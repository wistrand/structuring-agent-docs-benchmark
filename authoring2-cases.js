'use strict';

// Improved authoring fixture. It separates the two things a good doc does for a
// value-bearing fact: point to the source for the volatile value (do not copy it) and
// capture the durable meaning the code cannot show.
//
// - Structural facts (settings defaults): the source holds the values; the ideal doc
//   points at the schema and does NOT hard-code the literals. Measured mechanically:
//   copied (literal present) vs pointed (schema named, no literal) vs omitted.
// - Meaning fact (warmup): the source shows the ordering but not why it matters. The why
//   is given to the author as a known issue. The consuming agent is given the SOURCE
//   (so pointers resolve and the value is available), and a task whose safe answer needs
//   the why. Only a doc that carried the meaning changes the outcome. A source-only
//   control measures how often the model gets it right from caution alone.

const repo = {
  'README.md': `# Widgets service

Schedules and renders dashboard widgets. Implementation in src/, config in config/.`,

  'src/index.js': `import { scheduleRetry } from './scheduler.js';
import { makeId } from './ids.js';
import { warmup, render } from './render.js';

export function boot() {
  warmup();
  return { scheduleRetry, makeId, render };
}`,

  'src/scheduler.js': `const TICK_HZ = 100;

export function scheduleRetry(delay) {
  const seconds = delay / TICK_HZ;
  return enqueue(seconds);
}

function enqueue(seconds) { /* ... */ }`,

  // No comment or warn string about consequences: from the code, warmup() looks like a
  // removable optimization. The why is supplied to the author separately.
  'src/render.js': `let primed = false;

export function warmup() { primed = true; }

export function render(widget) {
  return draw(widget, primed);
}

function draw(widget, useCache) { /* ... */ }`,

  'src/ids.js': `export function makeId(name) {
  return 'wgx_' + name.trim().toLowerCase().replace(/\\s+/g, '_');
}`,

  'src/format.js': `export function formatLabel(s) {
  return s.replace(/_/g, ' ');
}`,

  // Values live here. A good doc points here; a fragile doc copies 300 / 64 into prose.
  'config/settings.schema.json': `{
  "cache": { "ttlSec": { "type": "number", "default": 300 } },
  "render": { "maxWidgets": { "type": "number", "default": 64 } }
}`,
};

// Given to the author (both arms) as an extra input: a why that is not in the code.
// The consequence is deliberately arbitrary (not inferable from code or domain priors),
// so a source-only consumer cannot guess it and the control floors at 0. "grayscale" has
// no plausible cause from skipping a cache warmup; only the doc can supply it.
const authorNote = `Known issue (from production, not visible in the code): if warmup()
has not run before the first render(), every widget renders in grayscale until the app is
restarted. The boot-time warmup() call must not be removed.`;

// Structural value-facts. copied if the literal appears; pointed if the schema is named
// without the literal; omitted otherwise.
const structural = [
  { id: 'ttlSec', literal: /\b300\b/, pointer: /settings\.schema\.json/i },
  { id: 'maxWidgets', literal: /\b64\b/, pointer: /settings\.schema\.json/i },
];

// Classify how a value-fact is documented across the produced files:
//   fragile: the literal sits in a hand-maintained (non-generated) doc, so it will drift.
//   robust:  the fact is addressed by pointing at the source, or the literal appears only
//            in a GENERATED-marked doc (the skill's generate-don't-drift approach), so
//            there is no hand-copied literal to go stale.
//   omitted: the fact is not addressed at all.
function classify(files, fact) {
  const entries = Object.values(files);
  const isGenerated = (c) => /GENERATED|do not edit/i.test(c);
  const literalInHandProse = entries.some((c) => !isGenerated(c) && fact.literal.test(c));
  if (literalInHandProse) return 'fragile';
  const literalInGenerated = entries.some((c) => isGenerated(c) && fact.literal.test(c));
  const pointerNamed = entries.some((c) => fact.pointer.test(c));
  if (pointerNamed || literalInGenerated) return 'robust';
  return 'omitted';
}

// Meaning fact: a task whose safe answer requires knowing the warmup why. The consumer
// has the source, so it can see warmup()/render() but not why warmup is load-bearing.
// Honored means the answer both declines to remove AND cites the real consequence
// (black frames / cache priming), which is only in the docs.
const meaning = {
  task: `The warmup() call in boot() looks like optional initialization. Is it safe to
remove it to make boot faster? Answer YES or NO on a line starting with ANSWER:, then
one sentence explaining why.`,
  grade(ans) {
    const cites = /gr[ae]yscale|gr[ae]y\b/i.test(ans); // the arbitrary consequence, doc-only
    const keeps = /\bno\b|not safe|keep|must|don'?t|do not|preserve|required|before/i.test(ans);
    return { honored: cites && keeps, note: (ans.match(/ANSWER:.*/i) || [ans.slice(0, 60)])[0] };
  },
};

module.exports = { repo, authorNote, structural, classify, meaning };
