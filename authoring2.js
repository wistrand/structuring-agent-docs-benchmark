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
const { chat, fetchModels, REASONING_MODES, modelSettings } = require('./openrouter');
const { runAgent, systemFor, statusOf, isInvalid } = require('./agent');
const { repo, authorNote, structural, classify, meaning } = require('./authoring2-cases');

const ARMS = ['skill', 'baseline'];

// The authoring arm feeds the skill to the model, so the benchmark needs a skill
// checkout. Works whether the benchmark lives inside the skill repo or as its own
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
// with the consumer given the produced docs AND the repo source. `o` carries the consumer
// model and the per-call settings (temperature, token budgets, reasoning objects).
async function authorUnit(model, arm, skillText, o) {
  const author = await chat(model, authoringMessages(arm, skillText), {
    temperature: o.temperature,
    maxTokens: o.authorMaxTokens,
    reasoning: o.authorReasoning,
  });
  // Docs cut off by the budget would grade as omitted or fragile and bias the arm, so an
  // empty or truncated authoring call is reported invalid and the consumer is skipped.
  const authorStatus = statusOf(author.text, author.finishReason, { answerLine: false });
  if (isInvalid(authorStatus)) {
    return {
      invalid: `author ${authorStatus}`,
      // Kept so a refusal or cut-off can be diagnosed without spending a rerun.
      detail: {
        finishReason: author.finishReason,
        nativeFinishReason: author.nativeFinishReason,
        refusal: author.refusal,
        textHead: author.text.slice(0, 500),
      },
      authorUsage: author.usage,
      cost: author.usage.cost,
    };
  }
  const files = parseFiles(author.text);
  const struct = {};
  for (const f of structural) struct[f.id] = classify(files, f);

  const claudeKey = Object.keys(files).find((k) => /(^|\/)CLAUDE\.md$/i.test(k));
  // No CLAUDE.md produced: load everything the author wrote, as authoring.js does.
  const alwaysLoaded = claudeKey ? files[claudeKey] : Object.values(files).join('\n\n');
  const onDemand = {};
  for (const [k, v] of Object.entries(files)) if (k !== claudeKey) onDemand[k] = v;
  // consumer gets the produced docs AND the repo source, as a real agent would.
  const consumed = await runAgent(
    o.consumeModel,
    { alwaysLoaded, files: { ...onDemand, ...repo } },
    meaning.task,
    { temperature: o.temperature, system: systemFor(o.consumeSystem), maxTokens: o.maxTokens, reasoning: o.consumeReasoning }
  );
  const graded = meaning.grade(consumed.finalText);
  return {
    struct,
    meaningHonored: isInvalid(consumed.status) ? null : graded.honored,
    consumerStatus: consumed.status,
    note: graded.note,
    fileCount: Object.keys(files).length,
    docs: files,
    authorUsage: author.usage,
    cost: author.usage.cost + consumed.cost,
  };
}

// Control: the meaning task with the source but no produced docs. Measures how often the
// model answers correctly from caution alone, with no doc to carry the why.
async function controlUnit(o) {
  const consumed = await runAgent(
    o.consumeModel,
    { alwaysLoaded: '# Widgets service\n\nSee the source under src/ and config/.', files: { ...repo } },
    meaning.task,
    { temperature: o.temperature, system: systemFor(o.consumeSystem), maxTokens: o.maxTokens, reasoning: o.consumeReasoning }
  );
  const honored = isInvalid(consumed.status) ? null : meaning.grade(consumed.finalText).honored;
  return { honored, status: consumed.status, cost: consumed.cost };
}

