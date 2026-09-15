# Benchmark findings

## At a glance

**The skill.** [structuring-agent-docs](https://github.com/wistrand/structuring-agent-docs)
tells a coding agent how to lay out a project's docs: a short `CLAUDE.md` that the agent
reads every session, linking to topic files in `agent_docs/` that it opens only when a
task needs them. Two of its rules are the ones worth testing. Facts whose absence would
silently break an edit belong inside `CLAUDE.md`, not in a linked file. And docs should
point at the file that defines a value rather than copy the value, which goes stale.

**What the benchmarks do.**

- Placement: one surprising project fact is put inside `CLAUDE.md`, in a linked file, two
  links away, or nowhere. Each AI model then does a small task that needs the fact, and
  the benchmark checks whether the answer used it.
- Authoring: models write docs for a small repository, with and without the skill, and
  the benchmark checks whether the docs copy settings values or point at their source.

**What they say about the skill.**

- Keeping critical facts in `CLAUDE.md` is right. Some models follow links reliably, but
  others almost never open a linked file, and a doc author cannot know which model will
  read the docs.
- An `@`-import saves nothing: it loads the whole file into every session, costing as
  much context as writing the text inline.
- Turning on reasoning does not reliably make up for a model that does not look.
- The skill works on the authoring side: given it, most models tested pointed at the
  source in nearly every doc set; without it, most copied the values.
- Nothing measured argues for changing the skill.

## How this file is kept

Recorded results from the placement and authoring benchmarks (see [README.md](README.md)
for the harness). Each run is a point-in-time snapshot: it depends on the exact models
and the provider on the day. Treat runs as immutable; on a rerun, append a new dated
section rather than overwriting an old one. Durable takeaways are separated from the
numbers, because the takeaways outlast any single model lineup.

## Summary

Consuming side (placement benchmark), robust across the 2026-07-01 and 2026-09-15 runs:

- Blast radius holds. Keep critical, default-overriding facts inline. Whether a model
  opens a linked doc depends on the specific model, not its capability tier: sonnet-5,
  opus-5, and deepseek-v4-pro followed links even under a non-urging prompt, while
  gpt-5.6-terra opened a linked doc in 1 of 200 link and chain runs across every prompt
  and reasoning setting, and weak models (llama-3.1-8b, ministral-8b) almost never follow
  links (0-15%). An author cannot know which model will read the docs, so inline is the
  only placement that works for all of them.
- The `@`-import warning holds. An `@`-import costs the same context as inline and saves
  nothing, confirmed in both runs and by the harness spec (imports load eagerly).
- For models that follow links conditionally, the harness's system prompt is the dominant
  lever, not the doc's labels or a per-link hint: sonnet-4.6 and gpt-4o-mini follow links
  under an eager prompt and mostly stop under a neutral one. Low-cue, default-overriding
  facts (`centiseconds`) are missed more than cued ones.
- Reasoning is not a substitute for inline placement. Turning it on helped only
  gemini-3.8-flash under a neutral prompt, barely changed gpt-5.6-terra, and was
  irrelevant for models already at ceiling.

Authoring side (authoring2), real and broader than the first run suggested:

- The skill's drift-resistance discipline (don't copy volatile values; point into source;
  generate) measurably improves authored docs. Given the skill, sonnet-4.6, sonnet-5,
  opus-5, gemini-3.8-flash, and deepseek-v4-pro pointed at the schema in every doc set and
  gpt-5.6-terra in 9 of 10; without it they hand-copied the values in 80-100% of doc sets.
  The benefit is not simply capability-gated: gemini-3.8-flash and deepseek-v4-pro, priced
  at or below haiku-4.5, respond fully, while haiku-4.5 responds only partially (50%
  robust with the skill).
- The structural classifier cannot tell a short doc that never states the values from a
  disciplined pointer, so an author with an already terse baseline (qwen3.8-flash) shows
  no skill effect. The meaning axis had a clean control but did not discriminate in either
  run (a handed-over why is documented by both arms).
- The earlier `authoring.js` downstream metric was confounded (a source-derivable fact
  with the source removed); `authoring2.js` is the corrected design.

