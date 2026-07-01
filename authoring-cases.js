'use strict';

// A synthetic repo whose important facts are NOT spelled out in tidy comments: they are
// inferable from code, or buried in a warn string, and surrounded by mundane distractor
// files. A naive "write agent docs" pass tends to describe the obvious surface and miss
// or misplace the facts that actually matter; the skill's disciplines (capture the why,
// flag invariants, point into source) push an agent to dig them out and place them where
// a later agent will see them. The repo is the whole game: if the facts are obvious, the
// benchmark cannot discriminate (an earlier, over-commented version did not).

const repo = {
  'README.md': `# Widgets service

Schedules and renders dashboard widgets. Implementation in src/.`,

  'src/index.js': `import { scheduleRetry } from './scheduler.js';
import { makeId } from './ids.js';
import { warmup, render } from './render.js';
import { formatLabel } from './format.js';
import { isValidName } from './validate.js';

export function boot() {
  warmup();
  return { scheduleRetry, makeId, render, formatLabel, isValidName };
}`,

  // Unit is inferable only from the division by TICK_HZ. No "centiseconds"/"ms" comment.
  'src/scheduler.js': `const TICK_HZ = 100;

export function scheduleRetry(delay) {
  const seconds = delay / TICK_HZ;
  return enqueue(seconds);
}

function enqueue(seconds) { /* ... */ }`,

  // Prefix convention is only in the return statement; no comment.
  'src/ids.js': `export function makeId(name) {
  return 'wgx_' + name.trim().toLowerCase().replace(/\\s+/g, '_');
}`,

  // The ordering hazard lives in a runtime warn string, not a doc comment.
  'src/render.js': `let primed = false;

export function warmup() { primed = true; }

export function render(widget) {
  if (!primed) {
    console.warn('render() before warmup(): frames stay black until the cache primes (~2s)');
  }
  return draw(widget);
}

function draw(widget) { /* ... */ }`,

  // Distractors: mundane, nothing critical.
  'src/format.js': `export function formatLabel(s) {
  return s.replace(/_/g, ' ').replace(/\\b\\w/g, (c) => c.toUpperCase());
}`,

  'src/validate.js': `export function isValidName(s) {
  return typeof s === 'string' && s.length > 0 && s.length <= 64;
}`,

  'config/settings.schema.json': `{
  "cache": { "ttlSec": { "type": "number", "default": 300 } },
  "render": { "maxWidgets": { "type": "number", "default": 64 } }
}`,
};

// capture() runs over all produced doc text.
const planted = [
  {
    id: 'centiseconds',
    what: 'scheduleRetry delay is in ticks (TICK_HZ=100), i.e. hundredths of a second',
    capture: (t) =>
      /TICK_HZ|centisecond|hundredth|\btick/i.test(t) ||
      /(\/|divide|multiply|times|x)\s*100|100\s*(per|hz|ticks)/i.test(t),
  },
  {
    id: 'id-prefix',
    what: 'widget ids must be prefixed wgx_',
    capture: (t) => /wgx_/.test(t),
  },
  {
    id: 'warmup',
    what: 'warmup() must run before first render or frames are black',
    capture: (t) => /warmup/i.test(t) && /black|prime/i.test(t),
  },
  {
    id: 'settings-gen',
    what: 'settings reference should be generated from the schema, not hand-copied',
    capture: (t) => /settings\.schema\.json/i.test(t) || /generated? from|do not edit by hand/i.test(t),
  },
];

// Downstream needs the buried unit. The consuming agent sees ONLY the produced docs, so
// honor depends on whether the docs surfaced the tick/100 conversion AND put it where a
// neutral-prompt agent will read it. Natural default without it is 3000 (ms) or 3.
const downstream = {
  question: `Add a call to \`scheduleRetry(...)\` that retries after 3 seconds. Reply with
just the one line of code on a line starting with ANSWER:`,
  grade(text) {
    const m = text.match(/scheduleRetry\(\s*([0-9_]+)\s*\)/i);
    if (!m) return { honored: false, note: 'no scheduleRetry(N)' };
    const n = Number(m[1].replace(/_/g, ''));
    return { honored: n === 300, note: `scheduleRetry(${n})` };
  },
};

module.exports = { repo, planted, downstream };
