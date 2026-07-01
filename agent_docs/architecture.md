# Architecture

How the benchmark is wired. For the conceptual framing (what each measure means and
why the facts are surprising on purpose) read [../README.md](../README.md); this file
indexes the code and records the wiring decisions that source alone doesn't explain.
Global invariants live in [../CLAUDE.md](../CLAUDE.md); this file adds subsystem-local
detail only.

## Placement benchmark data flow

```
run.js  --cases/--models/--link-hint/--repeats
  -> placements(case, linkHint)      placements.js   -> 5 variants { alwaysLoaded, files }
  -> runAgent(model, variant, task)  agent.js        -> multi-turn READ:/ANSWER: loop
       -> chat(model, messages)      openrouter.js   -> OpenRouter completion + usage
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
