# resolve, archive and status. Dot-sourced; the twin of lib/commands.sh.

$GP_GROUPS += 'commands'

# One key of held/info (matched by prefix, never executed).
function Get-HeldField([string]$Id, [string]$Key) {
  $f = Join-Path (Get-PlayerDir $Id) 'held/info'
  if (-not (Test-Path -LiteralPath $f -PathType Leaf)) { return '' }
  foreach ($line in [System.IO.File]::ReadAllText($f, [System.Text.UTF8Encoding]::new($false)).Split("`n")) {
    $line = $line.TrimEnd("`r")
    if ($line.StartsWith("$Key=", [StringComparison]::Ordinal)) { return $line.Substring($Key.Length + 1) }
  }
  return ''
}

# The tip of the branch in the held bundle. Needs PL_CLONE and PL_BRANCH.
function Get-HeldTip([string]$Id) {
  $f = Join-Path (Get-PlayerDir $Id) 'held/bundle.bundle'
  if (-not (Test-Path -LiteralPath $f -PathType Leaf)) { return '' }
  $out = @(Invoke-Git -C $script:PL_CLONE bundle list-heads $f 2> $null)
  if ($LASTEXITCODE -ne 0) { return '' }
  foreach ($line in $out) {
    $m = [regex]::Match([string]$line, '^([0-9a-f]{40}) (\S+)\z')
    if ($m.Success -and $m.Groups[2].Value -ceq "refs/heads/$($script:PL_BRANCH)") { return $m.Groups[1].Value }
  }
  return ''
}

# The number of commits in the held bundle after START, counted in a scratch repository.
function Get-HeldCount([string]$Id) {
  if (-not (Get-HeldTip $Id)) { return '?' }
  $start = Get-HeldField $Id 'start'
  if (-not [regex]::IsMatch($start, '^[0-9a-f]{40}\z')) { return '?' }
  $sc = Join-Path ([IO.Path]::GetTempPath()) ('gp-count.' + [guid]::NewGuid().ToString('N').Substring(0, 8))
  $n = '?'
  try {
    Invoke-Git init --bare -q $sc *> $null
    if ($LASTEXITCODE -eq 0) {
      $bundle = Join-Path (Get-PlayerDir $Id) 'held/bundle.bundle'
      Invoke-Git -C $sc fetch --no-tags $bundle "refs/heads/$($script:PL_BRANCH):refs/held" *> $null
      if ($LASTEXITCODE -eq 0) {
        $c = @(Invoke-Git -C $sc rev-list --count refs/held --not $start 2> $null)
        if ($LASTEXITCODE -eq 0) { $n = "$($c -join '')" }
      }
    }
  } finally {
    Remove-Item -LiteralPath $sc -Recurse -Force -ErrorAction SilentlyContinue
  }
  return $n
}

function Invoke-ResolveDiscard([string]$Id) {
  $d = Get-PlayerDir $Id
  $clone = ''
  if (Test-Path -LiteralPath (Join-Path $d 'clone') -PathType Leaf) { $clone = Read-FirstLine (Join-Path $d 'clone') }
  $n = 0
  if (Test-Path -LiteralPath (Join-Path $d 'held') -PathType Container) {
    $script:PL_CLONE = $clone
    $script:PL_BRANCH = ''
    if (Test-Path -LiteralPath (Join-Path $d 'branch') -PathType Leaf) { $script:PL_BRANCH = Read-FirstLine (Join-Path $d 'branch') }
    $n = '?'
    if ((Test-Path -LiteralPath $clone -PathType Container) -and (Test-Branch $script:PL_BRANCH)) {
      $n = Get-HeldCount $Id
    }
  }
  if (Test-Path -LiteralPath $clone -PathType Container) {
    Invoke-Git -C $clone update-ref -d refs/launcher/incoming *> $null
  }
  Invoke-Docker volume rm "geldar-ws-$Id" *> $null
  Remove-Item -LiteralPath (Join-Path $d 'held'), (Join-Path $d 'session') -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath (Join-Path $d 'start'), (Join-Path $d 'mode') -Force -ErrorAction SilentlyContinue
  Say discarded $Id $n
}