No result argued for changing the skill; several validate its claims. Recurring caveats:
n=2 produced spurious "clean wins" twice that higher n reversed, so trust n>=10 and treat
small runs as noise. Every run is one provider on one day, two placement cases, one
authoring fixture, and one-shot (so no long-horizon drift). A provider safety filter
refused 8 of 10 opus-5 baseline authoring prompts in the 2026-09-15 run, so that row rests
on n=2. The dated sections below are the chronological record and the evidence behind
this summary.

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

## Authoring run: 2026-07-01 (OpenRouter)

Tests the authoring side: does an agent given the skill produce better-structured docs
than one without it? A synthetic repo (`authoring-cases.js`) with facts planted in
source; two arms (skill = given `SKILL.md` + `references/`; baseline = generic "write
agent docs"); graded on capture (did the produced docs surface each planted fact) and
downstream honor (a consuming agent given only the produced docs honors the buried
invariant, via `--consume-model`/`--consume-system`).

### The fixture had to be hardened

v1 put the facts in obvious source comments. A capable author (haiku-4.5) captured all
four and honored downstream 100% in both arms: no discrimination, because a plain "write
docs" pass already surfaces flagged comments. v2 buries the invariant behind a `TICK_HZ`
constant and a division (no "centiseconds" comment), strips the giveaway comments on the
id rule and the warmup hazard (leaving only a runtime warn string), and adds distractor
files. v2 discriminates: capture rates now spread across 0-100% instead of a uniform
100%.

### Weak-author results are inconclusive

Two runs, weak authors (gpt-4o-mini, llama-3.1-8b), n=3 per cell.

- Capture did not replicate. Run 1 (author consumed its own docs) had skill above
  baseline on the buried invariant (gpt 33% vs 0%, llama 67% vs 0%). Run 2 (docs
  consumed by a strong model) flattened or reversed it (gpt skill 0% vs baseline 33%,
  llama 33% vs 33%). At n=3 a rate is 0/1/2/3 of three, so these swings are noise; no
  reliable skill capture advantage was established, and the run-1 numbers should not be
  read as one.
- Downstream floored at 0% in both runs, even when a strong model (sonnet-4.6) read the
  produced docs. In the cells where the unit was "captured," the doc still gave no usable
  conversion: the strong consumer answered `scheduleRetry(3000)` (the ms default) anyway.
  A mention of ticks/`TICK_HZ` is not the same as an inline, actionable "3 seconds = 300".

### Reading it

- The fixture is now sound (it discriminates), but this run shows no skill authoring
  advantage, and it would be wrong to claim one from the noisy run-1 numbers.
- Two likely reasons, both about the experiment, not the skill: n=3 is far too small, and
  a weak model may not reliably execute the skill's instructions (following a skill is
  itself a capability), so skill-vs-baseline is muddy for weak authors, echoing weak
  models ignoring links in the placement benchmark.
- Capturing a fact's existence is not the same as making it actionable and well placed;
  weak authors surfaced the unit occasionally but never in a form a downstream agent
  could apply.

### Next

To actually test the authoring claim, run capable authors (haiku-4.5, sonnet-4.6) on the
hardened fixture at higher n (10-20), with a strong decoupled consumer, and judge on
downstream honor, not just capture. Weak authors are probably the wrong subject: a model
that cannot follow the skill cannot show its benefit.

### Capable-author results (n=10, strong consumer sonnet-4.6, neutral)

Authors haiku-4.5 and sonnet-4.6; consumer sonnet-4.6; consume-system neutral.

- Capture saturated: both arms captured all four facts at ~100% for both authors. Capable
  models document the buried facts with or without the skill, so capture no longer
  discriminates (the fixture would need still-harder-to-find facts).
- Downstream under neutral: no help, and for sonnet the skill hurt.
  - haiku authored: skill 40%, baseline 40% (tie).
  - sonnet authored: **skill 0%, baseline 70%.**
- Mechanism (from the raw): sonnet-skill captured the invariant 100% but honored 0%.
  capture-100% with downstream-0% means the fact was written down but not in the
  always-loaded CLAUDE.md, so the neutral consumer, which does not open links, never saw
  it. The skill's factoring discipline (lean CLAUDE.md, detail into agent_docs) moved a
  default-overriding invariant off the always-loaded surface. Baseline dumped everything
  inline, so the consumer read the conversion and answered 300.

Reading it:

