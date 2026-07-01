# Placement micro-benchmark

Measures the skill's central, contested claim: a fact factored out of the
always-loaded `CLAUDE.md` into a linked file is missed more often than the same fact
kept inline, and an `@`-import costs the same context as inline while saving nothing.

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
(the always-on cost).

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
    node benchmark/run.js --dry-run

    # real run against OpenRouter:
    OPENROUTER_API_KEY=sk-... node benchmark/run.js \
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
determinism), `--cases` (subset by id), `--link-hint` (see below), `--concurrency`
(default 6), `--out` (raw JSON), `--verbose`/`-v` (per-run detail as it runs),
`--dry-run`.

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

Recorded results live in [findings.md](findings.md); add a new dated section there on
each meaningful run rather than overwriting the last.
