'use strict';

const { chat } = require('./openrouter');

// The agent sees CLAUDE.md as always-loaded context and opens linked files on demand
// by writing `READ: <path>`. This models the skill's world faithfully with plain
// completions: inline/import facts are already in context, linked/chained facts must
// be requested, and whether the model bothers to request them is exactly the
// follow-through the skill's blast-radius argument is about.

// The READ:/ANSWER: mechanism is explained in every variant so the harness can parse.
// What changes across variants is how hard the prompt pushes the agent to open files.

// eager: actively tells the agent to read what it needs and not to guess.
const SYSTEM_EAGER = `You are a coding agent working in a repository. The CLAUDE.md
shown to you is always loaded. You may open additional files that CLAUDE.md links to by
writing lines of the form:
READ: <path>
one path per line, using the exact path from the link. Only once you have what you
need, give your final answer on a line starting with:
ANSWER:
Keep the answer minimal. Do not invent file contents; if you need a file, READ it.`;

// neutral: reading is available but not urged, and there is no "do not guess" pressure.
const SYSTEM_NEUTRAL = `You are a coding agent working in a repository. The CLAUDE.md
shown to you is always loaded. You may open other files by writing lines of the form:
READ: <path>
one path per line. When you are ready, give your final answer on a line starting with:
ANSWER:
Keep the answer minimal.`;

function systemFor(hint) {
  return hint === 'eager' ? SYSTEM_EAGER : SYSTEM_NEUTRAL;
}

function normalizePath(p) {
  return p.replace(/[`'"()<>[\]]/g, '').replace(/[.,;:]+$/, '').trim();
}

function findFile(files, path) {
  const target = normalizePath(path);
  for (const k of Object.keys(files)) {
    if (normalizePath(k) === target) return files[k];
  }
  return null;
}

async function runAgent(model, variant, question, opts = {}) {
  const { temperature = 0.7, maxTurns = 4, system = SYSTEM_EAGER } = opts;
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: `CLAUDE.md:\n\n${variant.alwaysLoaded}\n\nTask:\n${question}` },
  ];

  let prompt = 0;
  let completion = 0;
  let firstPrompt = 0;
  const reads = [];
  let finalText = '';

  for (let turn = 0; turn < maxTurns; turn++) {
    const { text, usage } = await chat(model, messages, { temperature });
    prompt += usage.prompt_tokens || 0;
    completion += usage.completion_tokens || 0;
    if (turn === 0) firstPrompt = usage.prompt_tokens || 0;
    messages.push({ role: 'assistant', content: text });
    finalText = text;

    const requested = [...text.matchAll(/^\s*READ:\s*(\S+)/gim)].map((m) => m[1]);
    const answered = /^\s*ANSWER:/im.test(text);

    if (requested.length && !answered) {
      let reply = '';
      for (const path of requested) {
        reads.push(path);
        const contents = findFile(variant.files, path);
        reply += contents
          ? `Contents of ${path}:\n\n${contents}\n\n`
          : `${path}: (no such file)\n\n`;
      }
      reply += 'Continue. READ more if needed, otherwise give your ANSWER:.';
      messages.push({ role: 'user', content: reply });
      continue;
    }
    break;
  }

  return { finalText, reads, tokens: { prompt, completion, firstPrompt } };
}

module.exports = { runAgent, systemFor, SYSTEM_EAGER, SYSTEM_NEUTRAL };
