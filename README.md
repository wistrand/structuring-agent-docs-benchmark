# Placement micro-benchmark

Measures the skill's central, contested claim: a fact factored out of the
always-loaded `CLAUDE.md` into a linked file is missed more often than the same fact
kept inline, and an `@`-import costs the same context as inline while saving nothing.

Results: [findings.md](findings.md) records every run and opens with a summary of what
the runs have shown.

This is repo tooling, not part of the skill. The published zip ships only `SKILL.md`,
`references/`, and `templates/`; this directory is never bundled. It is dependency-free
Node (built-in `fetch`, Node 18+).

## What it does

Each case is one arbitrary, surprising, checkable fact whose natural default answer is
wrong (for example: durations are centiseconds, not milliseconds, so a 3-second retry
is `300`, not `3000`). Because the default is wrong, a model that never sees the fact
fails, so `absent` measures a real floor, not the model's prior knowledge.

The same fact and task run under five placements:

- `inline`  the fact sits inside the always-loaded CLAUDE.md
- `import`  the fact's file is eagerly concatenated into CLAUDE.md (simulated `@`-import)
- `link`    CLAUDE.md links the file one level deep; the model must open it
- `chain`   CLAUDE.md links doc A, which links the fact file (doc to doc to doc)
- `absent`  the fact appears nowhere

The model runs as a small agent: CLAUDE.md is always in context, and it opens linked
files by writing `READ: <path>`, which the harness answers. Honoring the fact is graded
automatically. Each cell reports honor rate, mean prompt tokens, and first-load tokens
(the always-on cost), plus invalid runs, reasoning tokens, and reported cost.

If the skill's claims hold, the shape should be:

- `inline` and `import` honor high; `link` lower and `chain` lower still, because each
  hop is a chance the model does not follow the link. This drop only appears under
  `--link-hint neutral` or `blind`. Under the default `eager` the system prompt coaches
  the model to open linked files and the labels advertise the topic, so `link`/`chain`
  honor near `inline`, which measures the token claims but not retrieval.
- `import` first-load tokens match `inline` (no savings), while `link` and `chain`
  first-load tokens are much smaller. That is the `@`-import trap made numeric.
- Weaker models should show a bigger inline-vs-link gap, which is the salience claim.

## Run

    # inspect exactly what each model would see, no API calls, no key:
    node run.js --dry-run

    # real run against OpenRouter:
    OPENROUTER_API_KEY=sk-... node run.js \
      --models anthropic/claude-haiku-4.5,openai/gpt-4o-mini \
      --repeats 5 --out results.json

    # from this directory you can also use the npm scripts (no install, no deps):
    npm run dry
    OPENROUTER_API_KEY=sk-... npm run bench -- --models anthropic/claude-haiku-4.5

