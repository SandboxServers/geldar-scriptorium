# upgrade <id> [--to <version>]: move a player's kit files to a release as a pull request (0008).
# Dot-sourced; the twin of lib/upgrade.sh. The fetched release is hostile input: every field is
# validated, nothing from it is evaluated, every command takes an argument array, and memory/,
# skills/ and the identity are never touched.

# No $GP_GROUPS entry: upgrade is a test group, not a --capabilities group (the bash twin adds none).

$script:UP_TEMPLATE = 'https://github.com/SandboxServers/geldar-player-template.git'
$script:UP_SEMVER = '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.]+)?\z'
$script:UP_SKIP = @('memory', 'skills', '.git', 'player.json')

# Like Invoke-BoundedQuiet, but the command's standard output goes to a file that is read back.
# Returns @{ Code; Text }. Past the limit the whole tree is killed (Code 124).
function Invoke-BoundedOut([int]$Secs, [object[]]$Words) {
  $f = Join-Path ([IO.Path]::GetTempPath()) ('gp-out.' + [guid]::NewGuid().ToString('N').Substring(0, 12))
  $env:GP_OUT_CMD = ConvertTo-Json -InputObject @($Words | ForEach-Object { [string]$_ }) -Compress
  $env:GP_OUT_FILE = $f
  $cmd = '$a = @($env:GP_OUT_CMD | ConvertFrom-Json -DateKind String); $e = $a[0]; $r = @($a | Select-Object -Skip 1); & $e @r 2> $null > $env:GP_OUT_FILE; exit $LASTEXITCODE'
  try {
    $code = Invoke-Bounded $Secs ([Environment]::ProcessPath) -NoProfile -NonInteractive -Command $cmd
    $text = ''
    if (Test-Path -LiteralPath $f -PathType Leaf) { $text = [System.IO.File]::ReadAllText($f, [System.Text.UTF8Encoding]::new($false)) }
    return @{ Code = [int]$code; Text = $text }
  } finally {
    $env:GP_OUT_CMD = $null
    $env:GP_OUT_FILE = $null
    Remove-Item -LiteralPath $f -Force -ErrorAction SilentlyContinue
  }
}

# A git command in a directory, bounded, with output.
function Invoke-GitOut([string]$Dir, [int]$Secs, [string[]]$GitArgs) {
  $w = @(Get-GitWords -C $Dir) + @($GitArgs)
  return (Invoke-BoundedOut $Secs $w)
}

function Invoke-GitQuiet([string]$Dir, [string[]]$GitArgs) {
  $w = @(Get-GitWords -C $Dir) + @($GitArgs)
  return (Invoke-BoundedQuiet 120 @w)
}

function Split-Kit([string]$V) {
  $plus = $V.IndexOf('+')
  if ($plus -ge 0) { $V = $V.Substring(0, $plus) }
  $pre = ''
  $h = $V.IndexOf('-')
  if ($h -ge 0) {
    $pre = $V.Substring($h + 1)
    $V = $V.Substring(0, $h)
  }
  $core = @([System.Numerics.BigInteger]::Zero, [System.Numerics.BigInteger]::Zero, [System.Numerics.BigInteger]::Zero)
  $parts = $V.Split('.')
  for ($i = 0; $i -lt 3 -and $i -lt $parts.Count; $i++) {
    if ($parts[$i] -match '^[0-9]+\z') { $core[$i] = [System.Numerics.BigInteger]::Parse($parts[$i]) }
  }
  return @{ Core = $core; Pre = $pre }
}

# -1, 0 or 1. Core numbers first (numeric), then a release beats its prerelease, then the prerelease
# identifiers (Compare-KitPre).
function Compare-Kit([string]$A, [string]$B) {
  $pa = Split-Kit $A
  $pb = Split-Kit $B
  for ($i = 0; $i -lt 3; $i++) {
    $c = $pa.Core[$i].CompareTo($pb.Core[$i])
    if ($c -ne 0) { return [Math]::Sign($c) }
  }
  if ($pa.Pre -ceq $pb.Pre) { return 0 }
  if ($pa.Pre -eq '') { return 1 }
  if ($pb.Pre -eq '') { return -1 }
  return Compare-KitPre $pa.Pre $pb.Pre
}

