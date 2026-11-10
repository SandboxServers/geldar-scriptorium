# new: create a player repository from the template and record it (decision 11, 0011).
# Dot-sourced; the twin of lib/new.sh.

$GP_GROUPS += 'new'

# Sleeps n seconds; GELDAR_SLEEP replaces n under GELDAR_INTERNAL=1.
function Invoke-GpSleep([double]$Seconds) {
  $s = Get-GatedEnv 'GELDAR_SLEEP'
  if ($s -match '^[0-9.]+\z') { $Seconds = [double]::Parse($s, [cultureinfo]::InvariantCulture) }
  Start-Sleep -Seconds $Seconds
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

# --- persona files (new --persona-dir; owner provisioning only) ---

# Code points the persona refuses as invisible: the set packages/git/src/message.ts strips beyond
# the controls, plus the tag characters and the variation selectors, plus the blank-looking
# characters (no-break and ideographic spaces, invisible operators, filler glyphs) that the bash
# twin's blank-line test would otherwise count as content.
function Test-PersonaInvisible([int]$Cp) {
  return (($Cp -ge 0x200B -and $Cp -le 0x200F) -or ($Cp -ge 0x2028 -and $Cp -le 0x202E) -or
    ($Cp -ge 0x2066 -and $Cp -le 0x2069) -or $Cp -eq 0x061C -or $Cp -eq 0xFEFF -or $Cp -eq 0x2060 -or
    $Cp -eq 0x00AD -or ($Cp -ge 0xE0000 -and $Cp -le 0xE007F) -or ($Cp -ge 0xFE00 -and $Cp -le 0xFE0F) -or
    ($Cp -ge 0xE0100 -and $Cp -le 0xE01EF) -or $Cp -eq 0x00A0 -or $Cp -eq 0x3000 -or
    ($Cp -ge 0x2061 -and $Cp -le 0x2064) -or ($Cp -ge 0x206A -and $Cp -le 0x206F) -or
    $Cp -eq 0x180E -or $Cp -eq 0x3164 -or $Cp -eq 0xFFA0 -or $Cp -eq 0x2800)
}

# One path component: it must exist ($Kind 'dir' or 'file'), not be a link or reparse point, and
# have the right type. A missing component is persona_missing; any other fault persona_bad.
function Test-PersonaPath([string]$Path, [string]$Kind, [string]$Id, [string]$Dir) {
  $item = Get-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
  if (-not $item) { Die 1 persona_missing $Dir $Id }
  if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { Die 1 persona_bad $Id link }
  $isDir = [bool]($item.Attributes -band [IO.FileAttributes]::Directory)
  if (($Kind -ceq 'dir') -ne $isDir) { Die 1 persona_bad $Id type }
  return $item
}

# Reads and validates one persona file; returns the bytes to store (CRLF turned into LF, no BOM).
# The bytes are read as bytes and decoded strictly, never through the console code page.
function Read-PersonaFile([string]$Path, [int]$Max, [bool]$IsIdentity, [string]$Id, [string]$Dir) {
  $item = Test-PersonaPath $Path 'file' $Id $Dir
  if ($item.Length -lt 1 -or $item.Length -gt $Max) { Die 1 persona_bad $Id size }
  $bytes = [System.IO.File]::ReadAllBytes($Path)
  try {
    $text = [System.Text.UTF8Encoding]::new($false, $true).GetString($bytes)
  } catch {
    Die 1 persona_bad $Id utf8
  }
  $text = $text.Replace("`r`n", "`n")
  $invisible = $false
  $i = 0
  while ($i -lt $text.Length) {
    $cp = [char]::ConvertToUtf32($text, $i)
    $i += $(if ($cp -gt 0xFFFF) { 2 } else { 1 })
    if ($cp -eq 0x0A -or $cp -eq 0x09) { continue }
    if ($cp -le 0x1F -or ($cp -ge 0x7F -and $cp -le 0x9F)) { Die 1 persona_bad $Id control }
    if (Test-PersonaInvisible $cp) { $invisible = $true }
  }
  if ($invisible) { Die 1 persona_bad $Id invisible }
  if ($IsIdentity) {
    # What setup would see: whitespace-only lines and the line "# Identity" dropped.
    # ASCII blanks only, the same test as the bash twin's grep under LC_ALL=C.
    $kept = @($text.Split("`n") | Where-Object { $_ -cnotmatch '^[ \t]*$' -and $_ -cne '# Identity' })
    if ($kept.Count -eq 0 -or ($kept -join "`n") -ceq 'Who you are. Written once, at your birth.') {
      Die 1 persona_bad $Id empty
    }
  }
  return , [System.Text.UTF8Encoding]::new($false).GetBytes($text)
}

# Validates the two persona files for $Id under $Dir; returns @(identityBytes, goalsBytes).
# Nothing is written here and no gh call has happened yet.
function Read-Persona([string]$Dir, [string]$Id) {
  if (-not $Dir) { Die 1 persona_missing $Dir $Id }
  $root = Get-Item -LiteralPath $Dir -Force -ErrorAction SilentlyContinue
  if (-not $root) { Die 1 persona_missing $Dir $Id }
  if (-not ($root.Attributes -band [IO.FileAttributes]::Directory)) { Die 1 persona_bad $Id type }
  $idDir = Join-Path $Dir $Id
  $mem = Join-Path $idDir 'memory'
  [void](Test-PersonaPath $idDir 'dir' $Id $Dir)
  [void](Test-PersonaPath $mem 'dir' $Id $Dir)
  $ident = Read-PersonaFile (Join-Path $mem 'identity.md') 8192 $true $Id $Dir
  $goals = Read-PersonaFile (Join-Path $mem 'goals.md') 4096 $false $Id $Dir
  return , @($ident, $goals)
}

function Verb-new {
  $id = [string]$args[0]
  $more = @($args | Select-Object -Skip 1 | ForEach-Object { [string]$_ })
  $vis = ''
  $mock = ''
  $tokfile = ''
  $shard = 'commons'
  $persona = ''
  $havePersona = $false
  $i = 0
  while ($i -lt $more.Count) {
    $a = $more[$i]
    if ($a -ceq '--private' -or $a -ceq '--public') {
      $vis = $a.Substring(2)
      $i++
    } elseif ($a -ceq '--mock' -or $a -ceq '--token-file' -or $a -ceq '--shard' -or $a -ceq '--persona-dir') {
      if ($i + 1 -ge $more.Count) { Die 2 usage }
      switch ($a) {
        '--mock' { $mock = $more[$i + 1] }
        '--token-file' { $tokfile = $more[$i + 1] }
        '--shard' { $shard = $more[$i + 1] }
        '--persona-dir' {
          if ($havePersona) { Die 1 persona_bad $id twice }
          $havePersona = $true
          $persona = $more[$i + 1]
        }
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
  $files = $null
  if ($havePersona) { $files = Read-Persona $persona $id }
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
  $msg = "player: $id"
  $adds = @('player.json')
  if ($havePersona) {
    # A seeded player is born at new: identity.md is no longer the stub, which is what the unborn check reads.
    [System.IO.File]::WriteAllBytes((Join-Path $clone 'memory/identity.md'), [byte[]]$files[0])
    [System.IO.File]::WriteAllBytes((Join-Path $clone 'memory/goals.md'), [byte[]]$files[1])
    $adds += 'memory/identity.md', 'memory/goals.md'
  }
  Invoke-Git -C $clone add @adds *> $null
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
      -c tag.gpgsign=false commit -q -m $msg *> $null
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
  if ($havePersona) { Say created_seeded $id $id } else { Say created $id $id }
}
