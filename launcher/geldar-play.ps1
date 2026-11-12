# geldar-play.ps1: the launcher for Windows (PowerShell 7.4+). Dot-sources lib/*.ps1, then runs the verb.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 3.0

$utf8 = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $utf8
[Console]::InputEncoding = $utf8
$OutputEncoding = $utf8

$GP_DIR = $PSScriptRoot
. (Join-Path $GP_DIR 'lib/common.ps1')
foreach ($f in (Get-ChildItem -LiteralPath (Join-Path $GP_DIR 'lib') -Filter '*.ps1' | Where-Object { $_.Name -ne 'common.ps1' } | Sort-Object Name)) {
  . $f.FullName
}
Import-Messages

# N4: on Linux and macOS everything the launcher makes is private (umask 077); on Windows the
# state under LOCALAPPDATA carries a user-private ACL and nothing changes.
if (-not $IsWindows) { [void](Set-Umask 0x3F) }

$GP_VERSION = '0.1.0'

# The tools each verb needs on the human's machine (decision 10).
function Get-VerbNeeds([string]$Verb) {
  switch ($Verb) {
    { $_ -in 'new', 'archive' } { return @('docker', 'git', 'gh') }
    { $_ -in 'setup', 'play', 'run', '__prepare', '__session', '__finish' } { return @('docker', 'git', 'tar') }
    'resolve' { return @('docker', 'git') }
    { $_ -in 'status', 'run_status' } { return @('git') }
    'upgrade' { return @('git', 'gh') }
    { $_ -in 'start', 'stop', 'restart', 'player_status', 'logs', 'deploy_key', 'release_hold' } { return @('docker', 'git') }
  }
  return @()
}

# Parses --cli out of the arguments after the verb; returns the remaining arguments.
function Read-CliOption([string[]]$Rest) {
  $cli = 'claude'
  $out = @()
  for ($i = 0; $i -lt $Rest.Count; $i++) {
    if ($Rest[$i] -ceq '--cli') {
      if ($i + 1 -ge $Rest.Count) { Die 2 usage }
      $cli = $Rest[$i + 1]
      $i++
    } else {
      $out += $Rest[$i]
    }
  }
  switch ($cli) {
    'claude' { }
    'codex' { Die 1 cli_unsupported }
    default { Die 2 usage }
  }
  return , $out
}

$verb = ''
if ($args.Count -ge 1) { $verb = [string]$args[0] }
$rest = @()
if ($args.Count -gt 1) { $rest = @($args | Select-Object -Skip 1 | ForEach-Object { [string]$_ }) }

switch -CaseSensitive ($verb) {
  '' { Die 2 usage }
  'help' { Say usage; exit 0 }
  '--version' { [Console]::Out.Write("geldar-play $GP_VERSION`n"); exit 0 }
  '--capabilities' {
    [Console]::Out.Write("core`n")
    foreach ($g in $GP_GROUPS) { [Console]::Out.Write("$g`n") }
    exit 0
  }
  { $_ -in '__prepare', '__session', '__finish', '__bounded' } {
    if ((Get-GatedEnv 'GELDAR_INTERNAL') -ne '1') { Die 2 internal_only }
  }
  { $_ -in 'new', 'setup', 'play', 'run', 'run-status', 'run-stop', 'resolve', 'archive', 'status', 'upgrade' } { }
  { $_ -in 'auth-set', 'auth-status', 'auth-clear' } { }
  { $_ -in 'start', 'stop', 'restart', 'player-status', 'logs', 'deploy-key', 'release-hold' } { }
  default { Die 2 usage }
}

if ($verb -ceq '__bounded') {
  if ($rest.Count -lt 2) { Die 2 usage }
  $code = Invoke-Bounded @rest
  exit ([int]$code)
}

$gpArgs = $rest
if ($verb -in 'new', 'setup', 'play', 'run') { $gpArgs = @((@(Read-CliOption $rest))[0]) }

$isAuth = $verb.StartsWith('auth-', [StringComparison]::Ordinal)
if ($verb -cne 'status' -and -not $isAuth -and $gpArgs.Count -lt 1) { Die 2 usage }
# The auth verbs take no player id: their arguments are checked by the verb itself.
if (-not $isAuth -and $gpArgs.Count -ge 1 -and -not (Test-PlayerId $gpArgs[0])) { Die 2 bad_player_id $gpArgs[0] }
if ($verb -ceq 'play' -and $gpArgs.Count -ge 2) {
  foreach ($id in $gpArgs) {
    if (-not (Test-PlayerId $id)) { Die 2 bad_player_id $id }
  }
  $verb = 'play_many'
}

if ($verb -ceq 'run-status') { $verb = 'run_status' }
if ($verb -ceq 'run-stop') { $verb = 'run_stop' }
if ($verb -ceq 'player-status') { $verb = 'player_status' }
if ($verb -ceq 'deploy-key') { $verb = 'deploy_key' }
if ($verb -ceq 'release-hold') { $verb = 'release_hold' }
if ($isAuth) { $verb = $verb.Replace('-', '_') }

$needs = @(Get-VerbNeeds $verb)
Need @needs

$handler = "Verb-$verb"
if (Get-Command $handler -CommandType Function -ErrorAction SilentlyContinue) {
  try {
    & $handler @gpArgs
  } finally {
    Lock-Release
  }
  exit 0
}
Die 2 not_yet
