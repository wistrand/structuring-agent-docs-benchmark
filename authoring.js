'use strict';

// Authoring benchmark: does an agent given the skill produce better-structured docs
// than one without it? Each unit authors a doc set for a synthetic repo (with-skill vs
// baseline), then grades it two ways:
//   capture:    did the produced docs surface each planted fact?
//   downstream: given only the produced docs, does a consuming agent honor the
//               default-overriding invariant? (reuses the placement harness's runAgent)
// No external deps; built-in fetch (Node 18+).

const fs = require('fs');
const path = require('path');
const { chat, fetchModelIds } = require('./openrouter');
const { runAgent, systemFor } = require('./agent');
const { repo, planted, downstream } = require('./authoring-cases');

const ARMS = ['skill', 'baseline'];

// The authoring arm feeds the skill to the model, so the benchmark needs a skill
// checkout. This works whether the benchmark lives inside the skill repo or as its own
// sibling repo. Override with --skill-dir or SKILL_DIR; never vendor a copy (it drifts).
function resolveSkillDir(explicit) {
  const candidates = [
    explicit,
    process.env.SKILL_DIR,
    path.join(__dirname, '..'), // in-repo, before the benchmark is split out
    path.join(__dirname, '..', 'structuring-agent-docs'), // sibling checkout
    path.join(__dirname, '..', '..', 'structuring-agent-docs'),
  ].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(path.join(c, 'SKILL.md'))) return c;
  throw new Error('skill not found. Pass --skill-dir <path to a structuring-agent-docs checkout> or set SKILL_DIR.');
}

function readSkill(skillDir) {
  let text = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
  const refDir = path.join(skillDir, 'references');
  for (const f of fs.readdirSync(refDir).sort()) {
    if (f.endsWith('.md')) {
      text += `\n\n----- references/${f} -----\n\n` + fs.readFileSync(path.join(refDir, f), 'utf8');
    }
  }
  return text;
}

function repoListing() {
  return Object.entries(repo)
    .map(([p, c]) => `----- ${p} -----\n${c}`)
    .join('\n\n');
}

const OUTPUT_RULE = `Produce the agent documentation as files. Output each file exactly as:

=== FILE: <path> ===
<file contents>

Write a CLAUDE.md and any agent_docs/*.md files you think help. Do not output source
code files.`;

function authoringMessages(arm, skillText) {
  const system =
    arm === 'skill'
      ? `You are setting up documentation for AI coding agents working in a repository. ` +
        `Apply the following skill when doing so.\n\n${skillText}`
      : `You are setting up documentation for AI coding agents working in a repository. ` +
        `Write whatever documentation you think best helps them navigate the repo and ` +
        `change it safely.`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: `${OUTPUT_RULE}\n\nRepository:\n\n${repoListing()}` },
  ];
}

