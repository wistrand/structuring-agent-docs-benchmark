# Benchmark findings

Recorded results from the placement micro-benchmark (see [README.md](README.md) for the
harness). Each run is a point-in-time snapshot: it depends on the exact models and the
provider on the day. Treat runs as immutable; on a rerun, append a new dated section
rather than overwriting an old one. Durable takeaways are separated from the numbers,
because the takeaways outlast any single model lineup.

## Summary

Consuming side (placement benchmark), robust:

- Blast radius holds. A fact factored out of the always-loaded CLAUDE.md is missed unless
  the harness urges reading, so keep critical, default-overriding facts inline. Even a
  frontier model misses factored-out facts under a non-urging prompt; weak models never
  follow links at all.
- The `@`-import warning holds. An `@`-import costs the same context as inline and saves
  nothing, confirmed by the benchmark and by the harness spec (imports load eagerly).
- Follow-through is governed by the harness's system prompt, not the doc's labels or a
  per-link hint. Mainstream harnesses urge reading, so link-following is usually fine for
  capable models; the real risk is weak models and low-cue, default-overriding facts.

Authoring side (authoring2), real but narrower:

- The skill's drift-resistance discipline (don't copy volatile values; point into source;
  generate) measurably improves a capable author's docs (sonnet: robust 100% vs baseline
  fragile 100%) and shows no effect for a mid author (haiku: both mostly hard-copy). The
  benefit is capability-gated. The meaning axis had a clean control but did not
  discriminate (a handed-over why is documented by both arms).
- The earlier `authoring.js` downstream metric was confounded (a source-derivable fact
  with the source removed); `authoring2.js` is the corrected design.

No result argued for changing the skill; several validate its claims. Recurring caveat:
n=2 produced spurious "clean wins" twice that higher n reversed, so trust n>=10 and treat
small runs as noise. All runs are one provider, one day, a few models, one repo, one-shot
(so no long-horizon drift). The dated sections below are the chronological record and the
evidence behind this summary.

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
