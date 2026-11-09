# The host re-check (H-13): the same rules as geldar-verify, re-done with host git so a flaw in
# the gate image alone cannot let a bad session through. Dot-sourced; the twin of lib/recheck.sh.
$GP_GROUPS += 'bundle'

$script:RC_WHY = ''

function ConvertTo-AsciiLower([string]$S) {
  return [regex]::Replace($S, '[A-Z]', { param($m) $m.Value.ToLowerInvariant() })
}

# Test-PathAllowed path mode: the PowerShell twin of packages/path-rule (spec section 7).
function Test-PathAllowed([string]$Path, [string]$Mode) {
  if ((ConvertTo-AsciiLower $Path) -ceq 'memory/identity.md') {
    return ($Path -ceq 'memory/identity.md' -and $Mode -ceq 'setup')
  }
  if ((ConvertTo-AsciiLower $Path).StartsWith('memory/identity.md/', [StringComparison]::Ordinal)) { return $false }
  if ($Path -ceq 'memory/people/.gitkeep' -or $Path -ceq 'memory/journal/current.md') { return $true }
  if (-not [regex]::IsMatch($Path, '^(memory|skills)/[A-Za-z0-9._/-]+\.(md|js|json)\z')) { return $false }
  if ($Path.Length -gt 200) { return $false }
  foreach ($part in $Path.Split('/')) {
    if ($part -eq '') { return $false }
    if ($part.StartsWith('.') -or $part.EndsWith('.')) { return $false }
    if ($part.Length -gt 64) { return $false }
    $stem = $part.Split('.')[0]
    if ([regex]::IsMatch((ConvertTo-AsciiLower $stem), '^(con|prn|aux|nul|com[0-9]|lpt[0-9])\z')) { return $false }
  }
  return $true
}

# git with its stdout read as raw bytes (a NUL-separated list must not pass through the pipeline).
# Returns @{ Code; Text } with Text decoded as UTF-8.
function Invoke-GitRaw([string[]]$GitArgs) {
  $exe = $env:GELDAR_GIT
  if (-not $exe) { $exe = 'git' }
  $found = Get-Command $exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($found) { $exe = $found.Source }
  $hooks = Join-Path (Get-StateDir) 'empty-hooks'
  if (-not (Test-Path -LiteralPath $hooks)) { New-Item -ItemType Directory -Path $hooks -Force | Out-Null }
  $psi = [System.Diagnostics.ProcessStartInfo]::new()
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  if ($exe -match '\.(cmd|bat)\z') {
    $psi.FileName = 'cmd.exe'
    $psi.ArgumentList.Add('/d')
    $psi.ArgumentList.Add('/c')
    $psi.ArgumentList.Add($exe)
  } else {
    $psi.FileName = $exe
  }
  $psi.ArgumentList.Add('-c')
  $psi.ArgumentList.Add("core.hooksPath=$hooks")
  foreach ($a in $GitArgs) { $psi.ArgumentList.Add($a) }
  $psi.Environment['GIT_NO_REPLACE_OBJECTS'] = '1'
  $psi.Environment['GIT_TERMINAL_PROMPT'] = '0'
  try {
    $p = [System.Diagnostics.Process]::Start($psi)
  } catch {
    return @{ Code = 127; Text = '' }
  }
  $err = $p.StandardError.ReadToEndAsync()
  $ms = [System.IO.MemoryStream]::new()
  $p.StandardOutput.BaseStream.CopyTo($ms)
  $p.WaitForExit()
  [void]$err.Wait(5000)
  $code = $p.ExitCode
  $p.Dispose()
  return @{ Code = $code; Text = [System.Text.UTF8Encoding]::new($false).GetString($ms.ToArray()) }
}