function parseFiles(text) {
  const files = {};
  const marks = [...text.matchAll(/^===\s*FILE:\s*(.+?)\s*===\s*$/gim)];
  for (let i = 0; i < marks.length; i++) {
    const p = marks[i][1].trim().replace(/[`'"]/g, '');
    const start = marks[i].index + marks[i][0].length;
    const end = i + 1 < marks.length ? marks[i + 1].index : text.length;
    let body = text.slice(start, end).trim();
    body = body.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim();
    files[p] = body;
  }
  return files;
}

async function authorAndConsume(model, arm, skillText, consumeSystem, temperature, consumeModel) {
  const author = await chat(model, authoringMessages(arm, skillText), {
    temperature,
    maxTokens: 2000,
  });
  const files = parseFiles(author.text);
  const allText = Object.values(files).join('\n');
  const captured = {};
  for (const item of planted) captured[item.id] = item.capture(allText);

  const claudeKey = Object.keys(files).find((k) => /(^|\/)CLAUDE\.md$/i.test(k));
  const alwaysLoaded = claudeKey ? files[claudeKey] : allText;
  const onDemand = {};
  for (const [k, v] of Object.entries(files)) if (k !== claudeKey) onDemand[k] = v;

  const consumed = await runAgent(
    consumeModel,
    { alwaysLoaded, files: onDemand },
    downstream.question,
    { temperature, system: systemFor(consumeSystem) }
  );
  const graded = downstream.grade(consumed.finalText);

  return {
    fileCount: Object.keys(files).length,
    hasClaude: !!claudeKey,
    captured,
    honored: graded.honored,
    note: graded.note,
  };
}

function parseArgs(argv) {
  const a = {
    models: [],
    repeats: 5,
    temperature: 0.7,
    concurrency: 4,
    consumeSystem: 'neutral',
    consumeModel: null,
    out: null,
    skillDir: null,
    verbose: false,
    dryRun: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--models') a.models = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (x === '--repeats') a.repeats = Number(argv[++i]);
    else if (x === '--temperature') a.temperature = Number(argv[++i]);
    else if (x === '--concurrency') a.concurrency = Number(argv[++i]);
    else if (x === '--consume-system') a.consumeSystem = String(argv[++i] || '').trim();
    else if (x === '--skill-dir') a.skillDir = String(argv[++i] || '').trim();
    else if (x === '--consume-model') a.consumeModel = String(argv[++i] || '').trim();
    else if (x === '--out') a.out = argv[++i];
    else if (x === '--verbose' || x === '-v') a.verbose = true;
    else if (x === '--dry-run') a.dryRun = true;
    else if (x === '--help' || x === '-h') a.help = true;
  }
  return a;
}

function help() {
  console.log(`Authoring benchmark for structuring-agent-docs.

Does an agent given the skill produce better-structured docs than one without it? Each
run authors docs for a synthetic repo (with-skill vs baseline), then grades capture of
planted facts and downstream honor of the invariant (a consuming agent given only the
produced docs).

Usage:
  OPENROUTER_API_KEY=... node authoring.js --models a/b [--repeats 5]
  node authoring.js --dry-run          print the authoring prompts, no API calls

Flags:
  --models        comma-separated OpenRouter model ids (required unless --dry-run)
  --repeats       runs per (model x arm), default 5
  --temperature   sampling temperature, default 0.7
  --concurrency   author+consume units in flight, default 4
  --consume-system eager | neutral (default): the consuming agent's prompt. neutral
                  rewards good placement (inline critical facts); eager is more lenient
  --consume-model M  model that reads the produced docs downstream (default: the author
                  model). Set a strong model to test doc usability independent of a weak
                  author's own consuming ability
  --skill-dir PATH path to a structuring-agent-docs checkout (default: sibling or in-repo)
  --out PATH      write raw per-run results as JSON
  --verbose, -v   (unused placeholder; per-run lines always print)
  --dry-run       build and print the authoring prompts; make no network calls
`);
}

async function validateModels(models) {
  let ids;
  try {
    ids = await fetchModelIds();
  } catch (e) {
    console.error(`(model list unavailable for validation: ${e.message})`);
    return;
  }
  const set = new Set(ids);
  const missing = models.filter((m) => !set.has(m));
  if (missing.length) {
    console.error('Unknown OpenRouter model(s): ' + missing.join(', '));
    console.error('See https://openrouter.ai/models.');
    process.exit(1);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return help();
  if (!['eager', 'neutral'].includes(args.consumeSystem)) {
    console.error('--consume-system must be eager or neutral.');
    process.exit(1);
  }

  let skillText;
  try {
    skillText = readSkill(resolveSkillDir(args.skillDir));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }

  if (args.dryRun) {
    for (const arm of ARMS) {
      const [sys, usr] = authoringMessages(arm, skillText);
      console.log('='.repeat(72));
      console.log(`ARM ${arm}`);
      console.log('--- system (truncated) ---');
      console.log(sys.content.length > 400 ? sys.content.slice(0, 400) + `\n... [${sys.content.length} chars total]` : sys.content);
      console.log('--- user ---');
      console.log(usr.content);
      console.log('');
    }
    return;
  }

  if (!args.models.length) {
    console.error('Pass --models, or use --dry-run. See --help.');
    process.exit(1);
  }
  if (!process.env.OPENROUTER_API_KEY) {
    console.error('Set OPENROUTER_API_KEY (or use --dry-run).');
    process.exit(1);
  }
  await validateModels(args.consumeModel ? [...new Set([...args.models, args.consumeModel])] : args.models);

  const units = [];
  for (const model of args.models) {
    for (const arm of ARMS) {
      for (let r = 0; r < args.repeats; r++) units.push({ model, arm, r });
    }
  }

  const agg = {};
  for (const m of args.models) {
    agg[m] = {};
    for (const arm of ARMS) {
      agg[m][arm] = {
        runs: 0,
        honored: 0,
        claude: 0,
        captured: Object.fromEntries(planted.map((p) => [p.id, 0])),
      };
    }
  }
  const raw = [];

  console.log(
    `Plan: ${args.models.length} model(s) x ${ARMS.length} arms x ${args.repeats} repeats = ` +
      `${units.length} units (${units.length * 2} calls), consume-model ` +
      `${args.consumeModel || 'author'}, consume-system ${args.consumeSystem}, ` +
      `concurrency ${args.concurrency}.`
  );
  const startedAt = Date.now();
  let done = 0;

  async function runUnit(u) {
    try {
      const consumeModel = args.consumeModel || u.model;
      return {
        u,
        res: await authorAndConsume(u.model, u.arm, skillText, args.consumeSystem, args.temperature, consumeModel),
      };
    } catch (e) {
      return { u, error: e };
    }
  }

  function record(o) {
    const { u, res, error } = o;
    done++;
    if (error) {
      console.error(`! ${u.model} ${u.arm} #${u.r}: ${error.message}`);
      return;
    }
    const c = agg[u.model][u.arm];
    c.runs++;
    if (res.honored) c.honored++;
    if (res.hasClaude) c.claude++;
    for (const id of Object.keys(res.captured)) if (res.captured[id]) c.captured[id]++;
    raw.push({ model: u.model, arm: u.arm, run: u.r, honored: res.honored, note: res.note, captured: res.captured, files: res.fileCount, hasClaude: res.hasClaude });
    const cap = planted.map((p) => (res.captured[p.id] ? p.id[0].toUpperCase() : '-')).join('');
    console.log(
      `[${done}/${units.length}] ${u.model} ${u.arm} #${u.r}  files=${res.fileCount} ` +
        `claude=${res.hasClaude ? 'y' : 'n'} capture=${cap} downstream=${res.honored ? 'honored' : 'missed'}`
    );
  }

  let next = 0;
  async function worker() {
    while (next < units.length) record(await runUnit(units[next++]));
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(args.concurrency, units.length)) }, () => worker()));

  console.log(`\nDone in ${Math.round((Date.now() - startedAt) / 1000)}s.`);

  const pct = (n, d) => (d ? Math.round((100 * n) / d) : 0);
  for (const m of args.models) {
    console.log(`\n=== authored by ${m} (consumed by ${args.consumeModel || m}, ${args.consumeSystem}) ===`);
    console.log('arm        n   ' + planted.map((p) => `cap:${p.id}`.padEnd(18)).join('') + 'downstream');
    for (const arm of ARMS) {
      const c = agg[m][arm];
      const caps = planted.map((p) => `${pct(c.captured[p.id], c.runs)}%`.padEnd(18)).join('');
      console.log(`${arm.padEnd(10)} ${String(c.runs).padStart(2)}  ${caps}${pct(c.honored, c.runs)}%`);
    }
  }

  if (args.out) {
    const mo = new Map(args.models.map((m, i) => [m, i]));
    const ao = new Map(ARMS.map((a, i) => [a, i]));
    raw.sort((a, b) => mo.get(a.model) - mo.get(b.model) || ao.get(a.arm) - ao.get(b.arm) || a.run - b.run);
    fs.writeFileSync(args.out, JSON.stringify({ args, raw }, null, 2));
    console.log(`\nWrote ${raw.length} runs to ${args.out}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
