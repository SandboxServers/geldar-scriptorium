# The session: allowlist, per-player CLI volume, compose override, start (H-06, H-07, H-08, H-19).
# Dot-sourced; the twin of lib/session.sh. Compose files come only from the launcher's own share.

$GP_GROUPS += 'session'

$script:SESSION_UTF8 = [System.Text.UTF8Encoding]::new($false)

# A value for a double-quoted YAML scalar: no quote, backslash or control character; $ doubled.
# Returns $null when the value cannot be quoted.
function ConvertTo-YamlQuoted([string]$Value) {
  if ([regex]::IsMatch($Value, '["\\\x00-\x1F\x7F-\x9F]')) { return $null }
  return '"' + $Value.Replace('$', '$$') + '"'
}

# A host path used in a mount. Backslashes become forward slashes first, so the path is
# C:/Users/... in a double-quoted long-syntax mount and never reaches a short-syntax volume
# string. A drive letter's colon is fine there; no other colon, comma or control character is.
function ConvertTo-MountQuoted([string]$Path) {
  $p = $Path.Replace([char]92, [char]47)
  $rest = [regex]::Replace($p, '^[A-Za-z]:(?=/)', '')
  if ([regex]::IsMatch($rest, '[\x00-\x1F\x7F-\x9F:,]')) { Die 1 bad_state_path }
  $q = ConvertTo-YamlQuoted $p
  if ($null -eq $q) { Die 1 bad_state_path }
  return $q
}

# H-08: the host of mcp_url, alone on one line.
# N4: it lives in <state>/<id>/pub (0755), the one world-readable path outside export/.
function Write-Allowlist([string]$Sd, [string]$Url) {
  $h = $Url.Substring($Url.IndexOf('://') + 3)
  $h = $h.Split('/')[0].Split(':')[0]
  $pub = Join-Path (Split-Path -Parent $Sd) 'pub'
  New-Item -ItemType Directory -Path $pub -Force | Out-Null
  $f = Join-Path $pub 'allowlist-world.txt'
  [System.IO.File]::WriteAllText($f, "$h`n", $script:SESSION_UTF8)
  # The effective port of the URL: the explicit one, else 80 for http and 443 for https.
  $auth = $Url.Substring($Url.IndexOf('://') + 3).Split('/')[0]
  $port = if ($auth.Contains(':')) { $auth.Substring($auth.IndexOf(':') + 1) }
  elseif ($Url.StartsWith('https:', [StringComparison]::Ordinal)) { '443' } else { '80' }
  $pf = Join-Path $pub 'allowlist-world-ports.txt'
  [System.IO.File]::WriteAllText($pf, "$port`n", $script:SESSION_UTF8)
  if (-not $IsWindows) {
    [System.IO.File]::SetUnixFileMode($pub, [System.IO.UnixFileMode]0x1ED)
    [System.IO.File]::SetUnixFileMode($f, [System.IO.UnixFileMode]0x1A4)
    [System.IO.File]::SetUnixFileMode($pf, [System.IO.UnixFileMode]0x1A4)
  }
}