# -1, 0 or 1 for two identifiers: a trailing number splits off its name, so rc10 is after rc9 (the
# template's tags are rc<N>); any other identifiers compare ordinally.
function Compare-KitId([string]$A, [string]$B) {
  $ma = [regex]::Match($A, '^(.*[^0-9])?([0-9]+)$')
  $mb = [regex]::Match($B, '^(.*[^0-9])?([0-9]+)$')
  if ($ma.Success -and $mb.Success -and $ma.Groups[1].Value -ceq $mb.Groups[1].Value) {
    return [Math]::Sign(([bigint]$ma.Groups[2].Value).CompareTo([bigint]$mb.Groups[2].Value))
  }
  return [Math]::Sign([string]::CompareOrdinal($A, $B))
}

# -1, 0 or 1 for two prereleases: their dot-separated identifiers in turn, then the count (fewer is lower).
function Compare-KitPre([string]$A, [string]$B) {
  if ($A -ceq $B) { return 0 }
  $x = @($A.Split('.'))
  $y = @($B.Split('.'))
  for ($i = 0; $i -lt [Math]::Min($x.Count, $y.Count); $i++) {
    $c = Compare-KitId $x[$i] $y[$i]
    if ($c -ne 0) { return $c }
  }
  return [Math]::Sign($x.Count - $y.Count)
}

# The newest of the given versions: the newest stable one, or the newest prerelease when none is stable.
# Returns '' for an empty list.
function Get-NewestKit([string[]]$Versions) {
  $best = ''
  $bestPre = ''
  foreach ($v in $Versions) {
    if ($v.Contains('-')) {
      if ($bestPre -eq '' -or (Compare-Kit $v $bestPre) -gt 0) { $bestPre = $v }
    } elseif ($best -eq '' -or (Compare-Kit $v $best) -gt 0) {
      $best = $v
    }
  }
  if ($best) { return $best }
  return $bestPre
}

function Get-TemplateUrl {
  $u = Get-GatedEnv 'GELDAR_TEMPLATE_URL'
  if ($u) { return $u }
  return $script:UP_TEMPLATE
}

# The versions of the template's kit-v tags that pass the strict pattern (a hostile name is ignored).
function Get-ReleaseVersions([string]$Url) {
  $w = @(Get-GitWords ls-remote --tags --refs $Url 'refs/tags/kit-v*')
  $r = Invoke-BoundedOut 60 $w
  if ($r.Code -ne 0) { return @() }
  $out = @()
  $re = '^[0-9a-f]{40,64}\trefs/tags/kit-v((0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.]+)?)\z'
  foreach ($line in $r.Text.Split("`n")) {
    $m = [regex]::Match($line.TrimEnd("`r"), $re)
    if ($m.Success) { $out += $m.Groups[1].Value }
  }
  return $out
}

# The kit_version in the committed player.json of the player's clone.
function Get-HeadKitVersion([string]$Clone) {
  $r = Invoke-GitOut $Clone 60 @('show', 'HEAD:player.json')
  if ($r.Code -ne 0) { return $null }
  try { $j = $r.Text | ConvertFrom-Json -DateKind String -ErrorAction Stop } catch { return $null }
  $p = $j.PSObject.Properties['kit_version']
  if ($null -eq $p -or $p.Value -isnot [string]) { return $null }
  return [string]$p.Value
}

# A path component is safe to create on any host: no dot entries, no .git in any spelling, no
# control or reserved characters.
function Test-SafeComponent([string]$C) {
  if ($C -eq '' -or $C -eq '.' -or $C -eq '..') { return $false }
  if ([regex]::IsMatch($C, '[\x00-\x1F\x7F-\x9F\\:*?"<>|]')) { return $false }
  $t = $C.TrimEnd('.', ' ')
  if ($t -ieq '.git' -or $t -ilike 'git~*') { return $false }
  return $true
}