function Invoke-ResolveHeld([string]$Id) {
  $d = Get-PlayerDir $Id
  $clone = ''
  if (Test-Path -LiteralPath (Join-Path $d 'clone') -PathType Leaf) { $clone = Read-FirstLine (Join-Path $d 'clone') }
  if (-not (Test-Path -LiteralPath $clone -PathType Container)) { Die 1 no_such_player $Id $Id }
  $script:PL_CLONE = $clone
  Read-Branch $Id
  # H-01 (N13)
  $st = @(Invoke-Git -C $clone status --porcelain --untracked-files=all 2> $null)
  if ($LASTEXITCODE -ne 0 -or "$($st -join '')" -ne '') { Die 1 dirty $Id }
  $br = @(Invoke-Git -C $clone symbolic-ref -q --short HEAD 2> $null)
  if ("$($br -join '')" -cne $script:PL_BRANCH) { Die 1 branch_changed $Id }
  $start = Get-HeldField $Id 'start'
  if (-not [regex]::IsMatch($start, '^[0-9a-f]{40}\z')) { $start = '' }
  $reason = Get-HeldField $Id 'reason'
  $mode = Get-HeldField $Id 'mode'
  $tip = Get-HeldTip $Id
  $w = @(Get-GitWords -C $clone fetch origin)
  $code = Invoke-BoundedQuiet 120 @w
  if ($code -ne 0) { Die 1 pull_failed $Id 'fetch failed' }
  $remote = ''
  $rp = @(Invoke-Git -C $clone rev-parse "refs/remotes/origin/$($script:PL_BRANCH)" 2> $null)
  if ($LASTEXITCODE -eq 0) { $remote = "$($rp -join '')" }
  # ff_failed: the held commits are already on origin; bring the host branch up to them.
  if ($tip -and $remote) {
    Invoke-Git -C $clone merge-base --is-ancestor $tip $remote *> $null
    if ($LASTEXITCODE -eq 0) {
      $w = @(Get-GitWords -C $clone pull --ff-only)
      $code = Invoke-BoundedQuiet 120 @w
      if ($code -ne 0) { Die 1 pull_failed $Id 'it could not be brought up to date' }
      Invoke-Git -C $clone merge-base --is-ancestor $tip HEAD *> $null
      if ($LASTEXITCODE -ne 0) { Die 1 pull_failed $Id 'it could not be brought up to date' }
      Invoke-FinishCleanup $Id $clone
      Remove-Item -LiteralPath (Join-Path $d 'held') -Recurse -Force -ErrorAction SilentlyContinue
      Say resolved $Id
      return
    }
  }
  $hd = @(Invoke-Git -C $clone rev-parse HEAD 2> $null)
  $head = "$($hd -join '')"
  if (-not $start -or $head -cne $start) {
    if ($reason -ceq 'host_moved') { Die 3 resolve_host_changed $Id }
    Die 3 resolve_diverged $Id
  }
  if ($remote -cne $head) { Die 3 resolve_diverged $Id }
  # Still at START: retry from the held state (finish re-verifies and pushes).
  if ($mode -cne 'play' -and $mode -cne 'setup') { $mode = 'play' }
  New-PrivateDir $d
  New-PrivateDir (Join-Path $d 'session')
  $hb = Join-Path $d 'held/bundle.bundle'
  if (Test-Path -LiteralPath $hb -PathType Leaf) { Copy-Item -LiteralPath $hb -Destination (Join-Path $d 'session/bundle.bundle') -Force }
  $u = [System.Text.UTF8Encoding]::new($false)
  [System.IO.File]::WriteAllText((Join-Path $d 'start'), "$start`n", $u)
  [System.IO.File]::WriteAllText((Join-Path $d 'mode'), "$mode`n", $u)
  Invoke-FinishSession $Id @()
  Remove-Item -LiteralPath (Join-Path $d 'held') -Recurse -Force -ErrorAction SilentlyContinue
}

