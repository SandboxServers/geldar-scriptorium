# Local models (decision 0002), the twin of lib/local.sh: the model server's settings. The base URL and
# the key live in the launcher's state for the player, never in the workspace or in player.json.

# Sets PL_CTX and PL_IMAGES from the committed player.json: each key once in the text, parsed as an
# integer or a boolean, and the context in range. A bad value is bad_player_json.
function Read-LocalFields([string]$Id, [string]$Text, $Json) {
  $script:PL_CTX = ''
  $script:PL_IMAGES = ''
  foreach ($k in 'context_tokens', 'images') {
    $pat = if ($k -ceq 'images') { '"images"\s*:' } else { '"context_tokens"\s*:' }
    if ([regex]::Matches($Text, $pat).Count -ne 1) { Fail-PlayerJson $Id $k }
  }
  # A key that is only nested (not at the top level) has no property here: bad_player_json, not a throw.
  $p = $Json.PSObject.Properties['context_tokens']
  if (-not $p) { Fail-PlayerJson $Id 'context_tokens' }
  $ctx = $p.Value
  if (($ctx -isnot [long]) -and ($ctx -isnot [int])) { Fail-PlayerJson $Id 'context_tokens' }
  if ($ctx -lt 1024 -or $ctx -gt 2000000) { Fail-PlayerJson $Id 'context_tokens' }
  $q = $Json.PSObject.Properties['images']
  if (-not $q) { Fail-PlayerJson $Id 'images' }
  $img = $q.Value
  if ($img -isnot [bool]) { Fail-PlayerJson $Id 'images' }
  $script:PL_CTX = [string]$ctx
  $script:PL_IMAGES = if ($img) { 'true' } else { 'false' }
}

# Sets PL_SECRET_KEY to the stored model server key (one line), empty when absent or a link.
function Set-LocalSecretKey([string]$Id) {
  $script:PL_SECRET_KEY = ''
  $f = Join-Path (Join-Path (Get-PlayerDir $Id) 'local') 'api-key'
  $i = Get-Item -LiteralPath $f -Force -ErrorAction SilentlyContinue
  if ($i -and -not $i.PSIsContainer -and -not $i.LinkType) { $script:PL_SECRET_KEY = Read-FirstLine $f }
}

# The stored base URL (one line), empty when absent or a link.
function Get-LocalBaseUrl([string]$Id) {
  $f = Join-Path (Join-Path (Get-PlayerDir $Id) 'local') 'base-url'
  $i = Get-Item -LiteralPath $f -Force -ErrorAction SilentlyContinue
  if ($i -and -not $i.PSIsContainer -and -not $i.LinkType) { return Read-FirstLine $f }
  return ''
}