# Validates the fetched release (a clone with no checkout). Returns the file list, the digest and
# the image, or $null when anything fails.
function Get-ValidRelease([string]$Dir, [string]$Version) {
  $r = Invoke-GitOut $Dir 60 @('ls-tree', '-r', '-z', '-l', 'HEAD')
  if ($r.Code -ne 0) { return $null }
  $files = @()
  $total = [long]0
  foreach ($rec in $r.Text.Split([char]0)) {
    if ($rec.Trim() -eq '') { continue }
    $m = [regex]::Match($rec.TrimStart("`r", "`n"), '^(\d{6}) (blob|commit|tree) [0-9a-f]{40,64} +(\d+|-)\t(.+)\z', 'Singleline')
    if (-not $m.Success) { return $null }
    $mode = $m.Groups[1].Value
    if ($mode -cne '100644' -and $mode -cne '100755') { return $null }
    if ($m.Groups[2].Value -cne 'blob') { return $null }
    $path = $m.Groups[4].Value
    $comps = $path.Split('/')
    foreach ($c in $comps) { if (-not (Test-SafeComponent $c)) { return $null } }
    if (-not [regex]::IsMatch($comps[0], '^[A-Za-z0-9._-]+\z')) { return $null }
    $total += [long]$m.Groups[3].Value
    $files += , @($path, $mode)
    if ($files.Count -gt 200 -or $total -gt 5MB) { return $null }
  }
  if ($files.Count -eq 0) { return $null }
  if (Test-ExportAttrs $Dir 'HEAD') { return $null }
  # player.json: the same shape the launcher reads from a player, and bound to this tag.
  $pj = Invoke-GitOut $Dir 60 @('show', 'HEAD:player.json')
  if ($pj.Code -ne 0) { return $null }
  $keys = 'player_id', 'name', 'shard', 'mcp_url', 'harness', 'declared_model', 'kit_version', 'kit_image'
  foreach ($k in $keys) {
    if ([regex]::Matches($pj.Text, '"' + $k + '"\s*:').Count -ne 1) { return $null }
  }
  try { $j = $pj.Text | ConvertFrom-Json -DateKind String -ErrorAction Stop } catch { return $null }
  $v = @{}
  foreach ($k in $keys) {
    $p = $j.PSObject.Properties[$k]
    if ($null -eq $p -or $p.Value -isnot [string] -or [regex]::IsMatch($p.Value, '[\x00-\x1F\x7F-\x9F]')) { return $null }
    $v[$k] = [string]$p.Value
  }
  if ($v['kit_version'] -cne $Version) { return $null }
  if (-not (Test-KitImage $v['kit_image'])) { return $null }
  # S6: only the kit repository the printed cosign command checks.
  if (-not $v['kit_image'].StartsWith('ghcr.io/sandboxservers/geldar-kit@sha256:', [StringComparison]::Ordinal)) { return $null }
  $digest = $v['kit_image'].Substring($v['kit_image'].IndexOf('@') + 1)
  $lg = Invoke-GitOut $Dir 60 @('log', '-1', '--format=%B', 'HEAD')
  if ($lg.Code -ne 0) { return $null }
  $lines = @($lg.Text.Replace("`r", '').TrimEnd("`n").Split("`n"))
  if ($lines.Count -lt 3) { return $null }
  $t = @($lines | Select-Object -Last 3)
  if (-not [regex]::IsMatch($t[0], '^template: [0-9a-f]{40}\z')) { return $null }
  if (-not [regex]::IsMatch($t[2], '^launcher: [0-9A-Za-z.+-]{1,64}\z')) { return $null }
  if ($t[1] -cne "image: $digest") { return $null }
  return @{ Files = $files; Digest = $digest; Image = $v['kit_image'] }
}

