# setup: the birth session. The unborn check lives in Invoke-PrepareSession (mode setup).
# Dot-sourced; the twin of lib/setup.sh.

$GP_GROUPS += 'setup'

function Verb-setup {
  $id = [string]$args[0]
  # SC-75: a bad GELDAR_DEV_MCP_URL is refused before any lock, state or docker call.
  [void](Get-DevWorldUrl $id)
  Lock-Acquire $id
  Assert-NotHeld $id
  Invoke-PrepareSession $id 'setup'
  Start-PlayerSession $id 'setup'
  Invoke-FinishSession $id @()
  $cf = Join-Path (Get-PlayerDir $id) 'clone'
  $clone = ''
  if (Test-Path -LiteralPath $cf -PathType Leaf) { $clone = Read-FirstLine $cf }
  $text = @(Invoke-Git -C $clone show 'HEAD:memory/identity.md' 2> $null)
  $kept = @($text | ForEach-Object { ([string]$_).TrimEnd("`r") } |
      Where-Object { $_ -notmatch '^\s*\z' -and $_ -cne '# Identity' })
  if ($kept.Count -eq 0 -or ($kept.Count -eq 1 -and $kept[0] -ceq 'Who you are. Written once, at your birth.')) {
    Die 1 setup_empty $id
  }
}
