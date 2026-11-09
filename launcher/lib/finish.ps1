# After the session: bundle, verify, host re-check, hold. Dot-sourced; the twin of lib/finish.sh.
# This is the minimal form (SC-53d); the fetch, push and fast-forward steps extend it.

# A failure after the session: the bundle and the workspace stay, the host branch is untouched.
function Suspend-Finish([string]$Id, [string]$Reason) {
  $d = Get-PlayerDir $Id
  $held = Join-Path $d 'held'
  New-Item -ItemType Directory -Path $held -Force | Out-Null
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
  if (-not (Test-RecheckScratch $Id $start $mode)) {
    Say recheck_failed $script:RC_WHY $Id
    Suspend-Finish $Id recheck_failed
  }
  Say verify_ok
  if ($until -cne 'verify') { Die 2 not_yet }
}

function Verb-__finish {
  $a = @($args)
  $ok = $a.Count -eq 1 -or ($a.Count -eq 3 -and $a[1] -ceq '--until' -and $a[2] -ceq 'verify')
  if (-not $ok) { Die 2 usage }
  Invoke-FinishSession ([string]$a[0]) @($a | Select-Object -Skip 1)
}