# Sets the two keys in player.json text and nothing else; $null when a key is not there once.
function Set-KitKeys([string]$Text, [string]$Version, [string]$Image) {
  foreach ($pair in @(@('kit_version', $Version), @('kit_image', $Image))) {
    $re = [regex]('("' + $pair[0] + '"\s*:\s*)"[^"\\]*"')
    $val = [string]$pair[1]
    if (-not $re.IsMatch($Text)) { return $null }
    $ev = [System.Text.RegularExpressions.MatchEvaluator] { param($m) $m.Groups[1].Value + '"' + $val + '"' }
    $Text = $re.Replace($Text, $ev, 1)
  }
  return $Text
}

# Writes the upgrade branch in the host clone and commits it. Returns '' on success, else a reason.
# On any failure the branch and the files are gone and the clone is back on its branch.
function Write-UpgradeBranch([string]$Clone, [string]$Branch, [string]$Version, [string]$Tmp, $Rel) {
  $utf8 = [System.Text.UTF8Encoding]::new($false)
  $branchName = "kit-upgrade/$Version"
  Invoke-Git -C $Clone checkout -q -b $branchName *> $null
  if ($LASTEXITCODE -ne 0) { return 'checkout' }
  $why = ''
  try {
    $ls = Invoke-GitOut $Clone 60 @('ls-tree', '-z', '--name-only', 'HEAD')
    if ($ls.Code -ne 0) { throw 'ls-tree' }
    foreach ($n in $ls.Text.Split([char]0)) {
      $n = $n.Trim("`r", "`n")
      if ($n -eq '' -or $script:UP_SKIP -contains $n) { continue }
      Invoke-Git -C $Clone rm -r -q -f --ignore-unmatch -- $n *> $null
      if ($LASTEXITCODE -ne 0) { throw 'rm' }
    }
    $root = [IO.Path]::GetFullPath($Clone).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
    foreach ($f in $Rel.Files) {
      $path = [string]$f[0]
      if ($script:UP_SKIP -contains $path.Split('/')[0]) { continue }
      $dest = [IO.Path]::GetFullPath((Join-Path $Clone $path))
      if (-not $dest.StartsWith($root, [StringComparison]::Ordinal)) { throw 'path' }
      New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($dest)) -Force | Out-Null
      [System.IO.File]::Copy((Join-Path $Tmp $path), $dest, $true)
    }
    $pjPath = Join-Path $Clone 'player.json'
    $old = [System.IO.File]::ReadAllText($pjPath, $utf8)
    $new = Set-KitKeys $old $Version $Rel.Image
    if ($null -eq $new) { throw 'player.json' }
    [System.IO.File]::WriteAllText($pjPath, $new, $utf8)
    Invoke-Git -C $Clone add -A *> $null
    if ($LASTEXITCODE -ne 0) { throw 'add' }
    foreach ($f in $Rel.Files) {
      $top = ([string]$f[0]).Split('/')[0]
      if ($f[1] -ceq '100755' -and -not ($script:UP_SKIP -contains $top)) {
        Invoke-Git -C $Clone update-index --chmod=+x -- ([string]$f[0]) *> $null
      }
    }
    # The self-check: nothing under memory/ or skills/, and player.json differs in the two keys only.
    $d = Invoke-GitOut $Clone 60 @('diff', '--cached', '--name-only', '-z', 'HEAD')
    if ($d.Code -ne 0) { throw 'diff' }
    foreach ($n in $d.Text.Split([char]0)) {
      $n = $n.Trim("`r", "`n")
      if ($n.StartsWith('memory/', [StringComparison]::Ordinal) -or $n.StartsWith('skills/', [StringComparison]::Ordinal)) { throw 'self-check' }
    }
    $a = $old | ConvertFrom-Json -DateKind String
    $b = $new | ConvertFrom-Json -DateKind String
    $names = @($a.PSObject.Properties.Name) + @($b.PSObject.Properties.Name) | Select-Object -Unique
    foreach ($k in $names) {
      if ($k -ceq 'kit_version' -or $k -ceq 'kit_image') { continue }
      if ("$($a.PSObject.Properties[$k].Value)" -cne "$($b.PSObject.Properties[$k].Value)") { throw 'self-check' }
    }
    Invoke-Git -C $Clone -c commit.gpgsign=false -c tag.gpgsign=false commit -q -m "upgrade the kit to $Version" -m "image: $($Rel.Digest)" *> $null
    if ($LASTEXITCODE -ne 0) { throw 'commit' }
  } catch {
    $why = "$_"
    if ($why -eq '') { $why = 'failed' }
  }
  if ($why -ne '') {
    Invoke-Git -C $Clone reset -q --hard HEAD *> $null
    Invoke-Git -C $Clone clean -q -fd *> $null
    Invoke-Git -C $Clone checkout -q $Branch *> $null
    Invoke-Git -C $Clone branch -q -D $branchName *> $null
  }
  return $why
}

