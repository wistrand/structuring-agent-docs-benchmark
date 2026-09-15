# structuring-agent-docs benchmark

Agent entry point. Read this first, then the linked file for whatever you touch.

This repo is the placement + authoring micro-benchmark for the
[structuring-agent-docs](https://github.com/wistrand/structuring-agent-docs) skill.
It measures the skill's contested claims empirically: a fact factored out of an
always-loaded `CLAUDE.md` is missed more than the same fact kept inline, an `@`-import
costs the same context as inline while saving nothing, and a stronger author writes
more drift-resistant docs given the skill. Human-facing overview and full flag
reference: [README.md](README.md).

## Layout

Flat, dependency-free CommonJS (built-in `fetch`, Node 18+). Point-into-source index:

| Path                  | Role                                                                      | Key symbols                                   |
|-----------------------|---------------------------------------------------------------------------|-----------------------------------------------|
| `run.js`              | Placement-benchmark CLI + concurrent orchestration                        | `parseArgs`, `validateModels`, `dryRun`, worker pool |
| `agent.js`            | The simulated agent loop: `READ:`/`ANSWER:` over plain completions        | `runAgent`, `systemFor`, `SYSTEM_EAGER`/`SYSTEM_NEUTRAL` |
| `placements.js`       | Builds the five placement variants of a case                              | `placements`, `PLACEMENT_ORDER`, `baseClaudeMd` |
| `cases.js`            | The fact cases for the placement benchmark                                | array of `{ id, fact, question, grade }`      |
| `openrouter.js`       | Minimal OpenRouter client, no deps; resolves per-model reasoning settings | `chat`, `fetchModels`, `modelSettings`        |
| `authoring2.js` + `authoring2-cases.js` | Corrected authoring benchmark (structural + meaning). **Prefer this** | `resolveSkillDir`, `authorUnit`, `controlUnit` |
| `authoring.js` + `authoring-cases.js`   | Original authoring benchmark, kept as the record of a flawed design | — |
| `README.md`           | Human guide: what it measures, how to read results, every flag            | —                                             |
| `findings.md`         | Dated results + decision history (the gotchas/findings doc)               | append-only, see Invariants                   |
| `plans/`              | Dated run plans: lineups, commands, gates, cost estimates                 | not results; those go to `findings.md`        |

How the pieces fit, the five placements, the link-hint/system levers, and the two
authoring benchmarks' internals: [agent_docs/architecture.md](agent_docs/architecture.md).

## Run

This calls a **paid API**. Do not spend real runs unless asked. `--dry-run` needs no
key and makes no network calls — use it to inspect exactly what a model would see.

```
node run.js --dry-run                    # free: print every constructed variant
node run.js --help                       # flags
OPENROUTER_API_KEY=... node run.js --models anthropic/claude-haiku-4.5 --repeats 5
node authoring2.js --dry-run             # authoring arm's prompts, free
```

`npm run dry` / `npm run bench` / `npm run author2` wrap the same commands. No install
step — there are no dependencies.

## Invariants

Rules that must stay true. Breaking one silently makes the benchmark measure nothing.

- **Every case's natural default answer must be wrong, and not recoverable by grep or
  general knowledge.** That is the whole source of the benchmark's power: the `absent`
  placement then measures a real floor, not the model's prior. A fact a model already
  knows makes all five placements tie. Holds for `cases.js` and the `*-cases.js` fact
  sets. See `cases.js:3`.
- **A placement's variants may differ only in *where the fact lives*.** The base
  entry point (`baseClaudeMd`) and the task string stay constant across all five, so
  any outcome difference is attributable to placement alone. See `placements.js:3`.
- **An invalid run is never graded as a miss.** A reply left empty or cut off by the
  token budget (often spent on hidden reasoning) is a harness artifact. `isInvalid`
  (`agent.js`) keeps it out of honor denominators and reports it separately; any added
  grading path must do the same. See [agent_docs/architecture.md](agent_docs/architecture.md).
- **`findings.md` runs are immutable.** Each run is a point-in-time snapshot; on a
  rerun append a new dated section, never edit or overwrite an old one. Keep durable
  takeaways separate from the numbers.
- **Never vendor a copy of the skill.** The authoring benchmark loads a live skill
  checkout resolved via `--skill-dir` / `SKILL_DIR` / a sibling or in-repo path
  (`authoring2.js` `resolveSkillDir`). A copied-in `SKILL.md` would drift from the
  source under test.
- **Stay dependency-free, Node 18+.** No `npm install`, no added deps; use built-in
  `fetch`. Do not add a lockfile or third-party module.
- **This directory is never bundled into the published skill.** The shipped zip
  contains only `SKILL.md`, `references/`, and `templates/`. Don't write code that
  assumes the benchmark ships with the skill.

## Documentation style

Agent-facing prose. No AI-isms, no time-sensitive phrasing ("currently", "new"), no
emojis. Link docs with markdown (`[findings.md](findings.md)`); reserve backticks for
source paths and symbols (`run.js`, `runAgent`). Point into source rather than
restating it; when a doc and the code disagree, the code wins — fix the doc. Record
each meaningful run as a dated section in [findings.md](findings.md), and read its
Summary before changing the skill on the strength of a result (small n produces
spurious clean wins; trust n>=10).
