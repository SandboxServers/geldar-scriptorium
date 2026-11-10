# Reading and validating a player (H-19, N4). Dot-sourced; the twin of lib/player.sh.
# Nothing here evaluates repo text: values are matched with fixed patterns (\z, never $).

$GP_GROUPS += 'pre'

$script:PL_CLONE = ''
$script:PL_BRANCH = ''
$script:PL_MCP_URL = ''
$script:PL_NAME = ''
$script:PL_SHARD = ''
$script:PL_MODEL = ''
$script:PL_KIT_IMAGE = ''

function Read-FirstLine([string]$Path) {
  $t = [System.IO.File]::ReadAllText($Path, [System.Text.UTF8Encoding]::new($false))
  $i = $t.IndexOf("`n")
  if ($i -ge 0) { $t = $t.Substring(0, $i) }
  return $t.TrimEnd("`r")
}

# The reason= line of held/info only, found by prefix, never executed.
function Get-HeldReason([string]$Id) {
  $f = Join-Path (Get-PlayerDir $Id) 'held/info'
  if (-not (Test-Path -LiteralPath $f -PathType Leaf)) { return '' }
  $utf8 = [System.Text.UTF8Encoding]::new($false)
  foreach ($line in [System.IO.File]::ReadAllText($f, $utf8).Split("`n")) {
    if ($line.StartsWith('reason=')) { return (Sanitize $line.Substring(7)) }
  }
  return ''
}

# A held session blocks every launch, before any docker call.
function Assert-NotHeld([string]$Id) {
  if (Test-Path -LiteralPath (Join-Path (Get-PlayerDir $Id) 'held') -PathType Container) {
    Die 1 held $Id (Get-HeldReason $Id) $Id
  }
}

function Fail-PlayerJson([string]$Id, [string]$Why) {
  Die 1 bad_player_json $Id $Why
}

# Verify's rule for a branch name.
function Test-Branch([string]$B) {
  if (-not [regex]::IsMatch($B, '^[A-Za-z0-9][A-Za-z0-9._/-]{0,100}\z')) { return $false }
  if ($B.Contains('..') -or $B.EndsWith('/') -or $B.EndsWith('.lock')) { return $false }
  return $true
}

# A digest-pinned image reference (decision 5, H-19).
function Test-KitImage([string]$Ref) {
  return [regex]::IsMatch($Ref, '^[a-z0-9][a-z0-9./-]*@sha256:[0-9a-f]{64}\z')
}

# Decision 5: the image from GELDAR_KIT_IMAGE if set, else the given player.json value.
function Resolve-KitImage([string]$FromPlayer) {
  $ref = $env:GELDAR_KIT_IMAGE
  if (-not $ref) { return $FromPlayer }
  if (Test-KitImage $ref) { return $ref }
  if ((Get-GatedEnv 'GELDAR_UNSAFE_IMAGE') -eq '1') {
    Say image_unsafe
    return $ref
  }
  Die 1 image_refused
}

# The branch recorded for the player, validated (bad_branch otherwise).
function Read-Branch([string]$Id) {
  $f = Join-Path (Get-PlayerDir $Id) 'branch'
  if (-not (Test-Path -LiteralPath $f -PathType Leaf)) { Die 1 bad_branch $Id }
  $line = Read-FirstLine $f
  if (-not (Test-Branch $line)) { Die 1 bad_branch $Id }
  $script:PL_BRANCH = $line
}

# Local or private names: a single label, a reserved name or suffix, or an empty label. `.test`
# stays allowed (RFC 6761). xn-- labels get no special treatment. Same rules as private_host (bash).
function Test-PrivateHost([string]$Name) {
  if ($Name -eq '' -or $Name.StartsWith('.') -or $Name.EndsWith('.') -or $Name.Contains('..')) { return $true }
  if (-not $Name.Contains('.')) { return $true }
  if ($Name -in 'localhost', 'host.docker.internal', 'gateway.docker.internal', 'kubernetes.docker.internal') { return $true }
  foreach ($s in 'localhost', 'local', 'internal', 'localdomain', 'lan', 'home', 'home.arpa', 'corp', 'intranet', 'private', 'invalid', 'example', 'onion') {
    if ($Name.EndsWith(".$s", [StringComparison]::Ordinal)) { return $true }
  }
  return $false
}

# A DNS name whose last label holds a letter (so dotted quads, 127.1 and 2130706433 are refused);
# a port, if any, is 80, 443 or the owner-set world port (Test-WorldPort).
function Test-McpUrl([string]$Url) {
  if (-not [regex]::IsMatch($Url, '^https?://[^/@ ]+/[A-Za-z0-9._~/-]*\z')) { return $false }
  $auth = $Url.Substring($Url.IndexOf('://') + 3)
  $auth = $auth.Substring(0, $auth.IndexOf('/'))
  $hostName = $auth
  $port = ''
  $c = $auth.IndexOf(':')
  if ($c -ge 0) {
    $hostName = $auth.Substring(0, $c)
    $port = $auth.Substring($c + 1)
  }
  if (-not [regex]::IsMatch($hostName, '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\z')) { return $false }
  if (Test-PrivateHost $hostName) { return $false }
  if ([regex]::IsMatch($Url, '/\.\.(/|\z)')) { return $false }
  if (-not (Test-HostLabel $hostName)) { return $false }
  if ($port -eq '' -or $port -ceq '80' -or $port -ceq '443') { return $true }
  return (Test-WorldPort $Url $hostName $port)
}

