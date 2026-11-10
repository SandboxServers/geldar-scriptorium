import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkTwinDrift, type TwinInput } from './twin-drift.ts';

const PARITY = `export const enabled = {
  bash: ['core', 'pre', 'hostile'],
  pwsh: ['core', 'pre', 'upgrade', 'hostile'],
};
export const testOnlyGroups: string[] = ['hostile', 'upgrade'];
`;

function fixture(): TwinInput {
  return {
    bashLibs: [
      { path: 'player.sh', text: 'GP_GROUPS="$GP_GROUPS pre"\n' },
      {
        path: 'prepare.sh',
        text: 'private_mkdir "$(state_dir)"\nprivate_mkdir "$d"\nprivate_mkdir "$sd"\nprivate_mkdir "$sd/export"\n',
      },
      { path: 'finish.sh', text: 'private_mkdir "$d/held"\n' },
    ],
    pwshLibs: [
      { path: 'player.ps1', text: "$GP_GROUPS += 'pre'\n" },
      {
        path: 'prepare.ps1',
        text: 'New-PrivateDir (Get-StateDir)\nNew-PrivateDir $d\nNew-PrivateDir $sd\n',
      },
      { path: 'finish.ps1', text: "$held = Join-Path $d 'held'\nNew-PrivateDir $held\n" },
    ],
    parityText: PARITY,
  };
}

describe('checkTwinDrift', () => {
  it('passes when the twins agree', () => {
    expect(checkTwinDrift(fixture())).toEqual([]);
  });

  it('names an extra group in the PowerShell twin', () => {
    const f = fixture();
    f.pwshLibs.push({ path: 'extra.ps1', text: "$GP_GROUPS += 'ghost'\n" });
    const findings = checkTwinDrift(f);
    expect(findings.some((x) => x.includes('"ghost"'))).toBe(true);
  });

  it.each([
    ['double-quoted', 'dq', `$GP_GROUPS += "dq"\n`],
    ['$script: prefix', 'sp', `$script:GP_GROUPS += 'sp'\n`],
    ['$script: prefix and double quotes', 'spdq', `$script:GP_GROUPS += "spdq"\n`],
  ])('names a PowerShell %s group registration the bash twin lacks', (_form, name, text) => {
    const f = fixture();
    f.pwshLibs.push({ path: 'extra.ps1', text });
    const findings = checkTwinDrift(f);
    expect(findings.some((x) => x.includes(`"${name}"`))).toBe(true);
  });

  it('fails when core is missing from parity.ts', () => {
    const f = fixture();
    f.parityText = PARITY.replace("bash: ['core', ", 'bash: [');
    expect(checkTwinDrift(f).some((x) => x.includes('"core"'))).toBe(true);
  });

  it('names a directory one twin makes less private', () => {
    const f = fixture();
    f.bashLibs[1] = {
      path: 'prepare.sh',
      text: 'private_mkdir "$(state_dir)"\nprivate_mkdir "$d"\n',
    };
    expect(checkTwinDrift(f).some((x) => x.includes('"session"'))).toBe(true);
  });

  it('fails when finish.ps1 lacks held', () => {
    const f = fixture();
    f.pwshLibs[2] = { path: 'finish.ps1', text: '' };
    const findings = checkTwinDrift(f);
    expect(findings.some((x) => x.includes('finish.ps1') && x.includes('held'))).toBe(true);
  });

  it('does not flag export and pub differing', () => {
    const f = fixture();
    f.pwshLibs.push({ path: 'pub.ps1', text: "New-PrivateDir (Join-Path $d 'pub')\n" });
    expect(checkTwinDrift(f)).toEqual([]);
  });

  it('passes on the real repo', () => {
    const read = (ext: string) =>
      readdirSync('launcher/lib')
        .filter((n) => n.endsWith(ext))
        .map((n) => ({
          path: `launcher/lib/${n}`,
          text: readFileSync(`launcher/lib/${n}`, 'utf8'),
        }));
    const findings = checkTwinDrift({
      bashLibs: read('.sh'),
      pwshLibs: read('.ps1'),
      parityText: readFileSync('launcher/test/parity.ts', 'utf8'),
    });
    expect(findings).toEqual([]);
  });
});
