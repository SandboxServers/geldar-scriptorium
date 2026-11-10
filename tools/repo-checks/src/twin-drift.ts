/**
 * Twin drift: the bash and PowerShell launchers must register the same test
 * groups and make the same directories private. Pure functions over text.
 *
 * Groups: `GP_GROUPS="$GP_GROUPS name"` (bash) and `$GP_GROUPS += 'name'` (pwsh;
 * double quotes and a `$script:` prefix are accepted too), plus the literal `core`,
 * which both launchers print but neither lib registers.
 * Each twin's set must equal its `enabled` list in launcher/test/parity.ts minus
 * `testOnlyGroups`.
 *
 * Directories: `private_mkdir ARG` (bash) and `New-PrivateDir ARG` (pwsh), over
 * every lib file. ARG maps to a name by these patterns:
 *   state root   `$(state_dir)`  / `(Get-StateDir)`      -> state
 *   player dir   `$d`, `$(player_dir ..)` / `$d`, `$dir`  -> player
 *   session dir  `$sd`                                   -> session
 *   hooks dir    `$hooks`                                -> empty-hooks
 *   child        `$d/NAME`, `$sd/NAME` / `(Join-Path $d 'NAME')` -> NAME
 *   other pwsh variable `$name` (for example `$held`)    -> name
 * `export` and `pub` are exempt: bash makes `export` private then opens it with
 * `chmod -R a+rX`, and `pub` is 0755 by design in both twins.
 */

export interface TwinFile {
  path: string;
  text: string;
}

export interface TwinInput {
  bashLibs: TwinFile[];
  pwshLibs: TwinFile[];
  /** Text of launcher/test/parity.ts. */
  parityText: string;
}

const EXEMPT_DIRS = new Set(['export', 'pub']);

export function bashGroups(libs: TwinFile[]): Set<string> {
  const groups = new Set<string>(['core']);
  for (const { text } of libs) {
    for (const m of text.matchAll(/^GP_GROUPS="\$GP_GROUPS (\w+)"/gm)) groups.add(m[1] as string);
    for (const m of text.matchAll(/^GP_GROUPS="\$\{GP_GROUPS-\} (\w+)"/gm))
      groups.add(m[1] as string);
  }
  return groups;
}

export function pwshGroups(libs: TwinFile[]): Set<string> {
  const groups = new Set<string>(['core']);
  for (const { text } of libs) {
    for (const m of text.matchAll(/^\$(?:script:)?GP_GROUPS \+= (['"])(\w+)\1/gm))
      groups.add(m[2] as string);
  }
  return groups;
}

function stringList(body: string): string[] {
  return [...body.matchAll(/'([^']+)'/g)].map((m) => m[1] as string);
}

export function parityGroups(parityText: string): { bash: Set<string>; pwsh: Set<string> } {
  const testOnly = new Set(
    stringList(/testOnlyGroups[^=]*=\s*\[([^\]]*)\]/.exec(parityText)?.[1] ?? ''),
  );
  const pick = (key: string): Set<string> =>
    new Set(
      stringList(new RegExp(`${key}:\\s*\\[([^\\]]*)\\]`).exec(parityText)?.[1] ?? '').filter(
        (g) => !testOnly.has(g),
      ),
    );
  return { bash: pick('bash'), pwsh: pick('pwsh') };
}

function bashDirName(arg: string): string {
  const a = arg.replace(/^"|"$/g, '');
  if (a === '$(state_dir)') return 'state';
  if (a === '$d' || a.startsWith('$(player_dir')) return 'player';
  if (a === '$sd') return 'session';
  if (a === '$hooks') return 'empty-hooks';
  const child = /^\$\w+\/([\w.-]+)$/.exec(a);
  return child ? (child[1] as string) : a;
}

function pwshDirName(arg: string): string {
  const a = arg.trim();
  if (a === '(Get-StateDir)') return 'state';
  if (a === '$d' || a === '$dir') return 'player';
  if (a === '$sd') return 'session';
  if (a === '$hooks') return 'empty-hooks';
  const child = /^\(Join-Path \$\w+ '([\w.-]+)'\)$/.exec(a);
  if (child) return child[1] as string;
  const variable = /^\$(\w+)$/.exec(a);
  return variable ? (variable[1] as string) : a;
}

function privateDirs(libs: TwinFile[], pattern: RegExp, name: (arg: string) => string) {
  const all = new Set<string>();
  const perFile = new Map<string, Set<string>>();
  for (const { path, text } of libs) {
    const found = new Set<string>();
    for (const m of text.matchAll(pattern)) found.add(name(m[1] as string));
    perFile.set(path, found);
    for (const d of found) all.add(d);
  }
  return { all, perFile };
}

function diff(label: string, a: Set<string>, b: Set<string>, aName: string, bName: string) {
  const findings: string[] = [];
  for (const x of [...a].sort()) {
    if (!b.has(x))
      findings.push(`${label} "${x}" is in the ${aName} launcher but not the ${bName} one`);
  }
  return findings;
}

export function checkTwinDrift(input: TwinInput): string[] {
  const findings: string[] = [];
  const bash = bashGroups(input.bashLibs);
  const pwsh = pwshGroups(input.pwshLibs);
  findings.push(...diff('group', bash, pwsh, 'bash', 'PowerShell'));
  findings.push(...diff('group', pwsh, bash, 'PowerShell', 'bash'));
  const parity = parityGroups(input.parityText);
  findings.push(...diff('group', bash, parity.bash, 'bash lib', 'parity.ts bash list'));
  findings.push(...diff('group', parity.bash, bash, 'parity.ts bash list', 'bash lib'));
  findings.push(...diff('group', pwsh, parity.pwsh, 'PowerShell lib', 'parity.ts pwsh list'));
  findings.push(...diff('group', parity.pwsh, pwsh, 'parity.ts pwsh list', 'PowerShell lib'));

  const bd = privateDirs(
    input.bashLibs,
    /\bprivate_mkdir\s+("[^"]*(?:\$\([^)]*\)[^"]*)*"|\S+)/g,
    bashDirName,
  );
  const pd = privateDirs(input.pwshLibs, /\bNew-PrivateDir\s+(\([^)]*\)|\$\w+)/g, pwshDirName);
  const bDirs = new Set([...bd.all].filter((d) => !EXEMPT_DIRS.has(d)));
  const pDirs = new Set([...pd.all].filter((d) => !EXEMPT_DIRS.has(d)));
  findings.push(...diff('private directory', bDirs, pDirs, 'bash', 'PowerShell'));
  findings.push(...diff('private directory', pDirs, bDirs, 'PowerShell', 'bash'));

  for (const [ext, dirs] of [
    ['sh', bd.perFile],
    ['ps1', pd.perFile],
  ] as const) {
    const finish = [...dirs].find(([path]) => path.endsWith(`finish.${ext}`));
    if (!finish?.[1].has('held')) findings.push(`finish.${ext} does not make "held" private`);
  }
  return findings;
}
