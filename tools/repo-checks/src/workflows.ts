/**
 * Lint for .github/workflows/*.yml. Pure over text so tests use fixtures; the
 * cli (workflows-cli.ts) reads the files. Rules are named; each finding says
 * which rule fired. D-SC-01: no model call in CI; D-SC-02: no GitHub secrets.
 */
import { basename } from 'node:path';
import { isAlias, parseDocument, visit } from 'yaml';

export interface Finding {
  rule: string;
  file: string;
  line?: number;
  message: string;
}

export interface WorkflowFile {
  path: string;
  text: string;
}

type Obj = Record<string, unknown>;
type Add = (rule: string, message: string, line?: number) => void;

/** Which jobs of which workflow file may hold each credential. */
const ID_TOKEN_JOBS: Record<string, string[]> = {
  'publish-template.yml': ['publish'],
  'release.yml': ['sign', 'launcher', 'template'],
};
const PACKAGES_WRITE_JOBS: Record<string, string[]> = { 'release.yml': ['build', 'sign'] };
const CONTENTS_WRITE_JOBS: Record<string, string[]> = { 'release.yml': ['release'] };
const ACTIONS_WITH_CREDENTIALS = [
  'actions/checkout',
  'actions/setup-node',
  'actions/download-artifact',
  'actions/upload-artifact',
  'sigstore/cosign-installer',
  'azure/login',
  'actions/create-github-app-token',
];
const RELEASE_FILES = ['publish-template.yml', 'release.yml'];
const TAG_IF = ["github.event_name == 'push'", "startsWith(github.ref, 'refs/tags/kit-v')"];

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const asObj = (v: unknown): Obj => (isObj(v) ? v : {});
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const norm = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ');

interface Step {
  uses?: string;
  run?: string;
  if?: unknown;
  with: Obj;
}
interface Job {
  name: string;
  data: Obj;
  steps: Step[];
  perms: Obj;
  credentialed: boolean;
}

function toStep(raw: unknown): Step {
  const s = asObj(raw);
  return {
    ...(typeof s.uses === 'string' ? { uses: s.uses } : {}),
    ...(typeof s.run === 'string' ? { run: s.run } : {}),
    ...('if' in s ? { if: s.if } : {}),
    with: asObj(s.with),
  };
}

function toJobs(jobs: unknown): Job[] {
  return Object.entries(asObj(jobs)).map(([name, raw]) => {
    const data = asObj(raw);
    const perms = asObj(data.permissions);
    const credentialed =
      perms['id-token'] === 'write' || perms.packages === 'write' || perms.contents === 'write';
    return { name, data, steps: asArr(data.steps).map(toStep), perms, credentialed };
  });
}

function triggersOf(on: unknown): Record<string, unknown> {
  if (typeof on === 'string') return { [on]: null };
  if (Array.isArray(on)) return Object.fromEntries(on.map((k) => [String(k), null]));
  return asObj(on);
}

export function checkWorkflow(file: WorkflowFile): Finding[] {
  const out: Finding[] = [];
  const name = basename(file.path);
  const add: Add = (rule, message, line) =>
    out.push({ rule, file: file.path, ...(line === undefined ? {} : { line }), message });

  const doc = parseDocument(file.text, { uniqueKeys: true });
  if (doc.errors.length > 0) {
    for (const e of doc.errors)
      add('yaml', `invalid YAML or duplicate key: ${e.message.split('\n')[0]}`);
    return out;
  }
  visit(doc, {
    Node(_k, node) {
      if (isAlias(node) || (node as { anchor?: string }).anchor) {
        add('yaml', 'anchors and aliases are not allowed in a workflow');
        return visit.BREAK;
      }
      return undefined;
    },
  });
  const data = asObj(doc.toJS());
  const jobs = toJobs(data.jobs);
  const isRelease = RELEASE_FILES.includes(name);

  checkPins(file.text, add);
  checkPermissions(name, data, jobs, add);
  checkTriggers(name, data, jobs, isRelease, add);
  checkText(file.text, jobs, add);
  for (const j of jobs) checkJob(j, isRelease, add);
  if (isRelease) checkTagGuard(jobs, add);
  return out;
}

