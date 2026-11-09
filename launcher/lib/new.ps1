# new: create a player repository from the template and record it (decision 11, 0011).
# Dot-sourced; the twin of lib/new.sh.

$GP_GROUPS += 'new'

# Sleeps n seconds; GELDAR_SLEEP replaces n under GELDAR_INTERNAL=1.
function Invoke-GpSleep([double]$Seconds) {
  $s = Get-GatedEnv 'GELDAR_SLEEP'
  if ($s -match '^[0-9.]+\z') { $Seconds = [double]::Parse($s, [cultureinfo]::InvariantCulture) }
  Start-Sleep -Seconds $Seconds
}

# The value of a key in world.conf (read as data, never sourced).
function Get-WorldConf([string]$Key) {
  $f = Join-Path (Get-ShareDir) 'config/world.conf'
  if (-not (Test-Path -LiteralPath $f -PathType Leaf)) { $f = Join-Path $GP_DIR 'config/world.conf' }
  if (-not (Test-Path -LiteralPath $f -PathType Leaf)) { return '' }
  foreach ($line in [System.IO.File]::ReadAllText($f, [System.Text.UTF8Encoding]::new($false)).Split("`n")) {
    $line = $line.TrimEnd("`r")
    if ($line.StartsWith("$Key=", [StringComparison]::Ordinal)) { return $line.Substring($Key.Length + 1) }
  }
  return ''
}

# A base address: scheme and host only; the host rules are those of Test-McpUrl.
function Test-BaseUrl([string]$Url) {
  if (-not [regex]::IsMatch($Url, '^https?://[^/@?# ]+\z')) { return $false }
  return (Test-McpUrl "$Url/p/x")
}

