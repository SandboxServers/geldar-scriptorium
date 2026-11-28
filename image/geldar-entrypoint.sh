#!/bin/sh
# The kit entrypoint. It seeds the player's CLI home, then runs the base image's
# docker-entrypoint.sh with the same arguments.
#
# Without workspace trust the CLI ignores the workspace's permissions.allow list, and under
# defaultMode dontAsk it refuses every tool. Without the first-run answers the CLI stops at a theme
# picker and a security-notes screen. Without an approval of the kit's MCP servers a dialog asks
# for each one, and the workspace is recreated every session, so an approval could never persist.
#
# Seeding runs only when GELDAR_MODE is set (the launcher sets it for setup and play sessions) and
# /cli-home is a writable directory. It merges into two files and keeps every other key (a
# logged-in session's keys too):
#   /cli-home/.claude.json: projects["/player"].hasTrustDialogAccepted true; hasCompletedOnboarding
#     true; theme "dark" when no theme is set yet.
#   /cli-home/settings.json: enabledMcpjsonServers lists the kit's three servers (added when
#     missing). Only those three are approved: enableAllProjectMcpServers is deliberately NOT set,
#     so a server added to .mcp.json later is not approved automatically.
# Each file is written through a temp file and a rename, with mode 0600. A file that is not valid
# JSON is left alone. The script never prints file contents, makes no network calls, and a
# seeding failure is one stderr line, never a failed container.
#
# Security: the agent cannot read or write /cli-home (managed settings deny it, see
# image/settings/managed.json), so this seeding does not widen anything the agent can do.
#
# GELDAR_CLI_HOME_DIR and GELDAR_TRUST_PATH are for tests; the image uses the defaults.
set -eu

cli_home="${GELDAR_CLI_HOME_DIR:-/cli-home}"
trust_path="${GELDAR_TRUST_PATH:-/player}"
kit_servers="geldar,geldar_memory,geldar_git"

# One merge per run: stdin is the file, the operation and its value, one per line. Exit codes:
# 0 seeded or already set, 2 left unchanged (not JSON or an unexpected shape), 1 any other
# failure. Node prints nothing itself, so no file content can reach stderr.
merge_js='
const fs = require("fs");
const path = require("path");
// Read from stdin: Git bash on Windows rewrites a leading "/" in arguments and environment
// values, but not in piped data.
const [file, op, value] = fs.readFileSync(0, "utf8").split("\n");
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
// A value of the wrong shape is never overwritten: exit 2 leaves the file as it was.
const shape = () => process.exit(2);
const objectAt = (parent, key) => {
  if (parent[key] === undefined) parent[key] = {};
  if (!isObject(parent[key])) shape();
  return parent[key];
};
// Each operation changes the config in place and returns whether it changed anything.
const ops = {
  trust(config) {
    const entry = objectAt(objectAt(config, "projects"), value);
    if (entry.hasTrustDialogAccepted === true) return false;
    entry.hasTrustDialogAccepted = true;
    return true;
  },
  onboarding(config) {
    let changed = false;
    if (config.hasCompletedOnboarding !== true) {
      config.hasCompletedOnboarding = true;
      changed = true;
    }
    if (config.theme === undefined) {
      config.theme = "dark";
      changed = true;
    }
    return changed;
  },
  mcp(config) {
    if (config.enabledMcpjsonServers === undefined) config.enabledMcpjsonServers = [];
    if (!Array.isArray(config.enabledMcpjsonServers)) shape();
    let changed = false;
    for (const name of value.split(",")) {
      if (!config.enabledMcpjsonServers.includes(name)) {
        config.enabledMcpjsonServers.push(name);
        changed = true;
      }
    }
    return changed;
  },
};
if (!Object.hasOwn(ops, op)) process.exit(1);
let raw = null;
try {
  raw = fs.readFileSync(file, "utf8");
} catch (err) {
  if (err.code !== "ENOENT") process.exit(1);
}
let config = {};
if (raw !== null) {
  try {
    config = JSON.parse(raw);
  } catch (err) {
    process.exit(2);
  }
}
if (!isObject(config)) process.exit(2);
if (!ops[op](config)) process.exit(0);
const tmp = path.join(path.dirname(file), path.basename(file) + "." + process.pid + ".tmp");
try {
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, file);
} catch (err) {
  try {
    fs.rmSync(tmp, { force: true });
  } catch (ignored) {
    // Nothing more to clean up; the exit code below reports the failure.
  }
  process.exit(1);
}
process.exit(0);
'

# Runs one merge on one file and prints one stderr line when it does not succeed.
merge() {
  status=0
  printf '%s\n%s\n%s\n' "$1" "$2" "$3" | node -e "$merge_js" || status=$?
  case $status in
    0) ;;
    2) echo "geldar-entrypoint: $1 is not valid JSON or has an unexpected shape; left unchanged, $2 not seeded" >&2 ;;
    *) echo "geldar-entrypoint: could not seed $2 in $1" >&2 ;;
  esac
  return "$status"
}

seed_cli_home() {
  [ -n "${GELDAR_MODE:-}" ] || return 0
  if [ ! -d "$cli_home" ] || [ ! -w "$cli_home" ]; then
    echo "geldar-entrypoint: $cli_home is not a writable directory; CLI settings not seeded" >&2
    return 0
  fi
  # A failed .claude.json merge skips its second step (one line on stderr), not settings.json.
  merge "$cli_home/.claude.json" trust "$trust_path" && merge "$cli_home/.claude.json" onboarding "" || true
  merge "$cli_home/settings.json" mcp "$kit_servers" || true
  return 0
}

seed_cli_home || echo "geldar-entrypoint: CLI home seeding failed; continuing" >&2
exec docker-entrypoint.sh "$@"