function checkPins(text: string, add: Add) {
  text.split('\n').forEach((line, i) => {
    const m = /^\s*-?\s*uses:\s*(.*)$/.exec(line);
    if (!m) return;
    const vm = /^(['"]?)([^\s#'"]+)\1\s*(#.*)?$/.exec((m[1] ?? '').trim());
    const value = vm?.[2] ?? '';
    const comment = vm?.[3] ?? '';
    if (value.startsWith('./')) return;
    const okValue = /^[\w.-]+\/[\w.-]+(\/[^@\s]+)?@[0-9a-f]{40}$/.test(value);
    const okComment = /^#\s*v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?\s*$/.test(comment);
    if (!okValue)
      add('pin', `uses "${value}" is not pinned to a 40-hex lowercase commit SHA`, i + 1);
    else if (!okComment) add('pin', `uses "${value}" lacks a same-line "# vX.Y.Z" comment`, i + 1);
  });
}

function checkPermissions(name: string, data: Obj, jobs: Job[], add: Add) {
  const top = data.permissions;
  if (!isObj(top)) {
    add('permissions', 'top-level permissions must exist and be a mapping (never write-all)');
  } else {
    for (const k of ['id-token', 'packages', 'contents'])
      if (top[k] === 'write')
        add('permissions', `top-level ${k}: write is not allowed; grant it on one job`);
  }
  const kinds: [string, Record<string, string[]>][] = [
    ['id-token', ID_TOKEN_JOBS],
    ['packages', PACKAGES_WRITE_JOBS],
    ['contents', CONTENTS_WRITE_JOBS],
  ];
  for (const j of jobs) {
    if (typeof j.data.permissions === 'string')
      add(
        'permissions',
        `job ${j.name}: permissions must be a mapping, not "${j.data.permissions}"`,
      );
    for (const [key, allowed] of kinds)
      if (j.perms[key] === 'write' && !(allowed[name] ?? []).includes(j.name))
        add('permissions', `job ${j.name} in ${name} may not set ${key}: write`);
    const idt = j.perms['id-token'] === 'write';
    const pkg = j.perms.packages === 'write';
    if (!idt && !pkg) continue;
    const uses = [j.data.uses, ...j.steps.map((s) => s.uses)].filter(
      (u): u is string => typeof u === 'string',
    );
    for (const u of uses) {
      const base = u.split('@')[0] ?? '';
      const ok =
        ACTIONS_WITH_CREDENTIALS.includes(base) ||
        u.startsWith('./.github/workflows/') ||
        (pkg && !idt && base.startsWith('docker/'));
      if (!ok) add('idtoken-uses', `job ${j.name} holds a credential and may not use ${base}`);
    }
  }
}

function checkTriggers(name: string, data: Obj, jobs: Job[], isRelease: boolean, add: Add) {
  const on = triggersOf(data.on);
  for (const bad of ['pull_request_target', 'workflow_run', 'issue_comment', 'repository_dispatch'])
    if (bad in on) add('triggers', `trigger ${bad} is not allowed`);
  if (isRelease) {
    const publish = name === 'publish-template.yml';
    const allowed = publish
      ? ['workflow_call', 'workflow_dispatch']
      : ['push', 'workflow_dispatch'];
    for (const k of Object.keys(on))
      if (!allowed.includes(k))
        add('triggers', `${name} may only have ${allowed.join(' and ')}, not ${k}`);
    const push = asObj(on.push);
    if (
      !publish &&
      'push' in on &&
      (JSON.stringify(push.tags) !== '["kit-v*"]' || 'branches' in push)
    )
      add('triggers', "release.yml push must have tags exactly ['kit-v*'] and no branches");
    for (const j of jobs) {
      if (!j.credentialed) continue;
      const cond = norm(j.data.if);
      if (!TAG_IF.every((t) => cond.includes(t)))
        add('triggers', `credentialed job ${j.name} lacks the kit-v tag if: guard`);
    }
  }
  for (const j of jobs)
    for (const c of [j.data.if, ...j.steps.map((s) => s.if)])
      if (norm(c).includes('workflow_call'))
        add(
          'no-workflow-call-if',
          `job ${j.name}: an if: mentions workflow_call (the github context is the caller's)`,
        );
}

function checkText(text: string, jobs: Job[], add: Add) {
  for (const m of text.matchAll(/secrets\.([A-Za-z_]\w*)/g))
    if (m[1] !== 'GITHUB_TOKEN')
      add('secrets', `secrets.${m[1]} is not allowed (only secrets.GITHUB_TOKEN)`);
  if (/secrets\s*\[/.test(text)) add('secrets', 'secrets[...] indexing is not allowed');
  if (/^\s*secrets:\s*inherit\b/m.test(text)) add('secrets', 'secrets: inherit is not allowed');
  for (const m of text.matchAll(/GELDAR_INTERNAL|GELDAR_UNSAFE_IMAGE/g))
    add('secrets', `${m[0]} must not appear in a workflow`);
  for (const m of text.matchAll(/ANTHROPIC|CLAUDE_CODE|OPENAI/gi))
    add('model', `${m[0]} must not appear in a workflow (no model call in CI)`);
  if (/\buses:\s*['"]?(anthropics|openai)\//i.test(text))
    add('model', 'an anthropics/ or openai/ action is not allowed');
  if (/live-check/.test(text)) add('model', 'the live-check verb is not allowed in CI');
  for (const j of jobs)
    for (const s of j.steps)
      if (s.run && /(^|[^\w-])claude(?![\w-])/.test(s.run))
        add('model', `job ${j.name}: run: calls claude`);
}

function checkJob(j: Job, isRelease: boolean, add: Add) {
  if (j.data.uses === undefined && j.data['timeout-minutes'] === undefined)
    add('timeout', `job ${j.name} has no timeout-minutes`);
  j.steps.forEach((s, i) => {
    if (s.run?.includes('${{'))
      add(
        'injection',
        `job ${j.name} step ${i + 1}: a template expression in run: (pass values through env:)`,
      );
    if (s.run) checkMask(j.name, s.run, add);
    if (isRelease && s.uses?.startsWith('actions/checkout@')) {
      const pc = s.with['persist-credentials'];
      if (pc !== false && pc !== 'false')
        add('checkout', `job ${j.name}: actions/checkout needs persist-credentials: false`);
    }
  });
}

function checkMask(job: string, run: string, add: Add) {
  if (!/az\s+keyvault\s+secret\s+(show|download)/.test(run)) return;
  const lines = run.split('\n');
  const maskAt = lines.findIndex((l) => l.includes('::add-mask::'));
  const first = maskAt === -1 ? Number.POSITIVE_INFINITY : maskAt;
  const vars: string[] = [];
  lines.forEach((l, i) => {
    const v = /^\s*([A-Za-z_]\w*)=["']?(?:\$\(|`)\s*az\s+keyvault\s+secret/.exec(l);
    if (v?.[1]) vars.push(v[1]);
    if (i < first && /\$\{?GITHUB_(OUTPUT|ENV|STEP_SUMMARY)/.test(l))
      add('mask', `job ${job}: line ${i + 1} writes to a GITHUB_ file before ::add-mask::`);
    if (i < first && !l.includes('>>') && /^\s*(echo|printf|cat)\b/.test(l))
      for (const name of vars)
        if (new RegExp(`\\$\\{?${name}\\b`).test(l))
          add('mask', `job ${job}: line ${i + 1} prints the secret in ${name} unmasked`);
    if (/\bset\s+-[a-zA-Z]*x|\bset\s+-o\s+xtrace|\bbash\s+-[a-zA-Z]*x/.test(l))
      add('mask', `job ${job}: line ${i + 1} enables shell tracing in a Key Vault step`);
  });
}

function checkTagGuard(jobs: Job[], add: Add) {
  const byName = new Map(jobs.map((j) => [j.name, j]));
  const needed = new Set<string>();
  const walk = (n: string) => {
    const needs = byName.get(n)?.data.needs;
    for (const d of typeof needs === 'string' ? [needs] : asArr(needs)) {
      if (typeof d === 'string' && !needed.has(d)) {
        needed.add(d);
        walk(d);
      }
    }
  };
  for (const j of jobs) {
    if (!j.credentialed) continue;
    needed.add(j.name);
    walk(j.name);
  }
  const guard = jobs.find((j) => needed.has(j.name));
  if (!guard || guard.data.uses !== undefined) return;
  const co = guard.steps.findIndex((s) => s.uses?.startsWith('actions/checkout@'));
  const depth = co === -1 ? undefined : guard.steps[co]?.with['fetch-depth'];
  if (co === -1 || (depth !== 0 && depth !== '0'))
    add('tagguard', `job ${guard.name}: needs actions/checkout with fetch-depth: 0`);
  const ok = guard.steps.some(
    (s, i) =>
      co !== -1 && i > co && /git merge-base --is-ancestor\b[^\n]*origin\/main/.test(s.run ?? ''),
  );
  if (!ok)
    add(
      'tagguard',
      `job ${guard.name}: no "git merge-base --is-ancestor ... origin/main" step after checkout`,
    );
}
