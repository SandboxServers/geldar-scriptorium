# The host re-check (H-13): the same rules as geldar-verify, re-done with host git so a flaw in
# the gate image alone cannot let a bad session through. Sourced; bash 3.2 syntax only.
GP_GROUPS="$GP_GROUPS bundle"

# path_allowed path mode: the shell twin of packages/path-rule (spec section 7).
path_allowed() {
  local p=$1 mode=$2 lower rest part stem lc
  local LC_ALL=C
  lower=$(printf '%s' "$p" | tr 'A-Z' 'a-z')
  if [ "$lower" = "memory/identity.md" ]; then
    [ "$p" = "memory/identity.md" ] && [ "$mode" = "setup" ]
    return
  fi
  case $lower in memory/identity.md/*) return 1 ;; esac
  case $p in
    memory/people/.gitkeep | memory/journal/current.md) return 0 ;;
  esac
  [[ $p =~ ^(memory|skills)/[A-Za-z0-9._/-]+\.(md|js|json)$ ]] || return 1
  [ "${#p}" -le 200 ] || return 1
  rest=$p
  while :; do
    part=${rest%%/*}
    [ -n "$part" ] || return 1
    case $part in
      .* | *.) return 1 ;;
    esac
    [ "${#part}" -le 64 ] || return 1
    stem=${part%%.*}
    lc=$(printf '%s' "$stem" | tr 'A-Z' 'a-z')
    [[ $lc =~ ^(con|prn|aux|nul|com[0-9]|lpt[0-9])$ ]] && return 1
    case $rest in
      */*) rest=${rest#*/} ;;
      *) break ;;
    esac
  done
  return 0
}

# host_recheck clone start ref mode: 0 when the range start..ref is acceptable, else 1 with the
# first violating path (through sanitize) in RC_WHY.
host_recheck() {
  local clone=$1 start=$2 ref=$3 mode=$4 meta p dmode n
  RC_WHY=""
  export GIT_NO_REPLACE_OBJECTS=1
  git_cmd -C "$clone" merge-base --is-ancestor "$start" "$ref" > /dev/null 2>&1 || {
    RC_WHY='history'
    return 1
  }
  n=$(git_cmd -C "$clone" rev-list --merges "$start..$ref" 2> /dev/null | head -n 1)
  [ -z "$n" ] || {
    RC_WHY='merge'
    return 1
  }
  n=$(git_cmd -C "$clone" rev-list --count "$start..$ref" 2> /dev/null) || n=999999
  [ "$n" -le 2000 ] 2> /dev/null || {
    RC_WHY='too many commits'
    return 1
  }
  while IFS= read -r -d '' meta; do
    IFS= read -r -d '' p || {
      RC_WHY='unreadable'
      return 1
    }
    dmode=${meta#:* }
    dmode=${dmode%% *}
    case $dmode in
      100644 | 000000) ;;
      *)
        RC_WHY=$(printf '%s' "$p" | sanitize)
        return 1
        ;;
    esac
    path_allowed "$p" "$mode" || {
      RC_WHY=$(printf '%s' "$p" | sanitize)
      return 1
    }
  done < <(git_cmd -C "$clone" diff --raw -z --no-renames --no-textconv --no-ext-diff "$start" "$ref" 2> /dev/null; [ $? -eq 0 ] || printf 'x\0x\0')
  [ -z "$RC_WHY" ] || return 1
  recheck_collision "$clone" "$start" "$ref"
}

# recheck_collision clone start ref: rejects a spelling in the end tree that differs only by ASCII
# case from another and is new (decision 28). Members are the files and every directory prefix.
recheck_collision() {
  local clone=$1 start=$2 ref=$3 hit
  hit=$(
    {
      git_cmd -C "$clone" ls-tree -r -z --name-only "$start" 2> /dev/null | tr '\0' '\n' | sed 's/^/S\t/'
      git_cmd -C "$clone" ls-tree -r -z --name-only "$ref" 2> /dev/null | tr '\0' '\n' | sed 's/^/E\t/'
    } | LC_ALL=C awk -F'\t' '
      function member(t, p,   i, n, parts, acc) {
        n = split(p, parts, "/"); acc = ""
        for (i = 1; i <= n; i++) {
          acc = (i == 1) ? parts[1] : acc "/" parts[i]
          if (t == "S") inS[acc] = 1
          else if (!(acc in seen)) { seen[acc] = 1; ord[++cnt] = acc }
        }
      }
      { member($1, $2) }
      END {
        for (i = 1; i <= cnt; i++) {
          l = ord[i]; f = tolower(l)
          if (!(f in first)) { first[f] = l; if (!(l in inS)) fresh[f] = l; continue }
          if (!(l in inS)) { print l; exit }
          if (f in fresh) { print fresh[f]; exit }
        }
      }'
  ) || true
  [ -z "$hit" ] && return 0
  RC_WHY="$(msg_text recheck_case_collision): $(printf '%s' "$hit" | sanitize)"
  return 1
}
