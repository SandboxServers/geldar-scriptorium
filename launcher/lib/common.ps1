# Shared functions for geldar-play.ps1 (PowerShell 7.4+). Dot-sourced; the twin of lib/common.sh.
# Every regex is anchored with \z (not $), so a trailing newline never matches.

. (Join-Path $GP_DIR 'lib/job.ps1')

$GP_GROUPS = @()
$script:GP_MSG = @{}
$script:GP_LOCK_ID = ''

# Test-only variables are read only through this function (decision 9): the value when
# GELDAR_INTERNAL=1, else the empty string.
function Get-GatedEnv([string]$Name) {
  if ([Environment]::GetEnvironmentVariable('GELDAR_INTERNAL') -ne '1') { return '' }
  $v = [Environment]::GetEnvironmentVariable($Name)
  if ($null -eq $v) { return '' }
  return $v
}

# Loads every messages.d/*.tsv: key<TAB>text, first row per key wins (as msg_text does).
function Import-Messages {
  $utf8 = [System.Text.UTF8Encoding]::new($false)
  foreach ($f in (Get-ChildItem -LiteralPath (Join-Path $GP_DIR 'messages.d') -Filter '*.tsv' | Sort-Object Name)) {
    foreach ($line in [System.IO.File]::ReadAllText($f.FullName, $utf8).Split("`n")) {
      $tab = $line.IndexOf("`t")
      if ($tab -lt 1) { continue }
      $key = $line.Substring(0, $tab)
      if (-not $script:GP_MSG.ContainsKey($key)) { $script:GP_MSG[$key] = $line.Substring($tab + 1) }
    }
  }
}

# Fills the %s placeholders in order, one argument each (a missing argument is empty).
function Format-Msg([string]$Fmt, [object[]]$Vals) {
  $parts = $Fmt.Split([string[]]@('%s'), [StringSplitOptions]::None)
  $sb = [System.Text.StringBuilder]::new($parts[0])
  for ($i = 1; $i -lt $parts.Count; $i++) {
    $v = ''
    if ($i - 1 -lt $Vals.Count) { $v = [string]$Vals[$i - 1] }
    [void]$sb.Append($v).Append($parts[$i])
  }
  return $sb.ToString()
}

# say <key> [args...]: "geldar-play: <text>" on stderr.
function Say {
  $key = [string]$args[0]
  $vals = @()
  if ($args.Count -gt 1) { $vals = @($args | Select-Object -Skip 1) }
  $fmt = $key
  if ($script:GP_MSG.ContainsKey($key)) { $fmt = $script:GP_MSG[$key] }
  [Console]::Error.Write('geldar-play: ' + (Format-Msg $fmt $vals) + "`n")
}

# die <code> <key> [args...]: say, then exit with the code.
function Die {
  $code = [int]$args[0]
  $rest = @($args | Select-Object -Skip 1)
  Say @rest
  exit $code
}

# H-16: one trailing LF dropped, then each C0, DEL and C1 code point becomes one space.
function Sanitize([string]$Text) {
  if ($Text.EndsWith("`n")) { $Text = $Text.Substring(0, $Text.Length - 1) }
  return [regex]::Replace($Text, '[\x00-\x1F\x7F-\x9F]', ' ')
}

function Get-StateDir {
  $d = $env:GELDAR_STATE_DIR
  if ($d) { return $d }
  $base = $env:LOCALAPPDATA
  if (-not $base) { $base = Join-Path $HOME 'AppData/Local' }
  return Join-Path $base 'geldar'
}

function Get-PlayerDir([string]$Id) {
  return Join-Path (Get-StateDir) $Id
}

function Test-PlayerId([string]$Id) {
  return [regex]::IsMatch($Id, '^[a-z][a-z0-9-]{1,38}\z')
}

# Is the tool there? Its seam variable wins; under GELDAR_TOOL_PATH only those directories count.
function Test-ToolFound([string]$Tool) {
  $seam = ''
  switch ($Tool) {
    'docker' { $seam = $env:GELDAR_DOCKER }
    'git' { $seam = $env:GELDAR_GIT }
    'gh' { $seam = $env:GELDAR_GH }
  }
  if ($seam) { return (Test-Path -LiteralPath $seam -PathType Leaf) }
  $tp = Get-GatedEnv 'GELDAR_TOOL_PATH'
  if ($tp) {
    foreach ($dir in $tp.Split([IO.Path]::PathSeparator)) {
      if (-not $dir) { continue }
      foreach ($n in @($Tool, "$Tool.exe", "$Tool.cmd")) {
        if (Test-Path -LiteralPath (Join-Path $dir $n) -PathType Leaf) { return $true }
      }
    }
    return $false
  }
  return [bool](Get-Command $Tool -CommandType Application -ErrorAction SilentlyContinue)
}