# resolve <id> [--discard]
function Verb-resolve {
  $a = @($args)
  $id = [string]$a[0]
  $discard = $false
  if ($a.Count -ge 2) {
    if ($a[1] -ceq '--discard' -and $a.Count -eq 2) { $discard = $true } else { Die 2 usage }
  }
  $d = Get-PlayerDir $id
  if (-not (Test-Path -LiteralPath (Join-Path $d 'clone') -PathType Leaf)) { Die 1 no_such_player $id $id }
  Lock-Acquire $id
  if ($discard) {
    Invoke-ResolveDiscard $id
    return
  }
  if (-not (Test-Path -LiteralPath (Join-Path $d 'held') -PathType Container)) { Die 1 resolve_nothing $id }
  Invoke-ResolveHeld $id
}

# archive <id>
function Verb-archive {
  $a = @($args)
  if ($a.Count -ne 1) { Die 2 usage }
  $id = [string]$a[0]
  $d = Get-PlayerDir $id
  if (-not (Test-Path -LiteralPath (Join-Path $d 'clone') -PathType Leaf)) { Die 1 no_such_player $id $id }
  Lock-Acquire $id
  if (Test-Path -LiteralPath (Join-Path $d 'held') -PathType Container) { Die 1 archive_held $id $id }
  if (Test-Path -LiteralPath (Join-Path $d 'session/running') -PathType Leaf) {
    $cid = @(Invoke-Docker ps -q --filter label=geldar.role=session --filter "label=com.docker.compose.project=geldar-$id" 2> $null)
    if ($cid.Count -gt 0 -and "$($cid -join '')" -ne '') { Die 1 locked $id }
    $have = (Test-Path -LiteralPath (Join-Path $d 'start') -PathType Leaf) -and (Test-Path -LiteralPath (Join-Path $d 'mode') -PathType Leaf)
    if ($have) {
      Invoke-Docker volume inspect "geldar-ws-$id" *> $null
      $have = $LASTEXITCODE -eq 0
    }
    if (-not $have) { Die 1 archive_held $id $id }
    Say recovering
    Invoke-FinishSession $id @()
  }
  $clone = Read-FirstLine (Join-Path $d 'clone')
  if (-not (Test-Path -LiteralPath $clone -PathType Container)) { Die 1 no_such_player $id $id }
  $script:PL_CLONE = $clone
  Read-Branch $id
  # B10: the target comes from the origin URL, by a strict pattern, and from nothing else.
  $u = @(Invoke-Git -C $clone config --get remote.origin.url 2> $null)
  $url = "$($u -join '')"
  $re = '^(https://([A-Za-z0-9._~-]+@)?|git@|ssh://git@)github\.com[:/]([A-Za-z0-9-]+)/player-' + [regex]::Escape($id) + '(\.git)?\z'
  $m = [regex]::Match($url, $re)
  if (-not $m.Success) { Die 1 archive_target $id }
  $owner = $m.Groups[3].Value
  $w = @(Get-GitWords -C $clone fetch origin)
  $code = Invoke-BoundedQuiet 120 @w
  if ($code -ne 0) { Die 1 not_pushed $id }
  $st = @(Invoke-Git -C $clone status --porcelain --untracked-files=all 2> $null)
  if ($LASTEXITCODE -ne 0 -or "$($st -join '')" -ne '') { Die 1 not_pushed $id }
  $hd = @(Invoke-Git -C $clone rev-parse HEAD 2> $null)
  $head = "$($hd -join '')"
  $remote = ''
  $rp = @(Invoke-Git -C $clone rev-parse "refs/remotes/origin/$($script:PL_BRANCH)" 2> $null)
  if ($LASTEXITCODE -eq 0) { $remote = "$($rp -join '')" }
  if (-not $head -or $head -cne $remote) { Die 1 not_pushed $id }
  if (-not [Console]::IsInputRedirected) { Say archive_confirm $id "$owner/player-$id" $id }
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { $line = '' }
  if ($line -cne "archive $id") { Die 1 archive_confirm $id "$owner/player-$id" $id }
  $gh = $env:GELDAR_GH
  if (-not $gh) { $gh = 'gh' }
  $w = @($gh, 'repo', 'archive', "$owner/player-$id", '--yes')
  $code = Invoke-BoundedQuiet 120 @w
  if ($code -ne 0) { Die 1 gh_failed $id archive }
  Invoke-Docker volume rm "geldar-ws-$id" *> $null
  # A player may have switched providers; archive removes both vendor homes.
  Invoke-Docker volume rm "geldar-cli-$id-claude" *> $null
  Invoke-Docker volume rm "geldar-cli-$id-chatgpt" *> $null
  Remove-Item -LiteralPath $d -Recurse -Force -ErrorAction SilentlyContinue
  Say archived $id
}

