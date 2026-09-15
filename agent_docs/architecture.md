# Architecture

How the benchmark is wired. For the conceptual framing (what each measure means and
why the facts are surprising on purpose) read [../README.md](../README.md); this file
indexes the code and records the wiring decisions that source alone doesn't explain.
Global invariants live in [../CLAUDE.md](../CLAUDE.md); this file adds subsystem-local
detail only.

## Placement benchmark data flow

```
run.js  --cases/--models/--link-hint/--repeats/--reasoning
  -> modelSettings(models, catalog)  openrouter.js   -> per-model reasoning object + notes
  -> placements(case, linkHint)      placements.js   -> 5 variants { alwaysLoaded, files }
  -> runAgent(model, variant, task)  agent.js        -> multi-turn READ:/ANSWER: loop, status
       -> chat(model, messages)      openrouter.js   -> completion, usage, cost, finish reason
  -> case.grade(finalText)           cases.js        -> { honored, note }
  -> aggregate per (model, placement), print table, optional --out JSON
```

`run.js` builds the full task list up front (one entry per model x case x placement x
repeat), then drains it through a bounded worker pool (`--concurrency`, default 6).
Each task is self-contained and carries its own coordinates, so the shared aggregates
are folded synchronously between awaits and no result is attributed to the wrong cell.
Raw records are sorted back into deterministic order before `--out` writes them, so the
JSON is identical regardless of completion order; only per-run `ms` varies.

## The simulated agent (`agent.js`)

`runAgent` models a coding agent with plain completions. `CLAUDE.md` is always in the
first user message; the model opens linked files by emitting `READ: <path>` lines,
which the harness answers from `variant.files`, then the model finishes with `ANSWER:`.
`maxTurns` caps the loop at 4. `firstPrompt` records turn-0 prompt tokens — the
always-on cost — separately from cumulative `prompt` tokens.

Whether the model bothers to `READ` a linked file **is** the follow-through the skill's
blast-radius argument is about; the harness does not force reads. `findFile` normalizes
paths (strips backticks/quotes/trailing punctuation) so a model's cosmetic variations
still resolve.

## Reasoning, token budget, and invalid runs

Reasoning models spend hidden tokens against the same completion budget as the visible
reply, so a tight budget yields an empty or cut-off answer that grades like a miss.
Three pieces keep that artifact out of the honor numbers:

- `resolveReasoning` / `modelSettings` in `openrouter.js` turn `--reasoning` into a
  per-model `reasoning` request object from the catalog's `reasoning` metadata
  (`mandatory`, `supported_efforts`). `off` sends `effort: "none"` where that level is
  listed, `enabled: false` otherwise, and the lowest listed effort where reasoning is
  mandatory, because effort `none` on a mandatory model is a 400. `default` sends
  nothing. The resolved settings print in the run header and land in `--out`.
- `chat` returns `finishReason` and a `usage` carrying `reasoning_tokens` and
  OpenRouter's reported `cost`. A 200 response with an error body is thrown, so 429/5xx
  still retry. A response with zero prompt tokens has lost its usage (seen on
  gemini-3.8-flash); `fetchGenerationUsage` recovers it from `GET /api/v1/generation`,
  retrying while the record lags, and `usage.source` records `response`, `generation`,
  or `missing`. `runAgent` counts `usageGaps`, and `run.js` leaves gap runs out of the
  token means so a false zero never lowers first-load tokens.