# Fetches and validates the release, then builds the branch. Returns the release and the changed
# files, or $null when the release was refused (nothing changed).
function Get-UpgradeBranch([string]$Clone, [string]$Branch, [string]$Version, [string]$Url) {
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ('gp-up.' + [guid]::NewGuid().ToString('N').Substring(0, 12))
  $empty = Join-Path ([IO.Path]::GetTempPath()) ('gp-hk.' + [guid]::NewGuid().ToString('N').Substring(0, 12))
  New-Item -ItemType Directory -Path $empty -Force | Out-Null
  $result = $null
  try {
    $gitExe = $env:GELDAR_GIT
    if (-not $gitExe) { $gitExe = 'git' }
    $env:GIT_NO_REPLACE_OBJECTS = '1'
    $env:GIT_TERMINAL_PROMPT = '0'
    $cfg = @('-c', "core.hooksPath=$empty", '-c', 'fetch.fsckObjects=true', '-c', 'transfer.fsckObjects=true', '-c', 'core.autocrlf=false')
    $cl = @($gitExe) + $cfg + @('clone', '-q', '--depth', '1', '--no-checkout', '--branch', "kit-v$Version", '--', $Url, $tmp)
    if ((Invoke-BoundedQuiet 120 @cl) -ne 0) { return $null }
    $rel = Get-ValidRelease $tmp $Version
    if ($null -eq $rel) { return $null }
    $co = @($gitExe) + $cfg + @('-C', $tmp, 'checkout', '-q', 'HEAD', '--', '.')
    if ((Invoke-BoundedQuiet 120 @co) -ne 0) { return $null }
    $nb = "kit-upgrade/$Version"
    if (-not (Test-Branch $nb)) { return $null }
    Invoke-Git -C $Clone show-ref --verify --quiet "refs/heads/$nb" *> $null
    $exists = $LASTEXITCODE -eq 0
    Invoke-Git -C $Clone show-ref --verify --quiet "refs/remotes/origin/$nb" *> $null
    if ($exists -or $LASTEXITCODE -eq 0) { Die 1 upgrade_branch_exists $nb }
    if (Write-UpgradeBranch $Clone $Branch $Version $tmp $rel) { return $null }
    $dn = Invoke-GitOut $Clone 60 @('diff', '--name-only', "${Branch}..${nb}")
    $names = @($dn.Text.Replace("`r", '').Split("`n") | Where-Object { $_ } | Select-Object -First 40 | ForEach-Object { Sanitize $_ })
    Invoke-Git -C $Clone checkout -q $Branch *> $null
    $result = @{ Rel = $rel; Files = ($names -join ', ') }
  } finally {
    Remove-Item -LiteralPath $tmp, $empty -Recurse -Force -ErrorAction SilentlyContinue
  }
  return $result
}

