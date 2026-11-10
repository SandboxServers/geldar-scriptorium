# play with two or more ids: one Windows Terminal tab per player. Dot-sourced; the twin of
# lib/multi.sh. Without wt, one pwsh window per id.

# The wt executable: GELDAR_WT under GELDAR_INTERNAL=1, else wt on PATH (or GELDAR_TOOL_PATH).
# Returns '' when there is none.
function Get-WtExe {
  $t = Get-GatedEnv 'GELDAR_WT'
  if ($t) {
    if (Test-Path -LiteralPath $t -PathType Leaf) { return $t }
    return ''
  }
  $tp = Get-GatedEnv 'GELDAR_TOOL_PATH'
  if ($tp) {
    $saved = $env:PATH
    try {
      $env:PATH = $tp
      $c = Get-Command wt -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    } finally {
      $env:PATH = $saved
    }
  } else {
    $c = Get-Command wt -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  }
  if ($c) { return $c.Source }
  return ''
}

# Every tab is its own pwsh running this launcher with play <id>; the arguments are an array,
# never one command line string, so a path with a space stays one argument.
function Get-TabArgs([string]$Id) {
  $script = Join-Path $GP_DIR 'geldar-play.ps1'
  return @([Environment]::ProcessPath, '-NoProfile', '-File', $script, 'play', $Id)
}

function Verb-play_many {
  $ids = @($args | ForEach-Object { [string]$_ })
  $seen = @{}
  foreach ($id in $ids) {
    if (-not (Test-PlayerId $id)) { Die 2 bad_player_id $id }
    if ($seen.ContainsKey($id)) { Die 1 dup_player $id }
    $seen[$id] = $true
  }
  # SC-75: one dev URL cannot reach a second player.
  if ((Get-DevWorldRaw) -ne '') { Die 1 dev_world_single }
  if ($ids.Count -gt 3) { Say many_players }
  $wt = Get-WtExe
  if ($wt) {
    $first = $true
    foreach ($id in $ids) {
      if ($first) {
        & $wt new-tab --title $id @(Get-TabArgs $id)
        $first = $false
      } else {
        & $wt -w 0 new-tab --title $id @(Get-TabArgs $id)
      }
      if ($LASTEXITCODE -ne 0) { Die 1 usage }
    }
    return
  }
  foreach ($id in $ids) {
    $t = @(Get-TabArgs $id)
    $argList = @($t | Select-Object -Skip 1 | ForEach-Object { if ($_ -match '\s') { '"' + $_ + '"' } else { $_ } })
    Start-Process -FilePath $t[0] -ArgumentList $argList | Out-Null
  }
}
