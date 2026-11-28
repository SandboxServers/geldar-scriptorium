# Sign in with ChatGPT is local to one player and vendor volume; never mount a repo or world token.
function Invoke-ChatGPTContainer([string]$Id, [string]$Action) {
  $network = @('--network', 'none')
  if ($Action -ceq 'login') { $network = @('-p', '127.0.0.1:1455:1455') }
  if ($Action -ceq 'models') { $network = @() }
  Invoke-Docker run --rm --init --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges `
    --memory 512m --pids-limit 64 --log-driver none --user 1000:1000 --entrypoint geldar-chatgpt `
    -v "geldar-cli-${Id}-chatgpt:/cli-home" @network $script:PL_KIT_IMAGE $Action
}

function Test-ChatGPTReady([string]$Id) {
  Invoke-ChatGPTContainer $Id status *> $null
  return $LASTEXITCODE -eq 0
}

function Verb-chatgpt_login {
  if ($args.Count -ne 1) { Die 2 usage }
  $id = [string]$args[0]
  Read-Player $id
  if ($script:PL_HARNESS -cne 'chatgpt') { Die 1 chatgpt_wrong_harness }
  Lock-Acquire $id
  Invoke-ChatGPTContainer $id login
  if ($LASTEXITCODE -ne 0) { Die 1 chatgpt_failed }
}

function Verb-chatgpt_models {
  if ($args.Count -ne 1) { Die 2 usage }
  $id = [string]$args[0]
  Read-Player $id
  if ($script:PL_HARNESS -cne 'chatgpt') { Die 1 chatgpt_wrong_harness }
  Lock-Acquire $id
  Invoke-ChatGPTContainer $id models
  if ($LASTEXITCODE -ne 0) { Die 1 chatgpt_failed }
}
