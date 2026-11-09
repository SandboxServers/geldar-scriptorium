import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkWorkflow } from './workflows.ts';

const SHA = '3d3c42e5aac5ba805825da76410c181273ba90b1';
const TAG_IF = "if: github.event_name == 'push' && startsWith(github.ref, 'refs/tags/kit-v')";
const MERGE_BASE = 'git merge-base --is-ancestor "$GITHUB_SHA" origin/main';

/** A passing release.yml; each hostile fixture edits one thing in it. */
const GOOD_RELEASE = `name: release
on:
  push:
    tags: ['kit-v*']
  workflow_dispatch:
permissions:
  contents: read
jobs:
  build:
    runs-on: ubuntu-24.04
    timeout-minutes: 30
    ${TAG_IF}
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@${SHA} # v7.0.1
        with:
          persist-credentials: false
          fetch-depth: 0
      - run: ${MERGE_BASE}
      - uses: docker/login-action@${SHA} # v3.0.0
`;

const GOOD_PUBLISH = `name: publish
on:
  workflow_call:
  workflow_dispatch:
permissions:
  contents: read
jobs:
  publish:
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    ${TAG_IF}
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: actions/checkout@${SHA} # v7.0.1
        with:
          persist-credentials: false
          fetch-depth: 0
      - run: ${MERGE_BASE}
`;

const GOOD_CI =
  `name: ci
on:
  pull_request:
permissions:
  contents: read
jobs:
  t:
    runs-on: ubuntu-24.04
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@${SHA} # v7.0.1
      - run: echo "$X"
        env:
          X: $` +
  `{{ github.ref }}
`;

const rules = (path: string, text: string) => [
  ...new Set(checkWorkflow({ path, text }).map((f) => f.rule)),
];
const step = (run: string) =>
  GOOD_RELEASE.replace(
    `      - run: ${MERGE_BASE}\n`,
    `      - run: ${MERGE_BASE}\n      - run: ${run}\n`,
  );
const stepBlock = (lines: string) =>
  GOOD_RELEASE.replace(
    `      - run: ${MERGE_BASE}\n`,
    `      - run: ${MERGE_BASE}\n      - run: |\n${lines}\n`,
  );
const ex = (v: string) => '$' + `{{ ${v} }}`;

describe('workflow lint: good fixtures', () => {
  it.each([
    ['release.yml', GOOD_RELEASE],
    ['publish-template.yml', GOOD_PUBLISH],
    ['ci.yml', GOOD_CI],
  ])('%s has no findings', (name, text) => {
    expect(checkWorkflow({ path: `.github/workflows/${name}`, text })).toEqual([]);
  });
});