function Verb-upgrade {
  $a = @($args)
  $id = [string]$a[0]
  $to = ''
  if ($a.Count -eq 3 -and $a[1] -ceq '--to') {
    $to = [string]$a[2]
    if (-not [regex]::IsMatch($to, $script:UP_SEMVER)) { Die 2 usage }
  } elseif ($a.Count -ne 1) {
    Die 2 usage
  }
  Read-Player $id
  $clone = $script:PL_CLONE
  $branch = $script:PL_BRANCH
  Lock-Acquire $id
  $d = Get-PlayerDir $id
  if (Test-Path -LiteralPath (Join-Path $d 'held') -PathType Container) { Die 1 upgrade_held }
  if (Test-Path -LiteralPath (Join-Path $d 'session/running') -PathType Leaf) { Die 1 locked $id }

  # H-01 and H-02
  $st = @(Invoke-Git -C $clone status --porcelain --untracked-files=all 2> $null)
  if ($LASTEXITCODE -ne 0 -or "$($st -join '')" -ne '') { Die 1 upgrade_dirty }
  $br = @(Invoke-Git -C $clone symbolic-ref -q --short HEAD 2> $null)
  if ("$($br -join '')" -cne $branch) { Die 1 upgrade_dirty }
  if ((Invoke-GitQuiet $clone @('pull', '--ff-only')) -ne 0) { Die 1 upgrade_dirty }

  # The target: --to, or the newest stable release (the newest prerelease only when there is none).
  $url = Get-TemplateUrl
  $all = @(Get-ReleaseVersions $url)
  $version = ''
  if ($to) {
    if ($all -contains $to) { $version = $to }
  } else {
    $version = Get-NewestKit $all
  }
  if (-not $version) { Die 1 upgrade_no_release }
  $cur = Get-HeadKitVersion $clone
  if ($null -eq $cur) { Die 1 upgrade_dirty }
  $cmp = Compare-Kit $version $cur
  if ($cmp -eq 0) {
    Say upgrade_current $version
    return
  }
  if ($cmp -lt 0) { Die 1 upgrade_downgrade $version $cur }

  $up = Get-UpgradeBranch $clone $branch $version $url
  if ($null -eq $up) { Die 1 upgrade_bad_release $version }
  $rel = $up.Rel

  # Push the branch (never the player branch, never forced), then the pull request.
  $nb = "kit-upgrade/$version"
  $ref = "refs/heads/$nb"
  $push = @(Get-GitWords -C $clone push -q origin "${ref}:${ref}")
  if ((Invoke-BoundedQuiet 120 @push) -ne 0) {
    Invoke-Git -C $clone branch -q -D $nb *> $null
    Die 1 pull_failed $id 'the upgrade branch could not be pushed'
  }
  # The branch lives on the remote; the host clone keeps only its own branch.
  Invoke-Git -C $clone branch -q -D $nb *> $null
  $verify = Format-Msg $script:GP_MSG['upgrade_verify'] @($rel.Digest)
  $body = "Moves the kit files from $cur to $version.`nImage: $($rel.Digest)`nFiles changed: $($up.Files)`n$verify`n"
  $bf = Join-Path ([IO.Path]::GetTempPath()) ('gp-body.' + [guid]::NewGuid().ToString('N').Substring(0, 12))
  [System.IO.File]::WriteAllText($bf, $body, [System.Text.UTF8Encoding]::new($false))
  $gh = $env:GELDAR_GH
  if (-not $gh) { $gh = 'gh' }
  $saved = [Environment]::CurrentDirectory
  try {
    [Environment]::CurrentDirectory = $clone
    $pr = Invoke-BoundedOut 60 @($gh, 'pr', 'create', '--base', $branch, '--head', $nb, '--title', "Upgrade the kit to $version", '--body-file', $bf)
  } finally {
    [Environment]::CurrentDirectory = $saved
    Remove-Item -LiteralPath $bf -Force -ErrorAction SilentlyContinue
  }
  $line = ''
  foreach ($l in $pr.Text.Replace("`r", '').Split("`n")) { if ($l.Trim()) { $line = $l } }
  if ($pr.Code -ne 0 -or -not $line) { Die 1 upgrade_pr_failed $nb }
  Say upgrade_done $version (Sanitize $line)
}
