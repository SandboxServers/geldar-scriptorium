# After the session: bundle, verify, host re-check, hold. Dot-sourced; the twin of lib/finish.sh.
# Fetch, push by SHA, then fast-forward the host branch (H-12 to H-17).

$GP_GROUPS += 'finish'
# A failure after the session: the bundle and the workspace stay, the host branch is untouched.
function Suspend-Finish([string]$Id, [string]$Reason) {
  $d = Get-PlayerDir $Id
  $held = Join-Path $d 'held'
  New-PrivateDir $d
  New-PrivateDir $held
  $bundle = Join-Path $d 'session/bundle.bundle'
  if (Test-Path -LiteralPath $bundle -PathType Leaf) {
    Copy-Item -LiteralPath $bundle -Destination (Join-Path $held 'bundle.bundle') -Force
  }
  $start = ''
  $mode = ''
  if (Test-Path -LiteralPath (Join-Path $d 'start') -PathType Leaf) { $start = Read-FirstLine (Join-Path $d 'start') }
  if (Test-Path -LiteralPath (Join-Path $d 'mode') -PathType Leaf) { $mode = Read-FirstLine (Join-Path $d 'mode') }
  $text = "reason=$Reason`nstart=$start`nmode=$mode`nbranch=$($script:PL_BRANCH)`n"
  [System.IO.File]::WriteAllText((Join-Path $held 'info'), $text, [System.Text.UTF8Encoding]::new($false))
  exit 3
}

# The bundle is fetched into a scratch repository, so the re-check runs on objects the host
# git has checked itself.
function Test-RecheckScratch([string]$Id, [string]$Start, [string]$Mode) {
  $sd = Join-Path (Get-PlayerDir $Id) 'session'
  $repo = Join-Path $sd 'recheck.git'
  Remove-Item -LiteralPath $repo -Recurse -Force -ErrorAction SilentlyContinue
  Invoke-Git init --bare -q $repo *> $null
  if ($LASTEXITCODE -ne 0) { return $false }
  $bundle = Join-Path $sd 'bundle.bundle'
  $refspec = "refs/heads/$($script:PL_BRANCH):refs/launcher/incoming"
  Invoke-Git -C $repo -c fetch.fsckObjects=true -c transfer.fsckObjects=true fetch --no-tags $bundle $refspec *> $null
  if ($LASTEXITCODE -ne 0) {
    $script:RC_WHY = 'fetch'
    Remove-Item -LiteralPath $repo -Recurse -Force -ErrorAction SilentlyContinue
    return $false
  }
  $ok = Test-HostRecheck $repo $Start 'refs/launcher/incoming' $Mode
  Remove-Item -LiteralPath $repo -Recurse -Force -ErrorAction SilentlyContinue
  return $ok
}

# The last check before the push: the host clone is clean, on the stored branch, and HEAD is
# START or an ancestor of what is about to be pushed.
function Test-HostStillOk([string]$Clone) {
  $st = @(Invoke-Git -C $Clone status --porcelain --untracked-files=all 2> $null)
  if ($LASTEXITCODE -ne 0) { return $false }
  if ($st.Count -gt 0 -and "$($st -join '')" -ne '') { return $false }
  $br = @(Invoke-Git -C $Clone symbolic-ref -q --short HEAD 2> $null)
  if ("$($br -join '')" -cne $script:PL_BRANCH) { return $false }
  Invoke-Git -C $Clone merge-base --is-ancestor HEAD refs/launcher/incoming *> $null
  return ($LASTEXITCODE -eq 0)
}

# H-15: only after the memory is on origin and in the host branch.
function Invoke-FinishCleanup([string]$Id, [string]$Clone) {
  $d = Get-PlayerDir $Id
  Invoke-Git -C $Clone update-ref -d refs/launcher/incoming *> $null
  Invoke-Docker volume rm "geldar-ws-$Id" *> $null
  Remove-Item -LiteralPath (Join-Path $d 'session'), (Join-Path $d 'pub') -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath (Join-Path $d 'start'), (Join-Path $d 'mode') -Force -ErrorAction SilentlyContinue
}

# A git command line for Invoke-BoundedQuiet: the executable first, then the shared flags.
function Get-GitWords {
  $exe = $env:GELDAR_GIT
  if (-not $exe) { $exe = 'git' }
  $hooks = Join-Path (Get-StateDir) 'empty-hooks'
  New-PrivateDir (Get-StateDir)
  New-PrivateDir $hooks
  $env:GIT_NO_REPLACE_OBJECTS = '1'
  $env:GIT_TERMINAL_PROMPT = '0'
  return @($exe, '-c', "core.hooksPath=$hooks") + @($args)
}

