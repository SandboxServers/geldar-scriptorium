// Regenerates ledger.md from the card files. Run: node docs/analysis/harness/tools-ledger.mjs (from the repo root)
import fs from 'node:fs';
import path from 'node:path';

const dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const files = [
  ['kit A', 'work-packets-kit-a.md'],
  ['kit B', 'work-packets-kit-b.md'],
  ['kit C', 'work-packets-kit-c.md'],
  ['geldar A', 'work-packets-geldar-a.md'],
  ['geldar B', 'work-packets-geldar-b.md'],
  ['geldar C', 'work-packets-geldar-c.md'],
  ['extra', 'work-packets-extra.md'],
];
const field = (block, names) => {
  for (const n of names) {
    const re = new RegExp(`\\*\\*${n}:?\\*\\*:?\\s*(.*?)(?=\\s\\*\\*[A-Za-z]|$)`, 'i');
    const m = block.match(re);
    if (m)
      return m[1]
        .replace(/\s+/g, ' ')
        .replace(/\|/g, '/')
        .replace(/[\s.-]+$/, '')
        .trim()
        .slice(0, 150);
  }
  return '';
};
const rows = [];
for (const [label, f] of files) {
  const L = fs.readFileSync(path.join(dir, f), 'utf8').split('\n');
  for (let i = 0; i < L.length; i++) {
    const m = L[i].match(/^#{2,4} ((?:HC|AN|GX)-\d+[a-c]?)(?::| \()\s*(.*)$/);
    if (!m) continue;
    const block = L.slice(i + 1, i + 14).join(' ');
    rows.push({
      id: m[1],
      title: m[2].replace(/\|/g, '/').slice(0, 110),
      label,
      dep: field(block, ['depends-on', 'Depends on']),
      size: field(block, ['size', 'Size']).slice(0, 24),
      status: /BlockedDecision/.test(block)
        ? 'BlockedDecision'
        : /BlockedDependency/.test(block)
          ? 'BlockedDependency'
          : 'Writing',
    });
  }
}
const ord = (id) => {
  const m = id.match(/^(HC|AN|GX)-(\d+)([a-c]?)/);
  return [m[1], Number(m[2]), m[3]];
};
rows.sort((a, b) => {
  const x = ord(a.id);
  const y = ord(b.id);
  return x[0] === y[0] ? x[1] - y[1] || x[2].localeCompare(y[2]) : x[0].localeCompare(y[0]);
});
const n = (p) => rows.filter((r) => r.id.startsWith(p)).length;
let out = `# Card ledger (generated)

Generated from the card files by \`tools-ledger.mjs\`, reading each card's heading and its depends-on line. ${rows.length} cards: ${n('HC')} kit (HC), ${n('AN')} world (AN) and ${n('GX')} new world (GX). Status is the status when written: \`Writing\` means the card is written but not yet reviewed or dispatched. The README ledger summarises these; this file is the exact list. Regenerate it after any card edit.

| Card | Title | File | Depends on | Size | Status |
|---|---|---|---|---|---|
`;
for (const r of rows)
  out += `| ${r.id} | ${r.title} | ${r.label} | ${r.dep || '(see card)'} | ${r.size} | ${r.status} |\n`;
fs.writeFileSync(path.join(dir, 'ledger.md'), out);
console.log(
  rows.length,
  'cards;',
  rows.filter((r) => !r.dep).length,
  'without a parsed dependency:',
  rows
    .filter((r) => !r.dep)
    .map((r) => r.id)
    .join(' '),
);