function Get-ToolHint([string]$Tool) {
  switch ($Tool) {
    'docker' { return 'Install Docker with Compose v2.' }
    'git' { return 'Install git 2.40 or newer.' }
    'tar' { return 'Install tar (Windows 10 and later include it).' }
    'perl' { return 'Install perl (it comes with Git for Windows).' }
    'tmux' { return 'Install tmux to run several players.' }
    'gh' { return 'Install the GitHub CLI (gh) to create or archive a player.' }
  }
  return ''
}

# docker through GELDAR_DOCKER or the plain name. The caller decides where output goes.
function Invoke-Docker {
  $exe = $env:GELDAR_DOCKER
  if (-not $exe) { $exe = 'docker' }
  Invoke-ShimAware $exe @args
}

# Runs a native command; a resolved .cmd or .bat goes through Start-CmdShim so cmd.exe never
# reads an argument as syntax. Output lines go to the pipeline, stderr to the console's stderr,
# and LASTEXITCODE is set.
function Invoke-ShimAware([string]$Exe) {
  $found = Get-Command $Exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($found -and $found.Source -match '\.(cmd|bat)\z') {
    $r = Start-CmdShim $found.Source @($args | ForEach-Object { [string]$_ })
    if ($r.StdErr) { [Console]::Error.Write($r.StdErr) }
    $global:LASTEXITCODE = $r.ExitCode
    if ($r.StdOut) { $r.StdOut -split "`r?`n" | Where-Object { $_ -ne '' } }
    return
  }
  & $Exe @args
}

# git through GELDAR_GIT or the plain name, with the shared-shape flags: no replace objects,
# no credential prompt, and an empty hooks directory.
function Invoke-Git {
  $exe = $env:GELDAR_GIT
  if (-not $exe) { $exe = 'git' }
  $hooks = Join-Path (Get-StateDir) 'empty-hooks'
  New-PrivateDir (Get-StateDir)
  New-PrivateDir $hooks
  $env:GIT_NO_REPLACE_OBJECTS = '1'
  $env:GIT_TERMINAL_PROMPT = '0'
  Invoke-ShimAware $exe -c "core.hooksPath=$hooks" @args
}

function Get-GitVersionText {
  $seam = $env:GELDAR_GIT
  if ($seam) { return ((& $seam --version 2>$null) -join "`n") }
  $tp = Get-GatedEnv 'GELDAR_TOOL_PATH'
  if (-not $tp) { return ((& git --version 2>$null) -join "`n") }
  $saved = $env:PATH
  try {
    $env:PATH = $tp
    return ((& git --version 2>$null) -join "`n")
  } finally {
    $env:PATH = $saved
  }
}

# need <tool>...: exit 1 with missing_tool when one is absent (docker also needs Compose v2,
# git needs 2.40 or newer).
function Need {
  foreach ($t in $args) {
    if (-not (Test-ToolFound $t)) { Die 1 missing_tool $t (Get-ToolHint $t) }
    if ($t -eq 'docker') {
      Invoke-Docker compose version *> $null
      if ($LASTEXITCODE -ne 0) { Die 1 missing_tool docker (Get-ToolHint docker) }
    }
    if ($t -eq 'git') {
      $v = Get-GitVersionText
      if ($v -notmatch '([0-9]+)\.([0-9]+)') { Die 1 missing_tool git (Get-ToolHint git) }
      $major = [int]$Matches[1]
      $minor = [int]$Matches[2]
      if ($major -lt 2 -or ($major -eq 2 -and $minor -lt 40)) { Die 1 git_too_old "$major.$minor" }
    }
  }
}

# mkdir is the lock; the owner's PID is stored inside. A dead owner's lock is never stolen.
function Lock-Acquire([string]$Id) {
  $dir = Get-PlayerDir $Id
  New-PrivateDir (Get-StateDir)
  New-PrivateDir $dir
  $d = Join-Path $dir 'lock'
  try {
    New-Item -ItemType Directory -Path $d -ErrorAction Stop | Out-Null
  } catch {
    $pf = Join-Path $d 'pid'
    $owner = ''
    if (Test-Path -LiteralPath $pf) { $owner = (Get-Content -LiteralPath $pf -Raw).Trim() }
    $alive = $owner -match '^[0-9]+\z' -and [bool](Get-Process -Id ([int]$owner) -ErrorAction SilentlyContinue)
    if ($owner -and -not $alive) { Say locked_stale $Id $d }
    Die 1 locked $Id
  }
  [System.IO.File]::WriteAllText((Join-Path $d 'pid'), "$PID`n", [System.Text.UTF8Encoding]::new($false))
  $script:GP_LOCK_ID = $Id
}