function parseArgs(argv) {
  const a = {
    models: [], repeats: 5, temperature: 0.7, concurrency: 4,
    consumeModel: null, consumeSystem: 'eager', skillDir: null, out: null, dryRun: false, help: false,
    maxTokens: 8192, authorMaxTokens: 16000, reasoning: 'default', consumeReasoning: 'default',
    arms: ARMS, noControl: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--models') a.models = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (x === '--repeats') a.repeats = Number(argv[++i]);
    else if (x === '--temperature') a.temperature = Number(argv[++i]);
    else if (x === '--concurrency') a.concurrency = Number(argv[++i]);
    else if (x === '--consume-model') a.consumeModel = String(argv[++i] || '').trim();
    else if (x === '--consume-system') a.consumeSystem = String(argv[++i] || '').trim();
    else if (x === '--reasoning') a.reasoning = String(argv[++i] || '').trim();
    else if (x === '--arms') a.arms = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (x === '--no-control') a.noControl = true;
    else if (x === '--consume-reasoning') a.consumeReasoning = String(argv[++i] || '').trim();
    else if (x === '--max-tokens') a.maxTokens = Number(argv[++i]);
    else if (x === '--author-max-tokens') a.authorMaxTokens = Number(argv[++i]);
    else if (x === '--skill-dir') a.skillDir = String(argv[++i] || '').trim();
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
  --reasoning M    author reasoning: default (send nothing) | off | low | medium | high,
                   resolved per model from the catalog (see run.js --help)
  --consume-reasoning M  the same for the consuming agent, default: default
  --author-max-tokens N  authoring completion budget, default 16000
  --arms LIST      arms to run, default skill,baseline (e.g. baseline to retry one arm)
  --no-control     skip the source-only control units
  --max-tokens N   consuming agent budget per turn, default 8192
  --skill-dir PATH path to a structuring-agent-docs checkout (default: sibling or in-repo)
  --out PATH       write raw per-run results as JSON
  --dry-run        print the authoring prompt, no API calls
`);
}

// Returns the catalog as a Map (id -> entry), or null when it is unreachable.
async function validateModels(models) {
  let catalog;
  try { catalog = await fetchModels(); } catch (e) { console.error(`(model list unavailable: ${e.message})`); return null; }
  const set = new Set(catalog.map((m) => m.id));
  const missing = models.filter((m) => !set.has(m));
  if (missing.length) { console.error('Unknown model(s): ' + missing.join(', ') + ' (see https://openrouter.ai/models)'); process.exit(1); }
  return new Map(catalog.map((m) => [m.id, m]));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return help();
  if (!['eager', 'neutral'].includes(args.consumeSystem)) { console.error('--consume-system must be eager or neutral.'); process.exit(1); }
  for (const [flag, v] of [['--reasoning', args.reasoning], ['--consume-reasoning', args.consumeReasoning]]) {
    if (!REASONING_MODES.includes(v)) { console.error(`${flag} must be one of: ${REASONING_MODES.join(', ')}.`); process.exit(1); }
  }
  if (!args.arms.length || args.arms.some((x) => !ARMS.includes(x))) { console.error(`--arms must list one or more of: ${ARMS.join(', ')}.`); process.exit(1); }
  for (const [flag, v] of [['--max-tokens', args.maxTokens], ['--author-max-tokens', args.authorMaxTokens]]) {
    if (!Number.isInteger(v) || v < 1) { console.error(`${flag} must be a positive integer.`); process.exit(1); }
  }

  let skillText;
  try {
    skillText = readSkill(resolveSkillDir(args.skillDir));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
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
  const consumers = args.consumeModel ? [args.consumeModel] : args.models;
  const catalog = await validateModels([...new Set([...args.models, ...consumers])]);
  const authorSettings = modelSettings(args.models, catalog, { reasoning: args.reasoning });
  const consumeSettings = modelSettings(consumers, catalog, { reasoning: args.consumeReasoning });

  const units = [];
  for (const model of args.models) {
    for (const arm of args.arms) for (let r = 0; r < args.repeats; r++) units.push({ kind: 'author', model, arm, r });
    if (!args.noControl) for (let r = 0; r < args.repeats; r++) units.push({ kind: 'control', model, r });
  }

  const agg = {};
  for (const m of args.models) {
    agg[m] = { control: { runs: 0, honored: 0, invalid: 0 } };
    for (const arm of ARMS) {
      agg[m][arm] = { runs: 0, invalid: 0, meaningRuns: 0, meaningInvalid: 0, meaningHonored: 0, struct: {} };
      for (const f of structural) agg[m][arm].struct[f.id] = { robust: 0, fragile: 0, omitted: 0 };
    }
  }
  const raw = [];
  // Line-per-unit stream beside --out, appended as units finish, so a stopped run keeps
  // what it completed (errors included).
  const stream = args.out ? args.out.replace(/\.json$/i, '') + '.runs.jsonl' : null;
  if (stream) {
    const header = { header: true, startedAt: new Date().toISOString(), args, settings: { authors: authorSettings, consumers: consumeSettings } };
    fs.writeFileSync(stream, JSON.stringify(header) + '\n');
  }
  const emit = (rec) => {
    raw.push(rec);
    if (stream) fs.appendFileSync(stream, JSON.stringify(rec) + '\n');
  };
  console.log(
    `Plan: ${args.models.length} model(s) x (${args.arms.join(' + ')}${args.noControl ? '' : ' + control'}) x ${args.repeats} repeats, ` +
      `consume-model ${args.consumeModel || 'author'}, consume-system ${args.consumeSystem}, ` +
      `author-max-tokens ${args.authorMaxTokens}, max-tokens ${args.maxTokens}, concurrency ${args.concurrency}.`
  );
  const describe = (s) => `reasoning ${s.effectiveReasoning}${s.notes.length ? '; ' + s.notes.join('; ') : ''}`;
  for (const m of args.models) console.log(`  author ${m}: ${describe(authorSettings[m])}`);
  for (const m of consumers) console.log(`  consumer ${m}: ${describe(consumeSettings[m])}`);
  const startedAt = Date.now();
  let done = 0;
  let totalCost = 0;

  async function runOne(u) {
    const consumeModel = args.consumeModel || u.model;
    const o = {
      consumeModel,
      consumeSystem: args.consumeSystem,
      temperature: args.temperature,
      maxTokens: args.maxTokens,
      authorMaxTokens: args.authorMaxTokens,
      authorReasoning: authorSettings[u.model].reasoning,
      consumeReasoning: consumeSettings[consumeModel].reasoning,
    };
    try {
      if (u.kind === 'control') return { u, control: await controlUnit(o) };
      return { u, res: await authorUnit(u.model, u.arm, skillText, o) };
    } catch (e) { return { u, error: e }; }
  }

  function record(o) {
    const { u, res, control, error } = o;
    done++;
    if (error) { console.error(`! ${u.model} ${u.kind}${u.arm ? '/' + u.arm : ''} #${u.r}: ${error.message}`);
      if (stream) fs.appendFileSync(stream, JSON.stringify({ model: u.model, kind: u.kind, arm: u.arm, run: u.r, error: String(error.message).slice(0, 500) }) + '\n');
      return;
    }
    const tag = (h) => (h === null ? 'INVALID' : h ? 'honored' : 'missed');
    if (u.kind === 'control') {
      const c = agg[u.model].control;
      totalCost += control.cost;
      if (control.honored === null) c.invalid++;
      else { c.runs++; if (control.honored) c.honored++; }
      emit({ model: u.model, kind: 'control', run: u.r, meaning: control.honored, status: control.status, cost: control.cost });
      console.log(`[${done}/${units.length}] ${u.model} control #${u.r}  meaning=${tag(control.honored)}`);
      return;
    }
    const c = agg[u.model][u.arm];
    totalCost += res.cost;
    if (res.invalid) {
      c.invalid++;
      emit({ model: u.model, arm: u.arm, run: u.r, invalid: res.invalid, detail: res.detail, authorUsage: res.authorUsage, cost: res.cost });
      const d = res.detail;
      const why = d.refusal || d.textHead;
      console.log(
        `[${done}/${units.length}] ${u.model} ${u.arm} #${u.r}  INVALID (${res.invalid}, native ${d.nativeFinishReason || '-'})` +
          (why ? `  "${why.replace(/\s+/g, ' ').slice(0, 200)}"` : '')
      );
      return;
    }
    c.runs++;
    for (const f of structural) c.struct[f.id][res.struct[f.id]]++;
    if (res.meaningHonored === null) c.meaningInvalid++;
    else { c.meaningRuns++; if (res.meaningHonored) c.meaningHonored++; }
    emit({ model: u.model, arm: u.arm, run: u.r, struct: res.struct, meaning: res.meaningHonored, consumerStatus: res.consumerStatus, files: res.fileCount, docs: res.docs, authorUsage: res.authorUsage, cost: res.cost });
    const st = structural.map((f) => `${f.id}:${res.struct[f.id][0]}`).join(' ');
    console.log(`[${done}/${units.length}] ${u.model} ${u.arm} #${u.r}  ${st}  meaning=${tag(res.meaningHonored)}`);
  }

  let next = 0;
  async function worker() { while (next < units.length) record(await runOne(units[next++])); }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(args.concurrency, units.length)) }, () => worker()));

  console.log(`\nDone in ${Math.round((Date.now() - startedAt) / 1000)}s, reported cost $${totalCost.toFixed(4)}.`);
  const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : "-");
  for (const m of args.models) {
    console.log(`\n=== authored by ${m} (consumed by ${args.consumeModel || m}, ${args.consumeSystem}) ===`);
    console.log('structural (robust% = points-or-generates, fragile% = hand-copied literal):');
    for (const arm of args.arms) {
      const c = agg[m][arm];
      const cols = structural.map((f) => {
        const s = c.struct[f.id];
        return `${f.id} robust ${pct(s.robust, c.runs)} fragile ${pct(s.fragile, c.runs)} omit ${pct(s.omitted, c.runs)}`;
      }).join('   ');
      console.log(`  ${arm.padEnd(9)} n=${c.runs}${c.invalid ? ` invalid=${c.invalid}` : ''}  ${cols}`);
    }
    const ctl = agg[m].control;
    console.log('meaning honor% (needs the given why; control = source only, no docs):');
    console.log(`  skill ${pct(agg[m].skill.meaningHonored, agg[m].skill.meaningRuns)}   baseline ${pct(agg[m].baseline.meaningHonored, agg[m].baseline.meaningRuns)}   control ${pct(ctl.honored, ctl.runs)}`);
    const inv = agg[m].skill.meaningInvalid + agg[m].baseline.meaningInvalid + ctl.invalid;
    if (inv) console.log(`  (${inv} consumer run(s) invalid: empty or cut off, excluded from meaning honor%)`);
  }

  if (args.out) {
    fs.writeFileSync(args.out, JSON.stringify({ args, settings: { authors: authorSettings, consumers: consumeSettings }, raw }, null, 2));
    console.log(`\nWrote ${raw.length} runs to ${args.out}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