- This is the skill's own blast-radius silent miss, triggered by its own factoring
  guidance: a capable author factored a must-inline invariant into a deep dive, and a
  non-eager reader missed it. The skill's "flag critical invariants inline" rule was
  outweighed by its louder "keep CLAUDE.md lean, factor into agent_docs" pull.
- It is under the pessimistic (neutral) consumer, so we ran eager next to check whether
  it was just a placement artifact. It was not only that, but it was still an artifact:
  see the eager run below.

### Eager run (n=10): the gap did not close, and that exposed a benchmark flaw

Same capable authors and strong consumer, `--consume-system eager`.

- haiku authored: skill 20%, baseline 40%.
- sonnet authored: skill 10%, baseline 90%.

Eager did not rescue the skill arm, so the neutral result was not merely a non-eager
placement artifact. But the notes reveal the real cause, and it is the benchmark, not the
docs. Skill-arm consumers mostly answered `no scheduleRetry(N)` (declined) or 3000 (the
ms default); baseline-arm consumers answered 300.

The downstream consumer sees the produced docs but NOT the repo source. The skill teaches
point-into-source and don't-copy-specific-values, so a skill-authored doc correctly says
"delays are in ticks; TICK_HZ is in scheduler.js" instead of hand-copying the number.
With the source removed, that pointer dangles: the consumer cannot resolve TICK_HZ=100,
so it declines to guess (the "no scheduleRetry" answers are the agent behaving well) or
falls back to the default. Baseline hand-copied "TICK_HZ=100, 3s=300" into the doc, the
drift-prone move the skill warns against, and so was self-contained without the source.

So the metric is confounded, and structurally so:

- The tested fact (centiseconds = delay / TICK_HZ) is derivable from source.
- Removing the source rewards copying the value and punishes pointing at it, inverting
  the skill's own guidance.
- Including the source would let the consumer derive 300 from code directly, making the
  docs redundant and washing out any difference.

A source-derivable fact therefore cannot fairly measure doc quality either way. The
"skill worse" numbers are an artifact of this setup, not evidence the skill produces
worse docs; the earlier provisional mark against the skill is withdrawn. If anything the
refusals show the skill's point-into-source working as designed, with the source it
points at deleted.

### What a fair authoring-downstream test needs

Test a fact that is NOT in the source (a why, a rejected approach, an external platform
trap) and is given to the author rather than discovered, so the doc is the only place it
can live; and give the consuming agent the repo source, as a real agent has. Then
downstream honor measures what the skill is actually for: carrying the residue code
cannot, and placing it where a later agent finds it. Since capture is saturated for
capable authors, downstream is the only discriminator, and it must be built on a
not-in-source fact to be valid. That is a redesign, not a parameter change.

Bottom line for the authoring side: capture does not discriminate for capable authors,
and the downstream metric as built is invalid for source-derivable facts. This benchmark
has produced no valid evidence for or against the skill's authoring value.

Caveats: weak run n=3, capable runs n=10; two to four models; one provider, one day, one
repo; one-shot, so no drift; the downstream metric is invalid for source-derivable facts
(see above).

## Authoring v2 run: 2026-07-01 (OpenRouter)

`authoring2.js` split the measurement into a mechanical structural axis (point-to-source
vs copy-the-literal) and a behavioral meaning axis (a why not in code, consumer given the
source, plus a source-only control). First run (haiku-4.5, sonnet-4.6 authors; sonnet-4.6
consumer; n=2) did not discriminate, and exposed two metric flaws rather than a result:

- Structural: copied 100% for both arms. But the classifier flags any literal as fragile,
  so it cannot tell a generated settings doc that lists the values (the skill's endorsed,
  drift-safe approach) from values hand-copied into prose (fragile). The number is
  uninterpretable, and the harness does not save the produced docs to disambiguate.
- Meaning: the control (source only, no docs) was not 0 (sonnet 50%), because the chosen
  why, warmup then black frames, is guessable from domain priors. Honor is contaminated by
  the consumer's own knowledge. And the why was handed to both arms, so both documented it
  (no capture gap).

Deeper tension: capable authors capture facts with or without the skill, given or
discoverable, so neither capture nor meaning discriminates for them. The only axis that
could is structural drift-resistance (generate/point vs hand-copy), which is exactly the
axis the classifier gets wrong.