function Lock-Release {
  if (-not $script:GP_LOCK_ID) { return }
  Remove-Item -LiteralPath (Join-Path (Get-PlayerDir $script:GP_LOCK_ID) 'lock') -Recurse -Force -ErrorAction SilentlyContinue
  $script:GP_LOCK_ID = ''
}

# N6: a .cmd or .bat shim runs under cmd.exe, which does not read a command line the way the
# Windows C runtime does. Each argument is wrapped in double quotes (inside them & | < > ^ ! ( )
# are literal; do not add carets). A percent sign is still expanded inside quotes on a command
# line and doubling it is no escape; measured on Windows with a recording shim, closing the quote
# around each percent sign ("a"%"TEMP"%"b") delivers a%TEMP%b byte for byte, so that is the form.
# A run of backslashes before a closing quote is doubled (the shim's C runtime reads \" as a quote).
# A double quote, CR, LF or NUL cannot be carried: refused as bad_state_path.
function ConvertTo-CmdArgument([string]$Arg) {
  if ($Arg -match '["\r\n\x00]') { Die 1 bad_state_path }
  $segs = @($Arg.Split('%') | ForEach-Object { [regex]::Replace($_, '(\\+)\z', '$1$1') })
  return '"' + ($segs -join '"%"') + '"'
}

# The start info for an executable and its arguments. A .cmd or .bat goes through
# cmd.exe /d /s /c "<shim> <args>" built on psi.Arguments (ArgumentList would re-escape the quotes).
function New-CmdShimStartInfo([string]$Exe, [string[]]$ArgList) {
  $psi = [System.Diagnostics.ProcessStartInfo]::new()
  $psi.UseShellExecute = $false
  if ($Exe -match '\.(cmd|bat)\z') {
    $parts = @(ConvertTo-CmdArgument $Exe) + @($ArgList | ForEach-Object { ConvertTo-CmdArgument ([string]$_) })
    $psi.FileName = 'cmd.exe'
    $psi.Arguments = '/d /s /c "' + ($parts -join ' ') + '"'
  } else {
    $psi.FileName = $Exe
    foreach ($a in $ArgList) { $psi.ArgumentList.Add([string]$a) }
  }
  return $psi
}

# Starts the process described by a start info (the lower function Start-CmdShim also uses).
function New-CmdShimProcess([System.Diagnostics.ProcessStartInfo]$Psi) {
  return [System.Diagnostics.Process]::Start($Psi)
}

# Runs the command to the end within a bounded wait; returns @{ExitCode; StdOut; StdErr}.
# ExitCode is 124 after the limit (the process is killed) and 127 when it cannot start.
function Start-CmdShim([string]$Exe, [string[]]$ArgList, [int]$TimeoutSec = 120) {
  $psi = New-CmdShimStartInfo $Exe $ArgList
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  try { $p = New-CmdShimProcess $psi } catch { return @{ ExitCode = 127; StdOut = ''; StdErr = '' } }
  $o = $p.StandardOutput.ReadToEndAsync()
  $e = $p.StandardError.ReadToEndAsync()
  if (-not $p.WaitForExit($TimeoutSec * 1000)) {
    try { $p.Kill($true) } catch {}
    $p.WaitForExit()
    $p.Dispose()
    return @{ ExitCode = 124; StdOut = ''; StdErr = '' }
  }
  [void]$o.Wait(10000)
  [void]$e.Wait(10000)
  $r = @{ ExitCode = $p.ExitCode; StdOut = $o.Result; StdErr = $e.Result }
  $p.Dispose()
  return $r
}

# N4 (Linux and macOS; on Windows the state sits under LOCALAPPDATA, a user-private ACL, and
# nothing changes). The launcher runs under umask 077 so every file it makes is 0600 and every
# directory 0700; Set-Umask returns the old mask.
function Set-Umask([int]$Mask) {
  if ($IsWindows) { return 0 }
  if (-not ('GeldarLibc' -as [type])) {
    Add-Type -Namespace '' -Name GeldarLibc -MemberDefinition '[System.Runtime.InteropServices.DllImport("libc", EntryPoint = "umask")] public static extern uint Umask(uint m);'
  }
  return [int][GeldarLibc]::Umask([uint32]$Mask)
}

