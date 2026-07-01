# Benchmark findings

Recorded results from the placement micro-benchmark (see [README.md](README.md) for the
harness). Each run is a point-in-time snapshot: it depends on the exact models and the
provider on the day. Treat runs as immutable; on a rerun, append a new dated section
rather than overwriting an old one. Durable takeaways are separated from the numbers,
because the takeaways outlast any single model lineup.

## Run: 2026-07-01 (OpenRouter)

Cases: `centiseconds`, `id-prefix` (both arbitrary, surprising facts whose natural
default answer is wrong). Placements: inline, import, link, chain, absent.

Two levers, crossed. The system prompt is `eager` (urges reading) or `neutral` (no
urging); the link labels are `descriptive` (name the topic), `hint` (a per-link "read
before you touch X" imperative), or `blind` (generic label and file name). All six
combinations were run at `--repeats 10`, temperature 0.7, over the four models
`anthropic/claude-sonnet-4.6`, `anthropic/claude-haiku-4.5`, `openai/gpt-4o-mini`,
`meta-llama/llama-3.1-8b-instruct` (n=20 per cell).

### Follow-through by system prompt x labels (n=20), honor%

`inline` and `import` honored 100% and `absent` 0% in every cell, so only link and
chain vary. Columns are prompt:label, e = eager prompt, n = neutral prompt.

link:

| model                       | e:desc | e:hint | e:blind | n:desc | n:hint | n:blind |
|-----------------------------|--------|--------|---------|--------|--------|---------|
| anthropic/claude-sonnet-4.6 | 75     | 100    | 75      | 0      | 0      | 20      |
| anthropic/claude-haiku-4.5  | 70     | 85     | 100     | 50     | 45     | 70      |
| openai/gpt-4o-mini          | 70     | 100    | 100     | 0      | 0      | 0       |
| meta-llama/llama-3.1-8b     | 0      | 0      | 0       | 0      | 0      | 0       |

chain:

| model                       | e:desc | e:hint | e:blind | n:desc | n:hint | n:blind |
|-----------------------------|--------|--------|---------|--------|--------|---------|
| anthropic/claude-sonnet-4.6 | 40     | 75     | 70      | 5      | 10     | 0       |
| anthropic/claude-haiku-4.5  | 100    | 100    | 100     | 70     | 50     | 60      |
| openai/gpt-4o-mini          | 55     | 65     | 65      | 0      | 0      | 0       |
| meta-llama/llama-3.1-8b     | 0      | 5      | 0       | 0      | 0      | 0       |

Reading the matrix:

- The system prompt is the dominant lever. Within any label style the eager prompt beats
  the neutral one, often by everything: gpt link 0 -> 100 (blind) and 0 -> 70
  (descriptive); sonnet link 0 -> 75 (descriptive). Neutral collapses, eager rescues.
- Under an eager prompt, label style barely matters for capable models. sonnet, haiku,
  and gpt all land 70-100 on link whether the label is descriptive, a hint, or blind;
  generic (blind) did about as well as the others. So an urged agent opens the linked doc
  regardless of what the label says. This measures, and largely refutes, the earlier idea
  that descriptive labels or the per-link hint help by signaling relevance.
- The weak model never follows links: llama is 0 on every factored-out cell under every
  prompt and label. For a model like it, only inlining works.
- Even an eager prompt does not fully close the gap for capable models. sonnet chain ran
  40-75 and gpt chain 55-65, and the low-cue `centiseconds` case was missed more than
  `id-prefix`. Depth plus a confident default still costs honor.

### Token side (all models, all configs)

Import first-load tokens tracked inline first-load tokens and stayed above link/chain
first-load tokens. The `@`-import loads eagerly, costs what inline costs, and saves
nothing. The worst-case cell appeared for every model that stopped reading under blind:
link/chain at roughly the same token count as `absent` (context "saved") with 0% honor
(answer silently wrong).

## Harness eagerness: how to read the link/chain numbers

The `neutral`, `hint`, and `blind` configs use a system prompt that does not urge
reading. Real coding harnesses urge it strongly, so those configs are a pessimistic
bound and `eager` is the realistic operating point. Evidence (mainstream harnesses,
mid-2026):

- Cursor: "you MUST read the contents ... before editing"; gather "the full picture
  before replying"; "trace every symbol back to its definitions and usages"; "bias
  towards not asking the user for help if you can find the answer yourself."
- Claude Code: "read before modifying" is a core task-execution instruction; a brief
  read-only investigation precedes clarifying questions; plan mode mandates exploring
  the codebase.
- Codex: auto-injects AGENTS.md (the model is "trained to closely adhere") and plans
  all needed reads before acting.

Two mechanisms, only one of which is a model choice:

- Auto-loaded context is eager by construction, not a choice: CLAUDE.md loads every
  session; `@path` imports expand into context at launch, recursively to four hops, with
  backticks opting out; Codex concatenates AGENTS.md from repo root to cwd. This confirms
  the skill's `@`-import warning from the harness spec, not only from this benchmark.
- Following a markdown link to a deep dive is the model's choice, governed by the
  eagerness above. That is the only thing the link/chain cells measure.

What it qualifies:

- The `eager` numbers (capable models 70-100% on one-level links) are the realistic case
  for descriptively-labeled links. The `neutral`/`blind` collapse is what happens only if
  the harness does not push reading, which mainstream ones do.
- Crossing the levers (eager prompt with blind labels, and with hint labels) measured
  this directly: under an eager prompt the label style barely mattered for capable models,
  with blind doing about as well as descriptive or hint. So an urged agent opens the doc
  regardless of the label; the relevance signal is not what drives reading. The skill's
  label/hint advice is neither the safeguard nor harmful, just a minor nicety.
- Blast radius still holds as the safe default: even under `eager`, low-cue facts that
  override a confident default were missed (sonnet chain 40%, gpt `centiseconds` link
  ~40%). And harness eagerness is neither universal (sub-agents, headless runs, custom
  harnesses, cheap models vary) nor author-controlled, so inline stays the robust,
  tool-independent lever.

Sources: [Claude Code memory docs](https://code.claude.com/docs/en/memory),
[Piebald-AI Claude Code system prompts](https://github.com/Piebald-AI/claude-code-system-prompts),
[Cursor agent system prompt](https://gist.github.com/sshh12/25ad2e40529b269a88b80e7cf1c38084),
[Codex AGENTS.md guide](https://developers.openai.com/codex/guides/agents-md),
[x1xhlol leaked system prompts](https://github.com/x1xhlol/system-prompts-and-models-of-ai-tools).

## Findings

1. **A factored-out fact behind a non-obvious link is silently missed.** Under blind,
   link/chain honor fell to 0-70% while inline/import held at 100%. The `reads` metric
   shows the cause is retrieval, not comprehension: honor tracked whether the model
   opened the doc.
2. **Model capability does not prevent it.** Follow-through was not monotone in strength.
   Under the non-urging prompts sonnet-4.6 (the strongest) missed the chain entirely, and
   even under the eager prompt it trailed the mid-tier haiku (sonnet chain 40-75 vs haiku
   100). A capable model is often more confident in its prior and answers without checking.
3. **Task cueing drives follow-through more than raw weakness.** Both Anthropic models
   checked the `id-prefix` task far more than `centiseconds` (haiku link 100% vs 40%).
   "Create an ID" hints a naming rule may exist; "retry after 3 seconds" feels
   self-evident, so the model confidently answers wrong. The silent miss is worst
   exactly where the wrong default feels most obvious.
4. **Depth ordering was within noise.** The blind run hinted chain <= link (haiku 60
   vs 70), but neutral reversed it (haiku chain 70 vs link 50). At n=20 the link-vs-chain
   order is not stable, so this benchmark neither confirms nor refutes "one level deep
   beats nested"; the honest statement is that both are missed far more than inline.
5. **The `@`-import trap holds across models.** Same context cost as inline, no savings.
6. **The system prompt is the lever; label style barely matters under it.** Crossing the
   two knobs at n=20: the eager prompt beat the neutral one within every label style (gpt
   link 0 -> 100 blind, 0 -> 70 descriptive), and under the eager prompt descriptive, hint,
   and blind labels all landed 70-100% for capable models. So what makes an agent open a
   linked doc is the harness's instruction to read, not the label or an in-document "read
   before you touch X" hint. This measures, and largely refutes, the earlier hypothesis
   that the per-link hint would be load-bearing.

## Takeaways (durable)

- Keep facts whose absence would silently corrupt an edit inline, regardless of model
  tier. The blast-radius rule held across four models including a frontier one.
- The salience risk is not "weak models only." Reframe it as: no model reliably follows
  a link that does not broadcast its relevance, and a confident strong model can be worse
  than a mid-tier one.
- `@`-imports give inline's context cost with none of the routing benefit.
- What makes a model open a linked doc is the harness's instruction to read (see "Harness
  eagerness"), not the link's label or a per-link hint: under an eager prompt, blind labels
  did about as well as descriptive or hint. So the label/hint is a minor nicety, not a
  follow-through mechanism. Harness eagerness is also not author-controlled or universal
  (the weak model never followed links at all), so keeping critical, default-overriding
  facts inline stays the robust lever.

## Caveats

- The pessimistic bound is the non-urging (`neutral`) prompt, not generic labels: under
  an eager prompt even blind labels did fine for capable models. Mainstream harnesses urge
  reading, so the realistic regime is the eager rows; treat the neutral rows as the worst
  case, which is the right bound for a "keep it inline" safety rule.
- Two cases, four models, one provider, one day. n=20 per cell makes the within-run
  rates trustworthy; the cross-model ordering (especially haiku above sonnet) is a real
  effect at this sample but worth re-checking as models change.
- Follow-through here is governed by the harness's system prompt, which this benchmark
  sets. A real coding harness has its own system prompt that may urge reading referenced
  docs (eager-like) or not; where it does, follow-through rises, but that is the
  harness's doing, not the doc author's. The lever the author controls is what stays
  inline.
