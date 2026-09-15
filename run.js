'use strict';

const fs = require('fs');
const cases = require('./cases');
const { placements, PLACEMENT_ORDER } = require('./placements');
const { runAgent, systemFor, isInvalid } = require('./agent');
const { fetchModels, REASONING_MODES, modelSettings } = require('./openrouter');

function parseArgs(argv) {
  const args = {
    models: [],
    repeats: 5,
    temperature: 0.7,
    cases: null,
    dryRun: false,
    out: null,
    verbose: false,
    linkHint: 'eager',
    system: null,
    concurrency: 6,
    maxTokens: 8192,
    reasoning: 'default',
    maxInvalid: null,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--models') args.models = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--repeats') args.repeats = Number(argv[++i]);
    else if (a === '--temperature') args.temperature = Number(argv[++i]);
    else if (a === '--cases') args.cases = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--concurrency') args.concurrency = Number(argv[++i]);
    else if (a === '--link-hint') args.linkHint = String(argv[++i] || '').trim();
    else if (a === '--system') args.system = String(argv[++i] || '').trim();
    else if (a === '--max-tokens') args.maxTokens = Number(argv[++i]);
    else if (a === '--reasoning') args.reasoning = String(argv[++i] || '').trim();
    else if (a === '--max-invalid') args.maxInvalid = Number(argv[++i]);
    else if (a === '--verbose' || a === '-v') args.verbose = true;
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

function help() {
  console.log(`Placement micro-benchmark for structuring-agent-docs.

Measures whether a fact factored out of the always-loaded CLAUDE.md is missed more
often than the same fact kept inline, and what each placement costs in tokens.

Usage:
  OPENROUTER_API_KEY=... node run.js --models a/b,c/d [--repeats 5] [--temperature 0.7]
  node run.js --dry-run          print every constructed prompt, no API calls, no key

Flags:
  --models       comma-separated OpenRouter model ids (required unless --dry-run)
  --repeats      runs per (model x case x placement), default 5
  --temperature  sampling temperature, default 0.7 (use 0 for determinism)
  --cases        comma-separated case ids to run (default: all)
  --out PATH     write raw per-run results as JSON, and stream each finished run as a
                 JSON line to PATH minus .json plus .runs.jsonl
  --concurrency N  completion calls in flight at once, default 6
  --link-hint M  eager (default) | neutral | blind | hint: how discoverable linked
                 facts are. eager urges reading and labels links by topic; neutral
                 drops the urging; blind also makes labels and file names generic, so
                 nothing signals that a routine task hides a convention; hint keeps
                 neutral but adds a per-link "read before you touch" imperative
  --system M     eager | neutral: the system-prompt eagerness, overriding the default
                 implied by --link-hint. Crosses the two levers, e.g. an eager prompt
                 with blind labels: --system eager --link-hint blind
  --reasoning M  default | off | low | medium | high. default sends nothing, so each
                 model runs at its own default. The rest resolve per model from the
                 catalog: off disables reasoning where allowed and falls back to the
                 lowest effort where it is mandatory
  --max-tokens N completion budget per turn, default 8192. Hidden reasoning counts
                 against it; a run left with no answer is reported invalid, not missed
  --max-invalid PCT  stop cleanly once any model's invalid runs exceed PCT% of its
                 planned runs outside the absent placement (absent grades 0% by
                 design, so its invalid runs never count): no new runs start,
                 in-flight runs finish, outputs are written, exit code 3. Default:
                 never stop
  --verbose, -v  print per-run detail (reads, tokens, timing, grade) as it runs
  --dry-run      build and print the variants; make no network calls
`);
}

// Line-per-run stream beside --out, appended as runs finish, so a stopped run keeps
// what it completed: results-x.json -> results-x.runs.jsonl
function streamPath(out) {
  return out.replace(/\.json$/i, '') + '.runs.jsonl';
}

function mean(a) {
  return a.length ? Math.round(a.reduce((s, x) => s + x, 0) / a.length) : 0;
}

// Token column: '-' when no run in the cell has usable usage data, never a false 0.
function tokCol(a, width) {
  return (a.length ? String(mean(a)) : '-').padStart(width);
}

function isModelMissing(err) {
  return /\b404\b|No endpoints found|not a valid model|does not exist|is not a valid/i.test(
    String(err && err.message)
  );
}

// Preflight: reject unknown model ids up front, with close matches, so a typo does
// not spend a run's worth of calls returning 404. Returns the catalog as a Map (id ->
// entry) for per-model settings, or null when it is unreachable (run proceeds unvalidated).
async function validateModels(models) {
  let catalog;
  try {
    catalog = await fetchModels();
  } catch (e) {
    console.error(`(could not fetch model list for validation: ${e.message})`);
    return null;
  }
  const ids = catalog.map((m) => m.id);
  const set = new Set(ids);
  const missing = models.filter((m) => !set.has(m));
  if (!missing.length) return new Map(catalog.map((m) => [m.id, m]));
  for (const m of missing) {
    const vendor = m.split('/')[0];
    const leaf = m.split('/').pop();
    const tokens = leaf.split(/[^a-z0-9]+/i).filter(Boolean).map((s) => s.toLowerCase());
    const near = ids
      .map((id) => {
        const lid = id.toLowerCase();
        let score = tokens.reduce((s, t) => s + (lid.includes(t) ? 1 : 0), 0);
        if (id.startsWith(vendor + '/')) score += 0.5;
        return { id, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map((x) => x.id);
    console.error(`Unknown OpenRouter model: ${m}`);
    if (near.length) console.error('  close matches: ' + near.join(', '));
  }
  console.error('Fix --models (full list: https://openrouter.ai/models).');
  process.exit(1);
}

function dryRun(selected, hint) {
  console.log(`(link-hint: ${hint})\n`);
  for (const c of selected) {
    const P = placements(c, hint);
    for (const name of PLACEMENT_ORDER) {
      const v = P[name];
      console.log('='.repeat(72));
      console.log(`CASE ${c.id}   PLACEMENT ${name}`);
      console.log('--- always-loaded CLAUDE.md ---');
      console.log(v.alwaysLoaded);
      const files = Object.keys(v.files);
      console.log('--- files readable on demand ---');
      console.log(files.length ? files.join(', ') : '(none)');
      console.log('--- task ---');
      console.log(c.question);
      console.log('');
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return help();

  if (!['eager', 'neutral', 'blind', 'hint'].includes(args.linkHint)) {
    console.error('--link-hint must be eager, neutral, blind, or hint.');
    process.exit(1);
  }

  if (!Number.isInteger(args.concurrency) || args.concurrency < 1) {
    console.error('--concurrency must be a positive integer.');
    process.exit(1);
  }

  if (args.system !== null && !['eager', 'neutral'].includes(args.system)) {
    console.error('--system must be eager or neutral.');
    process.exit(1);
  }

  if (!REASONING_MODES.includes(args.reasoning)) {
    console.error(`--reasoning must be one of: ${REASONING_MODES.join(', ')}.`);
    process.exit(1);
  }

  if (args.maxInvalid !== null && !(args.maxInvalid >= 0 && args.maxInvalid <= 100)) {
    console.error('--max-invalid must be a percentage from 0 to 100.');
    process.exit(1);
  }

  if (!Number.isInteger(args.maxTokens) || args.maxTokens < 1) {
    console.error('--max-tokens must be a positive integer.');
    process.exit(1);
  }

  const selected = args.cases ? cases.filter((c) => args.cases.includes(c.id)) : cases;
  if (!selected.length) {
    console.error('No matching cases. Known ids: ' + cases.map((c) => c.id).join(', '));
    process.exit(1);
  }

  if (args.dryRun) return dryRun(selected, args.linkHint);

  if (!args.models.length) {
    console.error('Pass --models, or use --dry-run. See --help.');
    process.exit(1);
  }
  if (!process.env.OPENROUTER_API_KEY) {
    console.error('Set OPENROUTER_API_KEY (or use --dry-run).');
    process.exit(1);
  }

  const catalog = await validateModels(args.models);
  const settings = modelSettings(args.models, catalog, { reasoning: args.reasoning });

  const stream = args.out ? streamPath(args.out) : null;
  if (stream) {
    const header = { header: true, startedAt: new Date().toISOString(), args, settings };
    fs.writeFileSync(stream, JSON.stringify(header) + '\n');
  }

  const raw = [];
  const cells = {}; // cells[model][placement], aggregated across cases
  for (const model of args.models) {
    cells[model] = {};
    for (const name of PLACEMENT_ORDER) {
      cells[model][name] = { honored: 0, total: 0, invalid: 0, cost: 0, prompt: [], first: [], reads: [], reasoning: [] };
    }
  }

  // Build the full task list up front. Variants depend only on (case, link-hint), so
  // compute each once and share the read-only object across models and repeats.
  const tasks = [];
  for (const c of selected) {
    const P = placements(c, args.linkHint);
    for (const name of PLACEMENT_ORDER) {
      const v = P[name];
      for (const model of args.models) {
        for (let r = 0; r < args.repeats; r++) tasks.push({ model, c, name, v, r });
      }
    }
  }

  const totalCells = args.models.length * selected.length * PLACEMENT_ORDER.length;
  const startedAt = Date.now();
  // --system overrides; otherwise the prompt eagerness defaults from --link-hint, so
  // existing commands reproduce exactly (eager mode -> eager prompt, else neutral).
  const systemMode = args.system || (args.linkHint === 'eager' ? 'eager' : 'neutral');
  const system = systemFor(systemMode);
  console.log(
    `Plan: ${args.models.length} model(s) x ${selected.length} case(s) x ` +
      `${PLACEMENT_ORDER.length} placements x ${args.repeats} repeats = ${tasks.length} calls, ` +
      `temperature ${args.temperature}, link-hint ${args.linkHint}, system ${systemMode}, ` +
      `reasoning ${args.reasoning}, max-tokens ${args.maxTokens}, concurrency ${args.concurrency}.`
  );
  for (const model of args.models) {
    const s = settings[model];
    console.log(`  ${model}: reasoning ${s.effectiveReasoning}${s.notes.length ? '; ' + s.notes.join('; ') : ''}`);
  }

  // Per (model, case, placement) tracking so a summary can print when a cell finishes,
  // even though runs complete out of order.
  const cellKey = (t) => `${t.model}||${t.c.id}||${t.name}`;
  const perCell = new Map();
  for (const t of tasks) {
    const k = cellKey(t);
    if (!perCell.has(k)) {
      perCell.set(k, { seen: 0, honored: 0, total: 0, invalid: 0, prompt: [], reads: [] });
    }
  }
  const missingReported = new Set();
  let cellsDone = 0;
  let totalCost = 0;
  let totalInvalid = 0;
  let totalUsageGaps = 0;
  let totalUsageRecovered = 0;
  let totalProviderRetries = 0;

  // --max-invalid: stop cleanly once a model's invalid runs exceed that share of its
  // planned runs. Workers stop taking tasks; in-flight runs finish; outputs are written.
  // `absent` is exempt: it grades 0% by design, so an invalid run there cannot change a
  // result (gemini-3.8-flash replies with whitespace there after searching for the
  // missing fact). Those runs are still printed, counted, and excluded from honor%.
  const LIMIT_EXEMPT = new Set(['absent']);
  const limitPlacements = PLACEMENT_ORDER.filter((p) => !LIMIT_EXEMPT.has(p)).length;
  const plannedPerModel = selected.length * limitPlacements * args.repeats;
  const invalidByModel = new Map();
  let abortReason = null;
  function checkInvalidLimit(model, placement) {
    if (LIMIT_EXEMPT.has(placement)) return;
    const n = (invalidByModel.get(model) || 0) + 1;
    invalidByModel.set(model, n);
    if (args.maxInvalid === null || abortReason) return;
    const allowed = Math.floor((args.maxInvalid / 100) * plannedPerModel);
    if (n > allowed) {
      abortReason =
        `${model} has ${n} invalid run(s), over --max-invalid ${args.maxInvalid}% ` +
        `of ${plannedPerModel} planned runs outside absent (${allowed} allowed)`;
      console.log(`STOPPING: ${abortReason}. Finishing in-flight runs, then writing results.`);
    }
  }

  // Run one task. The multi-turn call inside runAgent stays sequential; independent
  // tasks run concurrently. The result is self-contained, touching no shared state.
  async function runOne(t) {
    const t0 = Date.now();
    try {
      const outcome = await runAgent(t.model, t.v, t.c.question, {
        temperature: args.temperature,
        system,
        maxTokens: args.maxTokens,
        reasoning: settings[t.model].reasoning,
      });
      return { t, ms: Date.now() - t0, outcome, graded: t.c.grade(outcome.finalText) };
    } catch (e) {
      return { t, ms: Date.now() - t0, error: e };
    }
  }

  // Fold one completed result into the aggregates. This runs synchronously between
  // awaits, so the shared aggregates are never mutated concurrently, and no data is
  // attributed to the wrong cell (every result carries its own task coordinates).
  function record(res) {
    const { t, ms, outcome, graded, error } = res;
    const pc = perCell.get(cellKey(t));
    pc.seen++;

    if (error) {
      if (isModelMissing(error)) {
        if (!missingReported.has(t.model)) {
          console.error(`! ${t.model}: ${String(error.message).split('\n')[0]}. Its runs will be missing.`);
          missingReported.add(t.model);
        }
      } else {
        console.error(`! ${t.model} ${t.c.id}/${t.name} #${t.r}: ${error.message}`);
      }
      if (stream) {
        const rec = { model: t.model, case: t.c.id, placement: t.name, run: t.r, error: String(error.message).slice(0, 500), ms };
        fs.appendFileSync(stream, JSON.stringify(rec) + '\n');
      }
    } else {
      const cell = cells[t.model][t.name];
      // An invalid run (empty, or cut off before ANSWER:) is a budget or provider
      // artifact, not a placement miss, so it stays out of the honor denominator.
      const invalid = isInvalid(outcome.status);
      cell.cost += outcome.cost;
      totalCost += outcome.cost;
      if (outcome.tokens.usageGaps) totalUsageGaps++;
      totalUsageRecovered += outcome.tokens.usageRecovered;
      totalProviderRetries += outcome.providerRetries;
      if (invalid) {
        cell.invalid++;
        pc.invalid++;
        totalInvalid++;
      } else {
        cell.total++;
        pc.total++;
        if (graded.honored) {
          cell.honored++;
          pc.honored++;
        }
        cell.reads.push(outcome.reads.length);
        pc.reads.push(outcome.reads.length);
        // A turn with no usage data even after the generation lookup would average in a
        // false zero, so that run stays out of the token means.
        if (!outcome.tokens.usageGaps) {
          cell.prompt.push(outcome.tokens.prompt);
          cell.first.push(outcome.tokens.firstPrompt);
          cell.reasoning.push(outcome.tokens.reasoning);
          pc.prompt.push(outcome.tokens.prompt);
        }
      }
      const rec = {
        model: t.model,
        case: t.c.id,
        placement: t.name,
        run: t.r,
        status: outcome.status,
        finishReason: outcome.finishReason,
        nativeFinishReason: outcome.nativeFinishReason,
        turns: outcome.turns,
        providerRetries: outcome.providerRetries,
        honored: invalid ? null : graded.honored,
        note: graded.note,
        reads: outcome.reads,
        tokens: outcome.tokens,
        cost: outcome.cost,
        ms,
      };
      // An invalid run keeps enough of the reply to diagnose it without a rerun.
      if (invalid) rec.detail = { refusal: outcome.refusal, textHead: outcome.finalText.slice(0, 500) };
      raw.push(rec);
      if (stream) fs.appendFileSync(stream, JSON.stringify(rec) + '\n');
      if (invalid) {
        const why = outcome.refusal || outcome.finalText;
        console.log(
          `? ${t.model} ${t.c.id}/${t.name} #${t.r} invalid run: ${outcome.status}, ` +
            `finish ${outcome.finishReason || '-'}, native ${outcome.nativeFinishReason || '-'}, ` +
            `turns ${outcome.turns}, reads ${outcome.reads.length}` +
            (why ? `, reply "${why.replace(/\s+/g, ' ').slice(0, 160)}"` : ', empty reply')
        );
        checkInvalidLimit(t.model, t.name);
      }
      if (args.verbose) {
        const label = invalid ? outcome.status.toUpperCase().padEnd(7) : graded.honored ? 'honored' : 'MISSED ';
        console.log(
          `${t.model} ${t.c.id}/${t.name} #${t.r} ${label} ` +
            `reads=${outcome.reads.length ? outcome.reads.join(',') : '-'} ` +
            `tok=${outcome.tokens.prompt} reason=${outcome.tokens.reasoning} ${ms}ms  "${graded.note}"`
        );
      }
    }

    if (pc.seen === args.repeats) {
      cellsDone++;
      const pct = pc.total ? Math.round((100 * pc.honored) / pc.total) : 0;
      console.log(
        `[${cellsDone}/${totalCells}] ${t.model} ${t.c.id}/${t.name}  ` +
          `${pc.honored}/${pc.total} honored ${String(pct).padStart(3)}%  ` +
          `reads~${mean(pc.reads)}  tok~${mean(pc.prompt)}` +
          (pc.invalid ? `  invalid ${pc.invalid}` : '')
      );
    }
  }

  // Bounded worker pool: each worker pulls the next task index until the list is done.
  let next = 0;
  async function worker() {
    while (next < tasks.length && !abortReason) {
      const t = tasks[next++];
      record(await runOne(t));
    }
  }
  const poolSize = Math.max(1, Math.min(args.concurrency, tasks.length));
  await Promise.all(Array.from({ length: poolSize }, () => worker()));

  const elapsed = Math.round((Date.now() - startedAt) / 1000);
  console.log(
    `\n${abortReason ? 'Stopped early' : 'Done'} in ${elapsed}s, ${raw.length} runs, ` +
      `reported cost $${totalCost.toFixed(4)}.`
  );
  if (totalInvalid) {
    console.log(
      `${totalInvalid} run(s) returned no usable answer (empty or cut off) and are excluded ` +
        'from honor%. Raise --max-tokens or lower --reasoning, then rerun those models.'
    );
  }
  if (totalProviderRetries) {
    console.log(`${totalProviderRetries} provider generation error(s) retried; discarded attempts are included in cost.`);
  }
  if (totalUsageRecovered) {
    console.log(`${totalUsageRecovered} turn(s) had usage recovered from the generation stats endpoint.`);
  }
  if (totalUsageGaps) {
    console.log(
      `${totalUsageGaps} run(s) had a turn with no usage data after the generation lookup; ` +
        'they are left out of the token means and their cost is undercounted.'
    );
  }

  for (const model of args.models) {
    console.log(`\n=== ${model} (reasoning ${settings[model].effectiveReasoning}) ===`);
    console.log('placement  honor%    n  invalid   reads   meanPromptTok   firstLoadTok   reasonTok     cost$');
    for (const name of PLACEMENT_ORDER) {
      const cell = cells[model][name];
      const pct = cell.total ? Math.round((100 * cell.honored) / cell.total) : 0;
      console.log(
        `${name.padEnd(9)}  ${(cell.total ? `${pct}%` : '-').padStart(5)}  ${String(cell.total).padStart(3)}  ` +
          `${String(cell.invalid).padStart(7)}   ${String(mean(cell.reads)).padStart(5)}   ` +
          `${tokCol(cell.prompt, 13)}   ${tokCol(cell.first, 12)}   ` +
          `${tokCol(cell.reasoning, 9)}   ${cell.cost.toFixed(4).padStart(7)}`
      );
    }
  }

  if (args.out) {
    // sort back into deterministic (model, case, placement, run) order so the file is
    // identical regardless of the concurrent completion order.
    const mo = new Map(args.models.map((m, i) => [m, i]));
    const co = new Map(selected.map((c, i) => [c.id, i]));
    const po = new Map(PLACEMENT_ORDER.map((p, i) => [p, i]));
    raw.sort(
      (a, b) =>
        mo.get(a.model) - mo.get(b.model) ||
        co.get(a.case) - co.get(b.case) ||
        po.get(a.placement) - po.get(b.placement) ||
        a.run - b.run
    );
    fs.writeFileSync(args.out, JSON.stringify({ args, settings, aborted: abortReason, raw }, null, 2));
    console.log(`\nWrote ${raw.length} runs to ${args.out} (per-run stream: ${stream})`);
  }
  if (abortReason) {
    console.log(`Stopped early: ${abortReason}.`);
    process.exitCode = 3;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
