'use strict';

// Each case is an arbitrary, surprising, project-specific fact whose correct use is
// checkable and whose *natural default* is wrong. That last property is what gives the
// benchmark its power: a model that never sees the fact fails the task, so the
// `absent` placement measures a real floor rather than the model's prior knowledge.
//
// To add a case, keep that property. A fact recoverable by grep or general knowledge
// makes every placement score the same and the benchmark measures nothing.

module.exports = [
  {
    id: 'centiseconds',
    factLabel: 'timing and units',
    factPath: 'agent_docs/timing.md',
    fact:
`## Timing

Durations in this codebase are **centiseconds** (hundredths of a second), never
milliseconds. \`scheduleRetry(delay)\` and every \`*Timeout\` API take centiseconds.
So 1 second is 100, and 3 seconds is 300.`,
    question:
`Add a call to \`scheduleRetry(...)\` that retries after 3 seconds. Reply with just
the one line of code on a line starting with ANSWER:`,
    grade(text) {
      const m = text.match(/scheduleRetry\(\s*([0-9_]+)\s*\)/i);
      if (!m) return { honored: false, note: 'no scheduleRetry(N) found' };
      const n = Number(m[1].replace(/_/g, ''));
      // 300 = 3s in centiseconds (honored). 3000 = ms default, 3 = seconds: both wrong.
      return { honored: n === 300, note: `scheduleRetry(${n})` };
    },
  },
  {
    id: 'id-prefix',
    factLabel: 'naming conventions',
    factPath: 'agent_docs/conventions.md',
    fact:
`## Widget IDs

Every widget ID must start with the prefix \`wgx_\` followed by snake_case. The
registry rejects any ID without the \`wgx_\` prefix at build time.`,
    question:
`Create the ID string for a new "Quarterly Sales" widget. Reply with just the ID on a
line starting with ANSWER:`,
    grade(text) {
      const answer = text.match(/ANSWER:\s*`?([A-Za-z0-9_\-]+)`?/i);
      const loose = text.match(/\bwgx_[a-z0-9_]+/);
      const id = answer ? answer[1] : loose ? loose[0] : '';
      // Natural default (quarterly_sales / quarterlySales) lacks the wgx_ prefix.
      return { honored: /^wgx_[a-z0-9_]+$/.test(id), note: id || 'no id found' };
    },
  },
];
