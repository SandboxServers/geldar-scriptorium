# Local models (decision 0002): the model server's settings. The base URL and the key live in the
# launcher's state for the player, never in the workspace or in player.json.

# read_local_fields id text: reads context_tokens and images from the committed player.json text, each
# exactly once and in range. Sets PL_CTX and PL_IMAGES; a bad value is bad_player_json.
read_local_fields() {
  local id=$1 text=$2 k line n v re ctx="" img=""
  for k in context_tokens images; do
    n=0
    v=""
    case $k in
      context_tokens) re='^  "context_tokens": ([0-9]{4,7}),?$' ;;
      *) re='^  "images": (true|false),?$' ;;
    esac
    while IFS= read -r line || [ -n "$line" ]; do
      if [[ $line =~ $re ]]; then
        n=$((n + 1))
        v=${BASH_REMATCH[1]}
      fi
    done << TEXT
$text
TEXT
    [ "$n" -eq 1 ] || pj_fail "$id" "$k"
    case $k in
      context_tokens) ctx=$v ;;
      *) img=$v ;;
    esac
  done
  # 10# reads the digits as decimal, so a leading zero is not octal.
  [ "$((10#$ctx))" -ge 1024 ] && [ "$((10#$ctx))" -le 2000000 ] || pj_fail "$id" 'context_tokens'
  PL_CTX=$((10#$ctx))
  PL_IMAGES=$img
}

# local_key_read id: sets PL_SECRET_KEY to the stored model server key (one line), empty when absent.
local_key_read() {
  local f
  f="$(player_dir "$1")/local/api-key"
  PL_SECRET_KEY=""
  if [ -f "$f" ] && [ ! -L "$f" ]; then
    IFS= read -r PL_SECRET_KEY < "$f" || true
  fi
}

# local_export id: the compose environment for a local player (called inside pl_compose's subshell).
# The base URL and the key are read from the state folder; the key is exported only when stored.
local_export() {
  local id=$1 f base=""
  f="$(player_dir "$id")/local/base-url"
  if [ -f "$f" ] && [ ! -L "$f" ]; then
    IFS= read -r base < "$f" || true
  fi
  export GELDAR_LOCAL_BASE_URL="$base" GELDAR_LOCAL_CONTEXT_TOKENS="$PL_CTX" GELDAR_LOCAL_IMAGES="$PL_IMAGES"
  if [ -n "$PL_SECRET_KEY" ]; then export GELDAR_LOCAL_API_KEY="$PL_SECRET_KEY"; fi
  if [ -z "${GELDAR_RUN_MODEL:-}" ]; then export GELDAR_RUN_MODEL="$PL_MODEL"; fi
}
