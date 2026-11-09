# Before the session: clean clone, START, kit export, isolated workspace (H-01 to H-05).
# Dot-sourced; the twin of lib/prepare.sh. State lives under <state>/<id>/.

$script:PREP_ID = ''
$script:PREP_OWNS = $false
$script:PREP_VOL = $false

# A refusal after H-03 leaves no start, mode or running file and no volume this run made.
function Invoke-PrepareCleanup {
  if (-not $script:PREP_OWNS) { return }
  $d = Get-PlayerDir $script:PREP_ID
  foreach ($f in 'start', 'mode', 'session/running') {
    Remove-Item -LiteralPath (Join-Path $d $f) -Force -ErrorAction SilentlyContinue
  }
  if ($script:PREP_VOL) { Invoke-Docker volume rm "geldar-ws-$($script:PREP_ID)" *> $null }
  $script:PREP_OWNS = $false
  $script:PREP_VOL = $false
}

# Runs Invoke-Bounded on a child pwsh that discards the command's output, so text from git or
# docker is never printed raw. The command travels as JSON in an environment variable (no
# quoting). Returns the exit code, or 124 on expiry (Invoke-Bounded kills the whole tree).
function Invoke-BoundedQuiet {
  $rest = @($args)
  $secs = $rest[0]
  $rest = @($rest | Select-Object -Skip 1)
  $pre = @()
  if ($rest.Count -ge 2 -and $rest[0] -eq '--container') {
    $pre = @('--container', $rest[1])
    $rest = @($rest | Select-Object -Skip 2)
  }
  $env:GP_QUIET_CMD = ConvertTo-Json -InputObject @($rest | ForEach-Object { [string]$_ }) -Compress
  $cmd = '$a = @($env:GP_QUIET_CMD | ConvertFrom-Json); $e = $a[0]; $r = @($a | Select-Object -Skip 1); & $e @r *> $null; exit $LASTEXITCODE'
  try {
    return (Invoke-Bounded $secs @pre ([Environment]::ProcessPath) -NoProfile -NonInteractive -Command $cmd)
  } finally {
    $env:GP_QUIET_CMD = $null
  }
}

# A docker run for a helper role. Every flag the harness audit and the fake expect is here. The
# script is one line without double quotes (it must survive a cmd.exe shim as one argument).
function Invoke-HelperRun([string]$Role, [string]$Name, [string]$Image, [string[]]$Opts, [string]$Script) {
  $exe = $env:GELDAR_DOCKER
  if (-not $exe) { $exe = 'docker' }
  $a = @('run', '--rm', '--label', "geldar.role=$Role", '--name', $Name,
    '--memory', '1g', '--pids-limit', '256', '--log-driver', 'none',
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '-e', 'HOME=/tmp', '-e', 'GIT_CONFIG_GLOBAL=/dev/null', '-e', 'GIT_CONFIG_NOSYSTEM=1', '-e', 'GIT_NO_REPLACE_OBJECTS=1') +
    $Opts + @($Image, 'sh', '-c', $Script)
  return (Invoke-BoundedQuiet 120 --container $Name $exe @a)
}

$script:WS_CHECK = 'test -z $(git -C /player remote) || exit 1; ' +
  'test -z $(ls -A /player/.git/refs/remotes 2> /dev/null) || exit 1; ' +
  'if git -C /player config --local --list | grep -E -q ''^branch\..*\.remote=''; then exit 1; fi; ' +
  'if sed ''s#/in/start\.bundle##g'' /player/.git/config | grep -E -q ''(^|[=[:space:][:punct:]])/[^[:space:]]|[A-Za-z]:[/\\]''; then exit 1; fi; ' +
  'exit 0'

$script:WS_INIT = 'set -e; git clone --no-local --no-hardlinks -c core.autocrlf=false -b $GELDAR_BRANCH /in/start.bundle /tmp/c; ' +
  'cp -a /tmp/c/. /player/; git -C /player remote remove origin'

# On success the session directory holds export/, start.bundle and running, the volume
# geldar-ws-<id> holds the workspace, and PL_* hold player.json at START.
function Invoke-PrepareSession([string]$Id, [string]$Mode) {
  if ($Mode -cne 'play' -and $Mode -cne 'setup') { Die 2 usage }
  Assert-NotHeld $Id
  $d = Get-PlayerDir $Id
  $sd = Join-Path $d 'session'
  $script:PREP_ID = $Id
  try {
    Invoke-PrepareBody $Id $Mode $d $sd
  } finally {
    Invoke-PrepareCleanup
  }
}

