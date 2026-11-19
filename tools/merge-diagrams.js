// Merges every source diagram (*.mmd in the repository root) into one flowchart:
//   ef-harness-complete.mmd
// Each source becomes a subgraph inside its chapter. Node IDs, subgraph IDs and class names
// get a per-source prefix so the 31 diagrams can't collide.
// Run from the repository root:  node tools/merge-diagrams.js
// Render (the file exceeds Mermaid's default size limits):
//   npx -y @mermaid-js/mermaid-cli@11 -i ef-harness-complete.mmd -o ef-harness-complete.svg -c tools/mermaid-large.json

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const OUTPUT = 'ef-harness-complete.mmd';

const chapters = [
  ['1 · Overview: from a spoken idea to a verified feature', [
    ['harness-architecture.mmd', 'ha'],
  ]],
  ['2 · Getting started: providers, the app, the folder', [
    ['onboarding-providers-and-runtimes.mmd', 'on'],
    ['desktop-app.mmd', 'da'],
    ['workspace-git-and-brownfield.mmd', 'wg'],
  ]],
  ['3 · Discovery: questions, depth, dictation, full spec', [
    ['adaptive-question-selection.mmd', 'aq'],
    ['discovery-depth-and-catalog.mmd', 'dd'],
    ['dictation-and-canvas.mmd', 'dc'],
    ['spec-expansion.mmd', 'se'],
  ]],
  ['4 · Steering: routing messages and publishing changes', [
    ['requirements-and-agent-routing.mmd', 'rr'],
    ['agent-graph-routing.mmd', 'ag'],
    ['mid-build-messages.mmd', 'mb'],
    ['linked-architecture-revisions.mmd', 'lr'],
  ]],
  ['5 · Planning and knowledge', [
    ['build-pipeline.mmd', 'bp'],
    ['planning-and-crew.mmd', 'pc'],
    ['task-and-skill-architecture.mmd', 'ts'],
    ['knowledge-slicing.mmd', 'ks'],
  ]],
  ['6 · Building and verifying', [
    ['agent-handoffs.mmd', 'ah'],
    ['parallel-feature-integration.mmd', 'pf'],
    ['verification-for-real-apps.mmd', 'vr'],
    ['completeness-gate.mmd', 'cg'],
    ['ui-design-system.mmd', 'ui'],
    ['investigations-and-sweeps.mmd', 'is'],
  ]],
  ['7 · Safety: sandbox, network, supply chain', [
    ['sandbox-and-security.mmd', 'sb'],
  ]],
  ['8 · State, recovery and the developer beside the harness', [
    ['knowledge-database.mmd', 'kd'],
    ['database-design.mmd', 'db'],
    ['stops-undo-and-reentry.mmd', 'su'],
    ['editor-coexistence.mmd', 'ec'],
  ]],
  ['9 · Watching the build: cockpit and office', [
    ['cockpit-and-office.mmd', 'co'],
  ]],
  ['10 · Shipping and moving projects', [
    ['ship-and-deploy.mmd', 'sd'],
    ['projects-portability-and-sync.mmd', 'pp'],
  ]],
  ['11 · Quality: the meta-lab', [
    ['meta-lab.mmd', 'ml'],
  ]],
];

const KEYWORDS = new Set(['subgraph', 'end', 'direction', 'classDef', 'class', 'style', 'linkStyle', 'click',
  'flowchart', 'graph', 'TB', 'TD', 'BT', 'LR', 'RL']);

// Prefix identifiers outside quoted labels and outside |edge labels|.
function renameCode(code, p) {
  let out = '';
  let i = 0;
  while (i < code.length) {
    const ch = code[i];
    if (ch === '"') {
      const j = code.indexOf('"', i + 1);
      if (j < 0) throw new Error(`Unclosed quote: ${code}`);
      out += code.slice(i, j + 1); i = j + 1; continue;
    }
    if (ch === '|') {
      const j = code.indexOf('|', i + 1);
      if (j < 0) throw new Error(`Unclosed edge label: ${code}`);
      out += code.slice(i, j + 1); i = j + 1; continue;
    }
    const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(code.slice(i));
    if (m) {
      const word = m[0];
      out += KEYWORDS.has(word) ? word : `${p}_${word}`;
      i += word.length; continue;
    }
    out += ch; i += 1;
  }
  return out;
}

