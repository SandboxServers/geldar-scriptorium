# geldar-play auth-set, auth-status, auth-clear (SC-140). Sourced; bash 3.2 syntax only.
# One long-lived Claude login token per machine, kept in one owner-only file and passed to every
# session container as an environment variable of the compose process (see start_session).

auth_dir() {
  printf '%s/auth' "$(state_dir)"
}

auth_file() {
  printf '%s/claude-oauth-token' "$(auth_dir)"
}

# auth_clean: the raw text on stdin, one trailing LF or CRLF dropped; prints the token when what is
# left is one line of the allowed shape, else fails. Nothing is ever printed on failure.
auth_clean() {
  local raw re='^[A-Za-z0-9._~-]+$'
  raw=$(
    cat
    printf x
  )
  raw=${raw%x}
  raw=${raw%$'\n'}
  raw=${raw%$'\r'}
  case $raw in
    *$'\n'*) return 1 ;;
  esac
  # The interval {20,400} is over the regex engines' repeat limit, so the length is checked apart.
  [[ $raw =~ $re ]] && [ "${#raw}" -ge 20 ] && [ "${#raw}" -le 400 ] || return 1
  printf '%s' "$raw"
}

# auth_load: prints the stored token, or fails when there is none or it is not valid.
auth_load() {
  local f
  f=$(auth_file)
  [ -f "$f" ] && [ ! -L "$f" ] || return 1
  auth_clean < "$f"
}

# auth_mode_private path: true when the group and other bits are all clear.
auth_mode_private() {
  local m
  m=$(stat -c %a "$1" 2> /dev/null || stat -f %Lp "$1" 2> /dev/null) || return 1
  [[ $m =~ ^[0-7]?[0-7]00$ ]]
}

verb_auth_set() {
  local tok="" src="" f d
  case $# in
    0) ;;
    2) [ "$1" = "--token-file" ] && src=$2 || die 2 usage ;;
    *) die 2 usage ;;
  esac
  if [ -n "$src" ]; then
    [ -f "$src" ] || die 1 auth_bad_token
    tok=$(auth_clean < "$src") || die 1 auth_bad_token
  elif [ -t 0 ]; then
    say auth_set_prompt
    IFS= read -r -s tok || true
    printf '\n' >&2
    tok=$(printf '%s\n' "$tok" | auth_clean) || die 1 auth_bad_token
  else
    tok=$(auth_clean) || die 1 auth_bad_token
  fi
  d=$(auth_dir)
  f=$(auth_file)
  private_mkdir "$(state_dir)" && private_mkdir "$d" || die 1 bad_state_path
  [ ! -L "$f" ] && [ ! -L "$f.new" ] || die 1 bad_state_path
  (umask 077 && printf '%s\n' "$tok" > "$f.new") && chmod 600 "$f.new" && mv -f "$f.new" "$f" ||
    die 1 bad_state_path
  say auth_set_done
}

verb_auth_status() {
  local f
  [ $# -eq 0 ] || die 2 usage
  f=$(auth_file)
  if ! auth_load > /dev/null; then
    say auth_status_not_set
    return 0
  fi
  if auth_mode_private "$f" && auth_mode_private "$(auth_dir)"; then
    say auth_status_set
  else
    say auth_status_open_mode
  fi
}

verb_auth_clear() {
  [ $# -eq 0 ] || die 2 usage
  rm -f "$(auth_file)" "$(auth_file).new" || die 1 bad_state_path
  say auth_cleared
}