# Test-HostRecheck clone start ref mode: $true when the range start..ref is acceptable, else
# $false with the first violating path (through Sanitize) in RC_WHY.
function Test-HostRecheck([string]$Clone, [string]$Start, [string]$Ref, [string]$Mode) {
  $script:RC_WHY = ''
  $env:GIT_NO_REPLACE_OBJECTS = '1'
  Invoke-Git -C $Clone merge-base --is-ancestor $Start $Ref *> $null
  if ($LASTEXITCODE -ne 0) { $script:RC_WHY = 'history'; return $false }
  $merges = @(Invoke-Git -C $Clone rev-list --merges "$Start..$Ref" 2> $null)
  if ($merges.Count -gt 0 -and "$($merges[0])" -ne '') { $script:RC_WHY = 'merge'; return $false }
  $cnt = @(Invoke-Git -C $Clone rev-list --count "$Start..$Ref" 2> $null)
  $n = 999999
  if ($LASTEXITCODE -eq 0 -and $cnt.Count -gt 0 -and "$($cnt[0])" -match '^[0-9]+\z') { $n = [int]"$($cnt[0])" }
  if ($n -gt 2000) { $script:RC_WHY = 'too many commits'; return $false }
  $d = Invoke-GitRaw @('-C', $Clone, 'diff', '--raw', '-z', '--no-renames', '--no-textconv', '--no-ext-diff', $Start, $Ref)
  $tokens = [System.Collections.Generic.List[string]]::new()
  if ($d.Text.Length -gt 0) {
    $t = $d.Text
    if ($t.EndsWith([string][char]0)) { $t = $t.Substring(0, $t.Length - 1) }
    foreach ($x in $t.Split([char]0)) { $tokens.Add($x) }
  }
  if ($d.Code -ne 0) { $tokens.Add('x'); $tokens.Add('x') }
  for ($i = 0; $i -lt $tokens.Count; $i += 2) {
    if ($i + 1 -ge $tokens.Count) { $script:RC_WHY = 'unreadable'; return $false }
    $meta = $tokens[$i]
    $p = $tokens[$i + 1]
    $dmode = $meta
    if ($dmode.StartsWith(':')) {
      $sp = $dmode.IndexOf(' ')
      if ($sp -ge 0) { $dmode = $dmode.Substring($sp + 1) }
    }
    $sp = $dmode.IndexOf(' ')
    if ($sp -ge 0) { $dmode = $dmode.Substring(0, $sp) }
    if ($dmode -cne '100644' -and $dmode -cne '000000') { $script:RC_WHY = Sanitize $p; return $false }
    if (-not (Test-PathAllowed $p $Mode)) { $script:RC_WHY = Sanitize $p; return $false }
  }
  if ($script:RC_WHY -ne '') { return $false }
  return (Test-FoldCollision $Clone $Start $Ref)
}

# Test-FoldCollision clone start ref: $false (RC_WHY set) when a name in the end tree is new and
# differs only by ASCII case from another end-tree name (decision 28). Members are the files and
# every directory prefix; the twin of recheck_collision in recheck.sh.
function Test-FoldCollision([string]$Clone, [string]$Start, [string]$Ref) {
  $members = {
    param([string]$Tree)
    $set = [System.Collections.Generic.List[string]]::new()
    $r = Invoke-GitRaw @('-C', $Clone, 'ls-tree', '-r', '-z', '--name-only', $Tree)
    if ($r.Code -ne 0) { return $set }
    foreach ($path in $r.Text.Split([char]0)) {
      if ($path -eq '') { continue }
      $acc = ''
      foreach ($part in $path.Split('/')) {
        if ($acc -eq '') { $acc = $part } else { $acc = "$acc/$part" }
        $set.Add($acc)
      }
    }
    return $set
  }
  $inStart = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
  foreach ($m in (& $members $Start)) { [void]$inStart.Add($m) }
  $seen = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
  $first = [System.Collections.Generic.Dictionary[string, string]]::new([StringComparer]::Ordinal)
  $fresh = [System.Collections.Generic.Dictionary[string, string]]::new([StringComparer]::Ordinal)
  $hit = ''
  foreach ($l in (& $members $Ref)) {
    if (-not $seen.Add($l)) { continue }
    $f = $l.ToLowerInvariant()
    if (-not $first.ContainsKey($f)) {
      $first[$f] = $l
      if (-not $inStart.Contains($l)) { $fresh[$f] = $l }
      continue
    }
    if (-not $inStart.Contains($l)) { $hit = $l; break }
    if ($fresh.ContainsKey($f)) { $hit = $fresh[$f]; break }
  }
  if ($hit -eq '') { return $true }
  $script:RC_WHY = "$($script:GP_MSG['recheck_case_collision']): $(Sanitize $hit)"
  return $false
}
