# After the session: the workspace bundle and the verify gate (H-09, H-10, H-16).
# Dot-sourced; the twin of lib/bundle.sh. The workspace is read only through a container with no
# network. The bundle is binary: it is copied byte for byte from the child's stdout stream, never
# through the PowerShell pipeline (which would decode and re-encode it).

$script:GP_BUNDLE_CAP = 52428800
$script:GP_REASONS = @(
  'bad_arguments', 'verify_error', 'bundle_too_large', 'bundle_unreadable', 'bundle_refs_unexpected',
  'bundle_fetch_failed', 'too_many_commits', 'not_fast_forward', 'merge_commit', 'identity_mismatch',
  'identity_changed', 'path_not_allowed', 'symlink_not_allowed', 'gitlink_not_allowed',
  'executable_not_allowed', 'bad_mode')
$script:GP_FAIL = ''

# The flags every helper container gets.
function Get-HelperFlags {
  return @('--rm', '--memory', '1g', '--pids-limit', '256', '--log-driver', 'none', '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges', '--network', 'none')
}

function Get-HelperSeconds {
  $o = Get-GatedEnv 'GELDAR_HELPER_TIMEOUT_SEC'
  if ($o -match '^[0-9]+\z' -and [int]$o -gt 0) { return [int]$o }
  return 300
}

# Starts docker with stdout and stderr redirected. Stderr is drained at once, asynchronously
# (an undrained pipe would block the child). The process sits in a job so one call ends its tree.
function Start-DockerProcess([string[]]$DockerArgs) {
  $exe = $env:GELDAR_DOCKER
  if (-not $exe) { $exe = 'docker' }
  $found = Get-Command $exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($found) { $exe = $found.Source }
  $psi = New-CmdShimStartInfo $exe $DockerArgs
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $job = [IntPtr]::Zero
  try {
      if ($IsWindows) { Initialize-JobType; $job = [GeldarJob]::Create() }
      $p = [System.Diagnostics.Process]::Start($psi)
      if ($IsWindows -and ($job -eq [IntPtr]::Zero -or -not [GeldarJob]::Assign($job, $p.Handle))) {
        if ($job -ne [IntPtr]::Zero) { [GeldarJob]::Close($job) }
        $job = [IntPtr]::Zero
      }
    } catch {
      return $null
    }
    return @{ P = $p; Job = $job; Err = $p.StandardError.ReadToEndAsync() }
  }

  # Ends the process tree, then (named container) docker kill, and docker rm -f when asked.
  function Stop-DockerProcess($H, [string]$Name, [bool]$Remove) {
    if ($IsWindows -and $H.Job -ne [IntPtr]::Zero) { [GeldarJob]::Kill($H.Job) } else { try { $H.P.Kill($true) } catch {} }
    [void]$H.P.WaitForExit(10000)
    Invoke-Docker kill $Name *> $null
    if ($Remove) { Invoke-Docker rm -f $Name *> $null }
  }

  function Close-DockerProcess($H) {
    if ($IsWindows -and $H.Job -ne [IntPtr]::Zero) { [GeldarJob]::Close($H.Job) }
    if ($H.Err.Wait(2000)) {
      $t = $H.Err.Result
      if ($t) { [Console]::Error.Write($t) }
    }
    $H.P.Dispose()
  }

  # make_bundle id: needs Read-Player. Returns $true, or $false with GP_FAIL set.
  function New-Bundle([string]$Id) {
    $sd = Join-Path (Get-PlayerDir $Id) 'session'
    $out = Join-Path $sd 'bundle.bundle'
    $name = "geldar-bundle-$Id-$PID"
    Remove-Item -LiteralPath $out -Force -ErrorAction SilentlyContinue
    $dargs = @('run') + (Get-HelperFlags) + @('--label', 'geldar.role=bundle', '--name', $name,
      '-e', 'HOME=/tmp', '-e', 'GIT_CONFIG_GLOBAL=/dev/null', '-e', 'GIT_CONFIG_NOSYSTEM=1', '-e', 'GIT_NO_REPLACE_OBJECTS=1',
      '-e', 'GIT_CONFIG_COUNT=1', '-e', 'GIT_CONFIG_KEY_0=safe.directory', '-e', 'GIT_CONFIG_VALUE_0=/player',
      '-v', "geldar-ws-${Id}:/player:ro", '-e', "GELDAR_BRANCH=$($script:PL_BRANCH)",
      $script:PL_KIT_IMAGE, 'sh', '-c', 'git -C /player bundle create - refs/heads/$GELDAR_BRANCH')
    $h = Start-DockerProcess $dargs
    if ($null -eq $h) { $script:GP_FAIL = 'bundle_failed'; return $false }
    $limit = [int64]$script:GP_BUNDLE_CAP + 1
    $total = [int64]0
    $timedOut = $false
    $deadline = [DateTime]::UtcNow.AddSeconds((Get-HelperSeconds))
    $buf = [byte[]]::new(65536)
    $fs = [System.IO.File]::Create($out)
    try {
      $stdout = $h.P.StandardOutput.BaseStream
      while ($total -lt $limit) {
        $want = [int][Math]::Min([int64]$buf.Length, $limit - $total)
        $t = $stdout.ReadAsync($buf, 0, $want)
        $left = [int][Math]::Ceiling(($deadline - [DateTime]::UtcNow).TotalMilliseconds)
        if ($left -le 0 -or -not $t.Wait($left)) { $timedOut = $true; break }
        $n = $t.Result
        if ($n -le 0) { break }
        $fs.Write($buf, 0, $n)
        $total += $n
      }
  } finally {
    $fs.Dispose()
  }
  $dockrc = -1
  if ($total -gt $script:GP_BUNDLE_CAP) {
    # The container could otherwise write on: close our end of the pipe, so the writer sees it
    # closed, then kill it by name until docker run has ended. Only then the process tree.
    try { $stdout.Dispose() } catch {}
    $tries = 0
    while (-not $h.P.HasExited -and $tries -lt 300) {
      Invoke-Docker kill $name *> $null
      [void]$h.P.WaitForExit(200)
      $tries++
    }
    Stop-DockerProcess $h $name $true
  } elseif ($timedOut) {
    Stop-DockerProcess $h $name $true
  } else {
    $left = [int][Math]::Max(1, [Math]::Ceiling(($deadline - [DateTime]::UtcNow).TotalMilliseconds))
    if ($h.P.WaitForExit($left)) {
      $dockrc = $h.P.ExitCode
    } else {
      $timedOut = $true
      Stop-DockerProcess $h $name $true
    }
  }
  Close-DockerProcess $h
  # H-10: a full-size file is too large whatever status the closed pipe gave the docker client.
  if ((Get-Item -LiteralPath $out).Length -gt $script:GP_BUNDLE_CAP) {
    $script:GP_FAIL = 'bundle_too_large'
    return $false
  }
  if ($timedOut -or $dockrc -ne 0) {
    $script:GP_FAIL = 'bundle_failed'
    return $false
  }
  return $true
}

