// Which test groups each launcher passes. A bash packet adds its groups to `bash`, its PowerShell
// twin adds the same names to `pwsh`. A group listed for pwsh means the pwsh launcher passes the
// very test file the bash one does.
export const enabled = {
  bash: ['core', 'pre'],
  pwsh: ['core'],
} satisfies Record<string, string[]>;
