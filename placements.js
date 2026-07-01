'use strict';

// Builds the five placement variants of a case. The only thing that changes across
// variants is *where the fact lives*; the base entry point and the task are constant,
// so any difference in outcome is the placement, not the content.

function baseClaudeMd() {
  return `# Widgets service

Guidance for agents working in this repo. Read this first, then the relevant file
in \`agent_docs/\`.

## Layout
| Path          | Role                                |
|---------------|-------------------------------------|
| \`src/\`        | service code                        |
| \`agent_docs/\` | per-topic deep dives (linked below) |

## Conventions
- TypeScript, 2-space indent, no default exports.
- Do not touch \`src/generated/\`.
`;
}

function docsLink(path, label) {
  return `\n## Docs\n- [${path}](${path}): ${label}.\n`;
}

// hint controls how discoverable the linked fact is. Under `blind` the link label and
// the file names are generic, so nothing about the entry point signals that a
// routine-looking task has a non-obvious convention behind the link. Only inline,
// import, and absent are unaffected (they carry no links).
function placements(c, hint = 'eager') {
  const base = baseClaudeMd();
  const blind = hint === 'blind';
  const withHint = hint === 'hint';

  const factPath = blind ? 'agent_docs/reference.md' : c.factPath;
  const factLabel = blind ? 'project docs' : c.factLabel;
  const midPath = blind ? 'agent_docs/overview.md' : 'agent_docs/architecture.md';
  const midLabel = blind ? 'project docs' : 'system overview';
  const midTitle = blind ? '# Overview' : '# Architecture';

  // hint mode adds the skill's per-link "read before you touch" imperative to the link
  // line itself, with no global urging in the system prompt.
  // no trailing period: docsLink appends one after the purpose.
  const linkPurpose = withHint ? `Read this before working on ${c.factLabel}` : factLabel;
  const midPurpose = withHint
    ? `Read the linked docs before working on ${c.factLabel}`
    : midLabel;
  const chainPointer = blind
    ? `See [${factPath}](${factPath}) for more.`
    : withHint
      ? `Read [${factPath}](${factPath}) before working on ${c.factLabel}.`
      : `For ${c.factLabel} see [${factPath}](${factPath}).`;

  return {
    inline: {
      name: 'inline',
      alwaysLoaded: base + '\n' + c.fact + '\n',
      files: {},
    },
    import: {
      name: 'import',
      // @-import loads eagerly: the file's full content is pulled into the
      // always-loaded context. Same tokens as inline, presented as an import.
      alwaysLoaded: base + `\n<!-- @${factPath} (eagerly imported) -->\n` + c.fact + '\n',
      files: {},
    },
    link: {
      name: 'link',
      // one level deep: CLAUDE.md links the file; the fact lives only inside it.
      alwaysLoaded: base + docsLink(factPath, linkPurpose),
      files: { [factPath]: c.fact },
    },
    chain: {
      name: 'chain',
      // doc -> doc -> doc: CLAUDE.md links a mid doc, which links the fact file.
      alwaysLoaded: base + docsLink(midPath, midPurpose),
      files: {
        [midPath]: `${midTitle}\n\nThe service is a request router. ${chainPointer}\n`,
        [factPath]: c.fact,
      },
    },
    absent: {
      name: 'absent',
      alwaysLoaded: base,
      files: {},
    },
  };
}

const PLACEMENT_ORDER = ['inline', 'import', 'link', 'chain', 'absent'];

module.exports = { placements, PLACEMENT_ORDER, baseClaudeMd };