# Says the launcher's own text for each reason of a parsed rejection; $false when unreadable.
function Write-Reasons([string]$List) {
  $ids = @($List.Split(',') | ForEach-Object { $_.Replace('"', '') })
  foreach ($r in $ids) {
    if ($script:GP_REASONS -cnotcontains $r) { return $false }
  }
  foreach ($r in $ids) { Say "reason_$r" }
  return $true
}

# verify_bundle id start mode: $true only for exit 0 and exactly {"ok":true,"reasons":[]}.
# Otherwise $false with GP_FAIL set and the reasons already said.
function Test-BundleVerified([string]$Id, [string]$Start, [string]$Mode) {
  $sd = Join-Path (Get-PlayerDir $Id) 'session'
  $name = "geldar-verify-$Id-$PID"
  $stage = New-StagedBundle (Join-Path $sd 'bundle.bundle') 'bundle.bundle'
  if (-not $stage) {
    $script:GP_FAIL = 'verify_unreadable'
    return $false
  }
  $bundle = $stage.Replace([char]92, [char]47)
  $dargs = @('run') + (Get-HelperFlags) + @('--label', 'geldar.role=verify', '--name', $name,
    '-e', 'HOME=/tmp', '-e', 'GIT_CONFIG_GLOBAL=/dev/null', '-e', 'GIT_CONFIG_NOSYSTEM=1', '-e', 'GIT_NO_REPLACE_OBJECTS=1',
    '--read-only', '--tmpfs', '/tmp:size=256m', '-v', "${bundle}:/in:ro",
    $script:PL_KIT_IMAGE, 'geldar-verify', '--bundle', '/in/bundle.bundle', '--start', $Start,
    '--branch', $script:PL_BRANCH, '--mode', $Mode, '--player-id', $Id)
  $rc = 124
  $out = ''
  try {
  $h = Start-DockerProcess $dargs
  if ($null -ne $h) {
    $outTask = $h.P.StandardOutput.ReadToEndAsync()
    if ($h.P.WaitForExit((Get-HelperSeconds) * 1000) -and $outTask.Wait(10000)) {
      $rc = $h.P.ExitCode
      $out = $outTask.Result
    } else {
      Stop-DockerProcess $h $name $true
    }
    if ($IsWindows -and $h.Job -ne [IntPtr]::Zero) { [GeldarJob]::Close($h.Job) }
    $h.P.Dispose()
  }
  } finally {
    Remove-StagedBundle $stage
  }
  $out = $out.TrimEnd("`n")
  if ($rc -eq 0 -and $out -ceq '{"ok":true,"reasons":[]}') { return $true }
  if ($rc -ne 124 -and $out -cmatch '^\{"ok":false,"reasons":\[("[a-z_]+"(,"[a-z_]+")*)\]\}\z') {
    if (Write-Reasons $Matches[1]) {
      $script:GP_FAIL = 'verify_rejected'
      return $false
    }
  }
  $script:GP_FAIL = 'verify_unreadable'
  return $false
}