To fix and retry: (1) credit a literal that sits in a GENERATED-marked doc or alongside a
source pointer as robust, count only bare hand-prose literals as fragile, and save the
produced docs to verify; (2) use an arbitrary, unguessable why so the control floors at 0.
Absent those fixes, the authoring side remains unmeasured: the plausible honest conclusion
is that the skill has no capture/meaning advantage for capable authors, and any authoring
value is structural, pending a correct structural classifier.

Update: those fixes are now in `authoring2.js` / `authoring2-cases.js`, verified offline
but not yet run for real. The classifier credits a literal that sits in a GENERATED-marked
doc or alongside a source pointer as robust and counts only bare hand-prose literals as
fragile; the meaning why is now arbitrary ("grayscale") so the control floors at 0; and
produced docs are saved via `--out` for inspection. The offline check discriminates as
designed (skill robust, baseline fragile; control 0).

### Corrected run (n=2, capable authors, sonnet consumer, eager): a structural win

With the fixed classifier and the arbitrary why, the corrected benchmark produced the
first valid authoring signal, and it favors the skill:

- Structural: skill robust 100%, baseline fragile 100%, for both `ttlSec` and
  `maxWidgets`, across both haiku-4.5 and sonnet-4.6 authors. Skill-guided authors point
  at the schema or list the values in a GENERATED-marked doc (drift-safe); baseline
  authors hard-copy the literals into prose (will drift). 4/4 vs 0/4 across two models is
  an unambiguous direction even at n=2.
- Meaning: control 0% for both models (the arbitrary "grayscale" why is unguessable, so
  the metric is now clean); skill 100% both; baseline 100% (haiku) / 50% (sonnet). Skill
  is at least as good, but since the why was handed to both arms both document it, so this
  axis mostly confirms the honor is doc-driven rather than showing a strong skill edge.

