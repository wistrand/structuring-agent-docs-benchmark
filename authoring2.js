'use strict';

// Improved authoring benchmark. Measures two on-thesis things about the docs an agent
// produces, with vs without the skill:
//   structural: for volatile settings values, does the doc point at the source (ideal)
//               or hard-code the literal (fragile)? Mechanical, deterministic.
//   meaning:    for a why that is not in the code (given to the author), does a consuming
//               agent that HAS the source get a source+why task right? A source-only
//               control measures the caution baseline.
// This avoids the earlier downstream flaw (a source-derivable fact with the source
// removed, which punished point-into-source). No external deps; Node 18+.

const fs = require('fs');
const path = require('path');
const { chat, fetchModelIds } = require('./openrouter');
const { runAgent, systemFor } = require('./agent');
const { repo, authorNote, structural, classify, meaning } = require('./authoring2-cases');

const SKILL_DIR = path.join(__dirname, '..');
const ARMS = ['skill', 'baseline'];

function readSkill() {
  let text = fs.readFileSync(path.join(SKILL_DIR, 'SKILL.md'), 'utf8');
  const refDir = path.join(SKILL_DIR, 'references');
  for (const f of fs.readdirSync(refDir).sort()) {
    if (f.endsWith('.md')) text += `\n\n----- references/${f} -----\n\n` + fs.readFileSync(path.join(refDir, f), 'utf8');
  }
  return text;
}

