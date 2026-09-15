'use strict';

// Minimal OpenRouter chat client. No external deps; uses built-in fetch (Node 18+).

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const CATALOG = 'https://openrouter.ai/api/v1/models';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const GENERATION = 'https://openrouter.ai/api/v1/generation';
const GENERATION_WAITS_MS = [500, 1500, 3000, 6000];

// Generation stats (tokens and cost for one completion id). The record can lag the
// completion, so a 404 or transient status is retried after a wait. Returns a usage
// object shaped like chatOnce's, or null when the record never arrives.
async function fetchGenerationUsage(id, key) {
  for (const wait of GENERATION_WAITS_MS) {
    await sleep(wait);
    let res;
    try {
      res = await fetch(`${GENERATION}?id=${encodeURIComponent(id)}`, {
        headers: { Authorization: `Bearer ${key}` },
      });
    } catch (e) {
      continue;
    }
    if (res.status === 404 || res.status === 429 || res.status >= 500) continue;
    if (!res.ok) return null;
    const g = (await res.json().catch(() => ({}))).data || {};
    if (!(g.native_tokens_prompt > 0)) continue;
    const completion = g.native_tokens_completion || 0;
    return {
      prompt_tokens: g.native_tokens_prompt,
      completion_tokens: completion,
      total_tokens: g.native_tokens_prompt + completion,
      reasoning_tokens: g.native_tokens_reasoning || 0,
      cost: typeof g.total_cost === 'number' ? g.total_cost : 0,
      source: 'generation',
    };
  }
  return null;
}

// opts.reasoning is an OpenRouter `reasoning` object, or null to send none and run the
// model at its own default. Resolve it per model with `modelSettings`. Hidden reasoning
// tokens count against maxTokens, so a small budget can leave no visible answer.
async function chatOnce(model, messages, { temperature = 0.7, maxTokens = 8192, reasoning = null } = {}) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('OPENROUTER_API_KEY is not set');
  const body = { model, messages, temperature, max_tokens: maxTokens };
  if (reasoning) body.reasoning = reasoning;
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/wistrand/structuring-agent-docs',
      'X-Title': 'structuring-agent-docs placement benchmark',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  // A provider failure can arrive as a 200 with an error body. Surface its code so the
  // retry logic treats 429/5xx as transient.
  if (data.error) {
    throw new Error(`OpenRouter ${data.error.code || 'error'}: ${String(data.error.message || '').slice(0, 300)}`);
  }
  const choice = data.choices && data.choices[0];
  const content = choice && choice.message ? choice.message.content : '';
  const u = data.usage || {};
  let usage = {
    prompt_tokens: u.prompt_tokens || 0,
    completion_tokens: u.completion_tokens || 0,
    total_tokens: u.total_tokens || 0,
    reasoning_tokens: (u.completion_tokens_details && u.completion_tokens_details.reasoning_tokens) || 0,
    // OpenRouter reports the billed cost (credits, USD) on every response.
    cost: typeof u.cost === 'number' ? u.cost : 0,
    source: 'response',
  };
  // Every real completion has prompt tokens, so zero means the provider omitted usage.
  // Recover it from the generation stats; failing that, flag the gap (source 'missing')
  // so token means can leave the turn out instead of averaging in a false zero.
  if (!(usage.prompt_tokens > 0)) {
    const recovered = data.id ? await fetchGenerationUsage(data.id, key) : null;
    usage = recovered || { ...usage, source: 'missing' };
  }
  return {
    text: typeof content === 'string' ? content : '',
    usage,
    finishReason: (choice && choice.finish_reason) || null,
    nativeFinishReason: (choice && choice.native_finish_reason) || null,
    // A provider refusal arrives here, with finish_reason content_filter.
    refusal: (choice && choice.message && choice.message.refusal) || null,
  };
}

async function chat(model, messages, opts = {}, retries = 3) {
  let lastErr;
  let discardedCost = 0;
  let providerRetries = 0;
  for (let i = 0; i <= retries; i++) {
    let res;
    try {
      res = await chatOnce(model, messages, opts);
    } catch (e) {
      lastErr = e;
      const transient = /OpenRouter (429|5\d\d)|fetch failed|network|ETIMEDOUT|ECONNRESET/i.test(
        String(e && e.message)
      );
      if (i === retries || !transient) throw e;
      await sleep(800 * Math.pow(2, i));
      continue;
    }
    // finish_reason "error": the provider failed mid-generation (seen on gemini-3.8-flash,
    // e.g. native MALFORMED_FUNCTION_CALL). Retry like a 5xx. After the last retry, return
    // the response so the caller records an invalid run rather than aborting the run.
    // Discarded attempts may be billed, so their cost is carried into the result.
    if (res.finishReason === 'error' && i < retries) {
      discardedCost += res.usage.cost || 0;
      providerRetries++;
      await sleep(800 * Math.pow(2, i));
      continue;
    }
    res.usage.cost += discardedCost;
    res.providerRetries = providerRetries;
    return res;
  }
  throw lastErr;
}

