# Model refresh run plan (2026-09-15)

Status: planned, not run. Prices come from the OpenRouter catalog on 2026-09-15.
Results go into [findings.md](../findings.md) as dated sections; this file is the plan,
not the record. Harness flags are documented in [README.md](../README.md).

## Questions

The 2026-07-01 runs used four models, one of them frontier, all without reasoning.
This refresh re-checks their open points on the 2026-09 catalog:

1. **Frontier follow-through.** Under a non-urging prompt a frontier model still missed
   factored-out facts, and haiku-4.5 honored linked facts more than sonnet-4.6. Does
   that hold for opus-5, sonnet-5, gpt-5.6-terra, gemini-3.8-flash, deepseek-v4-pro?
2. **Weak floor.** Weak models never followed links. Does ministral-8b match
   llama-3.1-8b?
3. **Reasoning.** Most 2026 models reason by default. Does reasoning change link and
   chain follow-through relative to the same model with reasoning off?
4. **Authoring gate.** The drift-resistance benefit appeared for a sonnet-4.6 author and
   not a haiku-4.5 author. Where do the newer and cross-vendor authors fall?

## Harness prerequisites (done 2026-09-15)

- `--reasoning default|off|low|medium|high`, resolved per model from the catalog.
- `--max-tokens` defaults to 8192 (was a fixed 512). `authoring2.js
  --author-max-tokens` defaults to 16000 (was a fixed 2000).
- Empty or cut-off replies are reported `invalid` and excluded from honor%.
- Per-run reported cost and reasoning tokens are recorded, with totals printed.
- Models without `temperature` support are flagged. In this lineup that is sonnet-5
  and gpt-5.6-terra; their repeats sample at the provider default.
- `authoring2.js` no longer crashes when an author writes no `CLAUDE.md`.

Comparability with 2026-07-01: those runs sent no reasoning parameter, and sonnet-4.6
and haiku-4.5 reason only when asked, so `--reasoning off` reproduces their condition.
The larger budget cannot change a one-line placement answer. For authoring, the old
2000-token cap may have truncated docs without detection, so compare anchor authors to
their July numbers with that caveat.

## Lineups

Placement, reasoning `off` in phases 0 and 1:

| Role                   | Model                              | $/M in | $/M out | Under `--reasoning off`   |
|------------------------|------------------------------------|-------:|--------:|---------------------------|
| Anchor                 | `anthropic/claude-sonnet-4.6`      |   3.00 |   15.00 | off                       |
| Anchor                 | `anthropic/claude-haiku-4.5`       |   1.00 |    5.00 | off                       |
| Anchor, weak           | `openai/gpt-4o-mini`               |   0.15 |    0.60 | non-reasoning             |
| Anchor, weak           | `meta-llama/llama-3.1-8b-instruct` |   0.05 |    0.08 | non-reasoning             |
| Anthropic ladder       | `anthropic/claude-sonnet-5`        |   2.00 |   10.00 | off; no temperature       |
| Anthropic ladder       | `anthropic/claude-opus-5`          |   5.00 |   25.00 | off                       |
| Frontier, other vendor | `openai/gpt-5.6-terra`             |   2.00 |   12.00 | off; no temperature       |
| Frontier, other vendor | `google/gemini-3.8-flash`          |   0.75 |    3.75 | low (reasoning mandatory) |
| Frontier, open weights | `deepseek/deepseek-v4-pro-0813`    |   0.98 |    2.95 | off                       |
| Weak, non-reasoning    | `mistralai/ministral-8b-2512`      |   0.15 |    0.15 | non-reasoning             |

Reasoning arm (phase 2), the models whose catalog default is reasoning on:
`claude-sonnet-5` (default effort high), `claude-opus-5` (high), `gpt-5.6-terra`
(medium), `gemini-3.8-flash` (medium, compared against its forced-low phase 1 run).

Authoring2 authors: `claude-haiku-4.5`, `claude-sonnet-4.6`, `claude-sonnet-5`,
`claude-opus-5`, `gpt-5.6-terra`, `gemini-3.8-flash`, `deepseek-v4-pro-0813`,
`qwen/qwen3.8-flash` ($0.15/$0.47, a cheap mid-tier probe of the gate). Consumer fixed
at `claude-sonnet-4.6`, eager, reasoning off, as in July.

## Phases

Shell setup shared by all phases (run from the repo root, key exported):