function parse(file, p) {
  const text = fs.readFileSync(path.join(root, file), 'utf8').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/);
  let title = file;
  let idx = 0;
  if (lines[0].trim() === '---') {
    idx = 1;
    while (idx < lines.length && lines[idx].trim() !== '---') {
      const t = /^\s*title:\s*(.+)$/.exec(lines[idx]);
      if (t) title = t[1].trim();
      idx++;
    }
    idx++;
  }
  let direction = 'TB';
  const body = [];
  const styles = [];
  for (; idx < lines.length; idx++) {
    const raw = lines[idx];
    const t = raw.trim();
    if (!t) continue;
    const header = /^(flowchart|graph)\s+(\w+)/.exec(t);
    if (header) { direction = header[2]; continue; }
    if (t.startsWith('%%')) { body.push(raw); continue; }
    if (/^(linkStyle|click)\b/.test(t)) throw new Error(`${file}: ${t.split(' ')[0]} is not supported by the merger`);
    let m;
    if ((m = /^classDef\s+(\S+)\s+(.+)$/.exec(t))) { styles.push(`classDef ${p}_${m[1]} ${m[2]}`); continue; }
    if ((m = /^class\s+(\S+)\s+(\S+?);?$/.exec(t))) {
      styles.push(`class ${m[1].split(',').map(id => `${p}_${id}`).join(',')} ${p}_${m[2]}`); continue;
    }
    if ((m = /^style\s+(\S+)\s+(.+)$/.exec(t))) { styles.push(`style ${p}_${m[1]} ${m[2]}`); continue; }
    const indent = raw.match(/^\s*/)[0];
    if (t === 'end' || /^direction\s+\w+$/.test(t)) { body.push(indent + t); continue; }
    if ((m = /^subgraph\s+(.+)$/.exec(t))) { body.push(`${indent}subgraph ${renameCode(m[1], p)}`); continue; }
    body.push(indent + renameCode(t, p));
  }
  return { title, direction, body, styles };
}

const out = [];
const allStyles = [];
let sources = 0;
out.push('---');
out.push('title: EF Harness — the complete architecture, every diagram merged');
out.push('---');
out.push('flowchart TB');
out.push('  %% Generated by tools/merge-diagrams.js from every source diagram. Edit the sources, then re-run.');
out.push('  %% Chapters are chained top to bottom with invisible links (~~~), so they read 1 to 11 in one column.');
out.push('  subgraph MAP["Map · the eleven chapters below, in the order a project lives through them"]');
out.push('    direction LR');
chapters.forEach(([name], n) => out.push(`    MAP_${n + 1}["${name.replace(/"/g, "'")}"]`));
out.push(`    ${chapters.map((_, n) => `MAP_${n + 1}`).join(' --> ')}`);
out.push('  end');

chapters.forEach(([name, files], n) => {
  out.push(`  subgraph CH_${n + 1}["${name}"]`);
  out.push('    direction TB');
  for (const [file, p] of files) {
    const d = parse(file, p);
    sources++;
    out.push(`    subgraph ${p}_SRC["${d.title.replace(/"/g, "'")} · ${file}"]`);
    out.push(`      direction ${d.direction}`);
    for (const line of d.body) out.push('      ' + line.replace(/^\s{0,4}/, (s) => s));
    out.push('    end');
    allStyles.push(...d.styles);
  }
  out.push('  end');
});
out.push(`  MAP ~~~ ${chapters.map((_, n) => `CH_${n + 1}`).join(' ~~~ ')}`);
out.push('');
out.push('  %% Styles from every source, prefixed like their nodes');
for (const s of allStyles) out.push('  ' + s);
out.push('  classDef mapnode fill:#eef2ff,stroke:#4f46e5,color:#1e1b4b,stroke-width:2px');
out.push(`  class ${chapters.map((_, n) => `MAP_${n + 1}`).join(',')} mapnode`);

const present = new Set(fs.readdirSync(root).filter(f => f.endsWith('.mmd') && f !== OUTPUT));
const listed = new Set(chapters.flatMap(([, files]) => files.map(([f]) => f)));
const missing = [...present].filter(f => !listed.has(f));
if (missing.length) throw new Error(`Diagrams not assigned to a chapter: ${missing.join(', ')}`);

fs.writeFileSync(path.join(root, OUTPUT), out.join('\n') + '\n');
console.log(`Merged ${sources} diagrams into ${OUTPUT} (${out.length} lines)`);