// Public catalog (no auth). Used to validate --models and resolve per-model settings
// before spending anything.
async function fetchModels() {
  const res = await fetch(CATALOG, {
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`OpenRouter models ${res.status}`);
  const data = await res.json();
  return data.data || [];
}

async function fetchModelIds() {
  return (await fetchModels()).map((m) => m.id);
}

const REASONING_MODES = ['default', 'off', 'low', 'medium', 'high'];
const EFFORT_ORDER = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const byEffort = (a, b) => EFFORT_ORDER.indexOf(a) - EFFORT_ORDER.indexOf(b);

// Maps a --reasoning mode to one model's request `reasoning` object from the catalog's
// per-model `reasoning` metadata (`mandatory`, `supported_efforts`). Returns the object
// to send (null: send nothing) and a label for what the model actually runs with.
// Effort "none" on a model with mandatory reasoning is a 400, hence the fallback.
function resolveReasoning(entry, mode) {
  if (mode === 'default') return { reasoning: null, effective: 'model default' };
  if (!entry) {
    return {
      reasoning: mode === 'off' ? { enabled: false } : { effort: mode },
      effective: `${mode} (unverified, no catalog)`,
    };
  }
  const meta = entry.reasoning;
  if (!meta) return { reasoning: null, effective: 'none (non-reasoning model)' };
  // supported_efforts: an array lists the accepted levels, null accepts all, and an
  // omitted field means the model exposes no effort selection.
  const efforts = Array.isArray(meta.supported_efforts)
    ? meta.supported_efforts
    : meta.supported_efforts === null
      ? ['none', ...EFFORT_ORDER]
      : null;

  if (mode === 'off') {
    if (!meta.mandatory) {
      const reasoning = efforts && efforts.includes('none') ? { effort: 'none' } : { enabled: false };
      return { reasoning, effective: 'off' };
    }
    const lowest = efforts ? efforts.filter((e) => EFFORT_ORDER.includes(e)).sort(byEffort)[0] : null;
    return lowest
      ? { reasoning: { effort: lowest }, effective: `${lowest} (reasoning is mandatory)` }
      : { reasoning: null, effective: 'model default (reasoning is mandatory)' };
  }

  if (!efforts) return { reasoning: { effort: mode }, effective: `${mode} (no effort levels listed)` };
  if (efforts.includes(mode)) return { reasoning: { effort: mode }, effective: mode };
  const want = EFFORT_ORDER.indexOf(mode);
  const nearest = efforts
    .filter((e) => EFFORT_ORDER.includes(e))
    .sort(
      (a, b) =>
        Math.abs(EFFORT_ORDER.indexOf(a) - want) - Math.abs(EFFORT_ORDER.indexOf(b) - want) || byEffort(a, b)
    )[0];
  return nearest
    ? { reasoning: { effort: nearest }, effective: `${nearest} (${mode} not supported)` }
    : { reasoning: { effort: mode }, effective: `${mode} (unverified)` };
}

// Per-model request settings for a run, plus notes worth recording with the results.
// catalog: Map id -> catalog entry, or null when the catalog was unreachable.
function modelSettings(models, catalog, { reasoning = 'default' } = {}) {
  const out = {};
  for (const id of models) {
    const entry = catalog ? catalog.get(id) || null : null;
    const r = resolveReasoning(entry, reasoning);
    const params = entry && Array.isArray(entry.supported_parameters) ? entry.supported_parameters : null;
    const temperatureSupported = params ? params.includes('temperature') : null;
    const notes = [];
    if (temperatureSupported === false) notes.push('temperature not supported, samples at the provider default');
    out[id] = { reasoning: r.reasoning, effectiveReasoning: r.effective, temperatureSupported, notes };
  }
  return out;
}

module.exports = { chat, fetchModels, fetchModelIds, REASONING_MODES, resolveReasoning, modelSettings };
