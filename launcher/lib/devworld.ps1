# The dev-world override (SC-75, decision 33): GELDAR_DEV_MCP_URL, a human-environment seam.
# Dot-sourced; the twin of lib/devworld.sh. The value is checked against one exact shape and
# nothing else: it never goes through Test-McpUrl, which still refuses host.docker.internal.

$script:DEV_WORLD_HOST = 'host.docker.internal'

# The raw value of the seam, or '' when it is unset or empty. Read from the environment only.
function Get-DevWorldRaw {
  $v = [Environment]::GetEnvironmentVariable('GELDAR_DEV_MCP_URL')
  if ($null -eq $v) { return '' }
  return $v
}

# Get-DevWorldUrl id: '' when the seam is unset; the URL when it is exactly
# http://host.docker.internal:<1024-65535>/p/<id>; otherwise dev_world_bad and status 1.
# [0-9] and \z, not \d and $: no other digits, no trailing newline.
function Get-DevWorldUrl([string]$Id) {
  $v = Get-DevWorldRaw
  if ($v -eq '') { return '' }
  $m = [regex]::Match($v, '\Ahttp://host\.docker\.internal:([1-9][0-9]{3,4})/p/([a-z0-9-]+)\z')
  if ($m.Success -and $m.Groups[2].Value -ceq $Id) {
    $port = [int]$m.Groups[1].Value
    if ($port -ge 1024 -and $port -le 65535) { return $v }
  }
  Die 1 dev_world_bad $Id
}