interface Row {
  rule: string;
  label: string;
  file: string;
  text: string;
}
const rel = 'release.yml';
const rows: Row[] = [
  ...[
    ['unpinned @v4', `actions/checkout@v4 # v4.0.0`],
    ['@main', 'actions/checkout@main # v4.0.0'],
    ['39-hex', `actions/checkout@${SHA.slice(1)} # v4.0.0`],
    ['uppercase sha', `actions/checkout@${SHA.toUpperCase()} # v4.0.0`],
    ['no version comment', `actions/checkout@${SHA}`],
    ['docker://', 'docker://alpine:3'],
  ].map(([label, u]) => ({
    rule: 'pin',
    label: label as string,
    file: 'ci.yml',
    text: GOOD_CI.replace(`actions/checkout@${SHA} # v7.0.1`, u as string),
  })),
  {
    rule: 'permissions',
    label: 'write-all',
    file: 'ci.yml',
    text: GOOD_CI.replace('contents: read', 'write-all'),
  },
  {
    rule: 'permissions',
    label: 'absent',
    file: 'ci.yml',
    text: GOOD_CI.replace('permissions:\n  contents: read\n', ''),
  },
  {
    rule: 'permissions',
    label: 'id-token in ci',
    file: 'ci.yml',
    text: GOOD_CI.replace('    steps:', '    permissions:\n      id-token: write\n    steps:'),
  },
  {
    rule: 'permissions',
    label: 'id-token in build',
    file: rel,
    text: GOOD_RELEASE.replace('packages: write', 'id-token: write'),
  },
  {
    rule: 'idtoken-uses',
    label: 'docker login with id-token',
    file: 'publish-template.yml',
    text: GOOD_PUBLISH + `      - uses: docker/login-action@${SHA} # v3.0.0\n`,
  },
  {
    rule: 'idtoken-repo-code',
    label: 'checkout in an id-token job of release',
    file: rel,
    text:
      GOOD_RELEASE +
      `  launcher-sign:
    ${TAG_IF}
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: actions/checkout@${SHA} # v7.0.1
`,
  },
  {
    rule: 'idtoken-repo-code',
    label: 'repo script in an id-token job of release',
    file: rel,
    text:
      GOOD_RELEASE +
      `  launcher-sign:
    ${TAG_IF}
    permissions:
      contents: read
      id-token: write
    steps:
      - run: node tools/release/src/package-launcher.ts
`,
  },
  {
    rule: 'idtoken-uses',
    label: 'trivy with packages write',
    file: rel,
    text: GOOD_RELEASE + `      - uses: aquasecurity/trivy-action@${SHA} # v0.1.0\n`,
  },
  {
    rule: 'triggers',
    label: 'pull_request_target in ci',
    file: 'ci.yml',
    text: GOOD_CI.replace('pull_request:', 'pull_request_target:'),
  },
  {
    rule: 'triggers',
    label: 'pull_request_target in release',
    file: rel,
    text: GOOD_RELEASE.replace(
      '  workflow_dispatch:',
      '  workflow_dispatch:\n  pull_request_target:',
    ),
  },
  {
    rule: 'triggers',
    label: 'push branches',
    file: rel,
    text: GOOD_RELEASE.replace("tags: ['kit-v*']", 'branches: [main]'),
  },
  {
    rule: 'triggers',
    label: 'pull_request in release',
    file: rel,
    text: GOOD_RELEASE.replace('  workflow_dispatch:', '  workflow_dispatch:\n  pull_request:'),
  },
  {
    rule: 'triggers',
    label: 'push in publish',
    file: 'publish-template.yml',
    text: GOOD_PUBLISH.replace('  workflow_dispatch:', '  push:'),
  },
  {
    rule: 'triggers',
    label: 'no tag if',
    file: rel,
    text: GOOD_RELEASE.replace(`    ${TAG_IF}\n`, ''),
  },
  {
    rule: 'no-workflow-call-if',
    label: 'if workflow_call',
    file: 'publish-template.yml',
    text: GOOD_PUBLISH.replace(TAG_IF, "if: github.event_name == 'workflow_call'"),
  },
  {
    rule: 'secrets',
    label: 'AZURE secret',
    file: 'ci.yml',
    text: GOOD_CI + '        Y: $' + '{{ secrets.AZURE_CLIENT_SECRET }}\n',
  },
  {
    rule: 'secrets',
    label: 'inherit',
    file: 'ci.yml',
    text: GOOD_CI + '  c:\n    uses: ./.github/workflows/x.yml\n    secrets: inherit\n',
  },
  { rule: 'secrets', label: 'GELDAR_INTERNAL', file: rel, text: step('GELDAR_INTERNAL=1 node x') },
  {
    rule: 'model',
    label: 'ANTHROPIC_API_KEY',
    file: 'ci.yml',
    text: GOOD_CI + '        ANTHROPIC_API_KEY: x\n',
  },
  {
    rule: 'model',
    label: 'claude action',
    file: 'ci.yml',
    text: GOOD_CI + `      - uses: anthropics/claude-code-action@${SHA} # v1.0.0\n`,
  },
  { rule: 'model', label: 'claude -p', file: rel, text: step('claude -p hi') },
  { rule: 'model', label: 'live-check', file: rel, text: step('./scriptorium.ps1 live-check') },
  {
    rule: 'mask',
    label: 'output before mask',
    file: rel,
    text: stepBlock(
      '          S=$(az keyvault secret show --name n --query value -o tsv)\n          echo "s=$S" >> "$GITHUB_OUTPUT"\n          echo "::add-mask::$S"',
    ),
  },
  {
    rule: 'mask',
    label: 'set -x',
    file: rel,
    text: stepBlock(
      '          set -x\n          S=$(az keyvault secret show --name n -o tsv)\n          echo "::add-mask::$S"',
    ),
  },
  ...[
    'github.ref_name',
    'needs.build.outputs.digest',
    'github.event.pull_request.title',
    'inputs.version',
    'env.VERSION',
    'vars.X',
  ].map((v) => ({ rule: 'injection', label: v, file: rel, text: step(`echo ${ex(v)}`) })),
  {
    rule: 'checkout',
    label: 'no persist-credentials',
    file: rel,
    text: GOOD_RELEASE.replace('          persist-credentials: false\n', ''),
  },
  {
    rule: 'timeout',
    label: 'no timeout',
    file: 'ci.yml',
    text: GOOD_CI.replace('    timeout-minutes: 5\n', ''),
  },
  {
    rule: 'tagguard',
    label: 'no merge-base',
    file: rel,
    text: GOOD_RELEASE.replace(`      - run: ${MERGE_BASE}\n`, ''),
  },
  {
    rule: 'tagguard',
    label: 'no fetch-depth',
    file: rel,
    text: GOOD_RELEASE.replace('          fetch-depth: 0\n', ''),
  },
  {
    rule: 'yaml',
    label: 'anchor',
    file: 'ci.yml',
    text: GOOD_CI.replace('permissions:', 'x: &a 1\npermissions:'),
  },
  { rule: 'yaml', label: 'duplicate key', file: 'ci.yml', text: `${GOOD_CI}name: again\n` },
  { rule: 'yaml', label: 'invalid yaml', file: 'ci.yml', text: 'a: [unclosed\n  - : :\n' },
];