- `chat` retries a completion whose `finishReason` is `error` (a provider failure
  mid-generation, such as gemini's `MALFORMED_FUNCTION_CALL`) with the 5xx backoff,
  adds discarded attempts to `cost`, and reports `providerRetries`. After the last
  retry it returns the response rather than throwing, so the run is recorded invalid
  instead of printing an error line that stops a watched run.
- `statusOf` in `agent.js` labels the final turn `filtered`, `error` (provider error
  before `ANSWER:`), `empty`, `truncated` (length stop before `ANSWER:`), or `ok`, and
  `isInvalid` marks all but `ok`.
  `run.js` counts invalid runs per cell and excludes them from honor%. `authoring2.js`
  applies the check to the authoring call with `answerLine: false` (any length stop
  truncates a doc set), skips the consumer for an invalid author, and excludes invalid
  consumer and control runs from meaning honor%. An invalid author keeps a `detail`
  record (`finishReason`, `nativeFinishReason`, `refusal`, reply head) in `--out`.
  `statusOf` checks `content_filter` before emptiness, since a refusal often has no
  content.

Output survives a stop. `--out` streams each finished run, and each error, as a JSON
line to a `.runs.jsonl` file beside it; the sorted JSON is written at the end. Each
invalid run prints a `?` line with `status`, `finishReason`, `nativeFinishReason`,
`turns`, and the reply head, and its record keeps a `detail`. `--max-invalid` sets
`abortReason` once a model passes its share of invalid runs outside `absent`: workers
stop taking tasks, in-flight runs finish, outputs are written, and the exit code is 3.
`absent` is exempt (`LIMIT_EXEMPT`) because it grades 0% by design; gemini-3.8-flash
answers it with whitespace after searching for the missing fact, which stopped two runs
before the exemption.

Reasoning settings are per model, identical across that model's placements, so the
placement invariant (variants differ only in where the fact lives) is unaffected.

## The five placements (`placements.js`)

`placements(case, hint)` returns variants that differ only in where the fact sits:

| Variant  | Fact location                                          | `files` (readable on demand) |
|----------|--------------------------------------------------------|------------------------------|
| `inline` | inside the always-loaded `CLAUDE.md`                   | none                         |
| `import` | concatenated into `CLAUDE.md` (simulated `@`-import)  | none                         |
| `link`   | in a file `CLAUDE.md` links one level deep             | the fact file                |
| `chain`  | `CLAUDE.md` -> mid doc -> fact file (doc to doc to doc)| mid doc + fact file          |
| `absent` | nowhere                                                | none                         |

`import` deliberately carries the same tokens as `inline` — that is the `@`-import trap
made numeric. `absent` is the floor. `PLACEMENT_ORDER` fixes table/report ordering.

## The two levers (`--link-hint` x `--system`)

Discoverability is what actually tests the retrieval claim, and it is two independent
levers:

- **`--link-hint`** (`eager` | `neutral` | `blind` | `hint`) shapes the *docs*: `blind`
  makes the link label and file names generic (`project docs`, `agent_docs/reference.md`)
  so nothing signals a hidden convention; `hint` adds a per-link "read before you touch"
  imperative; `neutral` names the topic without urging; `eager` (default) names topics.
- **`--system`** (`eager` | `neutral`) shapes the *system prompt* eagerness
  (`SYSTEM_EAGER` vs `SYSTEM_NEUTRAL` in `agent.js`). When omitted it defaults from
  `--link-hint` (`eager` mode -> eager prompt, else neutral), so existing commands
  reproduce exactly. Set it to cross the levers, e.g. `--system eager --link-hint blind`.

The finding: follow-through is governed by the system prompt, not the doc labels. Run
`blind` with a non-urging prompt to see `link`/`chain` honor fall below `inline`.

## Authoring benchmarks

`authoring2.js` (prefer it) measures two on-thesis things about docs an agent *writes*,
`skill` arm vs `baseline` arm:

- **structural** (mechanical, no LLM): for a volatile settings value, does the produced
  doc point at the schema (`robust`) or hard-code the literal (`fragile`)? `classify` in
  `authoring2-cases.js`; a literal inside a `GENERATED`-marked doc still counts robust.
- **meaning** (behavioral): a why not present in the code is handed to the author; a
  consuming agent given the produced docs **and** the repo source runs a why-dependent
  task (`authorUnit`). A source-only `controlUnit` gives the caution baseline; the doc's
  contribution is honor above control.

`resolveSkillDir` finds a live skill checkout (`--skill-dir` / `SKILL_DIR` / sibling /
in-repo) and `readSkill` concatenates `SKILL.md` + `references/*.md` — never a vendored
copy (see [../CLAUDE.md](../CLAUDE.md) Invariants).

`authoring.js` is the earlier design, kept as the record of a confound: its downstream
metric removed the source for a source-derivable fact, which punished point-into-source
docs and rewarded value-copying. `authoring2.js` fixes it by separating the structural
and meaning axes. Detail and results: [../findings.md](../findings.md).
