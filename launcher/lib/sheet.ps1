# The character sheet, held privately on this machine (HC-26a). Twin of lib/sheet.sh: nothing here
# prints or logs the sheet text, and a refusal names only its reason.

# The largest sheet the launcher stores, in bytes.
$script:SHEET_MAX = 4096

# Test-SheetFile path id: dies with sheet_bad unless the file is a plain file of 1 to SHEET_MAX
# bytes, valid UTF-8 text whose first non-blank character is {. A link is refused before it is read.
function Test-SheetFile([string]$Path, [string]$Id) {
  $item = $null
  if ($Path) { $item = Get-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue }
  if (-not $item) { Die 1 sheet_bad $Id 'type' }
  if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) { Die 1 sheet_bad $Id 'link' }
  if ($item.PSIsContainer) { Die 1 sheet_bad $Id 'type' }
  if ($item.Length -lt 1 -or $item.Length -gt $script:SHEET_MAX) { Die 1 sheet_bad $Id 'size' }
  $bytes = [System.IO.File]::ReadAllBytes($item.FullName)
  $text = $null
  try {
    $text = [System.Text.UTF8Encoding]::new($false, $true).GetString($bytes)
  } catch {
    $text = $null
  }
  if ($null -eq $text -or $text -notmatch '\A[ \t\r\n]*\{') { Die 1 sheet_bad $Id 'text' }
}

# Save-Sheet id path: checks the file, then copies it to sheet.json in the player's state directory.
# The copy is written to a temporary file, owner-only, and moved into place.
function Save-Sheet([string]$Id, [string]$Path) {
  Test-SheetFile $Path $Id
  $dir = Get-PlayerDir $Id
  New-PrivateDir (Get-StateDir)
  New-PrivateDir $dir
  $tmp = Join-Path $dir ('sheet.' + [guid]::NewGuid().ToString('N') + '.tmp')
  try {
    [System.IO.File]::WriteAllBytes($tmp, [System.IO.File]::ReadAllBytes($Path))
    Set-PlayerOwnerOnly $tmp '(F)'
    [System.IO.File]::Move($tmp, (Join-Path $dir 'sheet.json'), $true)
  } catch {
    Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
    Die 1 sheet_bad $Id 'write'
  }
  Say sheet_stored $Id
}

# Verb-sheet_set id file: replaces the stored sheet of a player that already exists.
function Verb-sheet_set {
  if ($args.Count -ne 2) { Die 2 usage }
  $id = [string]$args[0]
  Read-Player $id
  Lock-Acquire $id
  Save-Sheet $id ([string]$args[1])
}
