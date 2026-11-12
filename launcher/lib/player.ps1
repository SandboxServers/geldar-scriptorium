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
# the host must also equal that of mcp_base in world.conf (SC-80); a port, if any, is 80, 443 or
# the owner-set world port (Test-WorldPort).
function Test-McpUrl([string]$Url, [switch]$Base) {
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
  # SC-80: -Base is for new's own base address, which is not yet a player URL.
  if ($Base -and ($port -eq '' -or $port -ceq '80' -or $port -ceq '443')) { return $true }
  return (Test-WorldPort $Url $hostName $port)
}

# The last label holds a letter (so dotted quads, 127.1 and 2130706433 are refused).
function Test-HostLabel([string]$HostName) {
  return [regex]::IsMatch($HostName.Substring($HostName.LastIndexOf('.') + 1), '[a-z]')
}

# SC-80: on every port the URL must have the scheme and host of mcp_base; a port other than 80 and
# 443 must also equal the owner-set mcp_port of world.conf. Fails closed: no reader, no readable
# file, no mcp_base, no port.
function Test-WorldPort([string]$Url, [string]$HostName, [string]$Port) {
  if (-not (Get-Command Get-WorldConf -CommandType Function -ErrorAction SilentlyContinue)) { return $false }
  try {
    $want = [string](Get-WorldConf 'mcp_port')
    $base = [string](Get-WorldConf 'mcp_base')
  } catch { return $false }
  if ($Port -ne '' -and $Port -cne '80' -and $Port -cne '443') {
    if (-not [regex]::IsMatch($want, '^[1-9][0-9]{3,4}\z')) { return $false }
    if ([int]$want -lt 1024 -or [int]$want -gt 65535) { return $false }
    if (-not [regex]::IsMatch($Port, '^[0-9]+\z') -or $Port -cne $want) { return $false }
  }
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

# SC-163b: the persistent player (decision 64), the twin of lib/player.sh. One compose project per
# player: geldar-player-<id>. Values reach compose through the environment of the call, never an argument.
$script:PL_REMOTE = ''
$script:PL_SECRET_MCP = ''
$script:PL_SECRET_LOGIN = ''

# Sets PL_REMOTE, the keeper's push address, from the clone's origin (github.com only).
function Set-PlayerRemote([string]$Id) {
  $out = @(Invoke-Git -C $script:PL_CLONE remote get-url origin 2> $null)
  $url = ''
  if ($LASTEXITCODE -eq 0 -and $out.Count -gt 0) { $url = ([string]$out[0]).Trim() }
  if ($url.EndsWith('/')) { $url = $url.Substring(0, $url.Length - 1) }
  if ($url.EndsWith('.git')) { $url = $url.Substring(0, $url.Length - 4) }
  $rest = $null
  if ($url.StartsWith('https://github.com/', [StringComparison]::Ordinal)) { $rest = $url.Substring(19) }
  elseif ($url.StartsWith('git@github.com:', [StringComparison]::Ordinal)) { $rest = $url.Substring(15) }
  elseif ($url.StartsWith('ssh://git@github.com/', [StringComparison]::Ordinal)) { $rest = $url.Substring(21) }
  if ($null -eq $rest) { Die 1 player_remote_bad $Id }
  $m = [regex]::Match($rest, '^([A-Za-z0-9._-]+)/([A-Za-z0-9._-]+)\z')
  if (-not $m.Success) { Die 1 player_remote_bad $Id }
  $script:PL_REMOTE = "ssh://git@ssh.github.com:443/$($m.Groups[1].Value)/$($m.Groups[2].Value).git"
}

# Sets PL_SECRET_MCP (the token file) and PL_SECRET_LOGIN (the shared login), empty when absent.
# Only the masking and the compose environment read them; nothing is printed.
function Set-PlayerSecrets([string]$Id) {
  $script:PL_SECRET_MCP = ''
  $script:PL_SECRET_LOGIN = ''
  $f = Join-Path (Get-PlayerDir $Id) 'token'
  $i = Get-Item -LiteralPath $f -Force -ErrorAction SilentlyContinue
  if ($i -and -not $i.PSIsContainer -and -not $i.LinkType) { $script:PL_SECRET_MCP = Read-FirstLine $f }
  if (Test-AuthUsable) { $script:PL_SECRET_LOGIN = [string](Get-AuthToken) }
}

# pl_mask: the stored secrets and token-like text replaced by [masked]; the same rules as the perl filter.
function Hide-PlayerText([string]$Text) {
  $t = $Text
  if ($script:PL_SECRET_MCP) { $t = $t.Replace($script:PL_SECRET_MCP, '[masked]') }
  if ($script:PL_SECRET_LOGIN) { $t = $t.Replace($script:PL_SECRET_LOGIN, '[masked]') }
  $t = [regex]::Replace($t, 'GELDAR_MCP_TOKEN=\S*', 'GELDAR_MCP_TOKEN=[masked]')
  $t = [regex]::Replace($t, 'sk-ant-[A-Za-z0-9_-]*', '[masked]')
  return [regex]::Replace($t, '(CLAUDE_CODE_OAUTH_TOKEN|oauth[_-]?token)[ :=]+\S+', '$1 [masked]', 'IgnoreCase')
}

# Writes masked text to stdout, one trailing LF; trailing CR and LF of the text are not kept.
function Write-PlayerText([string]$Text) {
  [Console]::Out.Write((Hide-PlayerText ($Text.TrimEnd("`r", "`n"))) + "`n")
}

# pl_compose id args...: docker compose for the player's project. The values are set in the environment
# for the call only, then restored; the tokens go in by name only. Returns the output lines.
function Invoke-PlayerCompose([string]$Id, [string[]]$ComposeArgs) {
  $d = Get-PlayerDir $Id
  $rest = $d -replace '^[A-Za-z]:', ''
  if ([regex]::IsMatch($rest, '[\x00-\x1F\x7F,:]')) { Die 1 bad_state_path }
  Set-PlayerRemote $Id
  Set-PlayerSecrets $Id
  $sd = Get-ShareDir
  $unset = 'GH_TOKEN', 'GITHUB_TOKEN', 'ANTHROPIC_API_KEY', 'GELDAR_DEV_MCP_URL', 'GELDAR_MCP_URL', 'GELDAR_MCP_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN'
  $set = @{
    KIT_IMAGE = $script:PL_KIT_IMAGE
    GELDAR_ID = $Id
    GELDAR_KEEPER_REMOTE = $script:PL_REMOTE
    GELDAR_MCP_URL = $script:PL_MCP_URL
    GELDAR_DEPLOY_KEY_FILE = "$d/deploy-key"
    GELDAR_WORLD_ALLOWLIST = "$d/pub/allowlist-world.txt"
    GELDAR_WORLD_PORTS = "$d/pub/allowlist-world-ports.txt"
  }
  if ($script:PL_SECRET_MCP) { $set['GELDAR_MCP_TOKEN'] = $script:PL_SECRET_MCP }
  if ($script:PL_SECRET_LOGIN) { $set['CLAUDE_CODE_OAUTH_TOKEN'] = $script:PL_SECRET_LOGIN }
  $saved = @{}
  foreach ($n in @($unset + @($set.Keys))) { $saved[$n] = [Environment]::GetEnvironmentVariable($n) }
  try {
    foreach ($n in $unset) { [Environment]::SetEnvironmentVariable($n, $null) }
    foreach ($k in $set.Keys) { [Environment]::SetEnvironmentVariable($k, [string]$set[$k]) }
    return @(Invoke-Docker compose -p "geldar-player-$Id" -f "$sd/compose/player.yml" @ComposeArgs 2> $null)
  } finally {
    foreach ($n in $saved.Keys) { [Environment]::SetEnvironmentVariable($n, $saved[$n]) }
  }
}

# One helper container (role ws, supervisor, keeper, key), bounded to 120 s like run_bounded. Its stdout
# goes to a private file, read back as text. Code is the exit code (124 on expiry). No secret is passed.
function Invoke-PlayerHelper([string]$Role, [string]$Name, [string[]]$Mounts, [string]$Script) {
  $exe = $env:GELDAR_DOCKER
  if (-not $exe) { $exe = 'docker' }
  $words = @(@($exe) + @('run', '--rm', '--label', "geldar.role=player-$Role", '--name', $Name,
    '--memory', '1g', '--pids-limit', '256', '--log-driver', 'none', '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges', '-e', 'HOME=/tmp', '-e', 'GIT_CONFIG_GLOBAL=/dev/null',
    '-e', 'GIT_CONFIG_NOSYSTEM=1', '-e', 'GIT_NO_REPLACE_OBJECTS=1') + $Mounts + @($script:PL_KIT_IMAGE, 'sh', '-c', $Script))
  $file = Join-Path (Get-StateDir) ('helper-' + [guid]::NewGuid().ToString('N') + '.out')
  $env:GP_OUT_CMD = ConvertTo-Json -InputObject $words -Compress
  $env:GP_OUT_FILE = $file
  $inner = '$a = @($env:GP_OUT_CMD | ConvertFrom-Json); $e = $a[0]; $r = @($a | Select-Object -Skip 1); & $e @r > $env:GP_OUT_FILE 2> $null; exit $LASTEXITCODE'
  try {
    $code = @(Invoke-Bounded 120 --container $Name ([Environment]::ProcessPath) -NoProfile -NonInteractive -Command $inner)[-1]
    $text = ''
    if (Test-Path -LiteralPath $file -PathType Leaf) { $text = [System.IO.File]::ReadAllText($file, [System.Text.UTF8Encoding]::new($false)) }
  } finally {
    $env:GP_OUT_CMD = $null
    $env:GP_OUT_FILE = $null
    Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue
  }
  return [pscustomobject]@{ Code = [int]$code; Text = $text }
}

# pl_helper id role vol uid mode script: a helper with the volume vol at /vol (mode ro or rw).
function Invoke-PlayerVolHelper([string]$Id, [string]$Role, [string]$Vol, [int]$Uid, [string]$Mode, [string]$Script) {
  return Invoke-PlayerHelper $Role "geldar-$Role-$Id" @('--user', "${Uid}:${Uid}", '-v', "${Vol}:/vol:${Mode}") $Script
}

# The uid:gid a helper runs as (the host's on POSIX; Windows has no uid to match).
function Get-PlayerHostIds {
  if ($IsWindows) { return '1000:1000' }
  return "$(& id -u):$(& id -g)"
}

# Owner-only, as auth.ps1 restricts its folder and file: an ACL on Windows, the mode bits on POSIX
# (a folder is already 0700 from New-PrivateDir there, so only a file gets the mode here).
function Set-PlayerOwnerOnly([string]$Path, [string]$Grant) {
  if ($IsWindows) {
    $sid = '*' + [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    & icacls.exe $Path /inheritance:r /grant:r "${sid}:$Grant" *> $null
    if ($LASTEXITCODE -ne 0) { Die 1 bad_state_path }
  } elseif (-not (Test-Path -LiteralPath $Path -PathType Container)) {
    [System.IO.File]::SetUnixFileMode($Path, 'UserRead,UserWrite')
  }
}

# pl_allowlist id: the world allowlist files for the proxy (the same writer as the session).
function Write-PlayerAllowlist([string]$Id) {
  $d = Get-PlayerDir $Id
  New-PrivateDir $d
  Write-Allowlist "$d/pub" $script:PL_MCP_URL
}

# pl_prepare_ws id: the workspace volume gets the host clone once (a copy with its .git).
function Initialize-PlayerWorkspace([string]$Id) {
  $name = "geldar-ws-$Id"
  $r = Invoke-PlayerHelper 'ws' "geldar-wscheck-$Id" @('-v', "${name}:/player:ro") 'test -e /player/.git'
  if ($r.Code -eq 0) { return }
  $r = Invoke-PlayerHelper 'ws' "geldar-wsinit-$Id" @('-v', "$($script:PL_CLONE):/in:ro", '-v', "${name}:/player") 'cp -a /in/. /player/'
  if ($r.Code -eq 0) { return }
  Invoke-Docker volume rm $name *> $null
  Die 1 player_ws_failed $Id
}

# pl_ready id: the deploy key, the MCP token file and the shared login.
function Assert-PlayerReady([string]$Id) {
  $d = Get-PlayerDir $Id
  if (-not (Test-Path -LiteralPath "$d/deploy-key" -PathType Leaf)) { Die 1 player_no_key $Id }
  if (-not (Test-Path -LiteralPath "$d/token" -PathType Leaf)) { Die 1 player_no_token $Id }
  if (-not (Test-AuthUsable)) { Die 1 player_no_login }
}

# start <id>: the checks, the workspace once, then compose up -d (idempotent).
function Verb-start {
  if ($args.Count -ne 1) { Die 2 usage }
  $id = [string]$args[0]
  Read-Player $id
  Assert-PlayerReady $id
  Lock-Acquire $id
  Write-PlayerAllowlist $id
  Initialize-PlayerWorkspace $id
  Invoke-PlayerCompose $id @('up', '-d')
  if ($LASTEXITCODE -ne 0) { Die 1 compose_failed }
  Say player_started $id
}

# restart <id>: the same checks, then the containers are recreated.
function Verb-restart {
  if ($args.Count -ne 1) { Die 2 usage }
  $id = [string]$args[0]
  Read-Player $id
  Assert-PlayerReady $id
  Lock-Acquire $id
  Write-PlayerAllowlist $id
  Invoke-PlayerCompose $id @('up', '-d', '--force-recreate')
  if ($LASTEXITCODE -ne 0) { Die 1 compose_failed }
  Say player_restarted $id
}

# stop <id>: stops the containers; the volumes are kept.
function Verb-stop {
  if ($args.Count -ne 1) { Die 2 usage }
  $id = [string]$args[0]
  Read-Player $id
  Lock-Acquire $id
  Invoke-PlayerCompose $id @('stop')
  if ($LASTEXITCODE -ne 0) { Die 1 compose_failed }
  Say player_stopped $id
}

# One part of player-status, masked. A part that cannot be read prints player_no_status for its role.
function Write-PlayerStatusPart([string]$Id, [string]$Role, [string]$Vol, [int]$Uid, [string]$Script) {
  $r = Invoke-PlayerVolHelper $Id $Role $Vol $Uid 'ro' $Script
  if ($r.Code -ne 0) { Say player_no_status $Role; return }
  Write-PlayerText $r.Text
}

# player-status <id>: container states, the supervisor's and the keeper's status.json, HELD if set.
function Verb-player_status {
  if ($args.Count -ne 1) { Die 2 usage }
  $id = [string]$args[0]
  Read-Player $id
  Set-PlayerSecrets $id
  $ps = @(Invoke-PlayerCompose $id @('ps', '--all', '--format', '{{.Service}} {{.State}}'))
  Write-PlayerText ($ps -join "`n")
  [Console]::Out.Write("supervisor status:`n")
  Write-PlayerStatusPart $id 'supervisor' "geldar-sup-$id" 1001 'cat /vol/status.json'
  [Console]::Out.Write("keeper status:`n")
  Write-PlayerStatusPart $id 'keeper' "geldar-keep-$id" 1002 'grep -E "\"(last_pushed_head|last_run_utc|upstream_head|upstream_result)\"" /vol/status.json'
  $held = Invoke-PlayerVolHelper $id 'keeper' "geldar-keep-$id" 1002 'ro' 'cat /vol/HELD'
  if ($held.Code -eq 0) { Say player_held (Sanitize ($held.Text.TrimEnd("`r", "`n"))) }
}

# logs <id> [--follow]: the supervisor's log and the containers' output, with the secrets masked.
function Verb-logs {
  if ($args.Count -lt 1 -or $args.Count -gt 2) { Die 2 usage }
  $id = [string]$args[0]
  $follow = $false
  if ($args.Count -eq 2) {
    if ($args[1] -cne '--follow') { Die 2 usage }
    $follow = $true
  }
  Read-Player $id
  Set-PlayerSecrets $id
  if ($follow) {
    $lines = @(Invoke-PlayerCompose $id @('logs', '--no-color', '--follow', 'player', 'keeper'))
    Write-PlayerText ($lines -join "`n")
    return
  }
  $tail = Invoke-PlayerVolHelper $id 'supervisor' "geldar-sup-$id" 1001 'ro' 'tail -n 200 /vol/supervisor.log'
  if ($tail.Text) { Write-PlayerText $tail.Text }
  $lines = @(Invoke-PlayerCompose $id @('logs', '--no-color', '--tail', '200', 'player', 'keeper'))
  if ($lines.Count -gt 0) { Write-PlayerText ($lines -join "`n") }
}

# pl_make_key id dir: a new ed25519 key (no passphrase) in dir/deploy-key and dir/deploy-key.pub.
# ssh-keygen on the host when there is one, else ssh-keygen in a throwaway kit container.
function New-PlayerKey([string]$Id, [string]$Dir) {
  $tmp = Join-Path $Dir 'keygen'
  Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
  New-PrivateDir (Join-Path $Dir 'keygen')
  $kg = Get-GatedEnv 'GELDAR_SSH_KEYGEN'
  if (-not $kg) { $kg = 'ssh-keygen' }
  $keyPath = Join-Path $tmp 'deploy-key'
  if (Get-Command $kg -CommandType Application -ErrorAction SilentlyContinue) {
    Invoke-ShimAware $kg '-q' '-t' 'ed25519' '-N' '' '-C' "geldar-$Id" '-f' $keyPath *> $null
    if ($LASTEXITCODE -ne 0) { Die 1 player_key_failed $Id }
  } else {
    $r = Invoke-PlayerHelper 'key' "geldar-key-$Id" @('--user', (Get-PlayerHostIds), '-v', "${tmp}:/out") "ssh-keygen -q -t ed25519 -N '' -C geldar-$Id -f /out/deploy-key"
    if ($r.Code -ne 0) { Die 1 player_key_failed $Id }
  }
  if (-not ((Test-Path -LiteralPath $keyPath -PathType Leaf) -and (Test-Path -LiteralPath "$keyPath.pub" -PathType Leaf))) {
    Die 1 player_key_failed $Id
  }
  Set-PlayerOwnerOnly $keyPath '(F)'
  Set-PlayerOwnerOnly "$keyPath.pub" '(F)'
  Move-Item -LiteralPath $keyPath -Destination (Join-Path $Dir 'deploy-key') -Force
  Move-Item -LiteralPath "$keyPath.pub" -Destination (Join-Path $Dir 'deploy-key.pub') -Force
  Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

# deploy-key <id> [--rotate]: prints the public key only. --rotate makes a new key first.
function Verb-deploy_key {
  if ($args.Count -lt 1 -or $args.Count -gt 2) { Die 2 usage }
  $id = [string]$args[0]
  $rotate = $false
  if ($args.Count -eq 2) {
    if ($args[1] -cne '--rotate') { Die 2 usage }
    $rotate = $true
  }
  Read-Player $id
  $d = Get-PlayerDir $id
  New-PrivateDir $d
  if ($IsWindows) { Set-PlayerOwnerOnly $d '(OI)(CI)F' }
  if ($rotate -or -not (Test-Path -LiteralPath "$d/deploy-key.pub" -PathType Leaf) -or -not (Test-Path -LiteralPath "$d/deploy-key" -PathType Leaf)) {
    New-PlayerKey $id $d
  }
  [Console]::Out.Write([System.IO.File]::ReadAllText("$d/deploy-key.pub", [System.Text.UTF8Encoding]::new($false)))
  if ($rotate) { Say player_key_rotated $id } else { Say player_key_add $id }
}

# release-hold <id>: prints the HELD reason, then removes HELD: the only way to clear it.
function Verb-release_hold {
  if ($args.Count -ne 1) { Die 2 usage }
  $id = [string]$args[0]
  Read-Player $id
  $held = Invoke-PlayerVolHelper $id 'keeper' "geldar-keep-$id" 1002 'ro' 'cat /vol/HELD'
  if ($held.Code -ne 0) { Say player_not_held $id; return }
  Say player_held (Sanitize ($held.Text.TrimEnd("`r", "`n")))
  $rm = Invoke-PlayerVolHelper $id 'keeper' "geldar-keep-$id" 1002 'rw' 'rm -f /vol/HELD'
  if ($rm.Code -ne 0) { Die 1 player_release_failed $id }
  Say player_released $id
}

# Whether the keeper and the supervisor are both running (the persistent group).
function Test-PlayerRunning([string]$Id) {
  $up = @(Invoke-PlayerCompose $Id @('ps', '--status', 'running', '--format', '{{.Service}}'))
  return ($up -contains 'keeper') -and ($up -contains 'supervisor')
}

# sync <id>: asks the keeper to fetch upstream now. It touches sync-request in the keeper's state; the
# keeper fetches and the supervisor applies the change between runs, never during one.
function Verb-sync {
  if ($args.Count -ne 1) { Die 2 usage }
  $id = [string]$args[0]
  Read-Player $id
  if (-not (Test-PlayerRunning $id)) { Die 1 player_not_running $id }
  $r = Invoke-PlayerVolHelper $id 'keeper' "geldar-keep-$id" 1002 'rw' 'touch /vol/sync-request'
  if ($r.Code -ne 0) { Die 1 player_sync_failed $id }
  Say player_sync_requested $id
}