# Fetch (H-12), re-check (H-13), push by SHA, then fast-forward the host branch (H-14).
function Invoke-FinishPublish([string]$Id, [string]$Start, [string]$Mode) {
  $clone = $script:PL_CLONE
  $sd = Join-Path (Get-PlayerDir $Id) 'session'
  $hooks = Join-Path (Get-StateDir) 'empty-hooks'
  Invoke-Git -C $clone update-ref -d refs/launcher/incoming *> $null
  $words = Get-GitWords -C $clone -c fetch.fsckObjects=true -c transfer.fsckObjects=true fetch --no-tags `
    (Join-Path $sd 'bundle.bundle') "refs/heads/$($script:PL_BRANCH):refs/launcher/incoming"
  if ((Invoke-BoundedQuiet 120 @words) -ne 0) {
    Say fetch_failed $Id
    Suspend-Finish $Id fetch_failed
  }
  if (-not (Test-HostRecheck $clone $Start 'refs/launcher/incoming' $Mode)) {
    Say recheck_failed $script:RC_WHY $Id
    Suspend-Finish $Id recheck_failed
  }
  $sha = "$(@(Invoke-Git -C $clone rev-parse refs/launcher/incoming 2> $null) -join '')"
  if ($sha -cnotmatch '^[0-9a-f]{40}\z') {
    Say fetch_failed $Id
    Suspend-Finish $Id fetch_failed
  }
  if (-not (Test-HostStillOk $clone)) {
    Say host_moved $Id $Id
    Suspend-Finish $Id host_moved
  }
  if ($sha -ceq $Start) {
    Invoke-FinishCleanup $Id $clone
    Say nothing_to_save $Id
    return
  }
  $n = "$(@(Invoke-Git -C $clone rev-list --count "$Start..$sha" 2> $null) -join '')"
  if ($LASTEXITCODE -ne 0 -or $n -cnotmatch '^[0-9]+\z') { $n = '0' }
  $words = Get-GitWords -C $clone push origin "${sha}:refs/heads/$($script:PL_BRANCH)"
  if ((Invoke-BoundedQuiet 120 @words) -ne 0) {
    Say push_failed $Id
    Suspend-Finish $Id push_failed
  }
  # Only now does the human's branch move.
  $ffOk = -not (Get-GatedEnv 'GELDAR_TEST_FORCE_FF_FAIL')
  if ($ffOk) {
    $oldMask = Set-Umask 0x12 # the human's clone keeps the user's normal modes
    try {
      Invoke-Git -C $clone -c "core.hooksPath=$hooks" -c core.autocrlf=false -c core.fsmonitor=false merge --ff-only refs/launcher/incoming *> $null
      $ffOk = $LASTEXITCODE -eq 0
    } finally { [void](Set-Umask $oldMask) }
  }
  if (-not $ffOk) {
    Say ff_failed $Id $Id
    Suspend-Finish $Id ff_failed
  }
  Say saved $n $Id
  foreach ($line in @(Invoke-Git -C $clone log -n 5 --format=%s "$Start..$sha" 2> $null)) {
    [Console]::Error.Write('  ' + (Sanitize "$line") + "`n")
  }
  Invoke-FinishCleanup $Id $clone
}

# Invoke-FinishSession id [--until verify]
function Invoke-FinishSession([string]$Id, [string[]]$More) {
  $until = ''
  if ($More.Count -ge 2 -and $More[0] -ceq '--until') { $until = $More[1] }
  $d = Get-PlayerDir $Id
  foreach ($f in 'start', 'mode') {
    if (-not (Test-Path -LiteralPath (Join-Path $d $f) -PathType Leaf)) { Die 1 no_such_player $Id $Id }
  }
  $start = Read-FirstLine (Join-Path $d 'start')
  $mode = Read-FirstLine (Join-Path $d 'mode')
  Read-Player $Id $start
  $script:GP_FAIL = ''
  if (-not (New-Bundle $Id)) {
    Say $script:GP_FAIL $Id
    Suspend-Finish $Id $script:GP_FAIL
  }
  if (-not (Test-BundleVerified $Id $start $mode)) {
    if ($script:GP_FAIL -ceq 'verify_rejected' -or $script:GP_FAIL -ceq 'verify_unreadable') { Say $script:GP_FAIL $Id }
    Suspend-Finish $Id $script:GP_FAIL
  }
  if ($until -ceq 'verify') {
    if (-not (Test-RecheckScratch $Id $start $mode)) {
      Say recheck_failed $script:RC_WHY $Id
      Suspend-Finish $Id recheck_failed
    }
    Say verify_ok
    return
  }
  Invoke-FinishPublish $Id $start $mode
}

function Verb-__finish {
  $a = @($args)
  $ok = $a.Count -eq 1 -or ($a.Count -eq 3 -and $a[1] -ceq '--until' -and $a[2] -ceq 'verify')
  if (-not $ok) { Die 2 usage }
  Invoke-FinishSession ([string]$a[0]) @($a | Select-Object -Skip 1)
}

# play: prepare, session, finish; a leftover running session is finished from its stored START.
function Verb-play {
  $id = [string]$args[0]
  $d = Get-PlayerDir $id
  Lock-Acquire $id
  Assert-NotHeld $id
  if (Test-Path -LiteralPath (Join-Path $d 'session/running') -PathType Leaf) {
    $cid = @(Invoke-Docker ps -q --filter label=geldar.role=session --filter "label=com.docker.compose.project=geldar-$id" 2> $null)
    if ($cid.Count -gt 0 -and "$($cid -join '')" -ne '') { Die 1 locked $id }
    Invoke-Docker volume inspect "geldar-ws-$id" *> $null
    if ($LASTEXITCODE -eq 0) {
      Say recovering
      Invoke-FinishSession $id @()
      return
    }
    Remove-Item -LiteralPath (Join-Path $d 'session') -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath (Join-Path $d 'start'), (Join-Path $d 'mode') -Force -ErrorAction SilentlyContinue
    Say stale_cleared
  }
  Invoke-PrepareSession $id 'play'
  Start-PlayerSession $id 'play'
  Invoke-FinishSession $id @()
}