```
M=anthropic/claude-sonnet-4.6,anthropic/claude-haiku-4.5,openai/gpt-4o-mini,meta-llama/llama-3.1-8b-instruct,anthropic/claude-sonnet-5,anthropic/claude-opus-5,openai/gpt-5.6-terra,google/gemini-3.8-flash,deepseek/deepseek-v4-pro-0813,mistralai/ministral-8b-2512
R=anthropic/claude-sonnet-5,anthropic/claude-opus-5,openai/gpt-5.6-terra,google/gemini-3.8-flash
A=anthropic/claude-haiku-4.5,anthropic/claude-sonnet-4.6,anthropic/claude-sonnet-5,anthropic/claude-opus-5,openai/gpt-5.6-terra,google/gemini-3.8-flash,deepseek/deepseek-v4-pro-0813,qwen/qwen3.8-flash
```

`results*.json` and `results*.jsonl` are gitignored, so the `--out` files below stay local.
Each `--out` also streams finished runs to a `.runs.jsonl` file, so a stopped command
keeps its completed runs. `--max-invalid 2` stops a command cleanly (exit code 3) when a
model passes 2% invalid runs; isolated invalid runs are logged with their reply and
excluded from honor%.

### Phase 0: smoke (repeats 1)

```
node run.js --models $M --reasoning off --repeats 1 --system eager --link-hint blind -v --out results-2026-09-p0-off.json
node run.js --models $R --reasoning default --repeats 1 --link-hint blind -v --out results-2026-09-p0-reasoning.json
node authoring2.js --models $A --consume-model anthropic/claude-sonnet-4.6 --reasoning off --consume-reasoning off --repeats 1 --out results-2026-09-p0-author2.json
```

Per-model cost and invalid counts from a placement smoke file:

```
node -e 'const r=require("./results-2026-09-p0-off.json").raw,t={};for(const x of r){const s=t[x.model]??={runs:0,cost:0,invalid:0,reason:0};s.runs++;s.cost+=x.cost;s.reason+=x.tokens.reasoning;if(x.status!=="ok")s.invalid++}for(const s of Object.values(t)){s.usdPerRun=+(s.cost/s.runs).toFixed(5);s.reasonPerRun=Math.round(s.reason/s.runs)}console.table(t)'
```

Gate to phase 1, all must hold:

- No `invalid` runs and no `!` error lines. A 400 on the reasoning object means that
  model rejects it; run it in its own command with `--reasoning default` and record that.
- `reasonPerRun` is 0 for every `off` model except gemini-3.8-flash. Nonzero means the
  disable did not take; record the effective setting rather than calling it off.
- Rescaled costs fit the budget: phase 1 is about `usdPerRun x 300` per model, and
  phase 2 is about the reasoning smoke's `usdPerRun x 200` per model.

### Phase 1: placement core, reasoning off (n=10 per case, n=20 per cell)

The three configurations that carry the July conclusions: realistic (eager prompt,
descriptive labels), realistic without label cues, and worst case.

```
node run.js --models $M --reasoning off --repeats 10 --max-invalid 2 --link-hint eager --out results-2026-09-p1-eager-descriptive.json
node run.js --models $M --reasoning off --repeats 10 --max-invalid 2 --system eager --link-hint blind --out results-2026-09-p1-eager-blind.json
node run.js --models $M --reasoning off --repeats 10 --max-invalid 2 --link-hint blind --out results-2026-09-p1-neutral-blind.json
```

Anchor check before reading the other models: sonnet-4.6 and haiku-4.5 `inline` and
`absent` cells, expected near 100% and 0%, should match July within about 15 points.
A larger shift points to a harness or provider change; stop and investigate. Middle
cells (link, chain) carry about plus or minus 20 points of sampling noise at n=20.

### Phase 1b (optional): remaining July configurations

Only for a full six-configuration replication. July found labels and per-link hints
minor next to the system prompt, so this is low priority.

Opus-5 is excluded from every run after 2026-09-15 (user decision following its phase 3
refusals), so phase 1b uses `M1B`, the phase 1 lineup without it. From phase 1 reported
costs, that is about $0.87 per configuration, $2.60 for all three.

```
M1B=anthropic/claude-sonnet-4.6,anthropic/claude-haiku-4.5,openai/gpt-4o-mini,meta-llama/llama-3.1-8b-instruct,anthropic/claude-sonnet-5,openai/gpt-5.6-terra,google/gemini-3.8-flash,deepseek/deepseek-v4-pro-0813,mistralai/ministral-8b-2512
node run.js --models $M1B --reasoning off --repeats 10 --max-invalid 2 --link-hint neutral --out results-2026-09-p1b-neutral-descriptive.json
node run.js --models $M1B --reasoning off --repeats 10 --max-invalid 2 --system eager --link-hint hint --out results-2026-09-p1b-eager-hint.json
node run.js --models $M1B --reasoning off --repeats 10 --max-invalid 2 --link-hint hint --out results-2026-09-p1b-neutral-hint.json
```