function Invoke-PrepareBody([string]$Id, [string]$Mode, [string]$d, [string]$sd) {
  # H-03 (guard): a start with a running session is crash recovery, not a new launch.
  if ((Test-Path -LiteralPath (Join-Path $d 'start')) -and (Test-Path -LiteralPath (Join-Path $sd 'running'))) {
    Die 1 unfinished $Id $Id
  }
  $cf = Join-Path $d 'clone'
  if (-not (Test-Path -LiteralPath $cf -PathType Leaf)) { Die 1 no_such_player $Id $Id }
  $clone = Read-FirstLine $cf
  if (-not (Test-Path -LiteralPath $clone -PathType Container)) { Die 1 no_such_player $Id $Id }
  Read-Branch $Id
  $branch = $script:PL_BRANCH

  # H-01
  $st = @(Invoke-Git -C $clone status --porcelain --untracked-files=all 2> $null)
  if ($LASTEXITCODE -ne 0 -or $st.Count -gt 0) { Die 1 dirty $Id }
  $cur = @(Invoke-Git -C $clone symbolic-ref -q --short HEAD 2> $null)
  if ($LASTEXITCODE -ne 0 -or $cur.Count -ne 1 -or [string]$cur[0] -cne $branch) { Die 1 branch_changed $Id }

  $hook = Get-GatedEnv 'GELDAR_TEST_HOOK_AFTER_CLEAN'
  if ($hook) {
    Push-Location -LiteralPath $clone
    try { & sh $hook } finally { Pop-Location }
  }

  # H-02
  $gitExe = $env:GELDAR_GIT
  if (-not $gitExe) { $gitExe = 'git' }
  $hooks = Join-Path (Get-StateDir) 'empty-hooks'
  New-PrivateDir (Get-StateDir)
  New-PrivateDir $hooks
  $env:GIT_NO_REPLACE_OBJECTS = '1'
  $env:GIT_TERMINAL_PROMPT = '0'
  # The human's clone keeps the user's normal modes: the pull runs under umask 022.
  $oldMask = Set-Umask 0x12
  try {
    $rc = Invoke-BoundedQuiet 120 $gitExe -c "core.hooksPath=$hooks" -C $clone pull --ff-only
  } finally { [void](Set-Umask $oldMask) }
  if ($rc -ne 0) {
    $tag = "git exit status $rc"
    if ($rc -eq 124) { $tag = 'timed out' }
    Die 1 pull_failed $Id (Sanitize $tag)
  }

  # H-03
  $startOut = @(Invoke-Git -C $clone rev-parse HEAD 2> $null)
  $start = ''
  if ($LASTEXITCODE -eq 0 -and $startOut.Count -eq 1) { $start = [string]$startOut[0] }
  if (-not [regex]::IsMatch($start, '^[0-9a-f]{40}\z')) { Die 1 pull_failed $Id 'no commit' }
  New-PrivateDir $d
  New-PrivateDir $sd
  $utf8 = [System.Text.UTF8Encoding]::new($false)
  [System.IO.File]::WriteAllText((Join-Path $d 'start'), "$start`n", $utf8)
  [System.IO.File]::WriteAllText((Join-Path $d 'mode'), "$Mode`n", $utf8)
  $script:PREP_OWNS = $true
  if ($Mode -ceq 'setup') {
    # Born only counts after the pull: a stale clone must not run setup on a born player.
    $idt = @(Invoke-Git -C $clone show "${start}:memory/identity.md" 2> $null)
    $kept = @($idt | ForEach-Object { ([string]$_).TrimEnd("`r") } |
        Where-Object { $_ -notmatch '^\s*\z' -and $_ -cne '# Identity' })
    if ($kept.Count -ne 1 -or $kept[0] -cne 'Who you are. Written once, at your birth.') { Die 1 already_born $Id }
  }
  # The validated values belong to the exported commit (N4).
  Read-Player $Id $start
  Say start_recorded $start.Substring(0, 12)

  # A drive letter's colon is fine on Windows; no other colon, comma or control character is.
  $chk = [regex]::Replace($sd, '^[A-Za-z]:(?=[\\/])', '')
  if ([regex]::IsMatch($chk, '[\x00-\x1F\x7F:,]')) { Die 1 bad_state_path }

  # H-04
  if (Test-ExportAttrs $clone $start) { Die 1 export_attributes $Id }
  $exp = Join-Path $sd 'export'
  foreach ($x in 'export', 'start.bundle', 'running', 'export.tar') {
    Remove-Item -LiteralPath (Join-Path $sd $x) -Recurse -Force -ErrorAction SilentlyContinue
  }
  New-Item -ItemType Directory -Path $exp -Force | Out-Null
  $lsRaw = (@(Invoke-Git -C $clone ls-tree -z --name-only $start 2> $null)) -join "`n"
  if ($LASTEXITCODE -ne 0) { Die 1 workspace_failed $Id 'the kit files could not be listed' }
  $entries = @($lsRaw.Split([char]0) | Where-Object { $_ -ne '' -and $_ -cne 'memory' -and $_ -cne 'skills' } |
      ForEach-Object { ":(literal)$_" })
  if ($entries.Count -gt 0) {
    # A committed symlink must never reach a host-side mount; check the tree itself too.
    $tree = (@(Invoke-Git -C $clone ls-tree -r -z $start -- @entries 2> $null)) -join "`n"
    if ($tree -match '(^|\x00)120000 ') { Die 1 export_symlink $Id }
    $tarFile = Join-Path $sd 'export.tar'
    Invoke-Git -C $clone archive --format=tar -o $tarFile $start -- @entries *> $null
    $gitRc = $LASTEXITCODE
    $tarRc = 1
    if ($gitRc -eq 0) {
      Push-Location -LiteralPath $sd
      try {
        & tar -x -f export.tar -C export *> $null
        $tarRc = $LASTEXITCODE
      } finally { Pop-Location }
    }
    Remove-Item -LiteralPath $tarFile -Force -ErrorAction SilentlyContinue
    # The container reads export/ as uid 1000 through bind mounts: a+rX after the umask-077 extraction.
    if ($gitRc -eq 0 -and $tarRc -eq 0 -and -not $IsWindows) { & chmod -R a+rX $exp *> $null }
    if ($gitRc -ne 0 -or $tarRc -ne 0) { Die 1 workspace_failed $Id 'the kit files could not be exported' }
  }
  foreach ($item in (Get-ChildItem -LiteralPath $exp -Recurse -Force)) {
    if ($item.LinkType -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { Die 1 export_symlink $Id }
  }
  Invoke-Git -C $clone bundle create (Join-Path $sd 'start.bundle') "refs/heads/$branch" *> $null
  if ($LASTEXITCODE -ne 0) { Die 1 workspace_failed $Id 'the start bundle could not be made' }

  # H-05
  $vol = "geldar-ws-$Id"
  Invoke-Docker volume inspect $vol *> $null
  if ($LASTEXITCODE -eq 0) {
    Invoke-Docker volume rm $vol *> $null
    if ($LASTEXITCODE -ne 0) { Die 1 workspace_exists $Id $Id }
  }
  Invoke-Docker volume create $vol *> $null
  if ($LASTEXITCODE -ne 0) { Die 1 workspace_failed $Id 'the volume could not be created' }
  $script:PREP_VOL = $true
  $name = "geldar-workspace-init-$Id-$PID"
  $stage = New-StagedBundle (Join-Path $sd 'start.bundle') 'start.bundle'
  if (-not $stage) { Die 1 workspace_failed $Id 'the start bundle could not be staged' }
  try {
    $rc = Invoke-HelperRun 'workspace-init' $name $script:PL_KIT_IMAGE @('-e', "GELDAR_BRANCH=$branch", '-v', "$($stage.Replace([char]92, [char]47)):/in:ro", '-v', "${vol}:/player") $script:WS_INIT
  } finally {
    Remove-StagedBundle $stage
  }
  if ($rc -ne 0) {
    $why = 'it failed'
    if ($rc -eq 124) { $why = 'timed out' }
    Die 1 workspace_failed $Id $why
  }
  $rc = Invoke-HelperRun 'workspace-init' "$name-check" $script:PL_KIT_IMAGE @('-v', "${vol}:/player:ro") $script:WS_CHECK
  if ($rc -ne 0) { Die 1 host_path_in_workspace $Id }

  [System.IO.File]::WriteAllText((Join-Path $sd 'running'), "$PID`n", $utf8)
  $script:PREP_OWNS = $false
  $script:PREP_VOL = $false
}

function Verb-__prepare {
  if ($args.Count -ne 2) { Die 2 usage }
  Invoke-PrepareSession ([string]$args[0]) ([string]$args[1])
}