Model ids must be exact OpenRouter slugs (see https://openrouter.ai/models); the
runner validates `--models` against the live catalog first and suggests close matches
on a typo, so a wrong id fails fast instead of spending a run. To test the salience
claim, pair a weak and a strong model, for example
`meta-llama/llama-3.1-8b-instruct,openai/gpt-4o-mini`.

Flags: `--models`, `--repeats` (default 5), `--temperature` (default 0.7, use 0 for
determinism), `--cases` (subset by id), `--link-hint` (see below), `--system`,
`--reasoning`, `--max-tokens` and `--max-invalid` (see "Reasoning models and invalid
runs"), `--concurrency` (default 6), `--out` (raw JSON), `--verbose`/`-v` (per-run
detail as it runs), `--dry-run`.

`--out results-x.json` also streams one JSON line per finished run, and per error, to
`results-x.runs.jsonl` after a header line, so a run stopped partway keeps what it
completed. The sorted JSON is written when the run ends.

`--link-hint eager|neutral|blind` sets how discoverable a factored-out fact is, which
is the lever that actually tests the retrieval claim:

- `eager` (default): the system prompt urges the model to open linked files, and link
  labels name the topic. Follow-through is near-perfect, so this measures the token
  claims, not retrieval.
- `neutral`: reading is allowed but not urged; labels still name the topic.
- `hint`: like `neutral` (no global urging), but the link line itself carries a
  "read X before working on Y" imperative, the skill's per-link hint. Tests whether
  that targeted nudge rescues follow-through without a blanket instruction to read.
- `blind`: no urging, and the link label and file names are generic (`project docs`,
  `agent_docs/reference.md`), so nothing signals that a routine task hides a
  convention. This is the real silent-miss test: run `blind` to see `link` and `chain`
  honor fall below `inline`, and the weak-vs-strong gap widen. Use `--repeats 10` or
  more here, since the interesting numbers are noisier.

`--link-hint` actually bundles two levers: the system-prompt eagerness and the label
style. `--system eager|neutral` overrides just the prompt, so you can cross them.
Without it, the prompt defaults from `--link-hint` (`eager` mode gets the eager prompt,
the others get the neutral one), so existing commands are unchanged. To isolate whether
descriptive labels or a per-link hint help once the harness already urges reading (the
realistic case, since mainstream harnesses do):

    # eager prompt + generic labels:
    ... --system eager --link-hint blind
    # eager prompt + per-link "read before you touch" hint:
    ... --system eager --link-hint hint

Runs execute concurrently through a bounded pool (`--concurrency`, default 6); each
individual run's multi-turn call stays sequential, and results are aggregated one at a
time, so no data is mixed. Because runs finish out of order, progress prints one
summary line per cell as that cell completes, `[8/20] model centiseconds/link  3/5
honored  60%  reads~1  tok~240`, and `--verbose` expands each run to its reads, tokens,
timing, and graded answer as it lands. Concurrency does not change the final tables or
the `--out` JSON (raw records are sorted back into deterministic order before writing);
only per-run `ms` latency varies. The final table adds a `reads` column, near 0 for
`inline`/`import`/`absent` and about 1 for `link`, 2 for `chain`, a direct read on
whether the model followed the links.

## Reasoning models and invalid runs

Most catalog models reason by default, and hidden reasoning tokens count against the
completion budget. A budget spent on reasoning leaves an empty or cut-off reply, which
would otherwise grade as a miss and pass for a placement effect.

- `--reasoning default|off|low|medium|high` sets reasoning for the run. `default` sends
  no reasoning parameter, so each model runs at its own default. The other modes
  resolve per model from the catalog's `reasoning` metadata: `off` disables reasoning
  where the model allows it and falls back to its lowest effort where reasoning is
  mandatory, and an unsupported effort maps to the nearest supported one. The run
  header prints what each model actually runs with.
- `--max-tokens` (default 8192) is the per-turn completion budget.
- A run whose final reply is empty, or stopped on length or a content filter before an
  `ANSWER:` line, is reported `invalid` and kept out of the honor denominator. A
  nonzero `invalid` count means raise `--max-tokens` or lower `--reasoning` and rerun
  that model. Each invalid run prints a `?` line with its status, finish reasons, turn
  count, and the head of the reply. `--max-invalid PCT` stops the run cleanly once any
  model's invalid runs exceed PCT% of its planned runs outside `absent`: no new runs
  start, in-flight runs finish, outputs are written, and the exit code is 3. `absent`
  grades 0% by design, so invalid runs there are reported but never trip the limit.
- A completion whose finish reason is `error` (a provider failure mid-generation, seen
  on gemini-3.8-flash) is retried like a 5xx. Discarded attempts count toward cost. If
  the last retry still fails, the run is recorded invalid with status `error`.
- Models whose catalog entry does not list `temperature` are flagged in the header.
  OpenRouter ignores unsupported parameters, so their repeats sample at the provider
  default; say so when recording the run.
- Each run records OpenRouter's reported cost and reasoning tokens. The table adds
  `reasonTok` and `cost$` columns, the run ends with a total, and `--out` stores the
  resolved per-model `settings` next to the raw records.
- A provider sometimes omits usage on a turn. The client then recovers tokens and cost
  from OpenRouter's generation stats endpoint. A run whose usage cannot be recovered
  stays in honor% but is left out of the token means, and the run summary counts it.

The 2026-07-01 runs sent no reasoning parameter under a 512-token cap. For the models
used in them, `--reasoning off` reproduces that condition.

Dated run plans with lineups, commands, and cost estimates live in [plans/](plans/).

## Read the results honestly

- Task design is the whole game. The facts are arbitrary and surprising on purpose, so
  the effect is real and not recoverable by grep or general knowledge. If you add a
  case, keep that property or the benchmark measures nothing.
- It measures today's models through one provider at one time. Re-run when models change.
- Honor rate at temperature above 0 needs repeats to be stable; raise `--repeats` for
  tighter numbers.
- It calls a paid API. `--dry-run` is free and shows exactly what the models see.
- It does not test long-horizon drift or maintainability, which are the skill's other
  claims and cannot be observed in a single run.

What the runs showed (consuming side): blast radius holds (a factored-out fact is missed
unless the harness urges reading, so keep critical facts inline), the `@`-import warning
holds (same context cost as inline, no savings), and follow-through is driven by the
harness system prompt rather than the doc's labels or a per-link hint. Full detail and the
authoring-side results are in [findings.md](findings.md), which opens with a summary. Add
a new dated section there on each meaningful run rather than overwriting the last.

## Authoring benchmark (`authoring.js`)

The placement benchmark tests the *consuming* side (agents working against a fixed doc
layout). `authoring.js` tests the *authoring* side: does an agent given the skill
produce better-structured docs than one without it?

Each run authors a doc set for a synthetic repo (`authoring-cases.js`) whose source has
facts planted in it (a default-overriding invariant, a naming rule, a why-behind-a-hack,
a generate-from-source candidate), in two arms: `skill` (the model is given `SKILL.md`
plus `references/`) and `baseline` (a generic "write agent docs" instruction). It grades
two ways:

- **capture**: did the produced docs surface each planted fact?
- **downstream**: given only the produced docs, does a consuming agent honor the
  default-overriding invariant? This reuses the placement harness's agent loop. It runs
  under `--consume-system neutral` by default, which rewards good placement (a critical
  fact kept inline in CLAUDE.md is honored; one buried or omitted is missed); pass
  `--consume-system eager` for the lenient, more realistic case.

Run:

    node authoring.js --dry-run                    # inspect both arms' prompts, no calls
    OPENROUTER_API_KEY=... node authoring.js --models anthropic/claude-haiku-4.5 --repeats 5

Caveats beyond the placement benchmark's: the produced artifact varies freely, so it is
noisier (use more repeats); the consuming agent sees only the produced docs, not the
source, to isolate doc quality; and, being one-shot, it cannot measure drift or
long-horizon maintainability. Do not grade by conformance to the skill's own rules
alone: that is near-tautological. Capture and downstream honor are the outcome measures.

`authoring.js`'s downstream metric turned out to be confounded: the tested fact was
derivable from source, and removing the source penalized the skill's point-into-source
docs while rewarding value-copying (see findings.md). `authoring2.js` is the corrected
design; prefer it. `authoring.js` is kept as the record of the flawed approach.

## Improved authoring benchmark (`authoring2.js`)

Fixes the confound by separating the two things a good doc does for a value-bearing fact
and measuring each fairly:

- **structural (mechanical):** for volatile settings values, does the doc point at the
  schema (ideal) or hard-code the literal (fragile)? Classified robust / fragile /
  omitted per doc, no LLM call (a literal in a GENERATED-marked doc counts as robust). This is the drift-resistance the skill's
  don't-copy-values / point-into-source rules are for.
- **meaning (behavioral):** a why that is not in the code, given to the author. The
  consuming agent is given the SOURCE (so pointers resolve and values are available) and
  a task whose safe answer needs the why. Only a doc that carried the meaning changes the
  outcome. A source-only control measures how often the model gets it right from caution
  alone; the doc's contribution is the honor above control.

Run:

    node authoring2.js --dry-run
    OPENROUTER_API_KEY=... node authoring2.js \
      --models anthropic/claude-haiku-4.5,anthropic/claude-sonnet-4.6 \
      --consume-model anthropic/claude-sonnet-4.6 --reasoning off --consume-reasoning off --repeats 10

`--reasoning` applies to the authors and `--consume-reasoning` to the consuming agent,
with the same modes as the placement benchmark. `--author-max-tokens` (default 16000)
bounds the authored docs; an empty or truncated doc set is reported invalid and skips
the consumer, since cut-off docs would grade as omitted or fragile. `--max-tokens`
(default 8192) bounds each consumer turn, and an invalid consumer run is excluded from
meaning honor%. An invalid author unit stores its finish reason, the provider's native
finish reason, any refusal text, and the head of the reply, so a refusal can be
diagnosed from `--out` without a rerun. `--arms baseline --no-control` reruns a single
arm without the control set, and `--out` streams finished units to a `.runs.jsonl` file.
The 2026-07-01 authoring runs capped docs at 2000 tokens
with no truncation check.

Read it as: skill vs baseline on `robust%` (higher is better, points-or-generates) and
`fragile%` (lower is better, hand-copied literal), and on `meaning honor%` relative to the `control` baseline.
Still one repo, few models, one-shot; the meaning grader is behavioral so it is fuzzier
than the placement benchmark's exact check.

What it showed (n=10): the structural benefit is capability-gated. A clean win for a
strong author (sonnet: robust 100% vs baseline fragile 100%) and no effect for a mid
author (haiku: both mostly hard-copy the values). The meaning axis had a clean control
(0%) but did not discriminate, since a handed-over why is documented by both arms. So
running it on a mid model alone will show little; use a strong author and n>=10. Detail
in [findings.md](findings.md).
