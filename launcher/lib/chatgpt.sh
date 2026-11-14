# Sign in with ChatGPT is local to one player and vendor volume. No repo or world token is mounted.
chatgpt_container() {
  local id=$1 action=$2
  local -a network
  network=(--network none)
  case $action in
    login) network=(-p 127.0.0.1:1455:1455) ;;
    models) network=() ;;
  esac
  docker_cmd run --rm --init --read-only --tmpfs /tmp --cap-drop ALL \
    --security-opt no-new-privileges --memory 512m --pids-limit 64 --log-driver none \
    --user 1000:1000 --entrypoint geldar-chatgpt \
    -v "geldar-cli-$id-chatgpt:/cli-home" "${network[@]}" "$PL_KIT_IMAGE" "$action"
}

chatgpt_ready() { chatgpt_container "$1" status > /dev/null 2>&1; }

verb_chatgpt_login() {
  [ $# -eq 1 ] || die 2 usage
  read_player "$1"
  [ "$PL_HARNESS" = chatgpt ] || die 1 chatgpt_wrong_harness
  lock_acquire "$1"
  chatgpt_container "$1" login || die 1 chatgpt_failed
}

verb_chatgpt_models() {
  [ $# -eq 1 ] || die 2 usage
  read_player "$1"
  [ "$PL_HARNESS" = chatgpt ] || die 1 chatgpt_wrong_harness
  lock_acquire "$1"
  chatgpt_container "$1" models || die 1 chatgpt_failed
}