# The last label holds a letter (so dotted quads, 127.1 and 2130706433 are refused).
function Test-HostLabel([string]$HostName) {
  return [regex]::IsMatch($HostName.Substring($HostName.LastIndexOf('.') + 1), '[a-z]')
}

# A non-default port is accepted only when it equals the owner-set mcp_port of world.conf and the
# URL has the scheme and host of mcp_base. Fails closed: no reader, no readable file, no port.
function Test-WorldPort([string]$Url, [string]$HostName, [string]$Port) {
  if (-not (Get-Command Get-WorldConf -CommandType Function -ErrorAction SilentlyContinue)) { return $false }
  try {
    $want = [string](Get-WorldConf 'mcp_port')
    $base = [string](Get-WorldConf 'mcp_base')
  } catch { return $false }
  if (-not [regex]::IsMatch($want, '^[1-9][0-9]{3,4}\z')) { return $false }
  if ([int]$want -lt 1024 -or [int]$want -gt 65535) { return $false }
  if (-not [regex]::IsMatch($Port, '^[0-9]+\z') -or $Port -cne $want) { return $false }
  $m = [regex]::Match($base, '^(https?)://([^/@?#:\s]+)(:[0-9]+)?\z')
  if (-not $m.Success) { return $false }
  $bh = $m.Groups[2].Value
  if (-not [regex]::IsMatch($bh, '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\z')) { return $false }
  if (Test-PrivateHost $bh) { return $false }
  if (-not (Test-HostLabel $bh)) { return $false }
  $scheme = $Url.Substring(0, $Url.IndexOf('://'))
  return ($scheme -ceq $m.Groups[1].Value -and $HostName -ceq $bh)
}

# Reads player.json from the committed tree at Rev (default HEAD), never the working file, then
# validates every value again with the same patterns as bash.
function Read-Player([string]$Id, [string]$Rev = 'HEAD') {
  $d = Get-PlayerDir $Id
  $cf = Join-Path $d 'clone'
  if (-not (Test-Path -LiteralPath $cf -PathType Leaf)) { Die 1 no_such_player $Id $Id }
  $clone = Read-FirstLine $cf
  if (-not (Test-Path -LiteralPath $clone -PathType Container)) { Die 1 no_such_player $Id $Id }
  $script:PL_CLONE = $clone
  Read-Branch $Id
  $raw = @(Invoke-Git -C $clone show "${Rev}:player.json" 2> $null)
  if ($LASTEXITCODE -ne 0) { Fail-PlayerJson $Id 'player.json cannot be read' }
  $text = $raw -join "`n"
  $keys = 'player_id', 'name', 'shard', 'mcp_url', 'harness', 'declared_model', 'kit_version', 'kit_image'
  foreach ($k in $keys) {
    if ([regex]::Matches($text, '"' + $k + '"\s*:').Count -ne 1) { Fail-PlayerJson $Id "$k is missing or repeated" }
  }
  try {
    $j = $text | ConvertFrom-Json -DateKind String -ErrorAction Stop
  } catch {
    Fail-PlayerJson $Id 'player.json is not JSON'
  }
  $v = @{}
  foreach ($k in $keys) {
    $val = $j.PSObject.Properties[$k].Value
    if ($val -isnot [string] -or [regex]::IsMatch($val, '[\x00-\x1F\x7F-\x9F]')) { Fail-PlayerJson $Id $k }
    $v[$k] = $val
  }
  if ($v['player_id'] -cne $Id) { Fail-PlayerJson $Id 'player_id' }
  if ($v['name'].Length -gt 40) { Fail-PlayerJson $Id 'name' }
  if (-not [regex]::IsMatch($v['shard'], '^$|^[a-z][a-z0-9-]{0,30}\z')) { Fail-PlayerJson $Id 'shard' }
  $semver = '^$|^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?\z'
  if (-not [regex]::IsMatch($v['kit_version'], $semver)) { Fail-PlayerJson $Id 'kit_version' }
  if (-not (Test-McpUrl $v['mcp_url'])) { Fail-PlayerJson $Id 'mcp_url' }
  switch -CaseSensitive ($v['harness']) {
    'claude' { }
    'codex' { Die 1 harness_unsupported $Id }
    default { Fail-PlayerJson $Id 'harness' }
  }
  if (-not $env:GELDAR_KIT_IMAGE -and -not (Test-KitImage $v['kit_image'])) { Fail-PlayerJson $Id 'kit_image' }
  $script:PL_KIT_IMAGE = Resolve-KitImage $v['kit_image']
  $script:PL_MCP_URL = $v['mcp_url']
  $script:PL_NAME = $v['name']
  $script:PL_SHARD = $v['shard']
  $script:PL_MODEL = $v['declared_model']
}
