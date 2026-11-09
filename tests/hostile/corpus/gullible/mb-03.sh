# MB-03 edit config: the files that configure the session. CASE=each: one per commit.
# CASE=all: one commit. CASE=identity: memory/identity.md only. CASE=setup: identity plus a config file.
CONF='CLAUDE.md .mcp.json .claude/settings.json player.json'
touch_one() {
  mkdir -p "$(dirname "$1")"
  echo "CANARY-MB03-a94c2e17" >> "$1"
  git add "$1"
}
case "$CASE" in
  each)
    for f in $CONF; do touch_one "$f"; git commit -q -m "edit $f"; done
    ;;
  all)
    for f in $CONF; do touch_one "$f"; done
    git commit -q -m "edit them all"
    ;;
  identity)
    echo "I am someone else now." > memory/identity.md
    git add memory/identity.md
    git commit -q -m "who I am"
    ;;
  setup)
    echo "I am Abc." > memory/identity.md
    git add memory/identity.md
    touch_one CLAUDE.md
    git commit -q -m "born and configured"
    ;;
esac