function repoListing() {
  return Object.entries(repo).map(([p, c]) => `----- ${p} -----\n${c}`).join('\n\n');
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
  const user =
    `${OUTPUT_RULE}\n\nRepository:\n\n${repoListing()}\n\nAlso note this for the docs:\n\n${authorNote}`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

function parseFiles(text) {
  const files = {};
  const marks = [...text.matchAll(/^===\s*FILE:\s*(.+?)\s*===\s*$/gim)];
  for (let i = 0; i < marks.length; i++) {
    const p = marks[i][1].trim().replace(/[`'"]/g, '');
    const start = marks[i].index + marks[i][0].length;
    const end = i + 1 < marks.length ? marks[i + 1].index : text.length;
    let body = text.slice(start, end).trim().replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim();
    files[p] = body;
  }
  return files;
}

// One authoring unit: author docs, classify structural facts, then run the meaning task
// with the consumer given the produced docs AND the repo source.
async function authorUnit(model, arm, skillText, consumeModel, consumeSystem, temperature) {
  const author = await chat(model, authoringMessages(arm, skillText), { temperature, maxTokens: 2000 });
  const files = parseFiles(author.text);
  const struct = {};
  for (const f of structural) struct[f.id] = classify(files, f);

  const claudeKey = Object.keys(files).find((k) => /(^|\/)CLAUDE\.md$/i.test(k));
  const alwaysLoaded = claudeKey ? files[claudeKey] : docsText;
  const onDemand = {};
  for (const [k, v] of Object.entries(files)) if (k !== claudeKey) onDemand[k] = v;
  // consumer gets the produced docs AND the repo source, as a real agent would.
  const consumed = await runAgent(
    consumeModel,
    { alwaysLoaded, files: { ...onDemand, ...repo } },
    meaning.task,
    { temperature, system: systemFor(consumeSystem) }
  );
  const graded = meaning.grade(consumed.finalText);
  return { struct, meaningHonored: graded.honored, note: graded.note, fileCount: Object.keys(files).length, docs: files };
}

// Control: the meaning task with the source but no produced docs. Measures how often the
// model answers correctly from caution alone, with no doc to carry the why.
async function controlUnit(consumeModel, consumeSystem, temperature) {
  const consumed = await runAgent(
    consumeModel,
    { alwaysLoaded: '# Widgets service\n\nSee the source under src/ and config/.', files: { ...repo } },
    meaning.task,
    { temperature, system: systemFor(consumeSystem) }
  );
  return meaning.grade(consumed.finalText).honored;
}

function parseArgs(argv) {
  const a = {
    models: [], repeats: 5, temperature: 0.7, concurrency: 4,
    consumeModel: null, consumeSystem: 'eager', out: null, dryRun: false, help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--models') a.models = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (x === '--repeats') a.repeats = Number(argv[++i]);
    else if (x === '--temperature') a.temperature = Number(argv[++i]);
    else if (x === '--concurrency') a.concurrency = Number(argv[++i]);
    else if (x === '--consume-model') a.consumeModel = String(argv[++i] || '').trim();
    else if (x === '--consume-system') a.consumeSystem = String(argv[++i] || '').trim();
    else if (x === '--out') a.out = argv[++i];
    else if (x === '--dry-run') a.dryRun = true;
    else if (x === '--help' || x === '-h') a.help = true;
  }
  return a;
}

function help() {
  console.log(`Improved authoring benchmark for structuring-agent-docs.

Measures, with vs without the skill:
  structural  for settings values, does the doc point at the schema (ideal) or hard-code
              the literal (fragile)? mechanical.
  meaning     for a why not in the code (given to the author), does a consuming agent that
              HAS the source answer a why-dependent task correctly? a source-only control
              gives the caution baseline.

Usage:
  OPENROUTER_API_KEY=... node authoring2.js --models a/b [--consume-model c/d] [--repeats 5]
  node authoring2.js --dry-run

Flags:
  --models         comma-separated OpenRouter author model ids (required unless --dry-run)
  --repeats        runs per (model x arm), default 5
  --temperature    default 0.7
  --concurrency    units in flight, default 4
  --consume-model  model that reads docs+source downstream (default: the author model)
  --consume-system eager (default) | neutral: the consuming agent's prompt
  --out PATH       write raw per-run results as JSON
  --dry-run        print the authoring prompt, no API calls
`);
}

async function validateModels(models) {
  let ids;
  try { ids = await fetchModelIds(); } catch (e) { console.error(`(model list unavailable: ${e.message})`); return; }
  const set = new Set(ids);
  const missing = models.filter((m) => !set.has(m));
  if (missing.length) { console.error('Unknown model(s): ' + missing.join(', ') + ' (see https://openrouter.ai/models)'); process.exit(1); }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return help();
  if (!['eager', 'neutral'].includes(args.consumeSystem)) { console.error('--consume-system must be eager or neutral.'); process.exit(1); }

  const skillText = readSkill();
  if (args.dryRun) {
    const [sys, usr] = authoringMessages('skill', skillText);
    console.log('--- skill system (truncated) ---');
    console.log(sys.content.slice(0, 300) + `\n... [${sys.content.length} chars]`);
    console.log('--- user (both arms) ---');
    console.log(usr.content);
    return;
  }
  if (!args.models.length) { console.error('Pass --models, or use --dry-run.'); process.exit(1); }
  if (!process.env.OPENROUTER_API_KEY) { console.error('Set OPENROUTER_API_KEY.'); process.exit(1); }
  await validateModels(args.consumeModel ? [...new Set([...args.models, args.consumeModel])] : args.models);

  const units = [];
  for (const model of args.models) {
    for (const arm of ARMS) for (let r = 0; r < args.repeats; r++) units.push({ kind: 'author', model, arm, r });
    for (let r = 0; r < args.repeats; r++) units.push({ kind: 'control', model, r });
  }

  const agg = {};
  for (const m of args.models) {
    agg[m] = { control: { runs: 0, honored: 0 } };
    for (const arm of ARMS) {
      agg[m][arm] = { runs: 0, meaningHonored: 0, struct: {} };
      for (const f of structural) agg[m][arm].struct[f.id] = { robust: 0, fragile: 0, omitted: 0 };
    }
  }
  const raw = [];
  console.log(
    `Plan: ${args.models.length} model(s) x (${ARMS.length} arms + control) x ${args.repeats} repeats, ` +
      `consume-model ${args.consumeModel || 'author'}, consume-system ${args.consumeSystem}, ` +
      `concurrency ${args.concurrency}.`
  );
  const startedAt = Date.now();
  let done = 0;

  async function runOne(u) {
    const consumeModel = args.consumeModel || u.model;
    try {
      if (u.kind === 'control') return { u, control: await controlUnit(consumeModel, args.consumeSystem, args.temperature) };
      return { u, res: await authorUnit(u.model, u.arm, skillText, consumeModel, args.consumeSystem, args.temperature) };
    } catch (e) { return { u, error: e }; }
  }

  function record(o) {
    const { u, res, control, error } = o;
    done++;
    if (error) { console.error(`! ${u.model} ${u.kind}${u.arm ? '/' + u.arm : ''} #${u.r}: ${error.message}`); return; }
    if (u.kind === 'control') {
      const c = agg[u.model].control; c.runs++; if (control) c.honored++;
      raw.push({ model: u.model, kind: 'control', run: u.r, meaning: control });
      console.log(`[${done}/${units.length}] ${u.model} control #${u.r}  meaning=${control ? 'honored' : 'missed'}`);
      return;
    }
    const c = agg[u.model][u.arm]; c.runs++; if (res.meaningHonored) c.meaningHonored++;
    for (const f of structural) c.struct[f.id][res.struct[f.id]]++;
    raw.push({ model: u.model, arm: u.arm, run: u.r, struct: res.struct, meaning: res.meaningHonored, files: res.fileCount, docs: res.docs });
    const st = structural.map((f) => `${f.id}:${res.struct[f.id][0]}`).join(' ');
    console.log(`[${done}/${units.length}] ${u.model} ${u.arm} #${u.r}  ${st}  meaning=${res.meaningHonored ? 'honored' : 'missed'}`);
  }

  let next = 0;
  async function worker() { while (next < units.length) record(await runOne(units[next++])); }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(args.concurrency, units.length)) }, () => worker()));

  console.log(`\nDone in ${Math.round((Date.now() - startedAt) / 1000)}s.`);
  const pct = (n, d) => (d ? Math.round((100 * n) / d) : 0);
  for (const m of args.models) {
    console.log(`\n=== authored by ${m} (consumed by ${args.consumeModel || m}, ${args.consumeSystem}) ===`);
    console.log('structural (robust% = points-or-generates, fragile% = hand-copied literal):');
    for (const arm of ARMS) {
      const c = agg[m][arm];
      const cols = structural.map((f) => {
        const s = c.struct[f.id];
        return `${f.id} robust ${pct(s.robust, c.runs)}% fragile ${pct(s.fragile, c.runs)}% omit ${pct(s.omitted, c.runs)}%`;
      }).join('   ');
      console.log(`  ${arm.padEnd(9)} n=${c.runs}  ${cols}`);
    }
    const ctl = agg[m].control;
    console.log('meaning honor% (needs the given why; control = source only, no docs):');
    console.log(`  skill ${pct(agg[m].skill.meaningHonored, agg[m].skill.runs)}%   baseline ${pct(agg[m].baseline.meaningHonored, agg[m].baseline.runs)}%   control ${pct(ctl.honored, ctl.runs)}%`);
  }

  if (args.out) {
    fs.writeFileSync(args.out, JSON.stringify({ args, raw }, null, 2));
    console.log(`\nWrote ${raw.length} runs to ${args.out}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
