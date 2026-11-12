# geldar-play run, run-status, run-stop (SC-123, decision 60): the twin of lib/run.sh.
# The supervisor keeps one player living: it loops full play cycles in the headless run mode and
# never skips the post-session gate or the commit. State lives in <state>/<id>/run/. It never
# prints the token, the prompt text or the stream contents.

$script:RUN_DIR = ''
$script:RUN_STARTED = ''
$script:RUN_LOCKED = $false
$script:RUN_UTF8 = [System.Text.UTF8Encoding]::new($false)

# The stop flag is set from a signal handler thread, which has no PowerShell runspace: a plain
# C# class holds the flag and hooks Ctrl-C (SIGINT), SIGTERM and SIGHUP. A signal says the
# stopping line once (Line, set by the caller) and sets the flag; it never kills a cycle.
# It is compiled on first use (Initialize-RunStop, from Verb-run only), so the other verbs pay
# nothing and keep working where Add-Type is blocked. On Windows it also holds ShieldFor: the
# console ignores Ctrl-C for a moment around the start of a child, which then inherits that
# (the twin of bash's trap '' INT in the cycle subshell); the supervisor keeps its own handler.
function Initialize-RunStop {
  if ('GeldarRunStop' -as [type]) { return }
  Add-Type -TypeDefinition @'
using System;
using System.Threading;
using System.Runtime.InteropServices;
public static class GeldarRunStop {
  public static volatile bool Flag;
  public static string Line;
  static int said;
  static bool hooked;
  static Timer unshield;
  static PosixSignalRegistration term;
  static PosixSignalRegistration hup;
  [DllImport("kernel32.dll")]
  static extern bool SetConsoleCtrlHandler(IntPtr handler, bool add);
  static void Restore() {
    try { SetConsoleCtrlHandler(IntPtr.Zero, false); } catch (Exception) { }
  }
  public static void ShieldFor(int ms) {
    try { SetConsoleCtrlHandler(IntPtr.Zero, true); } catch (Exception) { return; }
    lock (typeof(GeldarRunStop)) {
      if (unshield == null) unshield = new Timer(_ => Restore(), null, ms, Timeout.Infinite);
      else unshield.Change(ms, Timeout.Infinite);
    }
  }
  static void Stop() {
    if (Interlocked.Exchange(ref said, 1) == 0 && Line != null) Console.Error.Write(Line);
    Flag = true;
  }
  public static void Reset() { Flag = false; said = 0; }
  public static void Hook() {
    if (hooked) return;
    hooked = true;
    Console.CancelKeyPress += (s, e) => { e.Cancel = true; Stop(); };
    try { term = PosixSignalRegistration.Create(PosixSignal.SIGTERM, c => { c.Cancel = true; Stop(); }); }
    catch (Exception) { }
    try { hup = PosixSignalRegistration.Create(PosixSignal.SIGHUP, c => { c.Cancel = true; Stop(); }); }
    catch (Exception) { }
  }
}
'@
}

