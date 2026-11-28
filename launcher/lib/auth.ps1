# geldar-play auth-set, auth-status, auth-clear (SC-140): the twin of lib/auth.sh. Dot-sourced.
# One long-lived Claude login token per machine, kept in one owner-only file and passed to every
# session container as an environment variable of the compose process (see Start-PlayerSession).

function Get-AuthDir {
  return Join-Path (Get-StateDir) 'auth'
}

function Get-AuthFile {
  return Join-Path (Get-AuthDir) 'claude-oauth-token'
}

# The raw text with one trailing LF or CRLF dropped; the token when what is left is one line of
# the allowed shape, else $null. Nothing is ever printed.
function ConvertTo-AuthToken([string]$Raw) {
  if ($Raw.EndsWith("`n")) { $Raw = $Raw.Substring(0, $Raw.Length - 1) }
  if ($Raw.EndsWith("`r")) { $Raw = $Raw.Substring(0, $Raw.Length - 1) }
  if ($Raw.Contains("`n")) { return $null }
  if ($Raw -cnotmatch '^[A-Za-z0-9._~-]{20,400}\z') { return $null }
  return $Raw
}

# The bytes as text. GetString keeps a leading BOM as a character the token pattern refuses, and a
# NUL stays a NUL, so both launchers refuse the same inputs.
function ConvertFrom-AuthBytes([byte[]]$Bytes) {
  return [System.Text.UTF8Encoding]::new($false).GetString($Bytes)
}

# Is anything at the token path, valid or not (a file, a link or a folder)?
function Test-AuthPresent {
  return $null -ne (Get-Item -LiteralPath (Get-AuthFile) -Force -ErrorAction SilentlyContinue)
}

# The stored token, or $null when there is none or it is not valid.
function Get-AuthToken {
  $f = Get-AuthFile
  $i = Get-Item -LiteralPath $f -Force -ErrorAction SilentlyContinue
  if (-not $i -or $i.PSIsContainer -or $i.LinkType -or $i.LinkTarget) { return $null }
  return ConvertTo-AuthToken (ConvertFrom-AuthBytes ([System.IO.File]::ReadAllBytes($f)))
}

# The stored token is valid and its file and folder are owner only.
function Test-AuthUsable {
  return ($null -ne (Get-AuthToken)) -and (Test-AuthOwnerOnly (Get-AuthFile)) -and (Test-AuthOwnerOnly (Get-AuthDir))
}

# Says auth_stored_invalid when a file is there that will not be passed on.
function Write-AuthUnusableWarning {
  if ((Test-AuthPresent) -and -not (Test-AuthUsable)) { Say auth_stored_invalid }
}

# Empties the file, restricts it to the owner, and only then writes the token into it.
function Write-AuthFile([string]$Path, [string]$Token) {
  $utf8 = [System.Text.UTF8Encoding]::new($false)
  [System.IO.File]::WriteAllText($Path, '', $utf8)
  if ($IsWindows) {
    $sid = '*' + [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    & icacls.exe $Path /inheritance:r /grant:r "${sid}:(F)" *> $null
    if ($LASTEXITCODE -ne 0) {
      Remove-Item -LiteralPath $Path -Force
      Die 1 bad_state_path
    }
  } else {
    [System.IO.File]::SetUnixFileMode($Path, 'UserRead,UserWrite')
  }
  [System.IO.File]::WriteAllText($Path, "$Token`n", $utf8)
}

function Test-AuthOwnerOnly([string]$Path) {
  if ($IsWindows) {
    # Any allow entry for a principal other than this user, SYSTEM and Administrators is open.
    $me = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    try {
      foreach ($r in (Get-Acl -LiteralPath $Path).Access) {
        if ($r.AccessControlType -ne 'Allow') { continue }
        $sid = $r.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
        if ($sid -notin @($me, 'S-1-5-18', 'S-1-5-32-544')) { return $false }
      }
    } catch {
      return $false
    }
    return $true
  }
  $m = [int][System.IO.File]::GetUnixFileMode($Path)
  return (($m -band 0x3F) -eq 0)
}

function Verb-auth_set {
  $a = @($args | ForEach-Object { [string]$_ })
  $src = ''
  if ($a.Count -eq 2 -and $a[0] -ceq '--token-file') { $src = $a[1] } elseif ($a.Count -ne 0) { Die 2 usage }
  if ($src -ne '') {
    if (-not (Test-Path -LiteralPath $src -PathType Leaf)) { Die 1 auth_bad_token }
    $raw = ConvertFrom-AuthBytes ([System.IO.File]::ReadAllBytes($src))
  } elseif (-not [Console]::IsInputRedirected) {
    Say auth_set_prompt
    $sec = Read-Host -AsSecureString
    $raw = [System.Net.NetworkCredential]::new('', $sec).Password
  } else {
    $ms = [System.IO.MemoryStream]::new()
    [Console]::OpenStandardInput().CopyTo($ms)
    $raw = ConvertFrom-AuthBytes $ms.ToArray()
  }
  $tok = ConvertTo-AuthToken $raw
  if ($null -eq $tok) { Die 1 auth_bad_token }
  New-PrivateDir (Get-StateDir)
  $d = Get-AuthDir
  New-PrivateDir $d
  if ($IsWindows) {
    $sid = '*' + [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    & icacls.exe $d /inheritance:r /grant:r "${sid}:(OI)(CI)F" *> $null
    if ($LASTEXITCODE -ne 0) { Die 1 bad_state_path }
  }
  $f = Get-AuthFile
  foreach ($p in @($f, "$f.new")) {
    $li = Get-Item -LiteralPath $p -Force -ErrorAction SilentlyContinue
    if ($li -and ($li.LinkType -or $li.LinkTarget)) { Die 1 bad_state_path }
  }
  Write-AuthFile "$f.new" $tok
  Move-Item -LiteralPath "$f.new" -Destination $f -Force
  Say auth_set_done
}

function Verb-auth_status {
  if ($args.Count -ne 0) { Die 2 usage }
  if (-not (Test-AuthPresent)) {
    Say auth_status_not_set
    return
  }
  if ($null -eq (Get-AuthToken)) {
    Say auth_status_invalid
    return
  }
  if ((Test-AuthOwnerOnly (Get-AuthFile)) -and (Test-AuthOwnerOnly (Get-AuthDir))) {
    Say auth_status_set
  } else {
    Say auth_status_open_mode
  }
}

function Verb-auth_clear {
  if ($args.Count -ne 0) { Die 2 usage }
  $f = Get-AuthFile
  foreach ($p in @($f, "$f.new")) {
    try {
      Remove-Item -LiteralPath $p -Force -ErrorAction Stop
    } catch {
      if (Test-Path -LiteralPath $p) { Die 1 bad_state_path }
    }
  }
  Say auth_cleared
}