# A private directory: made if missing, and an existing one (wave 5 state) tightened to 0700.
# H-04 (S4): git archive honours in-tree .gitattributes export-ignore and export-subst, so the
# mounted kit could differ from the commit the gate trusts. $true when the tree of <Rev> holds
# any .gitattributes naming one of them (the caller refuses).
function Test-ExportAttrs([string]$Clone, [string]$Rev) {
  $raw = (@(Invoke-Git -C $Clone ls-tree -r -z $Rev 2> $null)) -join "`n"
  foreach ($rec in $raw.Split([char]0)) {
    $m = [regex]::Match($rec.TrimStart("`r", "`n"), '^\d{6} \w+ ([0-9a-f]{40,64})\t(.+)\z', 'Singleline')
    if (-not $m.Success) { continue }
    if (-not [regex]::IsMatch($m.Groups[2].Value, '(^|/)\.gitattributes\z', 'IgnoreCase')) { continue }
    $blob = (@(Invoke-Git -C $Clone cat-file blob $m.Groups[1].Value 2> $null)) -join "`n"
    if ([regex]::IsMatch($blob, 'export-(ignore|subst)')) { return $true }
  }
  return $false
}

# B1: the helper containers run as uid 1000, who need not be this user, so they cannot read the
# 0700 session dir or the 0600 bundles. New-StagedBundle returns a fresh 0755 directory holding a
# 0644 copy of the file as <Name>, or $null; the caller mounts it and runs Remove-StagedBundle at once.
function New-StagedBundle([string]$Source, [string]$Name) {
  $dir = Join-Path (Get-StateDir) ('stage.' + [guid]::NewGuid().ToString('N').Substring(0, 8))
  try {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
    Copy-Item -LiteralPath $Source -Destination (Join-Path $dir $Name)
    if (-not $IsWindows) {
      [System.IO.File]::SetUnixFileMode($dir, [System.IO.UnixFileMode]0x1ED)
      [System.IO.File]::SetUnixFileMode((Join-Path $dir $Name), [System.IO.UnixFileMode]0x1A4)
    }
  } catch {
    Remove-StagedBundle $dir
    return $null
  }
  return $dir
}

function Remove-StagedBundle([string]$Dir) {
  if ($Dir) { Remove-Item -LiteralPath $Dir -Recurse -Force -ErrorAction SilentlyContinue }
}

function New-PrivateDir([string]$Path) {
  New-Item -ItemType Directory -Path $Path -Force | Out-Null
  if (-not $IsWindows) { [System.IO.File]::SetUnixFileMode($Path, [System.IO.UnixFileMode]0x1C0) }
}

# Invoke-Bounded <seconds> [--container <name>] <cmd...>: the command runs as a child process.
# Past the limit its whole process tree is killed, and a named container gets docker kill then
# docker rm -f. Returns the command's exit code, or 124 on expiry. A .cmd or .bat runs via cmd.exe.
function Invoke-Bounded {
  $rest = @($args)
  $secs = [string]$rest[0]
  $rest = @($rest | Select-Object -Skip 1)
  $container = ''
  if ($rest.Count -ge 2 -and $rest[0] -eq '--container') {
    $container = [string]$rest[1]
    $rest = @($rest | Select-Object -Skip 2)
  }
  $override = Get-GatedEnv 'GELDAR_HELPER_TIMEOUT_SEC'
  if ($override -match '^[0-9]+\z') { $secs = $override }
  if ($secs -cnotmatch '^[1-9][0-9]*\z') { Die 2 usage }
  if ($rest.Count -lt 1) { Die 2 usage }
  $exe = [string]$rest[0]
  $cmdArgs = @($rest | Select-Object -Skip 1)
  $found = Get-Command $exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($found) { $exe = $found.Source }
  $psi = New-CmdShimStartInfo $exe @($cmdArgs | ForEach-Object { [string]$_ })
  try {
    $job = [IntPtr]::Zero
    if ($IsWindows) { Initialize-JobType; $job = [GeldarJob]::Create() }
    $p = [System.Diagnostics.Process]::Start($psi)
    if ($IsWindows -and ($job -eq [IntPtr]::Zero -or -not [GeldarJob]::Assign($job, $p.Handle))) {
      if ($job -ne [IntPtr]::Zero) { [GeldarJob]::Close($job) }
      $job = [IntPtr]::Zero
    }
  } catch {
    return 127
  }
  if ($p.WaitForExit([int]$secs * 1000)) {
    $code = $p.ExitCode
    if ($IsWindows) { [GeldarJob]::Close($job) }
    return $code
  }
  if ($IsWindows -and $job -ne [IntPtr]::Zero) { [GeldarJob]::Kill($job) } else { try { $p.Kill($true) } catch {} }
  $p.WaitForExit()
  if ($IsWindows) { [GeldarJob]::Close($job) }
  if ($container) {
    Invoke-Docker kill $container *> $null
    Invoke-Docker rm -f $container *> $null
  }
  return 124
}