describe('workflow lint: one named finding per hostile fixture', () => {
  it.each(rows)('$rule: $label', ({ rule, file, text }) => {
    expect(rules(`.github/workflows/${file}`, text)).toContain(rule);
  });

  it('every rule has at least one row', () => {
    const all = [
      'pin',
      'permissions',
      'idtoken-uses',
      'idtoken-repo-code',
      'triggers',
      'no-workflow-call-if',
      'secrets',
      'model',
      'mask',
      'injection',
      'checkout',
      'timeout',
      'tagguard',
      'yaml',
    ];
    expect(new Set(rows.map((r) => r.rule))).toEqual(new Set(all));
  });

  it('a mask before the first output write passes', () => {
    const text = stepBlock(
      '          S=$(az keyvault secret show --name n -o tsv)\n          echo "::add-mask::$S"\n          echo "s=$S" >> "$GITHUB_OUTPUT"',
    );
    expect(rules(`.github/workflows/${rel}`, text)).not.toContain('mask');
  });
});

describe('real workflows and cli', () => {
  const root = join(fileURLToPath(new URL('.', import.meta.url)), '../../..');
  const cli = join(root, 'tools/repo-checks/src/workflows-cli.ts');

  it('the repo ci.yml has zero findings', () => {
    const text = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');
    expect(checkWorkflow({ path: '.github/workflows/ci.yml', text })).toEqual([]);
  });

  it('cli exits 1 on a fixture directory with a finding and 0 on the repo workflows', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wf-'));
    writeFileSync(join(dir, 'ci.yml'), GOOD_CI.replace('pull_request:', 'pull_request_target:'));
    const bad = spawnSync(process.execPath, [cli, dir], { encoding: 'utf8' });
    expect(bad.status).toBe(1);
    expect(bad.stdout).toContain('[triggers]');
    const good = spawnSync(process.execPath, [cli, join(root, '.github/workflows')], {
      encoding: 'utf8',
    });
    expect(good.status).toBe(0);
  });
});
