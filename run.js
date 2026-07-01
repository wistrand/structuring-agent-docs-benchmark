'use strict';

const fs = require('fs');
const cases = require('./cases');
const { placements, PLACEMENT_ORDER } = require('./placements');
const { runAgent, systemFor } = require('./agent');
const { fetchModelIds } = require('./openrouter');

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
  --out PATH     write raw per-run results as JSON
  --concurrency N  completion calls in flight at once, default 6
  --link-hint M  eager (default) | neutral | blind | hint: how discoverable linked
                 facts are. eager urges reading and labels links by topic; neutral
                 drops the urging; blind also makes labels and file names generic, so
                 nothing signals that a routine task hides a convention; hint keeps
                 neutral but adds a per-link "read before you touch" imperative
  --system M     eager | neutral: the system-prompt eagerness, overriding the default
                 implied by --link-hint. Crosses the two levers, e.g. an eager prompt
                 with blind labels: --system eager --link-hint blind
  --verbose, -v  print per-run detail (reads, tokens, timing, grade) as it runs
  --dry-run      build and print the variants; make no network calls
`);
}

function mean(a) {
  return a.length ? Math.round(a.reduce((s, x) => s + x, 0) / a.length) : 0;
}

function isModelMissing(err) {
  return /\b404\b|No endpoints found|not a valid model|does not exist|is not a valid/i.test(
    String(err && err.message)
  );
}

// Preflight: reject unknown model ids up front, with close matches, so a typo does
// not spend a run's worth of calls returning 404.
async function validateModels(models) {
  let ids;
  try {
    ids = await fetchModelIds();
  } catch (e) {
    console.error(`(could not fetch model list for validation: ${e.message})`);
    return;
  }
  const set = new Set(ids);
  const missing = models.filter((m) => !set.has(m));
  if (!missing.length) return;
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

  await validateModels(args.models);

  const raw = [];
  const cells = {}; // cells[model][placement], aggregated across cases
  for (const model of args.models) {
    cells[model] = {};
    for (const name of PLACEMENT_ORDER) {
      cells[model][name] = { honored: 0, total: 0, prompt: [], first: [], reads: [] };
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
      `concurrency ${args.concurrency}.`
  );

  // Per (model, case, placement) tracking so a summary can print when a cell finishes,
  // even though runs complete out of order.
  const cellKey = (t) => `${t.model}||${t.c.id}||${t.name}`;
  const perCell = new Map();
  for (const t of tasks) {
    const k = cellKey(t);
    if (!perCell.has(k)) {
      perCell.set(k, { seen: 0, honored: 0, total: 0, prompt: [], reads: [] });
    }
  }
  const missingReported = new Set();
  let cellsDone = 0;

  // Run one task. The multi-turn call inside runAgent stays sequential; independent
  // tasks run concurrently. The result is self-contained, touching no shared state.
  async function runOne(t) {
    const t0 = Date.now();
    try {
      const outcome = await runAgent(t.model, t.v, t.c.question, {
        temperature: args.temperature,
        system,
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
    } else {
      const cell = cells[t.model][t.name];
      cell.total++;
      pc.total++;
      if (graded.honored) {
        cell.honored++;
        pc.honored++;
      }
      cell.prompt.push(outcome.tokens.prompt);
      cell.first.push(outcome.tokens.firstPrompt);
      cell.reads.push(outcome.reads.length);
      pc.prompt.push(outcome.tokens.prompt);
      pc.reads.push(outcome.reads.length);
      raw.push({
        model: t.model,
        case: t.c.id,
        placement: t.name,
        run: t.r,
        honored: graded.honored,
        note: graded.note,
        reads: outcome.reads,
        tokens: outcome.tokens,
        ms,
      });
      if (args.verbose) {
        console.log(
          `${t.model} ${t.c.id}/${t.name} #${t.r} ${graded.honored ? 'honored' : 'MISSED '} ` +
            `reads=${outcome.reads.length ? outcome.reads.join(',') : '-'} ` +
            `tok=${outcome.tokens.prompt} ${ms}ms  "${graded.note}"`
        );
      }
    }

    if (pc.seen === args.repeats) {
      cellsDone++;
      const pct = pc.total ? Math.round((100 * pc.honored) / pc.total) : 0;
      console.log(
        `[${cellsDone}/${totalCells}] ${t.model} ${t.c.id}/${t.name}  ` +
          `${pc.honored}/${pc.total} honored ${String(pct).padStart(3)}%  ` +
          `reads~${mean(pc.reads)}  tok~${mean(pc.prompt)}`
      );
    }
  }

  // Bounded worker pool: each worker pulls the next task index until the list is done.
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const t = tasks[next++];
      record(await runOne(t));
    }
  }
  const poolSize = Math.max(1, Math.min(args.concurrency, tasks.length));
  await Promise.all(Array.from({ length: poolSize }, () => worker()));

  const elapsed = Math.round((Date.now() - startedAt) / 1000);
  console.log(`\nDone in ${elapsed}s, ${raw.length} runs.`);

  for (const model of args.models) {
    console.log(`\n=== ${model} ===`);
    console.log('placement  honor%    n   reads   meanPromptTok   firstLoadTok');
    for (const name of PLACEMENT_ORDER) {
      const cell = cells[model][name];
      const pct = cell.total ? Math.round((100 * cell.honored) / cell.total) : 0;
      console.log(
        `${name.padEnd(9)}  ${String(pct).padStart(4)}%  ${String(cell.total).padStart(3)}   ` +
          `${String(mean(cell.reads)).padStart(5)}   ${String(mean(cell.prompt)).padStart(11)}   ` +
          `${String(mean(cell.first)).padStart(11)}`
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
    fs.writeFileSync(args.out, JSON.stringify({ args, raw }, null, 2));
    console.log(`\nWrote ${raw.length} runs to ${args.out}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
