# upgrade: move a player's kit files to a template release as a pull request (0008, SC-64).
# The release is hostile input: it is validated from the object database before one file is
# copied, nothing is evaled, and memory/ and skills/ are never touched. Sourced; bash 3.2 syntax.


UP_TEMPLATE_URL='https://github.com/SandboxServers/geldar-player-template.git'
UP_VER_RE='^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.]+)?$'
UP_TMP=""
UP_CLONE=""
UP_ORIG=""
UP_BRANCH=""
UP_DIGEST=""
UP_NEW_IMAGE=""

# Runs on every exit: back to the original branch, the upgrade branch deleted, the lock and the
# temp directory released.
up_exit() {
  if [ -n "$UP_CLONE" ] && [ -n "$UP_ORIG" ]; then
    if [ -n "$UP_BRANCH" ]; then
      git_cmd -C "$UP_CLONE" reset --hard -q > /dev/null 2>&1
      git_cmd -C "$UP_CLONE" clean -fdq > /dev/null 2>&1
    fi
    git_cmd -C "$UP_CLONE" checkout -q "$UP_ORIG" > /dev/null 2>&1
    if [ -n "$UP_BRANCH" ]; then
      git_cmd -C "$UP_CLONE" branch -D "$UP_BRANCH" > /dev/null 2>&1
    fi
  fi
  lock_release
  [ -z "$UP_TMP" ] || rm -rf "$UP_TMP"
}

# Digit strings without leading zeros: lt, eq or gt.
up_num_cmp() {
  if [ "${#1}" -ne "${#2}" ]; then
    if [ "${#1}" -lt "${#2}" ]; then echo lt; else echo gt; fi
  elif [ "$1" = "$2" ]; then
    echo eq
  elif [[ $1 < $2 ]]; then
    echo lt
  else
    echo gt
  fi
}

# up_cmp a b: lt, eq or gt for two versions (build metadata ignored; empty means 0.0.0).
up_cmp() {
  local a=${1%%+*} b=${2%%+*} pa="" pb="" a1 a2 a3 b1 b2 b3 r
  [ -n "$a" ] || a=0.0.0
  [ -n "$b" ] || b=0.0.0
  case $a in *-*) pa=${a#*-} ;; esac
  case $b in *-*) pb=${b#*-} ;; esac
  IFS=. read -r a1 a2 a3 << EOT
${a%%-*}
EOT
  IFS=. read -r b1 b2 b3 << EOT
${b%%-*}
EOT
  for r in "$(up_num_cmp "$a1" "$b1")" "$(up_num_cmp "$a2" "$b2")" "$(up_num_cmp "$a3" "$b3")"; do
    if [ "$r" != eq ]; then
      echo "$r"
      return 0
    fi
  done
  if [ "$pa" = "$pb" ]; then
    echo eq
  elif [ -z "$pa" ]; then
    echo gt
  elif [ -z "$pb" ]; then
    echo lt
  elif [[ $pa < $pb ]]; then
    echo lt
  else
    echo gt
  fi
}

# The versions of the template's well-formed kit-v tags, one per line, in listed order.
up_tag_versions() {
  local out=$1 sha ref name
  while IFS=$'\t' read -r sha ref || [ -n "$sha" ]; do
    case $ref in refs/tags/kit-v*) ;; *) continue ;; esac
    name=${ref#refs/tags/kit-v}
    if [[ $name =~ $UP_VER_RE ]]; then
      printf '%s\n' "$name"
    fi
  done < "$out"
}

# The value of one top-level key of a player.json text (exactly once, else status 1).
up_pj_value() {
  local text=$1 k=$2 line n=0 v="" re
  re="^  \"$k\": \"(.*)\",?\$"
  while IFS= read -r line || [ -n "$line" ]; do
    if [[ $line =~ $re ]]; then
      n=$((n + 1))
      v=${BASH_REMATCH[1]}
    fi
  done << TEXT
$text
TEXT
  [ "$n" -eq 1 ] || return 1
  printf '%s' "$v"
}