### Phase 2: reasoning arm (n=10 per case)

Same two blind configurations as phase 1, models at their shipping reasoning default.
Compare each model's link and chain honor against its own phase 1 row. If a model sits
at inline-level honor in phase 1 `neutral-blind`, its reasoning run can only confirm a
ceiling; drop it first if the budget is tight. opus-5 is most of this phase's cost.

```
node run.js --models $R --reasoning default --repeats 10 --max-invalid 2 --system eager --link-hint blind --out results-2026-09-p2-eager-blind.json
node run.js --models $R --reasoning default --repeats 10 --max-invalid 2 --link-hint blind --out results-2026-09-p2-neutral-blind.json
```

### Phase 3: authoring2 (n=10)

```
node authoring2.js --models $A --consume-model anthropic/claude-sonnet-4.6 --reasoning off --consume-reasoning off --repeats 10 --out results-2026-09-p3-author2.json
```

Read `robust%` and `fragile%` per author against the sonnet-4.6 (robust) and haiku-4.5
(fragile) anchors. Any `invalid=` count means docs hit the 16000-token cap; rerun that
author with a larger `--author-max-tokens` before interpreting it. The harness runs a
control set per author even though the consumer is shared; the extra controls cost
about $0.40 in total and add n for the control estimate.

## Cost estimate

| Phase                | Runs                        |              Estimate | Budget |
|----------------------|-----------------------------|----------------------:|-------:|
| 0 smoke              | 140 placement, 24 authoring |                 $1.75 |     $5 |
| 1 placement core     | 3,000                       |                 $4.35 |    $10 |
| 1b optional          | 3,000                       |                 $4.35 |    $10 |
| 2 reasoning arm      | 800                         | $6.50 to $50, mid $18 |    $40 |
| 3 authoring2         | 160 authoring, 80 control   |                 $6.90 |    $15 |
| **Total without 1b** |                             |             about $31 |    $70 |
| **Total with 1b**    |                             |             about $35 |    $80 |

Budget doubles the estimate for tokenizer variance and verbose models, except phase 2,
which is set near its middle scenario plus margin and should be rescaled from the
phase 0 reasoning smoke. The phase 0 smoke numbers replace these estimates once they
exist.

Per model, phase 1 (three configurations): sonnet-4.6 $0.76, haiku-4.5 $0.25,
gpt-4o-mini $0.04, llama-3.1-8b $0.01, sonnet-5 $0.50, opus-5 $1.26, gpt-5.6-terra
$0.53, gemini-3.8-flash $0.73, deepseek-v4-pro $0.22, ministral-8b $0.03.

Phase 2 by reasoning tokens per turn:

| Model              | 300 tok | 1,000 tok | 3,000 tok |
|--------------------|--------:|----------:|----------:|
| `claude-sonnet-5`  |   $1.30 |     $3.54 |     $9.94 |
| `claude-opus-5`    |   $3.24 |     $8.84 |    $24.84 |
| `gpt-5.6-terra`    |   $1.51 |     $4.20 |    $11.88 |
| `gemini-3.8-flash` |   $0.49 |     $1.33 |     $3.73 |
| **Total**          |   $6.53 |    $17.90 |    $50.38 |

Phase 3 per author, authoring plus its consumer and control runs: haiku-4.5 $0.60,
sonnet-4.6 $1.19, sonnet-5 $0.90, opus-5 $1.78, gpt-5.6-terra $0.96, gemini-3.8-flash
$0.59, deepseek-v4-pro $0.54, qwen3.8-flash $0.34.

Method and assumptions:

- Prompt tokens come from the prompts the harness builds (characters divided by 3.5).
  A placement run averages about 600 prompt and 48 output tokens with reasoning off,
  counting every link as followed, which overstates neutral and blind runs.
- Visible output is 30 tokens per turn. gemini-3.8-flash adds 300 reasoning tokens per
  turn under `off`, since it cannot disable reasoning.
- Phase 2 reasoning volume is unknown before the smoke, hence three scenarios.
- Authoring: the skill arm sends about 13,800 input tokens (the live skill checkout is
  46,000 characters), the baseline about 600, and each doc set is 1,500 output tokens.
  A consumer run is 3,500 prompt and 150 output tokens; a control run 1,200 and 100.
- Retries on 429/5xx and any credit purchase fee are not included.

## Recording

- One dated findings section per phase, stating the lineup, the effective reasoning per
  model (from the run header or `settings` in the `--out` file), invalid counts, the
  temperature caveat for sonnet-5 and gpt-5.6-terra, and reported total cost.
- Keep July sections untouched; state anchor agreement or drift explicitly.
- Update the findings Summary only with results at n>=10 that hold across both cases.