# The current time in seconds since the epoch (GELDAR_RUN_NOW is a gated test seam: a command).
function Get-RunNow {
  $c = Get-GatedEnv 'GELDAR_RUN_NOW'
  if ($c) { return [long](((@(& $c)) -join '').Trim()) }
  return [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
}

# Format-RunTime <epoch> <date|stamp>: UTC text for the epoch.
function Format-RunTime([long]$Epoch, [string]$Kind) {
  $f = "yyyy-MM-dd'T'HH:mm:ss'Z'"
  if ($Kind -ceq 'date') { $f = 'yyyy-MM-dd' }
  return [DateTimeOffset]::FromUnixTimeSeconds($Epoch).UtcDateTime.ToString($f, [cultureinfo]::InvariantCulture)
}

function Test-RunStop {
  return ([GeldarRunStop]::Flag -or (Test-Path -LiteralPath (Join-Path $script:RUN_DIR 'STOP')))
}

# Start-RunSleep <seconds>: interruptible; returns early on a stop signal or a STOP file. The gated
# GELDAR_RUN_SLEEP command replaces the real wait (one call with the whole span).
function Start-RunSleep([long]$Secs) {
  $c = Get-GatedEnv 'GELDAR_RUN_SLEEP'
  if ($c) {
    & $c ([string]$Secs) | Out-Null
    return
  }
  $left = $Secs
  while ($left -gt 0 -and -not (Test-RunStop)) {
    Start-Sleep -Seconds 1
    $left--
  }
}

function Read-RunPid([string]$Lock) {
  try {
    return ([System.IO.File]::ReadAllText((Join-Path $Lock 'pid'), $script:RUN_UTF8)).Trim()
  } catch {
    return ''
  }
}

# Get-RunLock <id>: the lock folder appears whole (its pid file already in it) by one rename. An
# empty or unreadable pid means someone is starting: wait up to 2 seconds. Stale only when a
# pid is there and no such process exists.
function Get-RunLock([string]$Id) {
  $l = Join-Path $script:RUN_DIR 'lock'
  $t = Join-Path $script:RUN_DIR "lock.$PID"
  $waited = 0
  while ($true) {
    Remove-Item -LiteralPath $t -Recurse -Force -ErrorAction SilentlyContinue
    try {
      New-Item -ItemType Directory -Path $t -ErrorAction Stop | Out-Null
      [System.IO.File]::WriteAllText((Join-Path $t 'pid'), "$PID`n", $script:RUN_UTF8)
    } catch {
      Die 1 bad_state_path
    }
    if (-not (Test-Path -LiteralPath $l)) {
      try { [System.IO.Directory]::Move($t, $l) } catch { $null = $_ }
      if ((Read-RunPid $l) -ceq [string]$PID) { return }
    }
    Remove-Item -LiteralPath $t -Recurse -Force -ErrorAction SilentlyContinue
    $owner = Read-RunPid $l
    if ($owner -cmatch '^[0-9]+\z') {
      # A number too long to be a pid names no process: the lock is stale.
      $alive = $false
      if ($owner.Length -le 10 -and [long]$owner -le [int]::MaxValue) {
        $alive = [bool](Get-Process -Id ([int][long]$owner) -ErrorAction SilentlyContinue)
      }
      if ($alive) { Die 1 run_already_running $Id $l $owner }
      Remove-Item -LiteralPath $l -Recurse -Force -ErrorAction SilentlyContinue
      continue
    }
    if ($waited -ge 4) { Die 1 run_already_running $Id $l 'unknown' }
    $waited++
    Start-Sleep -Milliseconds 500
  }
}

function Invoke-RunCleanup {
  Lock-Release
  if ($script:RUN_LOCKED) {
    Remove-Item -LiteralPath (Join-Path $script:RUN_DIR 'lock') -Recurse -Force -ErrorAction SilentlyContinue
  }
  $script:RUN_LOCKED = $false
}

# Get-RunNum <name> <default> <min> <max>: the validated integer value of a run setting.
function Get-RunNum([string]$Name, [int]$Default, [long]$Min, [long]$Max) {
  $v = [Environment]::GetEnvironmentVariable($Name)
  if ([string]::IsNullOrEmpty($v)) { $v = [string]$Default }
  if ($v -cnotmatch '^[0-9]{1,9}\z') { Die 2 run_setting_bad $Name }
  $x = [long]$v
  if ($x -lt $Min -or $x -gt $Max) { Die 2 run_setting_bad $Name }
  return $x
}

# A file made with the private mode from the start where the platform allows it.
function Write-RunFile([string]$Path, [string]$Text) {
  $bytes = $script:RUN_UTF8.GetBytes($Text)
  if ($IsWindows) {
    [System.IO.File]::WriteAllBytes($Path, $bytes)
    return
  }
  $fo = [System.IO.FileStreamOptions]::new()
  $fo.Mode = [System.IO.FileMode]::Create
  $fo.Access = [System.IO.FileAccess]::Write
  $fo.UnixCreateMode = [System.IO.UnixFileMode]0x180
  $fs = [System.IO.FileStream]::new($Path, $fo)
  try { $fs.Write($bytes, 0, $bytes.Length) } finally { $fs.Dispose() }
  [System.IO.File]::SetUnixFileMode($Path, [System.IO.UnixFileMode]0x180)
}

# The one-line summary JSON of a stream file (empty when none can be had).
function Get-RunSummary([string]$Stream) {
  if (-not (Test-Path -LiteralPath $Stream -PathType Leaf)) { return '' }
  $c = Get-GatedEnv 'GELDAR_RUN_SUMMARY_CMD'
  try {
    if ($c) {
      $out = @(& $c $Stream 2> $null)
    } else {
      $out = @(Get-RunSummaryBox $Stream)
    }
  } catch {
    return ''
  }
  if ($out.Count -eq 0) { return '' }
  return [string]$out[0]
}

# The summary container, bounded to 120 seconds like the other helper containers (the twin of
# run_bounded 120 --container). The stream goes in on its input; the first output line is kept.
function Get-RunSummaryBox([string]$Stream) {
  $name = "geldar-$PID-run-summary"
  $exe = $env:GELDAR_DOCKER
  if (-not $exe) { $exe = 'docker' }
  $f = Join-Path ([IO.Path]::GetTempPath()) ('gp-out.' + [guid]::NewGuid().ToString('N').Substring(0, 12))
  $words = @($exe, 'run', '--rm', '-i', '--label', 'geldar.role=run-summary', '--name', $name,
    '--memory', '1g', '--pids-limit', '256', '--log-driver', 'none',
    '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--entrypoint', 'geldar-verify', $script:PL_KIT_IMAGE, 'run-summary')
  $env:GP_RUN_CMD = ConvertTo-Json -InputObject @($words | ForEach-Object { [string]$_ }) -Compress
  $env:GP_RUN_IN = $Stream
  $env:GP_RUN_OUT = $f
  $cmd = '$a = @($env:GP_RUN_CMD | ConvertFrom-Json -DateKind String); $e = $a[0]; $r = @($a | Select-Object -Skip 1); [System.IO.File]::ReadAllText($env:GP_RUN_IN) | & $e @r 2> $null > $env:GP_RUN_OUT; exit $LASTEXITCODE'
  try {
    [void](Invoke-Bounded 120 --container $name ([Environment]::ProcessPath) -NoProfile -NonInteractive -Command $cmd)
    if (-not (Test-Path -LiteralPath $f -PathType Leaf)) { return '' }
    $lines = [System.IO.File]::ReadAllText($f, $script:RUN_UTF8).Split("`n")
    return $lines[0].TrimEnd("`r")
  } finally {
    $env:GP_RUN_CMD = $null
    $env:GP_RUN_IN = $null
    $env:GP_RUN_OUT = $null
    Remove-Item -LiteralPath $f -Force -ErrorAction SilentlyContinue
  }
}

# ConvertFrom-Json of the summary line; $null when it does not parse to an object.
function ConvertFrom-RunSummary([string]$Json) {
  if ($Json -eq '') { return $null }
  # A lone surrogate escape would become U+FFFD; bash drops it. An escaped backslash is skipped
  # (a literal \\ud83d stays), and a valid high-low pair stays.
  $Json = [regex]::Replace($Json, '\\\\|\\u(d[89ab][0-9a-f]{2})\\u(d[c-f][0-9a-f]{2})|\\ud[89a-f][0-9a-f]{2}', {
      param($m)
      if ($m.Value -ceq '\\' -or $m.Groups[1].Success) { return $m.Value }
      return ''
    }, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
  try {
    $o = $Json | ConvertFrom-Json -DateKind String -ErrorAction Stop
  } catch {
    return $null
  }
  if ($o -is [System.Management.Automation.PSCustomObject]) { return $o }
  return $null
}

# Get-RunField <object> <name> <default>: a number or boolean field of the summary, as text.
function Get-RunField($Obj, [string]$Name, [string]$Default) {
  if ($null -eq $Obj) { return $Default }
  $p = $Obj.PSObject.Properties[$Name]
  if ($null -eq $p) { return $Default }
  $v = $p.Value
  if ($v -is [bool]) { return $(if ($v) { 'true' } else { 'false' }) }
  if ($v -is [int] -or $v -is [long] -or $v -is [double] -or $v -is [decimal]) {
    return ([System.Convert]::ToString($v, [cultureinfo]::InvariantCulture))
  }
  return $Default
}

# The character's last words from a summary: no control characters, double quotes turned into
# single quotes, at most 1500 characters (code points). It is untrusted text.
function Get-RunLastWords($Obj) {
  if ($null -eq $Obj) { return '' }
  $p = $Obj.PSObject.Properties['last_text']
  if ($null -eq $p -or $p.Value -isnot [string]) { return '' }
  $t = [string]$p.Value
  # A lone surrogate is dropped; a valid pair stays.
  $t = [regex]::Replace($t, '[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]', '')
  $t = $t.Replace("`n", ' ')
  $t = [regex]::Replace($t, '[\x00-\x1f\x7f-\x9f]', '')
  $t = $t.Replace('"', "'")
  $sb = [System.Text.StringBuilder]::new()
  $count = 0
  $i = 0
  while ($i -lt $t.Length -and $count -lt 1500) {
    if ([char]::IsHighSurrogate($t[$i]) -and $i + 1 -lt $t.Length -and [char]::IsLowSurrogate($t[$i + 1])) {
      [void]$sb.Append($t[$i]).Append($t[$i + 1])
      $i += 2
    } else {
      [void]$sb.Append($t[$i])
      $i++
    }
    $count++
  }
  return $sb.ToString()
}

# New-RunPrompt <n>: writes run/prompt.txt (private, UTF-8, LF) for waking number n; returns its path.
function New-RunPrompt([long]$N) {
  $f = Join-Path $script:RUN_DIR 'prompt.txt'
  $prev = Join-Path $script:RUN_DIR "session-$($N - 1).jsonl"
  $words = ''
  if ($N -gt 1 -and (Test-Path -LiteralPath $prev -PathType Leaf)) {
    $words = Get-RunLastWords (ConvertFrom-RunSummary (Get-RunSummary $prev))
  }
  $text = "This is your waking number $N. You have been living here a while."
  if ($words -ne '') { $text = "$text Last you said: `"$words`"." }
  $text = "$text Read your journal first, then look around. If something does not work, read why and try another way. If you are truly stuck, wait or sleep and try again later; do not stop."
  try {
    Write-RunFile $f "$text`n"
  } catch {
    Die 1 bad_state_path
  }
  return $f
}

# The next run number: one more than the highest run/session-<n>.jsonl.
function Get-RunNextNumber {
  $max = [long]0
  foreach ($f in @(Get-ChildItem -LiteralPath $script:RUN_DIR -Filter 'session-*.jsonl' -File -ErrorAction SilentlyContinue)) {
    $b = $f.Name.Substring(8, $f.Name.Length - 8 - 6)
    if ($b -cnotmatch '^[0-9]{1,9}\z') { continue }
    if ([long]$b -gt $max) { $max = [long]$b }
  }
  return ($max + 1)
}

# Cost summed over today's (UTC) lines of costs.csv, as text.
function Get-RunCostToday([string]$Day) {
  $f = Join-Path $script:RUN_DIR 'costs.csv'
  if (-not (Test-Path -LiteralPath $f -PathType Leaf)) { return '0' }
  $sum = [double]0
  foreach ($line in [System.IO.File]::ReadAllText($f, $script:RUN_UTF8).Split("`n")) {
    $c = $line.TrimEnd("`r").Split(',')
    if ($c.Count -lt 2 -or -not $c[1].StartsWith($Day, [StringComparison]::Ordinal)) { continue }
    $x = [double]0
    if ($c.Count -ge 4 -and [double]::TryParse($c[3], [Globalization.NumberStyles]::Float, [cultureinfo]::InvariantCulture, [ref]$x)) { $sum += $x }
  }
  return $sum.ToString('F4', [cultureinfo]::InvariantCulture)
}

# Write-RunStatus <run> <state> <last_result> <today's cost>
function Write-RunStatus($N, [string]$State, [string]$LastResult, [string]$Cost) {
  $now = Format-RunTime (Get-RunNow) 'stamp'
  $t = Join-Path $script:RUN_DIR 'status.json.new'
  $json = '{"run":' + $N + ',"state":"' + $State + '","started":"' + $script:RUN_STARTED + '","last_result":"' + $LastResult + '","cost_today":' + $Cost + ',"updated":"' + $now + '"}' + "`n"
  Invoke-RunWrite 'status.json' {
    Write-RunFile $t $json
    Move-Item -LiteralPath $t -Destination (Join-Path $script:RUN_DIR 'status.json') -Force
  } | Out-Null
}

# Invoke-RunWrite <name> <script block>: a log or status write is tried 5 times, 200 ms apart (a
# Windows sharing violation passes); then it is reported on stderr and skipped. It never ends the
# supervisor. The text is fixed: a new message key is not part of this packet.
function Invoke-RunWrite([string]$Name, [scriptblock]$Body) {
  for ($try = 1; $try -le 5; $try++) {
    try {
      $null = & $Body
      return $true
    } catch {
      if ($try -lt 5) { Start-Sleep -Milliseconds 200 }
    }
  }
  [Console]::Error.Write("geldar-play: could not write $Name; it was skipped`n")
  return $false
}

function Write-RunLog([string]$Text) {
  $line = (Format-RunTime (Get-RunNow) 'stamp') + ' ' + $Text + "`n"
  Invoke-RunWrite 'supervisor.log' {
    [System.IO.File]::AppendAllText((Join-Path $script:RUN_DIR 'supervisor.log'), $line, $script:RUN_UTF8)
  } | Out-Null
}

# One full play cycle in run mode; a refusal inside it ends only the cycle. Returns its exit code.
function Invoke-RunCycle([string]$Id, [long]$N) {
  $rc = 0
  $script:GP_DIE_THROWS = $true
  try {
    $res = @(Invoke-RunCycleBody $Id $N)
    $rc = $res[$res.Count - 1]
  } catch {
    if ($_.Exception.Message -ceq 'geldar-die') {
      $rc = $script:GP_DIE_CODE
    } else {
      [Console]::Error.Write($_.Exception.Message + "`n")
      $rc = 1
    }
  } finally {
    $script:GP_DIE_THROWS = $false
    Lock-Release
    Remove-Item Env:GELDAR_RUN_PROMPT_FILE -ErrorAction SilentlyContinue
  }
  return [int]$rc
}

function Invoke-RunCycleBody([string]$Id, [long]$N) {
  $d = Get-PlayerDir $Id
  $out = Join-Path $script:RUN_DIR "session-$N.jsonl"
  $prompt = New-RunPrompt $N
  if ((Get-GatedEnv 'GELDAR_RUN_DRY') -ceq '1') {
    try {
      Write-RunFile $out "{`"dry`":true}`n"
    } catch {
      return 1
    }
    $c = Get-GatedEnv 'GELDAR_RUN_DRY_CMD'
    if ($c) {
      $global:LASTEXITCODE = 0
      & $c ([string]$N) $out | Out-Null
      return [int]$global:LASTEXITCODE
    }
    return 0
  }
  Lock-Acquire $Id
  Assert-NotHeld $Id
  if (Test-Path -LiteralPath (Join-Path $d 'session/running') -PathType Leaf) {
    $cid = @(Invoke-Docker ps -q --filter label=geldar.role=session --filter "label=com.docker.compose.project=geldar-$Id" 2> $null)
    if ($cid.Count -gt 0 -and "$($cid -join '')" -ne '') { Die 1 locked $Id }
    Invoke-Docker volume inspect "geldar-ws-$Id" *> $null
    if ($LASTEXITCODE -eq 0) {
      Say recovering
      Invoke-FinishSession $Id @()
      return 0
    }
    Remove-Item -LiteralPath (Join-Path $d 'session') -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath (Join-Path $d 'start'), (Join-Path $d 'mode') -Force -ErrorAction SilentlyContinue
    Say stale_cleared
  }
  Invoke-PrepareSession $Id 'play'
  $env:GELDAR_RUN_PROMPT_FILE = $prompt
  Start-PlayerSession $Id 'run' ([string]$N)
  Remove-Item Env:GELDAR_RUN_PROMPT_FILE -ErrorAction SilentlyContinue
  Invoke-FinishSession $Id @()
  return 0
}

# Is the path a link? A link at the run folder would send the state elsewhere.
function Test-RunLink([string]$Path) {
  $li = Get-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
  return [bool]($li -and ($li.LinkType -or $li.LinkTarget))
}

# run <id>: the supervisor loop.
function Verb-run {
  if ($args.Count -ne 1) { Die 2 usage }
  $id = [string]$args[0]
  [void](Get-DevWorldUrl $id)
  $delayBase = Get-RunNum 'GELDAR_RUN_DELAY' 20 1 86400
  $maxDelay = Get-RunNum 'GELDAR_RUN_MAX_DELAY' 900 1 86400
  $fast = Get-RunNum 'GELDAR_RUN_FAST_SEC' 30 0 86400
  $maxFails = Get-RunNum 'GELDAR_RUN_MAX_FAILS' 5 1 1000
  $turns = Get-RunNum 'GELDAR_RUN_MAX_TURNS' 300 1 999999
  $cap = [Environment]::GetEnvironmentVariable('GELDAR_RUN_DAILY_CAP_USD')
  if ([string]::IsNullOrEmpty($cap)) { $cap = '15' }
  if ($cap -cnotmatch '^[0-9]{1,6}(\.[0-9]{1,4})?\z') { Die 2 run_setting_bad GELDAR_RUN_DAILY_CAP_USD }
  $inv = [cultureinfo]::InvariantCulture
  $capNum = [double]::Parse($cap, [Globalization.NumberStyles]::Float, $inv)
  if (-not ($capNum -gt 0)) { Die 2 run_setting_bad GELDAR_RUN_DAILY_CAP_USD }
  $model = [string][Environment]::GetEnvironmentVariable('GELDAR_RUN_MODEL')
  if ($model -ne '' -and $model -cnotmatch '^[A-Za-z0-9._:/-]+\z') { Die 2 run_setting_bad GELDAR_RUN_MODEL }
  if ($maxDelay -lt $delayBase) { Die 2 run_setting_bad GELDAR_RUN_MAX_DELAY }
  $env:GELDAR_RUN_MAX_TURNS = [string]$turns
  $d = Get-PlayerDir $id
  Read-Player $id
  $script:RUN_DIR = Join-Path $d 'run'
  if (Test-RunLink $script:RUN_DIR) { Die 1 bad_state_path }
  New-PrivateDir (Join-Path $d 'run')
  Get-RunLock $id
  $script:RUN_LOCKED = $true
  Initialize-RunStop
  $script:GP_SHIELD = $true
  [GeldarRunStop]::Reset()
  [GeldarRunStop]::Line = 'geldar-play: ' + (Format-Msg $script:GP_MSG['run_stopping'] @()) + "`n"
  [GeldarRunStop]::Hook()
  $stopFail = $false
  try {
    # A manual STOP is stale at the start and cleared; one the supervisor wrote itself is not.
    $stopFile = Join-Path $script:RUN_DIR 'STOP'
    if (Test-Path -LiteralPath $stopFile -PathType Leaf) {
      $seen = ''
      try { $seen = ([System.IO.File]::ReadAllText($stopFile, $script:RUN_UTF8) -split "`n")[0].TrimEnd("`r") } catch { $null = $_ }
      if ($seen.StartsWith('auto:', [StringComparison]::Ordinal)) {
        Die 1 run_stopped_auto ($seen -replace '^auto: ', '') $stopFile
      }
      Remove-Item -LiteralPath $stopFile -Force -ErrorAction SilentlyContinue
    }
    $script:RUN_STARTED = Format-RunTime (Get-RunNow) 'stamp'
    $delay = $delayBase
    $fails = 0
    $n = [long]0
    $last = 'none'
    Say run_start $id
    while ($true) {
      if (Test-RunStop) { break }
      $e = Get-RunNow
      $today = Format-RunTime $e 'date'
      $sum = Get-RunCostToday $today
      $inv = [cultureinfo]::InvariantCulture
      if ([double]::Parse($sum, $inv) -ge [double]::Parse($cap, $inv)) {
        $secs = 86400 - $e % 86400
        Say run_cap_reached $cap
        Write-RunLog "cap reached cost=$sum waiting=$secs"
        Write-RunStatus $n 'sleeping' $last $sum
        Start-RunSleep $secs
        continue
      }
      $n = Get-RunNextNumber
      Write-RunStatus $n 'running' $last $sum
      $t0 = Get-RunNow
      $rc = Invoke-RunCycle $id $n
      $t1 = Get-RunNow
      $secs = $t1 - $t0
      $o = ConvertFrom-RunSummary (Get-RunSummary (Join-Path $script:RUN_DIR "session-$n.jsonl"))
      $turnsDone = Get-RunField $o 'turns' '0'
      $costDone = Get-RunField $o 'cost' '0'
      $err = Get-RunField $o 'is_error' 'true'
      $seen = Get-RunField $o 'result_seen' 'false'
      $row = "$n,$(Format-RunTime $t1 'stamp'),$turnsDone,$costDone`n"
      # The cap depends on this row: a failed write is said loudly, and the loop goes on.
      if (-not (Invoke-RunWrite 'costs.csv' { [System.IO.File]::AppendAllText((Join-Path $script:RUN_DIR 'costs.csv'), $row, $script:RUN_UTF8) })) {
        [Console]::Error.Write("geldar-play: WARNING: the cost of run $n is not in costs.csv; the daily cap may undercount`n")
      }
      $ok = $true
      if ($rc -ne 0 -or $secs -lt $fast -or $err -ceq 'true' -or $seen -cne 'true') { $ok = $false }
      if ($ok) {
        $fails = 0
        $delay = $delayBase
        $last = 'ok'
      } else {
        $fails++
        $delay = $delay * 2
        if ($delay -gt $maxDelay) { $delay = $maxDelay }
        $last = 'failed'
      }
      $cost = Get-RunCostToday (Format-RunTime $t1 'date')
      Write-RunLog "run=$n turns=$turnsDone cost=$costDone secs=$secs exit=$rc result=$last delay=$delay fails=$fails"
      Write-RunStatus $n 'sleeping' $last $cost
      if ($rc -eq 3 -or (Test-Path -LiteralPath (Join-Path $d 'held') -PathType Container)) {
        Write-RunFile (Join-Path $script:RUN_DIR 'STOP') "auto: the saved session was held back`n"
        Say run_held $id $id
        $stopFail = $true
        break
      }
      if ($fails -ge $maxFails) {
        Write-RunFile (Join-Path $script:RUN_DIR 'STOP') "auto: $fails failed cycles in a row`n"
        Say run_too_many_failures $fails
        $stopFail = $true
        break
      }
      if (Test-RunStop) { break }
      if (-not $ok) { Say run_backoff $n $delay }
      Start-RunSleep $delay
    }
    Write-RunStatus $n 'stopped' $last (Get-RunCostToday (Format-RunTime (Get-RunNow) 'date'))
    Write-RunLog 'stopped'
    Say run_stopped $n
  } finally {
    $script:GP_SHIELD = $false
    Invoke-RunCleanup
  }
  if ($stopFail) { exit 1 }
}

# run-status <id>: the status file, the last 5 cost lines and the tool-call counts of the latest stream.
function Verb-run_status {
  if ($args.Count -ne 1) { Die 2 usage }
  $id = [string]$args[0]
  if (-not (Test-Path -LiteralPath (Get-PlayerDir $id) -PathType Container)) { Die 1 no_such_player $id $id }
  $script:RUN_DIR = Join-Path (Get-PlayerDir $id) 'run'
  if (-not (Test-Path -LiteralPath $script:RUN_DIR -PathType Container)) { Die 0 run_status_none $id }
  $sf = Join-Path $script:RUN_DIR 'status.json'
  if (Test-Path -LiteralPath $sf -PathType Leaf) { [Console]::Out.Write([System.IO.File]::ReadAllText($sf, $script:RUN_UTF8)) }
  $cf = Join-Path $script:RUN_DIR 'costs.csv'
  if (Test-Path -LiteralPath $cf -PathType Leaf) {
    $lines = [System.IO.File]::ReadAllText($cf, $script:RUN_UTF8).Split("`n")
    if ($lines.Count -gt 0 -and $lines[$lines.Count - 1] -eq '') { $lines = $lines[0..($lines.Count - 2)] }
    foreach ($l in @($lines | Select-Object -Last 5)) { [Console]::Out.Write($l + "`n") }
  }
  $latest = ''
  $max = [long]0
  foreach ($f in @(Get-ChildItem -LiteralPath $script:RUN_DIR -Filter 'session-*.jsonl' -File -ErrorAction SilentlyContinue)) {
    $b = $f.Name.Substring(8, $f.Name.Length - 8 - 6)
    if ($b -cnotmatch '^[0-9]{1,9}\z') { continue }
    if ([long]$b -gt $max) { $max = [long]$b; $latest = $f.FullName }
  }
  if ($latest -eq '') { return }
  Read-Player $id
  $sum = Get-RunSummary $latest
  $tools = 'unavailable'
  if ($sum -ne '') { $tools = '{}' }
  $m = [regex]::Match($sum, '^.*"tools":(\{[^}]*\})', [System.Text.RegularExpressions.RegexOptions]::Singleline)
  if ($m.Success) { $tools = $m.Groups[1].Value }
  [Console]::Out.Write("tools: $tools`n")
}

# run-stop <id>: asks a running supervisor to stop after the current cycle.
function Verb-run_stop {
  if ($args.Count -ne 1) { Die 2 usage }
  $id = [string]$args[0]
  $d = Get-PlayerDir $id
  if (-not (Test-Path -LiteralPath $d -PathType Container)) { Die 1 no_such_player $id $id }
  if (Test-RunLink (Join-Path $d 'run')) { Die 1 bad_state_path }
  New-PrivateDir (Join-Path $d 'run')
  Write-RunFile (Join-Path (Join-Path $d 'run') 'STOP') "manual`n"
  Say run_stop_requested $id
}
