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
  # The effective port of the URL: the explicit one, else 80 for http and 443 for https. An empty
  # port (https://host:/p/x) takes the default too, as the bash twin's write_allowlist does.
  $auth = $Url.Substring($Url.IndexOf('://') + 3).Split('/')[0]
  $port = ''
  if ($auth.Contains(':')) { $port = $auth.Substring($auth.IndexOf(':') + 1) }
  if ($port -eq '') { $port = if ($Url.StartsWith('http://', [StringComparison]::Ordinal)) { '80' } else { '443' } }
  $pf = Join-Path $pub 'allowlist-world-ports.txt'
  [System.IO.File]::WriteAllText($pf, "$port`n", $script:SESSION_UTF8)
  if (-not $IsWindows) {
    [System.IO.File]::SetUnixFileMode($pub, [System.IO.UnixFileMode]0x1ED)
    [System.IO.File]::SetUnixFileMode($f, [System.IO.UnixFileMode]0x1A4)
    [System.IO.File]::SetUnixFileMode($pf, [System.IO.UnixFileMode]0x1A4)
  }
}

# H-06: the override. Absolute host paths only; one read-only bind per kit entry.
function Write-Override([string]$Id, [string]$Sd, [string]$Mcp, [bool]$Dev = $false, [string]$Prompt = '', [string]$Turns = '', [string]$Model = '') {
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
  if ($Prompt -ne '') {
    # SC-121: the run prompt file, read-only, at a fixed path; the same path checks as a kit entry.
    $v = ConvertTo-MountQuoted $Prompt
    [void]$sb.Append("      - type: bind`n        source: $v`n        target: /run-input/prompt.txt`n")
    [void]$sb.Append("        read_only: true`n        bind:`n          create_host_path: false`n")
  }
  $q = ConvertTo-YamlQuoted $Mcp
  if ($null -eq $q) { Die 1 bad_state_path }
  [void]$sb.Append("    environment:`n      GELDAR_MCP_URL: $q`n      GELDAR_MCP_TOKEN:`n      CLAUDE_CODE_OAUTH_TOKEN:`n")
  if ($Turns -ne '') { [void]$sb.Append("      GELDAR_RUN_MAX_TURNS: `"$Turns`"`n") }
  if ($Model -ne '') { [void]$sb.Append("      GELDAR_RUN_MODEL: $(ConvertTo-YamlQuoted $Model)`n") }
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
  if ($Cli -ceq 'claude' -and $Mode -ceq 'run') {
    # SC-121: one headless run. The prompt is read inside the container from the read-only mounted
    # file, so it never shows on a host command line; the turn cap and the optional model come from
    # the container's environment (the override sets them).
    $line = 'exec claude --autocompact 100000 --settings /etc/geldar/settings/play.json'
    $line += ' -p "$(cat /run-input/prompt.txt)" --max-turns "$GELDAR_RUN_MAX_TURNS"'
    if ([Environment]::GetEnvironmentVariable('GELDAR_RUN_MODEL')) { $line += ' --model "$GELDAR_RUN_MODEL"' }
    $line += ' --output-format stream-json --verbose'
    return @('sh', '-c', $line)
  }
  if ($Cli -ceq 'claude') { return @('claude', '--autocompact', '100000', '--settings', "/etc/geldar/settings/$Mode.json", "/$Mode") }
  throw 'unsupported cli'
}

# Runs docker as a child process with its own environment (never $env: of this process, so the
# token is not set here). Stdin and, unless Quiet, stdout and stderr are the launcher's own.
# A .cmd or .bat shim runs via cmd.exe. Returns the exit code.
function Invoke-DockerChild([string[]]$DockerArgs, [hashtable]$Set, [string[]]$Unset, [bool]$Quiet, [string]$OutFile = '') {
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
  # SC-121: with OutFile only stdout is captured, into that (already private) file.
  # The headless run reads no stdin: the pipe is closed at once, so the child sees end of input.
  if ($OutFile -ne '') {
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardInput = $true
  }
  try {
    $p = [System.Diagnostics.Process]::Start($psi)
  } catch {
    return 127
  }
  if ($OutFile -ne '') { $p.StandardInput.Close() }
  if ($Quiet) {
    $p.BeginOutputReadLine()
    $p.BeginErrorReadLine()
  }
  if ($OutFile -ne '') {
    $fs = [System.IO.File]::Open($OutFile, [System.IO.FileMode]::Truncate, [System.IO.FileAccess]::Write)
    try { $p.StandardOutput.BaseStream.CopyTo($fs) } finally { $fs.Dispose() }
  }
  $p.WaitForExit()
  $code = $p.ExitCode
  $p.Dispose()
  return $code
}

# Start-PlayerSession id mode [n]: needs prepare to have run (export/, start, running).
# SC-121: mode run (with its number n) is one headless play session: no TTY, the prompt file named
# by GELDAR_RUN_PROMPT_FILE mounted read-only, stdout saved to <state>/<id>/run/session-<n>.jsonl.
function Start-PlayerSession([string]$Id, [string]$Mode, [string]$N = '') {
  $cmode = $Mode
  $prompt = ''
  $turns = ''
  $model = ''
  if ($Mode -ceq 'play' -or $Mode -ceq 'setup') {
    if ($N -ne '') { Die 2 usage }
  } elseif ($Mode -ceq 'run') {
    if ($N -cnotmatch '^[0-9]{1,9}\z') { Die 2 usage }
    $cmode = 'play'
    $prompt = [string][Environment]::GetEnvironmentVariable('GELDAR_RUN_PROMPT_FILE')
    $pchk = [regex]::Replace($prompt.Replace([char]92, [char]47), '^[A-Za-z]:(?=/)', '')
    if ($prompt -cnotmatch '^(/|[A-Za-z]:[\\/])' -or [regex]::IsMatch($pchk, '[\x00-\x1F\x7F:,]') -or -not (Test-Path -LiteralPath $prompt -PathType Leaf)) {
      Die 2 run_setting_bad GELDAR_RUN_PROMPT_FILE
    }
    $turns = [string][Environment]::GetEnvironmentVariable('GELDAR_RUN_MAX_TURNS')
    if ($turns -eq '') { $turns = '300' }
    if ($turns -cnotmatch '^[0-9]{1,6}\z') { Die 2 run_setting_bad GELDAR_RUN_MAX_TURNS }
    $model = [string][Environment]::GetEnvironmentVariable('GELDAR_RUN_MODEL')
    if ($model -ne '' -and $model -cnotmatch '^[A-Za-z0-9._:/-]+\z') { Die 2 run_setting_bad GELDAR_RUN_MODEL }
  } else {
    Die 2 usage
  }
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
  $out = ''
  if ($Mode -ceq 'run') {
    # A link at the run folder or the stream file would make the launcher truncate its target.
    $runDir = Join-Path $d 'run'
    $out = Join-Path $runDir "session-$N.jsonl"
    foreach ($lp in @($runDir, $out)) {
      $li = Get-Item -LiteralPath $lp -Force -ErrorAction SilentlyContinue
      if ($li -and ($li.LinkType -or $li.LinkTarget)) { Die 1 bad_state_path }
    }
  }

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
  Write-Override $Id $sd $mcp ($dev -ne '') $prompt $turns $model
  if ($Mode -ceq 'run') {
    New-PrivateDir (Join-Path $d 'run')
    # Created with the private mode from the start where the platform allows it.
    if ($IsWindows) {
      [System.IO.File]::WriteAllBytes($out, [byte[]]@())
    } else {
      $fo = [System.IO.FileStreamOptions]::new()
      $fo.Mode = [System.IO.FileMode]::Create
      $fo.Access = [System.IO.FileAccess]::Write
      $fo.UnixCreateMode = [System.IO.UnixFileMode]0x180
      ([System.IO.FileStream]::new($out, $fo)).Dispose()
      [System.IO.File]::SetUnixFileMode($out, [System.IO.UnixFileMode]0x180)
    }
  }

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
  if ([Console]::IsInputRedirected -or $Mode -ceq 'run') { $tty = @('-T') }
  $cargs = @('compose', '-p', "geldar-$Id") + $files

  Write-AuthUnusableWarning
  Say session_start (Sanitize $script:PL_NAME)
  $set = @{
    GELDAR_UID = '1000'; GELDAR_GID = '1000'; GELDAR_WORKSPACE = "geldar-ws-$Id"
    GELDAR_CLI_HOME = "geldar-cli-$Id-claude"; KIT_IMAGE = $script:PL_KIT_IMAGE
    GELDAR_WORLD_ALLOWLIST = $wl; GELDAR_WORLD_PORTS = $wp; GELDAR_MODE = $cmode
  }
  $tf = Join-Path $d 'token'
  $runSet = $set.Clone()
  if (Test-Path -LiteralPath $tf -PathType Leaf) { $runSet['GELDAR_MCP_TOKEN'] = Read-FirstLine $tf }
  # SC-140: an ambient login token is never passed on (it is in the unset list); only the stored,
  # valid one is set, on the compose process alone.
  $authTok = $null
  if (Test-AuthUsable) { $authTok = Get-AuthToken }
  if ($null -ne $authTok) { $runSet['CLAUDE_CODE_OAUTH_TOKEN'] = $authTok }
  $runArgs = $cargs + @('run', '--rm') + $tty + @('--label', 'geldar.role=session', 'session') + $words
  $rc = Invoke-DockerChild $runArgs $runSet @('GH_TOKEN', 'GITHUB_TOKEN', 'ANTHROPIC_API_KEY', 'GELDAR_MCP_TOKEN', 'GELDAR_DEV_MCP_URL', 'CLAUDE_CODE_OAUTH_TOKEN') $false $out
  [System.IO.File]::WriteAllText((Join-Path $sd 'exit'), "$rc`n", $script:SESSION_UTF8)
  [void](Invoke-DockerChild ($cargs + @('down', '--remove-orphans')) $set @('GELDAR_MCP_TOKEN', 'GELDAR_DEV_MCP_URL', 'CLAUDE_CODE_OAUTH_TOKEN') $true)
  if ($rc -eq 125) { Die 1 compose_failed }
  Say session_end (Sanitize $script:PL_NAME)
}

function Verb-__session {
  if ($args.Count -ne 2 -and -not ($args.Count -eq 3 -and [string]$args[1] -ceq 'run')) { Die 2 usage }
  Start-PlayerSession ([string]$args[0]) ([string]$args[1]) $(if ($args.Count -eq 3) { [string]$args[2] } else { '' })
}