# The state of one player as a tab-separated line.
function Get-StatusLine([string]$Id) {
  $d = Get-PlayerDir $Id
  $cf = Join-Path $d 'clone'
  $clone = ''
  if (Test-Path -LiteralPath $cf -PathType Leaf) { $clone = Read-FirstLine $cf }
  if (-not $clone -or -not (Test-Path -LiteralPath $clone -PathType Container)) { return "$Id`tmissing" }
  $branch = ''
  if (Test-Path -LiteralPath (Join-Path $d 'branch') -PathType Leaf) { $branch = Read-FirstLine (Join-Path $d 'branch') }
  if (-not (Test-Branch $branch)) { $branch = '' }
  if (Test-Path -LiteralPath (Join-Path $d 'held') -PathType Container) {
    return "$Id`theld`t$branch`t$(Get-HeldReason $Id)"
  }
  $running = Test-Path -LiteralPath (Join-Path $d 'session/running') -PathType Leaf
  $cid = ''
  if ($running) {
    $c = @(Invoke-Docker ps -q --filter label=geldar.role=session --filter "label=com.docker.compose.project=geldar-$Id" 2> $null)
    $cid = "$($c -join '')"
  }
  $word = ''
  if ($cid) {
    $word = 'running'
  } else {
    $unfinished = $running -or (Test-Path -LiteralPath (Join-Path $d 'start') -PathType Leaf)
    if (-not $unfinished) {
      Invoke-Docker volume inspect "geldar-ws-$Id" *> $null
      $unfinished = $LASTEXITCODE -eq 0
    }
    if ($unfinished) {
      $word = 'unfinished'
    } else {
      $raw = @(Invoke-Git -C $clone show HEAD:memory/identity.md 2> $null)
      $ident = @($raw | ForEach-Object { ([string]$_).Replace("`r", '') } |
          Where-Object { $_ -notmatch '^\s*\z' -and $_ -cne '# Identity' }) -join "`n"
      if (-not $ident -or $ident -ceq 'Who you are. Written once, at your birth.') { $word = 'unborn' } else { $word = 'ready' }
    }
  }
  return "$Id`t$word`t$branch"
}

# status [<id>...]: data on stdout, no network.
function Verb-status {
  $ids = @($args | ForEach-Object { [string]$_ })
  foreach ($id in $ids) {
    if (-not (Test-PlayerId $id)) { Die 2 bad_player_id $id }
  }
  if ($ids.Count -eq 0) {
    $sd = Get-StateDir
    if (Test-Path -LiteralPath $sd -PathType Container) {
      $names = @(Get-ChildItem -LiteralPath $sd -Directory | ForEach-Object { $_.Name })
      [array]::Sort($names, [System.StringComparer]::Ordinal)
      foreach ($n in $names) {
        if (-not (Test-PlayerId $n)) { continue }
        if (-not (Test-Path -LiteralPath (Join-Path (Join-Path $sd $n) 'clone') -PathType Leaf)) { continue }
        $ids += $n
      }
    }
  }
  foreach ($id in $ids) {
    [Console]::Out.Write((Get-StatusLine $id) + "`n")
  }
}
