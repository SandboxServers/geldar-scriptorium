#!/usr/bin/env pwsh
<#
.SYNOPSIS
Scriptorium task runner: setup and local checks.

.DESCRIPTION
Runs on PowerShell 7 on Windows and Linux.

  ./scriptorium.ps1 setup            Install workspace dependencies (frozen lockfile once pnpm-lock.yaml exists)
  ./scriptorium.ps1 pnpm <args...>   Run pnpm with the pinned version on PATH, nested calls included
  ./scriptorium.ps1 check            Every check CI runs, in CI's order
  ./scriptorium.ps1 help             Show this help
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)] [string] $Command = 'help',
  [Parameter(Position = 1, ValueFromRemainingArguments = $true)] [string[]] $Rest = @()
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$Root = $PSScriptRoot

# Use pnpm from PATH when present. Otherwise put a corepack shim for the version
# package.json pins on PATH for this run (nested `pnpm -r` calls need it too).
# `corepack enable` without a directory needs admin on Windows, so the shim goes
# under node_modules/, which is gitignored.
if (-not (Get-Command pnpm -CommandType Application -ErrorAction SilentlyContinue)) {
  $shimDir = Join-Path $Root 'node_modules/.corepack-bin'
  if (-not (Get-ChildItem -Path $shimDir -Filter 'pnpm*' -ErrorAction SilentlyContinue)) {
    New-Item -ItemType Directory -Force $shimDir | Out-Null
    corepack enable pnpm --install-directory $shimDir
    if ($LASTEXITCODE -ne 0) { throw "corepack could not create a pnpm shim in $shimDir" }
  }
  $env:PATH = $shimDir + [IO.Path]::PathSeparator + $env:PATH
}

function Invoke-Step([string] $Name, [scriptblock] $Block) {
  Write-Host "==> $Name" -ForegroundColor Cyan
  & $Block
  if ($LASTEXITCODE -ne 0) { throw "$Name failed (exit $LASTEXITCODE)" }
}

function Invoke-Check {
  Push-Location $Root
  try {
    Invoke-Step 'lint (biome)' { pnpm lint }
    Invoke-Step 'typecheck' { pnpm typecheck }
    Invoke-Step 'test (vitest)' { pnpm test }
    Invoke-Step 'repo checks (line caps, LF)' { pnpm check:repo }
    $pkg = Get-Content -Raw (Join-Path $Root 'package.json') | ConvertFrom-Json
    if ($pkg.scripts.PSObject.Properties.Name -contains 'check:template') {
      Invoke-Step 'template checks' { pnpm check:template }
    }
    Write-Host 'All checks passed.' -ForegroundColor Green
  } finally { Pop-Location }
}

switch ($Command) {
  'setup' {
    # Bootstrap: with no lockfile yet, frozen install refuses, so let pnpm create it.
    $frozen = if (Test-Path (Join-Path $Root 'pnpm-lock.yaml')) { '--frozen-lockfile' } else { '--no-frozen-lockfile' }
    Push-Location $Root; try { Invoke-Step 'pnpm install' { pnpm install $frozen } } finally { Pop-Location }
  }
  'pnpm' { Push-Location $Root; try { pnpm @Rest; exit $LASTEXITCODE } finally { Pop-Location } }
  'check' { Invoke-Check }
  default { Get-Help $PSCommandPath -Detailed | Out-Host }
}
