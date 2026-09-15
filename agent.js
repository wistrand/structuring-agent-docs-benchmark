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

// A turn that left no usable text is a harness artifact, not a placement miss: an
// exhausted token budget (often spent on hidden reasoning) or a provider filter.
// Callers exclude invalid runs from honor denominators and report them separately.
// answerLine: an ANSWER: line means the turn delivered, even if cut off after it. Pass
// false for free-form output (authoring), where a length stop always means truncation.
function statusOf(text, finishReason, { answerLine = true } = {}) {
  const delivered = answerLine && /^\s*ANSWER:/im.test(text);
  // A refusal often has empty content, so check the filter before emptiness.
  if (finishReason === 'content_filter' && !delivered) return 'filtered';
  // A provider generation error that survived chat's retries: partial text is not graded.
  if (finishReason === 'error' && !delivered) return 'error';
  if (!text.trim()) return 'empty';
  if (finishReason === 'length' && !delivered) return 'truncated';
  return 'ok';
}

function isInvalid(status) {
  return status === 'empty' || status === 'truncated' || status === 'filtered' || status === 'error';
}

async function runAgent(model, variant, question, opts = {}) {
  const { temperature = 0.7, maxTurns = 4, system = SYSTEM_EAGER, maxTokens, reasoning = null } = opts;
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: `CLAUDE.md:\n\n${variant.alwaysLoaded}\n\nTask:\n${question}` },
  ];

  let prompt = 0;
  let completion = 0;
  let firstPrompt = 0;
  const reads = [];
  let finalText = '';
  let reasoningTokens = 0;
  let cost = 0;
  let finishReason = null;
  // Turns whose usage was lost (sums incomplete) or recovered from generation stats.
  let usageGaps = 0;
  let usageRecovered = 0;
  // Final-turn diagnostics, kept so an invalid run can be explained without a rerun.
  let nativeFinishReason = null;
  let refusal = null;
  let turns = 0;
  let providerRetries = 0;

  for (let turn = 0; turn < maxTurns; turn++) {
    const res = await chat(model, messages, { temperature, maxTokens, reasoning });
    const { text, usage } = res;
    prompt += usage.prompt_tokens || 0;
    completion += usage.completion_tokens || 0;
    reasoningTokens += usage.reasoning_tokens || 0;
    cost += usage.cost || 0;
    finishReason = res.finishReason;
    nativeFinishReason = res.nativeFinishReason || null;
    refusal = res.refusal || null;
    turns++;
    providerRetries += res.providerRetries || 0;
    if (usage.source === 'missing') usageGaps++;
    if (usage.source === 'generation') usageRecovered++;
    if (turn === 0) firstPrompt = usage.source === 'missing' ? null : usage.prompt_tokens || 0;
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

  return {
    finalText,
    reads,
    status: statusOf(finalText, finishReason),
    finishReason,
    nativeFinishReason,
    refusal,
    turns,
    providerRetries,
    tokens: { prompt, completion, firstPrompt, reasoning: reasoningTokens, usageGaps, usageRecovered },
    cost,
  };
}

module.exports = { runAgent, systemFor, statusOf, isInvalid, SYSTEM_EAGER, SYSTEM_NEUTRAL };
