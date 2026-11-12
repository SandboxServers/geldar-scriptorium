#!/bin/sh
# A fake gh for the launcher tests (SC-52a). Logs every call (tab-separated argv) to
# $FAKE_GH_ROOT/calls.log. `repo create NAME ... --public|--private` makes the bare repository
# $FAKE_GH_ROOT/NAME.git from $FAKE_GH_TEMPLATE and records the visibility in NAME.vis.
# `repo clone NAME` clones it into ./NAME. FAKE_GH_CLONE_FAILS=n makes the first n clones fail;
# FAKE_GH_CLONE_EMPTY=n makes the first n clones an empty repository (a .git with no commits, as
# GitHub can answer before the template is in); FAKE_GH_SLEEP=n makes every call sleep n seconds
# first (SIGPIPE ignored); FAKE_GH_CREATE_FAIL=1 makes create fail; FAKE_GH_REJECT_PUSH=1 makes the
# new repository refuse every push. `pr create` appends its arguments to prs.log and prints FAKE_GH_PR_URL (default a
# fake URL); FAKE_GH_PR_FAIL=1 makes it fail.
: "${FAKE_GH_ROOT:?FAKE_GH_ROOT is not set}"
mkdir -p "$FAKE_GH_ROOT"
tab=$(printf '\t')
line=""
sep=""
for a in "$@"; do
  line="$line$sep$a"
  sep=$tab
done
printf '%s\n' "$line" >> "$FAKE_GH_ROOT/calls.log"

if [ -n "${FAKE_GH_SLEEP:-}" ]; then
  trap '' PIPE
  sleep "$FAKE_GH_SLEEP" &
  wait
  exit 1
fi

if [ "${1:-}" = "pr" ]; then
  [ "${2:-}" = "create" ] || exit 99
  [ -z "${FAKE_GH_PR_FAIL:-}" ] || exit 1
  # One PR is one prs.log line: newlines in the body are written as a backslash and n, and a
  # --body-file's contents are appended as a last field, so assertions see the whole body.
  rec=$line
  prev=""
  for a in "$@"; do
    if [ "$prev" = "--body-file" ] && [ -f "$a" ]; then rec="$rec${tab}BODYFILE=$(cat "$a")"; fi
    prev=$a
  done
  printf '%s\n' "$rec" | awk 'BEGIN { ORS = "" } NR > 1 { print "\\n" } { print } END { print "\n" }' >> "$FAKE_GH_ROOT/prs.log"
  printf '%s
' "${FAKE_GH_PR_URL:-https://github.test/pull/1}"
  exit 0
fi
# `api repos/OWNER/NAME/contents --jq ...` prints the top-level names of the bare repository
# $FAKE_GH_ROOT/NAME.git, as a JSON array, as `--jq map(.name)` would (a repository with no commit fails, as GitHub's 404 does).
if [ "${1:-}" = "api" ]; then
  r=${2#repos/}
  r=${r%/contents}
  names=$(git -C "$FAKE_GH_ROOT/${r#*/}.git" ls-tree --name-only main 2> /dev/null) || exit 1
  printf '%s\n' "$names" | awk 'BEGIN { printf "[" } NF { printf "%s\"%s\"", (n++ ? "," : ""), $0 } END { print "]" }'
  exit 0
fi
[ "${1:-}" = "repo" ] || exit 99
sub=${2:-}
name=${3:-}
case $sub in
  create)
    [ -z "${FAKE_GH_CREATE_FAIL:-}" ] || exit 1
    vis=public
    for a in "$@"; do
      [ "$a" != "--private" ] || vis=private
    done
    bare="$FAKE_GH_ROOT/$name.git"
    [ ! -e "$bare" ] || exit 1
    git init -q --bare -b main "$bare" || exit 1
    tmp=$(mktemp -d) || exit 1
    cp -R "$FAKE_GH_TEMPLATE/." "$tmp/" || exit 1
    git -C "$tmp" init -q -b main || exit 1
    git -C "$tmp" add -A || exit 1
    GIT_AUTHOR_NAME=Template GIT_AUTHOR_EMAIL=template@example.test GIT_COMMITTER_NAME=Template GIT_COMMITTER_EMAIL=template@example.test git -C "$tmp" -c user.name=Template -c user.email=template@example.test -c commit.gpgsign=false commit -q -m template || exit 1
    git -C "$tmp" push -q "$bare" main || exit 1
    rm -rf "$tmp"
    if [ -n "${FAKE_GH_REJECT_PUSH:-}" ]; then
      printf '#!/bin/sh\nexit 1\n' > "$bare/hooks/pre-receive" || exit 1
      chmod +x "$bare/hooks/pre-receive" || exit 1
    fi
    echo "$vis" > "$FAKE_GH_ROOT/$name.vis"
    ;;
  view)
    # The adopted repository exists as NAME.git with its visibility in NAME.vis.
    [ -d "$FAKE_GH_ROOT/${name#*/}.git" ] || exit 1
    printf '{"isEmpty":false,"name":"%s","visibility":"%s"}\n' "${name#*/}" \
      "$(tr 'a-z' 'A-Z' < "$FAKE_GH_ROOT/${name#*/}.vis")"
    ;;
  clone)
    if [ "$name" = SandboxServers/geldar-player-template ]; then
      # The template is cloned into ./DIR; FAKE_GH_TEMPLATE_LINK=1 puts a symlink entry in its index.
      tmp=$(mktemp -d) || exit 1
      cp -R "$FAKE_GH_TEMPLATE/." "$tmp/" || exit 1
      git -C "$tmp" init -q -b main || exit 1
      git -C "$tmp" add -A || exit 1
      GIT_AUTHOR_NAME=Template GIT_AUTHOR_EMAIL=template@example.test GIT_COMMITTER_NAME=Template GIT_COMMITTER_EMAIL=template@example.test git -C "$tmp" -c user.name=Template -c user.email=template@example.test -c commit.gpgsign=false commit -q -m template || exit 1
      git clone -q "$tmp" "${4:-tpl}" || exit 1
      rm -rf "$tmp"
      if [ -n "${FAKE_GH_TEMPLATE_LINK:-}" ]; then
        blob=$(printf README.md | git -C "${4:-tpl}" hash-object -w --stdin) || exit 1
        git -C "${4:-tpl}" update-index --add --cacheinfo "120000,$blob,link" || exit 1
      fi
      exit 0
    fi
    case $name in
      */*) bare="$FAKE_GH_ROOT/${name#*/}.git" dest=${4:-${name#*/}} ;;
      *) bare="$FAKE_GH_ROOT/$name.git" dest=$name ;;
    esac
    n=$(cat "$FAKE_GH_ROOT/clones" 2> /dev/null || echo 0)
    n=$((n + 1))
    echo "$n" > "$FAKE_GH_ROOT/clones"
    [ "$n" -gt "${FAKE_GH_CLONE_FAILS:-0}" ] || exit 1
    if [ "$n" -le "${FAKE_GH_CLONE_EMPTY:-0}" ]; then
      git init -q -b main "$dest" || exit 1
      exit 0
    fi
    git clone -q "$bare" "$dest" || exit 1
    ;;
  archive)
    [ -d "$FAKE_GH_ROOT/${name#*/}.git" ] || [ -z "${FAKE_GH_ARCHIVE_NEEDS_REPO:-}" ] || exit 1
    echo archived > "$FAKE_GH_ROOT/${name##*/}.archived"
    ;;
  *) exit 99 ;;
esac