# Reads the token file: one line, trimmed, nothing after it. Returns the token.
function Read-TokenFile([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { Die 1 bad_token }
  $lines = [System.IO.File]::ReadAllText($Path, [System.Text.UTF8Encoding]::new($false)).Split("`n")
  for ($i = 1; $i -lt $lines.Count; $i++) {
    if ($lines[$i].TrimEnd("`r") -ne '') { Die 1 bad_token }
  }
  $line = $lines[0].TrimEnd("`r").Trim()
  if (-not [regex]::IsMatch($line, '^[A-Za-z0-9._~-]{16,200}\z')) { Die 1 bad_token }
  return $line
}

# player.json from the template with the three values replaced, line by line (not ConvertTo-Json:
# its indent and key order differ, and the diff against the template must be three lines).
function Write-PlayerJson([string]$Path, [string]$Id, [string]$Shard, [string]$Url) {
  $utf8 = [System.Text.UTF8Encoding]::new($false)
  $lines = [System.IO.File]::ReadAllText($Path, $utf8).Split("`n")
  for ($i = 0; $i -lt $lines.Count; $i++) {
    $l = $lines[$i]
    if ($l.StartsWith('  "player_id": ', [StringComparison]::Ordinal)) { $l = "  `"player_id`": `"$Id`"," }
    elseif ($l.StartsWith('  "shard": ', [StringComparison]::Ordinal)) { $l = "  `"shard`": `"$Shard`"," }
    elseif ($l.StartsWith('  "mcp_url": ', [StringComparison]::Ordinal)) { $l = "  `"mcp_url`": `"$Url`"," }
    $lines[$i] = $l
  }
  [System.IO.File]::WriteAllText("$Path.new", ($lines -join "`n"), $utf8)
  Move-Item -LiteralPath "$Path.new" -Destination $Path -Force
}

# Shard and visibility rules (0015). Returns 'private' or 'public'.
function Get-Visibility([string]$Shard, [string]$Vis, [string]$Mock) {
  $list = Get-GatedEnv 'GELDAR_PRIVATE_SHARDS_TEST'
  if (-not $list) { $list = Get-WorldConf 'private_only_shards' }
  if (-not $list) {
    Say private_list_unset
    if (-not $Mock -and -not $Vis) { Die 1 private_required $Shard }
  } else {
    foreach ($s in $list.Split([string[]]@(',', ' '), [StringSplitOptions]::RemoveEmptyEntries)) {
      if ($s -ceq $Shard -and $Vis -cne 'private') { Die 1 private_required $Shard }
    }
  }
  if ($Vis -ceq 'private') { return 'private' }
  return 'public'
}

# A file only the current user can read, restricted before the token is written into it.
function Write-TokenFile([string]$Path, [string]$Token) {
  $utf8 = [System.Text.UTF8Encoding]::new($false)
  [System.IO.File]::WriteAllText($Path, '', $utf8)
  if ($IsWindows) {
    $sid = '*' + [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    & icacls.exe $Path /inheritance:r /grant:r "${sid}:(F)" *> $null
    if ($LASTEXITCODE -ne 0) {
      Remove-Item -LiteralPath $Path -Force
      Die 1 bad_token
    }
  } else {
    [System.IO.File]::SetUnixFileMode($Path, 'UserRead,UserWrite')
  }
  [System.IO.File]::WriteAllText($Path, "$Token`n", $utf8)
}

# Runs a quiet bounded command in the given working directory; returns the exit code.
function Invoke-InDir([string]$Dir, [object[]]$Words) {
  $saved = [Environment]::CurrentDirectory
  try {
    [Environment]::CurrentDirectory = $Dir
    return (Invoke-BoundedQuiet 120 @Words)
  } finally {
    [Environment]::CurrentDirectory = $saved
  }
}

function Verb-new {
  $id = [string]$args[0]
  $more = @($args | Select-Object -Skip 1 | ForEach-Object { [string]$_ })
  $vis = ''
  $mock = ''
  $tokfile = ''
  $shard = 'commons'
  $i = 0
  while ($i -lt $more.Count) {
    $a = $more[$i]
    if ($a -ceq '--private' -or $a -ceq '--public') {
      $vis = $a.Substring(2)
      $i++
    } elseif ($a -ceq '--mock' -or $a -ceq '--token-file' -or $a -ceq '--shard') {
      if ($i + 1 -ge $more.Count) { Die 2 usage }
      switch ($a) {
        '--mock' { $mock = $more[$i + 1] }
        '--token-file' { $tokfile = $more[$i + 1] }
        '--shard' { $shard = $more[$i + 1] }
      }
      $i += 2
    } else {
      Die 2 usage
    }
  }
  if (-not [regex]::IsMatch($shard, '^[a-z][a-z0-9-]{0,30}\z')) { Die 1 bad_shard }
  if ($mock) {
    if (-not (Test-BaseUrl $mock)) { Die 1 bad_url }
    $base = $mock
  } else {
    $base = Get-WorldConf 'mcp_base'
    if (-not $base) { Die 1 no_world }
    if (-not (Test-BaseUrl $base)) { Die 1 bad_url }
  }
  $token = ''
  if ($tokfile) { $token = Read-TokenFile $tokfile }
  $newVis = Get-Visibility $shard $vis $mock
  $url = "$base/p/$id"

  $name = "player-$id"
  $players = $env:GELDAR_PLAYERS_DIR
  if (-not $players) { $players = Join-Path $HOME 'geldar-players' }
  $d = Get-PlayerDir $id
  if ((Test-Path -LiteralPath (Join-Path $players $name)) -or (Test-Path -LiteralPath (Join-Path $d 'clone'))) {
    Die 1 repo_exists $id
  }
  New-Item -ItemType Directory -Path $players -Force | Out-Null
  $gh = $env:GELDAR_GH
  if (-not $gh) { $gh = 'gh' }
  if ($newVis -cne 'private') { Say public_notice }

  $tpl = 'SandboxServers/geldar-player-template'
  if ((Invoke-InDir $players @($gh, 'repo', 'create', $name, '--template', $tpl, "--$newVis")) -ne 0) {
    Die 1 gh_failed $id 'create'
  }
  $clone = Join-Path $players $name
  $n = 0
  while ($true) {
    $n++
    $oldMask = Set-Umask 0x12 # the human's clone keeps the user's normal modes
    try { $ok = (Invoke-InDir $players @($gh, 'repo', 'clone', $name)) -eq 0 } finally { [void](Set-Umask $oldMask) }
    if ($ok -and (Test-Path -LiteralPath (Join-Path $clone '.git'))) { break }
    Remove-Item -LiteralPath $clone -Recurse -Force -ErrorAction SilentlyContinue
    if ($n -ge 5) { Die 1 clone_timeout $id }
    Invoke-GpSleep 3
  }

  Write-PlayerJson (Join-Path $clone 'player.json') $id $shard $url
  Invoke-Git -C $clone add player.json *> $null
  if ($LASTEXITCODE -ne 0) { Die 1 gh_failed $id 'add' }
  $email = "player-$id@users.noreply.github.com"
  $saved = @{}
  foreach ($k in 'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL') {
    $saved[$k] = [Environment]::GetEnvironmentVariable($k)
  }
  $env:GIT_AUTHOR_NAME = $name
  $env:GIT_AUTHOR_EMAIL = $email
  $env:GIT_COMMITTER_NAME = $name
  $env:GIT_COMMITTER_EMAIL = $email
  try {
    Invoke-Git -C $clone -c "user.name=$name" -c "user.email=$email" -c commit.gpgsign=false `
      -c tag.gpgsign=false commit -q -m "player: $id" *> $null
    $rc = $LASTEXITCODE
  } finally {
    foreach ($k in $saved.Keys) { [Environment]::SetEnvironmentVariable($k, $saved[$k]) }
  }
  if ($rc -ne 0) { Die 1 gh_failed $id 'commit' }
  $words = Get-GitWords -C $clone push -q origin HEAD
  if ((Invoke-BoundedQuiet 120 @words) -ne 0) { Die 1 gh_failed $id 'push' }

  New-PrivateDir (Get-StateDir)
  New-PrivateDir $d
  $utf8 = [System.Text.UTF8Encoding]::new($false)
  [System.IO.File]::WriteAllText((Join-Path $d 'clone'), "$clone`n", $utf8)
  $br = @(Invoke-Git -C $clone symbolic-ref --short HEAD 2> $null)
  $brText = 'main'
  if ($LASTEXITCODE -eq 0 -and $br.Count -ge 1 -and "$($br[0])" -ne '') { $brText = "$($br[0])" }
  [System.IO.File]::WriteAllText((Join-Path $d 'branch'), "$brText`n", $utf8)
  if ($token) { Write-TokenFile (Join-Path $d 'token') $token }
  Say created $id $id
}