# Checks the release's tree from the object database. $1 is the clone, $2 the version.
up_validate() {
  local rel=$1 ver=$2 listing mode type sha size path meta c n=0 total=0 top
  local topre='^[A-Za-z0-9._-]+$' text kv ki msg l image="" tmpl="" launch="" dig tail3
  local parts
  listing="$UP_TMP/listing"
  git_cmd -C "$rel" ls-tree -r -l -z HEAD > "$listing" 2> /dev/null || return 1
  while IFS= read -r -d '' meta; do
    path=${meta#*$'\t'}
    read -r mode type sha size << EOT
${meta%%$'\t'*}
EOT
    case $mode in 100644 | 100755) ;; *) return 1 ;; esac
    [ "$type" = blob ] || return 1
    case $path in *[[:cntrl:]]* | *\\* | *:*) return 1 ;; esac
    top=${path%%/*}
    [[ $top =~ $topre ]] || return 1
    IFS=/ read -r -a parts << EOT
$path
EOT
    for c in "${parts[@]}"; do
      case $c in
        '' | . | .. | .[gG][iI][tT] | [gG][iI][tT]~*) return 1 ;;
      esac
    done
    n=$((n + 1))
    total=$((total + size))
    [ "$n" -le 200 ] || return 1
    [ "$total" -le 5242880 ] || return 1
  done < "$listing"
  [ "$n" -ge 1 ] || return 1
  text=$(git_cmd -C "$rel" show HEAD:player.json 2> /dev/null) || return 1
  kv=$(up_pj_value "$text" kit_version) || return 1
  ki=$(up_pj_value "$text" kit_image) || return 1
  [ "$kv" = "$ver" ] || return 1
  valid_kit_image "$ki" || return 1
  dig=${ki#*@}
  msg=$(git_cmd -C "$rel" log -1 --format=%B HEAD 2> /dev/null) || return 1
  tail3=$(printf '%s\n' "$msg" | tail -n 3)
  while IFS= read -r l || [ -n "$l" ]; do
    case $l in
      image:\ *) image=${l#image: } ;;
      template:\ *) tmpl=${l#template: } ;;
      launcher:\ *) launch=${l#launcher: } ;;
    esac
  done << EOT
$tail3
EOT
  [[ $tmpl =~ ^[0-9a-f]{40}$ ]] || return 1
  [[ $launch =~ ^[0-9A-Za-z.+-]+$ ]] || return 1
  [[ $image =~ ^sha256:[0-9a-f]{64}$ ]] || return 1
  [ "$image" = "$dig" ] || return 1
  UP_DIGEST=$dig
  UP_NEW_IMAGE=$ki
  return 0
}

# Rewrites the two keys of player.json (all other bytes kept, LF).
up_set_keys() {
  local f=$1 ver=$2 img=$3 line out re1 re2
  re1='^(  "kit_version": ")(.*)(",?)$'
  re2='^(  "kit_image": ")(.*)(",?)$'
  out="$f.new"
  : > "$out"
  while IFS= read -r line || [ -n "$line" ]; do
    if [[ $line =~ $re1 ]]; then
      line="${BASH_REMATCH[1]}$ver${BASH_REMATCH[3]}"
    elif [[ $line =~ $re2 ]]; then
      line="${BASH_REMATCH[1]}$img${BASH_REMATCH[3]}"
    fi
    printf '%s\n' "$line" >> "$out"
  done < "$f"
  mv "$out" "$f"
}

# After the commit: no path under memory/ or skills/, and player.json differs only in its two keys.
up_selfcheck() {
  local clone=$1 orig=$2 p line names diff
  names="$UP_TMP/names"
  git_cmd -C "$clone" diff --name-only -z "$orig" HEAD > "$names" 2> /dev/null || return 1
  while IFS= read -r -d '' p; do
    case $p in memory | memory/* | skills | skills/*) return 1 ;; esac
  done < "$names"
  diff=$(git_cmd -C "$clone" diff -U0 --no-color "$orig" HEAD -- player.json 2> /dev/null) || return 1
  while IFS= read -r line; do
    case $line in
      '+++'* | '---'*) ;;
      '+  "kit_version": '* | '-  "kit_version": '* | '+  "kit_image": '* | '-  "kit_image": '*) ;;
      +* | -*) return 1 ;;
    esac
  done << EOT
$diff
EOT
  return 0
}

verb_upgrade() {
  local id=$1 d to="" url ver cur cmp tags best v out rel hk name body url_out line tip
  shift
  while [ $# -gt 0 ]; do
    case $1 in
      --to)
        [ $# -ge 2 ] || die 2 usage
        to=$2
        shift 2
        ;;
      *) die 2 usage ;;
    esac
  done
  if [ -n "$to" ] && ! [[ $to =~ $UP_VER_RE ]]; then
    die 2 usage
  fi
  d=$(player_dir "$id")
  read_player "$id"
  lock_acquire "$id"
  UP_CLONE=$PL_CLONE
  UP_TMP=$(mktemp -d "${TMPDIR:-/tmp}/gp-upg.XXXXXX") || die 1 upgrade_dirty
  trap 'up_exit' EXIT
  trap 'exit 130' INT TERM
  [ ! -d "$d/held" ] || die 1 upgrade_held
  [ ! -f "$d/session/running" ] || die 1 locked "$id"
  # H-01, H-02
  out=$(git_cmd -C "$PL_CLONE" status --porcelain --untracked-files=all 2> /dev/null) || die 1 upgrade_dirty
  [ -z "$out" ] || die 1 upgrade_dirty
  out=$(git_cmd -C "$PL_CLONE" symbolic-ref -q --short HEAD 2> /dev/null)
  [ "$out" = "$PL_BRANCH" ] || die 1 upgrade_dirty
  run_bounded 120 git_cmd -C "$PL_CLONE" pull --ff-only > /dev/null 2>&1 || die 1 upgrade_dirty
  read_player "$id"
  cur=$PLV_kit_version

  url=$(gp_env GELDAR_TEMPLATE_URL)
  [ -n "$url" ] || url=$UP_TEMPLATE_URL
  out="$UP_TMP/tags"
  run_bounded 60 git_cmd ls-remote --tags --refs "$url" 'refs/tags/kit-v*' > "$out" 2> /dev/null ||
    die 1 upgrade_no_release
  tags=$(up_tag_versions "$out")
  ver=""
  if [ -n "$to" ]; then
    while IFS= read -r v; do
      if [ "$v" = "$to" ]; then ver=$v; fi
    done << EOT
$tags
EOT
  else
    best=""
    while IFS= read -r v; do
      [ -n "$v" ] || continue
      case $v in *-*) continue ;; esac
      if [ -z "$best" ] || [ "$(up_cmp "$v" "$best")" = gt ]; then
        best=$v
      fi
    done << EOT
$tags
EOT
    ver=$best
  fi
  [ -n "$ver" ] || die 1 upgrade_no_release
  cmp=$(up_cmp "$ver" "$cur")
  if [ "$cmp" = eq ]; then
    say upgrade_current "$ver"
    return 0
  fi
  [ "$cmp" != lt ] || die 1 upgrade_downgrade "$ver" "$cur"

  # Fetch and validate the release.
  rel="$UP_TMP/release"
  hk="$UP_TMP/hooks"
  mkdir -p "$hk"
  run_bounded 120 git_cmd -c "core.hooksPath=$hk" -c fetch.fsckObjects=true -c transfer.fsckObjects=true \
    clone -q --no-checkout --depth 1 --branch "kit-v$ver" "$url" "$rel" > /dev/null 2>&1 ||
    die 1 upgrade_bad_release "$ver"
  up_validate "$rel" "$ver" || die 1 upgrade_bad_release "$ver"

  # The branch.
  UP_ORIG=$PL_BRANCH
  name="kit-upgrade/$ver"
  valid_branch "$name" || die 1 upgrade_bad_release "$ver"
  if git_cmd -C "$PL_CLONE" show-ref --verify --quiet "refs/heads/$name" ||
    git_cmd -C "$PL_CLONE" show-ref --verify --quiet "refs/remotes/origin/$name"; then
    die 1 upgrade_branch_exists "$name"
  fi
  tip=$(git_cmd -C "$PL_CLONE" rev-parse HEAD) || die 1 upgrade_dirty
  git_cmd -C "$PL_CLONE" checkout -q -b "$name" > /dev/null 2>&1 || die 1 upgrade_dirty
  UP_BRANCH=$name
  git_cmd -C "$rel" checkout -q HEAD -- . > /dev/null 2>&1 || die 1 upgrade_bad_release "$ver"
  git_cmd -C "$PL_CLONE" ls-tree --name-only -z "$tip" > "$UP_TMP/old" 2> /dev/null || die 1 upgrade_dirty
  while IFS= read -r -d '' v; do
    case $v in memory | skills | .git | player.json) continue ;; esac
    git_cmd -C "$PL_CLONE" rm -rq --ignore-unmatch -- "$v" > /dev/null 2>&1 || die 1 upgrade_bad_release "$ver"
    rm -rf "${PL_CLONE:?}/$v"
  done < "$UP_TMP/old"
  for v in "$rel"/* "$rel"/.[!.]*; do
    [ -e "$v" ] || continue
    v=${v##*/}
    case $v in memory | skills | .git | player.json) continue ;; esac
    cp -R "$rel/$v" "$PL_CLONE/$v" || die 1 upgrade_bad_release "$ver"
  done
  up_set_keys "$PL_CLONE/player.json" "$ver" "$UP_NEW_IMAGE"
  git_cmd -C "$PL_CLONE" add -A > /dev/null 2>&1 || die 1 upgrade_bad_release "$ver"
  printf 'upgrade the kit to %s\n\nimage: %s\n' "$ver" "$UP_DIGEST" |
    git_cmd -C "$PL_CLONE" commit -q -F - > /dev/null 2>&1 || die 1 upgrade_bad_release "$ver"
  up_selfcheck "$PL_CLONE" "$tip" || die 1 upgrade_bad_release "$ver"

  # Push the branch (never forced, never the player branch) and ask for the pull request.
  run_bounded 120 git_cmd -C "$PL_CLONE" push -q origin "$name" > /dev/null 2>&1 || die 1 upgrade_pr_failed "$name"
  body="Kit upgrade from ${cur:-none} to $ver.
Image: $UP_DIGEST

Files changed:
$(git_cmd -C "$PL_CLONE" diff --name-status "$tip" HEAD | head -n 100)

$(printf -- "$(msg_text upgrade_verify)" "$UP_DIGEST")"
  url_out="$UP_TMP/pr"
  cd "$PL_CLONE" || die 1 upgrade_pr_failed "$name"
  run_bounded 60 "${GELDAR_GH:-gh}" pr create --base "$PL_BRANCH" --head "$name" \
    --title "Upgrade the kit to $ver" --body "$body" > "$url_out" 2> /dev/null ||
    die 1 upgrade_pr_failed "$name"
  line=""
  while IFS= read -r v || [ -n "$v" ]; do
    if [ -n "$v" ]; then line=$v; fi
  done < "$url_out"
  line=$(printf '%s' "${line:0:300}" | sanitize)
  say upgrade_done "$ver" "$line"
}