Reading it: the skill's authoring value is real and measurable on the drift-resistance
axis, its actual thesis (don't copy volatile values; point into source; generate). It
validates those rules; it does not call for changing the skill. The consuming-side value
was already shown by the placement benchmark; this closes the authoring side.

Caveat: n=2, and it turned out to matter. The n=10 run below shows the haiku 100% was
noise (true ~20%); the clean structural win holds only for sonnet.

### Corrected run (n=10): the structural win is sonnet-only

At n=10 the picture sharpens and partly reverses the n=2 read:

- sonnet authored: skill robust 100%, baseline fragile 100% (both facts). Clean, strong
  win: a capable author given the skill reliably points at the schema or generates the
  values instead of hard-coding them.
- haiku authored: skill robust ~20%, baseline robust ~10-40% (both mostly fragile). No
  skill advantage; on `ttlSec` baseline was even more robust than skill (40% vs 20%). The
  skill did not move a mid-tier author away from hard-copying values.
- Meaning: control 0% both (the arbitrary why works); skill 100% and baseline 100% both,
  so no discrimination (the why was handed to both arms).

So the skill's authoring benefit on the drift axis is real but model-dependent: a strong
author (sonnet) follows the don't-copy / point / generate discipline; a mid author
(haiku) hard-copies values regardless of being given the skill. The n=2 haiku 100% was
noise. This echoes the placement finding that instruction-following is not uniform across
capability: "don't copy specific values" has limited traction below the top tier.

Net authoring conclusion: the skill measurably improves drift-resistant structure for a
capable author and shows no measurable effect for a mid author on this fixture. It
validates the rules where they are followed and does not argue for changing the skill,
though the weak traction on mid models is consistent with the placement-side salience
caveat.

## Run: 2026-09-15 placement refresh (OpenRouter)

Phase 1 of [plans/2026-09-15-model-refresh.md](plans/2026-09-15-model-refresh.md). Cases
`centiseconds` and `id-prefix`, five placements, `--repeats 10` (n=20 per cell),
temperature 0.7, `--reasoning off`, `--max-tokens 8192`, `--max-invalid 2`. Three of the
six July configurations: eager prompt with descriptive labels (e:desc), eager prompt
with blind labels (e:blind), and neutral prompt with blind labels (n:blind). Ten models:
the four July anchors plus `anthropic/claude-sonnet-5`, `anthropic/claude-opus-5`,
`openai/gpt-5.6-terra`, `google/gemini-3.8-flash`, `deepseek/deepseek-v4-pro-0813`, and
`mistralai/ministral-8b-2512`.

Run conditions:

- Reasoning was off for every reasoning-capable model except gemini-3.8-flash, whose
  reasoning is mandatory; it ran at effort `low`.
- sonnet-5 and gpt-5.6-terra do not accept `temperature`, so their repeats sampled at
  the provider default.
- 3000 runs, 1 invalid (gemini, a whitespace-only reply after 16 reads, excluded), 0
  usage gaps. 13 gemini completions ended with a provider `error` finish reason and
  succeeded on retry. Reported cost $4.58.
- Since July the harness gained reasoning control, invalid-run exclusion, cost capture,
  usage recovery, and provider-error retries (see
  [agent_docs/architecture.md](agent_docs/architecture.md)). An earlier attempt at this
  phase was stopped before per-run streaming existed, and a stopped e:blind attempt was
  superseded; neither is used here.

### Anchors match July

| model                            | config  | link July | link 2026-09 | chain July | chain 2026-09 |
|----------------------------------|---------|-----------|--------------|------------|---------------|
| anthropic/claude-sonnet-4.6      | e:desc  | 75        | 75           | 40         | 50            |
| anthropic/claude-sonnet-4.6      | e:blind | 75        | 75           | 70         | 55            |
| anthropic/claude-sonnet-4.6      | n:blind | 20        | 15           | 0          | 0             |
| anthropic/claude-haiku-4.5       | e:desc  | 70        | 80           | 100        | 100           |
| anthropic/claude-haiku-4.5       | e:blind | 100       | 95           | 100        | 95            |
| anthropic/claude-haiku-4.5       | n:blind | 70        | 55           | 60         | 70            |
| openai/gpt-4o-mini               | e:desc  | 70        | 75           | 55         | 55            |
| openai/gpt-4o-mini               | e:blind | 100       | 95           | 65         | 55            |
| openai/gpt-4o-mini               | n:blind | 0         | 0            | 0          | 0             |
| meta-llama/llama-3.1-8b-instruct | e:desc  | 0         | 15           | 0          | 0             |
| meta-llama/llama-3.1-8b-instruct | e:blind | 0         | 0            | 0          | 5             |
| meta-llama/llama-3.1-8b-instruct | n:blind | 0         | 0            | 0          | 0             |

`inline` and `import` honored 100% and `absent` 0% in every cell except two 95% `inline`
cells (llama e:desc, deepseek e:blind). Every anchor link and chain cell is within 15
points of July, so the harness changes did not move the anchors and the other models'
numbers are comparable.

### Follow-through (n=20), honor%

link:

| model                            | e:desc | e:blind | n:blind |
|----------------------------------|--------|---------|---------|
| anthropic/claude-sonnet-4.6      | 75     | 75      | 15      |
| anthropic/claude-haiku-4.5       | 80     | 95      | 55      |
| openai/gpt-4o-mini               | 75     | 95      | 0       |
| meta-llama/llama-3.1-8b-instruct | 15     | 0       | 0       |
| anthropic/claude-sonnet-5        | 100    | 100     | 100     |
| anthropic/claude-opus-5          | 90     | 100     | 100     |
| openai/gpt-5.6-terra             | 0      | 0       | 0       |
| google/gemini-3.8-flash          | 100    | 100     | 80      |
| deepseek/deepseek-v4-pro-0813    | 90     | 95      | 95      |
| mistralai/ministral-8b-2512      | 0      | 0       | 0       |

chain:

| model                            | e:desc | e:blind | n:blind |
|----------------------------------|--------|---------|---------|
| anthropic/claude-sonnet-4.6      | 50     | 55      | 0       |
| anthropic/claude-haiku-4.5       | 100    | 95      | 70      |
| openai/gpt-4o-mini               | 55     | 55      | 0       |
| meta-llama/llama-3.1-8b-instruct | 0      | 5       | 0       |
| anthropic/claude-sonnet-5        | 100    | 100     | 100     |
| anthropic/claude-opus-5          | 100    | 95      | 100     |
| openai/gpt-5.6-terra             | 0      | 0       | 0       |
| google/gemini-3.8-flash          | 100    | 90      | 75      |
| deepseek/deepseek-v4-pro-0813    | 80     | 80      | 75      |
| mistralai/ministral-8b-2512      | 0      | 0       | 0       |

Reading it:

- The 2026 Anthropic frontier models follow links without urging. sonnet-5 honored 100%
  on link and chain in all three configurations, opus-5 90-100%, and deepseek-v4-pro
  75-95% including n:blind. For these models the July result that a frontier model
  misses factored-out facts under a non-urging prompt does not hold.
- gpt-5.6-terra never follows a link. Across 120 link and chain runs, and 60 absent
  runs, it made 0 reads and answered in one turn with the natural default
  (`scheduleRetry(3000)`, `quarterly-sales`). The eager prompt did not change it. This
  harness has no native tool calling, so a model that ignores the `READ:` convention
  looks the same as one that declines to look; either way the fact is missed.
- The weak floor holds: ministral-8b stayed at 0% like llama-3.1-8b (llama 0-15% link).
- The system prompt remains the dominant lever for the July-era models: sonnet-4.6 link
  fell from 75% to 15% and gpt-4o-mini from 75-95% to 0% going from eager to neutral.
  sonnet-5, opus-5, and deepseek are insensitive to it; gemini drops modestly (link 100
  to 80, chain 100 to 75).
- The low-cue case still costs more. Under e:desc, sonnet-4.6 chain was 0% on
  `centiseconds` and 100% on `id-prefix`; gpt-4o-mini chain was 10% and 100%.
- One opus-5 e:desc link miss graded the token `antml` (markup on the answer line), so
  that cell likely understates opus-5 by one run.

### Token side

First-load tokens, mean over the three configurations:

| model                            | inline | import | link | chain | absent |
|----------------------------------|--------|--------|------|-------|--------|
| anthropic/claude-sonnet-4.6      | 319    | 335    | 285  | 285   | 259    |
| anthropic/claude-haiku-4.5       | 318    | 334    | 284  | 284   | 258    |
| openai/gpt-4o-mini               | 285    | 298    | 255  | 256   | 237    |
| meta-llama/llama-3.1-8b-instruct | 293    | 305    | 263  | 264   | 245    |
| anthropic/claude-sonnet-5        | 422    | 448    | 381  | 381   | 346    |
| anthropic/claude-opus-5          | 422    | 448    | 381  | 381   | 346    |
| openai/gpt-5.6-terra             | 284    | 297    | 254  | 255   | 236    |
| google/gemini-3.8-flash          | 297    | 314    | 270  | 269   | 244    |
| deepseek/deepseek-v4-pro-0813    | 285    | 300    | 256  | 257   | 235    |
| mistralai/ministral-8b-2512      | 290    | 305    | 258  | 258   | 237    |

Import first-load stayed above inline for every model, and link and chain below both, as
in July. The `@`-import still costs inline's context and saves nothing.

### Takeaways

- Keep critical, default-overriding facts inline. At least one frontier model
  (gpt-5.6-terra) and every weak model never open a linked doc, under any prompt.
- Link follow-through is model-specific rather than tier-specific: sonnet-5, opus-5, and
  deepseek-v4-pro follow links even unprompted, while gpt-5.6-terra never does.
  Capability tier alone does not predict it.
- Caveats: one provider, one day, two cases, n=20 per cell, reasoning off (phase 2 of
  the plan tests reasoning on), gemini at reasoning `low`, and no temperature control
  for sonnet-5 and gpt-5.6-terra.

## Run: 2026-09-15 reasoning arm (OpenRouter)

Phase 2 of [plans/2026-09-15-model-refresh.md](plans/2026-09-15-model-refresh.md). Same
cases and placements as phase 1, `--repeats 10` (n=20 per cell), temperature 0.7,
`--max-tokens 8192`, `--max-invalid 2`, configurations e:blind and n:blind. The four
models whose catalog default is reasoning on ran with `--reasoning default`:
`anthropic/claude-sonnet-5` and `anthropic/claude-opus-5` (default effort high),
`openai/gpt-5.6-terra` (medium), and `google/gemini-3.8-flash` (medium). Each is compared
against its own phase 1 row, where reasoning was off (gemini: effort low).

Run conditions:

- 800 runs, 5 invalid, all in gemini-3.8-flash `absent` cells: whitespace-only or empty
  replies after several reads, one `tool_calls` finish, and one run that emitted 1965
  `READ:` lines and stopped on `MAX_TOKENS`. They are excluded; `absent` stays 0% for
  every model.
- The n:blind command crossed gemini's `--max-invalid 2` limit on its last runs. Every
  planned run had already completed, so no cell is short.
- 13 gemini completions ended with a provider `error` finish reason and succeeded on
  retry. 0 usage gaps. Reported cost $3.24.
- sonnet-5 and gpt-5.6-terra do not accept `temperature`.

### Reasoning off vs on (n=20), honor%

| model                     | config  | link off | link on | chain off | chain on | reasonTok on |
|---------------------------|---------|----------|---------|-----------|----------|--------------|
| anthropic/claude-sonnet-5 | e:blind | 100      | 100     | 100       | 100      | 13 / 12      |
| anthropic/claude-opus-5   | e:blind | 100      | 100     | 95        | 100      | 15 / 19      |
| openai/gpt-5.6-terra      | e:blind | 0        | 5       | 0         | 0        | 102 / 70     |
| google/gemini-3.8-flash   | e:blind | 100      | 95      | 90        | 95       | 156 / 173    |
| anthropic/claude-sonnet-5 | n:blind | 100      | 100     | 100       | 100      | 4 / 20       |
| anthropic/claude-opus-5   | n:blind | 100      | 100     | 100       | 100      | 61 / 30      |
| openai/gpt-5.6-terra      | n:blind | 0        | 0       | 0         | 0        | 117 / 125    |
| google/gemini-3.8-flash   | n:blind | 80       | 95      | 75        | 90       | 469 / 311    |

`reasonTok on` is the mean reasoning tokens per run with reasoning on, link then chain.

Reading it:

- Reasoning does not make gpt-5.6-terra follow links. With reasoning on it opened a
  file in 1 of 80 link and chain runs, honoring that one, and otherwise answered with
  the natural default under both prompts. It spent 70-125 reasoning tokens per run
  without deciding to read.
- sonnet-5 and opus-5 were already at or near ceiling with reasoning off and stayed at
  100%. At their default setting they used 4-61 reasoning tokens per run on this task.
- gemini-3.8-flash is the only model reasoning helped, and only under the neutral
  prompt: link rose from 80% to 95% and chain from 75% to 90%, while its reasoning
  tokens rose to 311-469 per run. Under the eager prompt it was already 90-100%.

### Takeaways

- Reasoning is not a substitute for keeping critical facts inline. It closed part of
  gemini's gap under a non-urging prompt, did nothing for a model that never looks
  (gpt-5.6-terra), and was irrelevant for models that already follow links.
- Caveats: one provider, one day, two cases, n=20 per cell. "Default reasoning" means a
  different effort per model, and gemini's baseline was effort low because it cannot
  turn reasoning off.

## Run: 2026-09-15 authoring refresh (OpenRouter)

Phase 3 of [plans/2026-09-15-model-refresh.md](plans/2026-09-15-model-refresh.md).
`authoring2.js` with eight authors, `--repeats 10` per arm (skill, baseline) plus 10
source-only controls per author. Consumer `anthropic/claude-sonnet-4.6` with the eager
prompt. `--reasoning off` for authors and consumer (the gemini author ran at effort
`low`), `--author-max-tokens 16000`, `--max-tokens 8192`, temperature 0.7 (not accepted
by sonnet-5 and gpt-5.6-terra). The skill came from the live sibling checkout.

Run conditions:

- 240 units, 0 errors, reported cost $5.99.
- The provider refused 8 of 10 opus-5 baseline authoring calls: finish `content_filter`,
  native `refusal`, message "This request triggered restrictions on violative cyber
  content and was blocked under Anthropic's Usage Policy." The prompt is the benign
  widgets fixture. The skill arm, which sends the same repository and note plus the
  skill text, was never refused. The opus-5 baseline row has n=2.
- The 2026-07-01 runs capped authoring at 2000 output tokens with no truncation check.
  Here sonnet-5 and opus-5 exceeded that in most units, and the July authors in some
  (haiku-4.5 2 of 10 per arm, sonnet-4.6 skill 4 of 10), so some July doc sets were
  likely cut short.

### Structural axis (n=10 per arm), robust% / fragile%

| author                        | skill ttlSec | skill maxWidgets | base ttlSec | base maxWidgets | skill doc tokens | base doc tokens | skill n | base n |
|-------------------------------|--------------|------------------|-------------|-----------------|------------------|-----------------|---------|--------|
| anthropic/claude-haiku-4.5    | 50 / 50      | 50 / 50          | 30 / 70     | 10 / 90         | 1716             | 1675            | 10      | 10     |
| anthropic/claude-sonnet-4.6   | 100 / 0      | 100 / 0          | 0 / 100     | 0 / 100         | 1970             | 1480            | 10      | 10     |
| anthropic/claude-sonnet-5     | 100 / 0      | 100 / 0          | 0 / 100     | 0 / 100         | 2357             | 3751            | 10      | 10     |
| anthropic/claude-opus-5       | 100 / 0      | 100 / 0          | 0 / 100     | 0 / 100         | 4209             | 4166            | 10      | 2      |
| openai/gpt-5.6-terra          | 90 / 10      | 90 / 10          | 20 / 80     | 20 / 80         | 1299             | 1436            | 10      | 10     |
| google/gemini-3.8-flash       | 100 / 0      | 100 / 0          | 10 / 90     | 10 / 90         | 1127             | 756             | 10      | 10     |
| deepseek/deepseek-v4-pro-0813 | 100 / 0      | 100 / 0          | 0 / 100     | 0 / 100         | 1241             | 1433            | 10      | 10     |
| qwen/qwen3.8-flash            | 80 / 20      | 70 / 30          | 90 / 10     | 90 / 10         | 1320             | 544             | 10      | 10     |

`omitted` was 0% in every cell. `doc tokens` is the mean authored output per valid unit.

### Meaning axis, honor%

| author                        | control | skill | baseline |
|-------------------------------|---------|-------|----------|
| anthropic/claude-haiku-4.5    | 0       | 90    | 100      |
| anthropic/claude-sonnet-4.6   | 0       | 90    | 70       |
| anthropic/claude-sonnet-5     | 0       | 70    | 70       |
| anthropic/claude-opus-5       | 0       | 100   | 100      |
| openai/gpt-5.6-terra          | 0       | 70    | 100      |
| google/gemini-3.8-flash       | 0       | 90    | 100      |
| deepseek/deepseek-v4-pro-0813 | 0       | 90    | 100      |
| qwen/qwen3.8-flash            | 0       | 90    | 90       |

Reading it:

- The skill's drift-resistance benefit holds and reaches beyond one vendor. With the
  skill, sonnet-4.6, sonnet-5, opus-5, gemini-3.8-flash, and deepseek-v4-pro pointed at
  the schema instead of copying the values in every doc set, and gpt-5.6-terra did in 9
  of 10. Without it, the same authors hand-copied the values in 80-100% of doc sets
  (opus-5 baseline on n=2).
- Anchors: sonnet-4.6 reproduces July exactly (skill robust 100%, baseline fragile
  100%). haiku-4.5 skill robust rose from about 20% in July to 50%, with its baseline
  still mostly fragile (70-90%). At n=10 that gap is within sampling noise, and July's
  cap cut some haiku doc sets short, so it is not evidence of a change.
- The July reading that the benefit is capability-gated needs narrowing. gemini-3.8-flash
  and deepseek-v4-pro, both far cheaper than sonnet, respond as fully as the frontier
  authors, while haiku-4.5 responds only partially.
- qwen3.8-flash shows no skill effect because its baseline is already robust (90%): it
  writes one short CLAUDE.md that names `config/settings.schema.json` without stating
  the values. That is robust by brevity rather than discipline, which the classifier
  cannot distinguish. With the skill it writes longer docs and copies a value more
  often (robust 70-80%).
- Meaning still does not discriminate: control is 0% for every author and both arms
  score 70-100%, because the why is handed to both arms.

### Takeaways

- Given the skill, most capable authors, across vendors and price points, stop
  hand-copying volatile values into docs. This validates the don't-copy and
  point-into-source rules and does not argue for changing the skill.
- A provider safety filter can refuse a benign doc-authoring prompt (opus-5 baseline, 8
  of 10). Record refusals per arm; an arm dominated by refusals cannot be compared.
- Caveats: one fixture repository, two structural facts, one consumer, n=10 per arm (n=2
  for opus-5 baseline), one-shot, and no long-horizon drift.
