#!/bin/sh
# The kit entrypoint. It seeds Claude Code's workspace trust for /player, then runs the base
# image's docker-entrypoint.sh with the same arguments.
#
# Without that trust the CLI ignores the workspace's permissions.allow list, and under
# defaultMode dontAsk it refuses every tool. Seeding runs only when GELDAR_MODE is set (the
# launcher sets it for setup and play sessions) and /cli-home is a writable directory. It merges
# {"projects":{"/player":{"hasTrustDialogAccepted":true}}} into /cli-home/.claude.json, keeping
# every other key (a logged-in session's keys too). The file is written through a temp file and a
# rename, with mode 0600. A file that is not valid JSON is left alone. The script never prints file
# contents, makes no network calls, and a seeding failure is one stderr line, never a failed
# container.
#
# Security: the agent cannot read or write /cli-home (managed settings deny it, see
# image/settings/managed.json), so this seeding does not widen anything the agent can do.
#
# GELDAR_CLI_HOME_DIR and GELDAR_TRUST_PATH are for tests; the image uses the defaults.
set -eu

cli_home="${GELDAR_CLI_HOME_DIR:-/cli-home}"
trust_path="${GELDAR_TRUST_PATH:-/player}"

# Exit codes from the merge: 0 seeded or already set, 2 left unchanged (not JSON or unexpected
# shape), 1 any other failure. Node prints nothing itself, so no file content can reach stderr.
merge_js='
const fs = require("fs");
const path = require("path");
// Read from stdin: Git bash on Windows rewrites a leading "/" in arguments and environment
// values, but not in piped data. The first line is the file, the second the project path.
const [file, project] = fs.readFileSync(0, "utf8").split("\n");
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
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
if (config.projects === undefined) config.projects = {};
if (!isObject(config.projects)) process.exit(2);
if (config.projects[project] === undefined) config.projects[project] = {};
const entry = config.projects[project];
if (!isObject(entry)) process.exit(2);
if (entry.hasTrustDialogAccepted === true) process.exit(0);
entry.hasTrustDialogAccepted = true;
const tmp = path.join(path.dirname(file), ".claude.json." + process.pid + ".tmp");
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

seed_trust() {
  [ -n "${GELDAR_MODE:-}" ] || return 0
  if [ ! -d "$cli_home" ] || [ ! -w "$cli_home" ]; then
    echo "geldar-entrypoint: $cli_home is not a writable directory; workspace trust not seeded" >&2
    return 0
  fi
  status=0
  printf '%s\n%s\n' "$cli_home/.claude.json" "$trust_path" | node -e "$merge_js" || status=$?
  case $status in
    0) ;;
    2) echo "geldar-entrypoint: $cli_home/.claude.json is not valid JSON; left unchanged, workspace trust not seeded" >&2 ;;
    *) echo "geldar-entrypoint: could not write workspace trust to $cli_home/.claude.json" >&2 ;;
  esac
  return 0
}

seed_trust || echo "geldar-entrypoint: workspace trust seeding failed; continuing" >&2
exec docker-entrypoint.sh "$@"
