'use strict';

// Minimal OpenRouter chat client. No external deps; uses built-in fetch (Node 18+).

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function chatOnce(model, messages, { temperature = 0.7, maxTokens = 512 } = {}) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('OPENROUTER_API_KEY is not set');
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/wistrand/structuring-agent-docs',
      'X-Title': 'structuring-agent-docs placement benchmark',
    },
    body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenRouter ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const text = data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content || ''
    : '';
  const usage = data.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  return { text, usage };
}

async function chat(model, messages, opts = {}, retries = 3) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await chatOnce(model, messages, opts);
    } catch (e) {
      lastErr = e;
      const transient = /OpenRouter (429|5\d\d)|fetch failed|network|ETIMEDOUT|ECONNRESET/i.test(
        String(e && e.message)
      );
      if (i === retries || !transient) throw e;
      await sleep(800 * Math.pow(2, i));
    }
  }
  throw lastErr;
}

// Public catalog (no auth). Used to validate --models before spending anything.
async function fetchModelIds() {
  const res = await fetch('https://openrouter.ai/api/v1/models', {
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`OpenRouter models ${res.status}`);
  const data = await res.json();
  return (data.data || []).map((m) => m.id);
}

module.exports = { chat, fetchModelIds };