# H-06: the override. Absolute host paths only; one read-only bind per kit entry.
function Write-Override([string]$Id, [string]$Sd, [string]$Mcp, [bool]$Dev = $false) {
  $f = Join-Path $Sd 'override.yml'
  $exp = Join-Path $Sd 'export'
  if (-not (Test-Path -LiteralPath $exp -PathType Container)) { Die 1 no_such_player $Id $Id }
  $sb = [System.Text.StringBuilder]::new()
  [void]$sb.Append("services:`n  session:`n    volumes:`n")
  [void]$sb.Append("      - type: volume`n        source: geldar_ws`n        target: /player`n")
  [void]$sb.Append("      - type: volume`n        source: geldar_cli`n        target: /cli-home`n")
  $names = @(Get-ChildItem -LiteralPath $exp -Force | ForEach-Object { $_.Name })
  [Array]::Sort($names, [StringComparer]::Ordinal)
  foreach ($name in $names) {
    if (-not [regex]::IsMatch($name, '^[A-Za-z0-9._-]+\z')) { Die 1 bad_export_name $Id }
    if ($name -ceq 'memory' -or $name -ceq 'skills' -or $name -ceq '.git') { continue }
    $v = ConvertTo-MountQuoted (Join-Path $exp $name)
    [void]$sb.Append("      - type: bind`n        source: $v`n        target: `"/player/$name`"`n")
    [void]$sb.Append("        read_only: true`n        bind:`n          create_host_path: false`n")
  }
  $q = ConvertTo-YamlQuoted $Mcp
  if ($null -eq $q) { Die 1 bad_state_path }
  [void]$sb.Append("    environment:`n      GELDAR_MCP_URL: $q`n      GELDAR_MCP_TOKEN:`n")
  if ([Environment]::GetEnvironmentVariable('GELDAR_INTERNAL') -eq '1') {
    $stubs = @([Environment]::GetEnvironmentVariables().Keys | ForEach-Object { [string]$_ } |
        Where-Object { $_ -cmatch '^GELDAR_STUB_[A-Z0-9_]+\z' })
    [Array]::Sort($stubs, [StringComparer]::Ordinal)
    foreach ($s in $stubs) { [void]$sb.Append("      ${s}:`n") }
  }
  if ($Dev) {
    [void]$sb.Append("  proxy:`n    extra_hosts:`n      - `"host.docker.internal:host-gateway`"`n")
  }
  [void]$sb.Append("volumes:`n  geldar_ws:`n    external: true`n    name: `"geldar-ws-$Id`"`n")
  [void]$sb.Append("  geldar_cli:`n    external: true`n    name: `"geldar-cli-$Id-claude`"`n")
  [System.IO.File]::WriteAllText("$f.new", $sb.ToString(), $script:SESSION_UTF8)
  Move-Item -LiteralPath "$f.new" -Destination $f -Force
}

# The one function that builds the harness command words; SC-71 changes it.
function Get-HarnessCommand([string]$Cli, [string]$Mode) {
  if ($Cli -ceq 'claude') { return @('claude', '--settings', "/etc/geldar/settings/$Mode.json", "/$Mode") }
  throw 'unsupported cli'
}

# Runs docker as a child process with its own environment (never $env: of this process, so the
# token is not set here). Stdin and, unless Quiet, stdout and stderr are the launcher's own.
# A .cmd or .bat shim runs via cmd.exe. Returns the exit code.
function Invoke-DockerChild([string[]]$DockerArgs, [hashtable]$Set, [string[]]$Unset, [bool]$Quiet) {
  $exe = $env:GELDAR_DOCKER
  if (-not $exe) { $exe = 'docker' }
  $found = Get-Command $exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($found) { $exe = $found.Source }
  $psi = New-CmdShimStartInfo $exe $DockerArgs
  foreach ($u in $Unset) { [void]$psi.Environment.Remove($u) }
  foreach ($k in $Set.Keys) { $psi.Environment[$k] = [string]$Set[$k] }
  if ($Quiet) {
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
  }
  try {
    $p = [System.Diagnostics.Process]::Start($psi)
  } catch {
    return 127
  }
  if ($Quiet) {
    $p.BeginOutputReadLine()
    $p.BeginErrorReadLine()
  }
  $p.WaitForExit()
  $code = $p.ExitCode
  $p.Dispose()
  return $code
}

# Start-PlayerSession id mode: needs prepare to have run (export/, start, running).
function Start-PlayerSession([string]$Id, [string]$Mode) {
  if ($Mode -cne 'play' -and $Mode -cne 'setup') { Die 2 usage }
  $d = Get-PlayerDir $Id
  $sd = Join-Path $d 'session'
  $sf = Join-Path $d 'start'
  if (-not (Test-Path -LiteralPath $sf -PathType Leaf)) { Die 1 no_such_player $Id $Id }
  $start = Read-FirstLine $sf
  Read-Player $Id $start
  $sdf = $sd.Replace([char]92, [char]47)
  $chk = [regex]::Replace($sdf, '^[A-Za-z]:(?=/)', '')
  if ([regex]::IsMatch($chk, '[\x00-\x1F\x7F:,]')) { Die 1 bad_state_path }
  $share = (Get-ShareDir).Replace([char]92, [char]47)

  # SC-75: the human-set dev world replaces the URL for this launch only. It goes straight to the
  # allowlist writer and the override; it is never run through Test-McpUrl.
  $mcp = $script:PL_MCP_URL
  $dev = Get-DevWorldUrl $Id
  if ($dev -ne '') {
    Say dev_world_active $dev
    $mcp = $dev
  }

  New-PrivateDir $d
  New-PrivateDir $sd
  Write-Allowlist $sd $mcp
  Invoke-Docker volume create "geldar-cli-$Id-claude" *> $null
  if ($LASTEXITCODE -ne 0) { Die 1 workspace_failed $Id 'the CLI volume could not be created' }
  Write-Override $Id $sd $mcp ($dev -ne '')

  $words = @(Get-HarnessCommand claude $Mode)
  $ov = "$sdf/override.yml"
  $wl = (Split-Path -Parent $sdf) + '/pub/allowlist-world.txt'
  $wp = (Split-Path -Parent $sdf) + '/pub/allowlist-world-ports.txt'
  $files = @('-f', "$share/compose/session.yml", '-f', $ov)
  $extra = Get-GatedEnv 'GELDAR_EXTRA_COMPOSE'
  if ($extra) {
    if ($extra -match '^(/|[A-Za-z]:)') { $files += @('-f', $extra) } else { Die 1 bad_state_path }
  }
  $tty = @()
  if ([Console]::IsInputRedirected) { $tty = @('-T') }
  $cargs = @('compose', '-p', "geldar-$Id") + $files

  Say session_start (Sanitize $script:PL_NAME)
  $set = @{
    GELDAR_UID = '1000'; GELDAR_GID = '1000'; GELDAR_WORKSPACE = "geldar-ws-$Id"
    GELDAR_CLI_HOME = "geldar-cli-$Id-claude"; KIT_IMAGE = $script:PL_KIT_IMAGE
    GELDAR_WORLD_ALLOWLIST = $wl; GELDAR_WORLD_PORTS = $wp; GELDAR_MODE = $Mode
  }
  $tf = Join-Path $d 'token'
  $runSet = $set.Clone()
  if (Test-Path -LiteralPath $tf -PathType Leaf) { $runSet['GELDAR_MCP_TOKEN'] = Read-FirstLine $tf }
  $runArgs = $cargs + @('run', '--rm') + $tty + @('--label', 'geldar.role=session', 'session') + $words
  $rc = Invoke-DockerChild $runArgs $runSet @('GH_TOKEN', 'GITHUB_TOKEN', 'ANTHROPIC_API_KEY', 'GELDAR_MCP_TOKEN', 'GELDAR_DEV_MCP_URL') $false
  [System.IO.File]::WriteAllText((Join-Path $sd 'exit'), "$rc`n", $script:SESSION_UTF8)
  [void](Invoke-DockerChild ($cargs + @('down', '--remove-orphans')) $set @('GELDAR_MCP_TOKEN') $true)
  if ($rc -eq 125) { Die 1 compose_failed }
  Say session_end (Sanitize $script:PL_NAME)
}

function Verb-__session {
  if ($args.Count -ne 2) { Die 2 usage }
  Start-PlayerSession ([string]$args[0]) ([string]$args[1])
}
