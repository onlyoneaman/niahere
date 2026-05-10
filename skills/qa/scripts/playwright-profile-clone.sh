#!/usr/bin/env bash
set -euo pipefail

PROFILE_HOME="${PLAYWRIGHT_PROFILE_HOME:-$HOME/.shared}"
CONFIG_PATH="${PLAYWRIGHT_CONFIG:-$PROFILE_HOME/playwright-config.json}"
RUNS_DIR="${PLAYWRIGHT_PROFILE_RUNS_DIR:-$PROFILE_HOME/playwright-profile-runs}"
BACKUPS_DIR="${PLAYWRIGHT_PROFILE_BACKUPS_DIR:-$PROFILE_HOME/playwright-profile-backups}"
STATE_DIR="$RUNS_DIR/.state"
MAX_RUNS="${PLAYWRIGHT_PROFILE_MAX_RUNS:-100}"
SCRIPT_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
COMMIT_LOCK_HELD=""

usage() {
  cat <<'EOF'
Usage:
  playwright-profile-clone.sh prepare [--run-id <hex>] [--primary <path>]
  playwright-profile-clone.sh open [--run-id <hex>] [--primary <path>] [--commit-on-close|--discard-on-close|--keep]
  playwright-profile-clone.sh commit [--run-id <hex>]
  playwright-profile-clone.sh cleanup [--run-id <hex>]
  playwright-profile-clone.sh prune [--keep <count>|--off]
  playwright-profile-clone.sh status [--run-id <hex>]

Environment:
  PW_PRIMARY_PROFILE            Canonical source profile override
  PLAYWRIGHT_USER_PROFILE       Canonical source profile override
  PLAYWRIGHT_PROFILE_HOME       Base dir, default: ~/.shared
  PLAYWRIGHT_CONFIG             Config to seed from, default: ~/.shared/playwright-config.json
  PLAYWRIGHT_CHROME             Chrome executable override
  PLAYWRIGHT_PROFILE_MAX_RUNS   Max run dirs to keep, default: 100; set 0/off to disable auto-prune
EOF
}

die() {
  echo "error=$*" >&2
  exit 1
}

release_commit_lock() {
  if [ -n "$COMMIT_LOCK_HELD" ]; then
    rmdir "$COMMIT_LOCK_HELD" 2>/dev/null || true
    COMMIT_LOCK_HELD=""
  fi
}

trap release_commit_lock EXIT

shell_quote() {
  printf "%q" "$1"
}

random_hex() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 4
  else
    node -e "console.log(require('crypto').randomBytes(4).toString('hex'))"
  fi
}

configured_profile() {
  [ -f "$CONFIG_PATH" ] || return 0
  command -v node >/dev/null 2>&1 || return 0
  node - "$CONFIG_PATH" <<'NODE'
const fs = require("fs");
const config = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const dir = config?.browser?.userDataDir || config?.browser?.launchOptions?.userDataDir || "";
if (dir) process.stdout.write(dir);
NODE
}

resolve_primary() {
  local explicit="$1"
  if [ -n "$explicit" ]; then
    echo "$explicit"
  elif [ -n "${PW_PRIMARY_PROFILE:-}" ]; then
    echo "$PW_PRIMARY_PROFILE"
  elif [ -n "${PLAYWRIGHT_USER_PROFILE:-}" ]; then
    echo "$PLAYWRIGHT_USER_PROFILE"
  else
    echo "$PROFILE_HOME/playwright-user-profile"
  fi
}

has_entries() {
  [ -d "$1" ] && [ -n "$(find "$1" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]
}

copy_profile() {
  local source="$1"
  local destination="$2"
  mkdir -p "$destination"
  rsync -a --delete \
    --exclude='Singleton*' \
    --exclude='DevToolsActivePort' \
    --exclude='BrowserMetrics/' \
    --exclude='Crashpad/' \
    --exclude='Default/Cache/' \
    --exclude='Default/Code Cache/' \
    --exclude='Default/GPUCache/' \
    --exclude='Default/DawnGraphiteCache/' \
    --exclude='Default/DawnWebGPUCache/' \
    --exclude='GrShaderCache/' \
    --exclude='GraphiteDawnCache/' \
    --exclude='ShaderCache/' \
    "$source/" "$destination/"
}

acquire_commit_lock() {
  mkdir -p "$BACKUPS_DIR"
  local lock_dir="$BACKUPS_DIR/.commit.lock"
  local deadline=$((SECONDS + 60))

  while ! mkdir "$lock_dir" 2>/dev/null; do
    if [ "$SECONDS" -ge "$deadline" ]; then
      die "timed out waiting for profile commit lock"
    fi
    sleep 0.2
  done

  COMMIT_LOCK_HELD="$lock_dir"
}

prune_old_runs() {
  local protected_run_id="${1:-}"
  local max_runs="${2:-$MAX_RUNS}"
  local quiet="${3:-quiet}"

  RUNS_DIR="$RUNS_DIR" STATE_DIR="$STATE_DIR" PROTECTED_RUN_ID="$protected_run_id" MAX_RUNS="$max_runs" QUIET="$quiet" node <<'NODE'
const fs = require("fs");
const path = require("path");

const runsDir = process.env.RUNS_DIR;
const stateDir = process.env.STATE_DIR;
const protectedRunId = process.env.PROTECTED_RUN_ID || "";
const rawMax = String(process.env.MAX_RUNS || "100").toLowerCase();
const quiet = process.env.QUIET === "quiet";

if (["0", "off", "false", "none", "disabled"].includes(rawMax)) {
  if (!quiet) console.log("profile_prune=disabled");
  process.exit(0);
}

const max = Number.parseInt(rawMax, 10);
if (!Number.isFinite(max) || max < 1) {
  console.error(`error=invalid PLAYWRIGHT_PROFILE_MAX_RUNS: ${process.env.MAX_RUNS}`);
  process.exit(1);
}

if (!fs.existsSync(runsDir)) {
  if (!quiet) console.log("profile_pruned=0");
  process.exit(0);
}

function parseState(runId) {
  const file = path.join(stateDir, `${runId}.env`);
  if (!fs.existsSync(file)) return {};
  const state = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    state[match[1]] = match[2].replace(/^'(.*)'$/, "$1").replace(/^"(.*)"$/, "$1");
  }
  return state;
}

function pidIsAlive(pid) {
  const numericPid = Number.parseInt(pid || "", 10);
  if (!numericPid) return false;
  try {
    process.kill(numericPid, 0);
    return true;
  } catch {
    return false;
  }
}

const runs = fs.readdirSync(runsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name !== ".state")
  .map((entry) => {
    const runDir = path.join(runsDir, entry.name);
    return {
      id: entry.name,
      dir: runDir,
      mtimeMs: fs.statSync(runDir).mtimeMs,
      state: parseState(entry.name),
    };
  })
  .sort((a, b) => a.mtimeMs - b.mtimeMs);

let remaining = runs.length;
let pruned = 0;

for (const run of runs) {
  if (remaining <= max) break;
  if (run.id === protectedRunId) continue;
  if (pidIsAlive(run.state.PW_CHROME_PID)) continue;

  fs.rmSync(run.dir, { recursive: true, force: true });
  fs.rmSync(path.join(stateDir, `${run.id}.env`), { force: true });
  fs.rmSync(path.join(runsDir, `${run.id}.chrome.log`), { force: true });
  remaining -= 1;
  pruned += 1;
}

if (!quiet) {
  console.log(`profile_pruned=${pruned}`);
  console.log(`profile_runs=${remaining}`);
  console.log(`profile_max_runs=${max}`);
}
NODE
}

seed_primary_if_needed() {
  local primary="$1"
  mkdir -p "$(dirname "$primary")"

  if has_entries "$primary"; then
    return 0
  fi

  local configured
  configured="$(configured_profile || true)"
  if [ -n "$configured" ] && [ "$configured" != "$primary" ] && has_entries "$configured"; then
    copy_profile "$configured" "$primary"
  else
    mkdir -p "$primary"
  fi
}

state_file() {
  echo "$STATE_DIR/$1.env"
}

write_state() {
  local run_id="$1"
  local status="$2"
  local primary="$3"
  local run_dir="$4"
  local cdp_url="${5:-}"
  local chrome_pid="${6:-}"
  local close_action="${7:-manual}"

  mkdir -p "$STATE_DIR"
  {
    echo "PW_PROFILE_RUN_ID=$(shell_quote "$run_id")"
    echo "PW_PRIMARY_PROFILE=$(shell_quote "$primary")"
    echo "PW_USER_DATA_DIR=$(shell_quote "$run_dir")"
    echo "PW_CDP_URL=$(shell_quote "$cdp_url")"
    echo "PW_CHROME_PID=$(shell_quote "$chrome_pid")"
    echo "PW_PROFILE_STATUS=$(shell_quote "$status")"
    echo "PW_PROFILE_CLOSE_ACTION=$(shell_quote "$close_action")"
  } >"$(state_file "$run_id")"
}

load_state() {
  local run_id="$1"
  local file
  file="$(state_file "$run_id")"
  [ -f "$file" ] || die "unknown run id: $run_id"
  # shellcheck disable=SC1090
  source "$file"
}

single_active_run_id() {
  mkdir -p "$STATE_DIR"
  local ids=()
  local file
  while IFS= read -r file; do
    ids+=("$(basename "$file" .env)")
  done < <(find "$STATE_DIR" -maxdepth 1 -type f -name '*.env' -print | sort)

  if [ "${#ids[@]}" -eq 1 ]; then
    echo "${ids[0]}"
  elif [ "${#ids[@]}" -eq 0 ]; then
    die "no active profile runs; pass --run-id"
  else
    printf 'active_runs=' >&2
    printf '%s ' "${ids[@]}" >&2
    printf '\n' >&2
    die "multiple active profile runs; pass --run-id"
  fi
}

resolve_run_id_arg() {
  local explicit="$1"
  if [ -n "$explicit" ]; then
    echo "$explicit"
  elif [ -n "${PW_PROFILE_RUN_ID:-}" ]; then
    echo "$PW_PROFILE_RUN_ID"
  else
    single_active_run_id
  fi
}

print_exports() {
  local run_id="$1"
  local primary="$2"
  local run_dir="$3"
  local cdp_url="${4:-}"
  echo "PW_PROFILE_RUN_ID='${run_id}'"
  echo "PW_PRIMARY_PROFILE='${primary}'"
  echo "PW_USER_DATA_DIR='${run_dir}'"
  if [ -n "$cdp_url" ]; then
    echo "PW_CDP_URL='${cdp_url}'"
  fi
  echo "export PW_PROFILE_RUN_ID PW_PRIMARY_PROFILE PW_USER_DATA_DIR${cdp_url:+ PW_CDP_URL}"
}

prepare_profile() {
  local run_id="$1"
  local primary="$2"
  local run_dir="$RUNS_DIR/$run_id"

  seed_primary_if_needed "$primary"
  copy_profile "$primary" "$run_dir"
  write_state "$run_id" "prepared" "$primary" "$run_dir"
  prune_old_runs "$run_id"
  print_exports "$run_id" "$primary" "$run_dir"
}

free_port() {
  node <<'NODE'
const net = require("net");
const server = net.createServer();
server.listen(0, "127.0.0.1", () => {
  const port = server.address().port;
  server.close(() => console.log(port));
});
NODE
}

chrome_path() {
  if [ -n "${PLAYWRIGHT_CHROME:-}" ]; then
    echo "$PLAYWRIGHT_CHROME"
  elif [ -x "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]; then
    echo "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  elif command -v google-chrome >/dev/null 2>&1; then
    command -v google-chrome
  elif command -v chromium >/dev/null 2>&1; then
    command -v chromium
  elif command -v chromium-browser >/dev/null 2>&1; then
    command -v chromium-browser
  else
    die "could not find Chrome/Chromium; set PLAYWRIGHT_CHROME"
  fi
}

cmd_prepare() {
  local run_id=""
  local primary_arg=""
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --run-id) run_id="${2:-}"; shift 2 ;;
      --primary) primary_arg="${2:-}"; shift 2 ;;
      -h|--help) usage; exit 0 ;;
      *) die "unknown prepare arg: $1" ;;
    esac
  done
  [ -n "$run_id" ] || run_id="$(random_hex)"
  prepare_profile "$run_id" "$(resolve_primary "$primary_arg")"
}

cmd_open() {
  local run_id=""
  local primary_arg=""
  local close_action="commit"
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --run-id) run_id="${2:-}"; shift 2 ;;
      --primary) primary_arg="${2:-}"; shift 2 ;;
      --commit-on-close) close_action="commit"; shift ;;
      --discard-on-close) close_action="discard"; shift ;;
      --keep) close_action="keep"; shift ;;
      -h|--help) usage; exit 0 ;;
      *) die "unknown open arg: $1" ;;
    esac
  done
  [ -n "$run_id" ] || run_id="$(random_hex)"
  local primary run_dir port cdp_url chrome log_file
  primary="$(resolve_primary "$primary_arg")"
  run_dir="$RUNS_DIR/$run_id"
  prepare_profile "$run_id" "$primary" >/dev/null
  port="$(free_port)"
  cdp_url="http://127.0.0.1:$port"
  chrome="$(chrome_path)"
  log_file="$RUNS_DIR/$run_id.chrome.log"

  "$chrome" \
    --user-data-dir="$run_dir" \
    --remote-debugging-port="$port" \
    --no-first-run \
    --no-default-browser-check \
    about:blank >"$log_file" 2>&1 &
  local chrome_pid=$!
  write_state "$run_id" "opened" "$primary" "$run_dir" "$cdp_url" "$chrome_pid" "$close_action"
  start_close_watchdog "$run_id" "$chrome_pid" "$close_action" "$log_file"
  print_exports "$run_id" "$primary" "$run_dir" "$cdp_url"
  echo "PW_CHROME_PID='${chrome_pid}'"
  echo "PW_CHROME_LOG='${log_file}'"
  echo "PW_PROFILE_CLOSE_ACTION='${close_action}'"
}

commit_profile() {
  local run_id="$1"
  local allow_running="${2:-false}"
  load_state "$run_id"

  if [ "$allow_running" != "true" ] && [ -n "${PW_CHROME_PID:-}" ] && kill -0 "$PW_CHROME_PID" 2>/dev/null; then
    die "browser still running for run id $run_id; close it before commit"
  fi

  acquire_commit_lock
  local backup="$BACKUPS_DIR/$run_id-$(date +%Y%m%d%H%M%S)"
  if has_entries "$PW_PRIMARY_PROFILE"; then
    copy_profile "$PW_PRIMARY_PROFILE" "$backup"
  else
    mkdir -p "$backup"
  fi
  copy_profile "$PW_USER_DATA_DIR" "$PW_PRIMARY_PROFILE"
  write_state "$run_id" "committed" "$PW_PRIMARY_PROFILE" "$PW_USER_DATA_DIR" "${PW_CDP_URL:-}" "${PW_CHROME_PID:-}" "${PW_PROFILE_CLOSE_ACTION:-manual}"
  echo "status=committed"
  echo "run_id=$run_id"
  echo "backup=$backup"
  release_commit_lock
}

cleanup_profile() {
  local run_id="$1"
  load_state "$run_id"
  rm -rf "$PW_USER_DATA_DIR" "$(state_file "$run_id")" "$RUNS_DIR/$run_id.chrome.log"
  echo "status=cleaned"
  echo "run_id=$run_id"
}

start_close_watchdog() {
  local run_id="$1"
  local chrome_pid="$2"
  local close_action="$3"
  local log_file="$4"

  [ "$close_action" != "keep" ] || return 0

  (
    while kill -0 "$chrome_pid" 2>/dev/null; do
      sleep 0.2
    done

    if [ "$close_action" = "commit" ]; then
      bash "$SCRIPT_PATH" commit --run-id "$run_id" --assume-closed >>"$log_file" 2>&1 &&
        bash "$SCRIPT_PATH" cleanup --run-id "$run_id" >>"$log_file" 2>&1
    elif [ "$close_action" = "discard" ]; then
      bash "$SCRIPT_PATH" cleanup --run-id "$run_id" >>"$log_file" 2>&1
    fi
  ) >/dev/null 2>&1 &
}

cmd_commit() {
  local run_id_arg=""
  local allow_running="false"
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --run-id) run_id_arg="${2:-}"; shift 2 ;;
      --assume-closed) allow_running="true"; shift ;;
      -h|--help) usage; exit 0 ;;
      *) die "unknown commit arg: $1" ;;
    esac
  done

  local run_id
  run_id="$(resolve_run_id_arg "$run_id_arg")"
  commit_profile "$run_id" "$allow_running"
}

cmd_cleanup() {
  local run_id_arg=""
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --run-id) run_id_arg="${2:-}"; shift 2 ;;
      -h|--help) usage; exit 0 ;;
      *) die "unknown cleanup arg: $1" ;;
    esac
  done

  local run_id
  run_id="$(resolve_run_id_arg "$run_id_arg")"
  cleanup_profile "$run_id"
}

cmd_prune() {
  local keep="$MAX_RUNS"
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --keep) keep="${2:-}"; shift 2 ;;
      --off) keep="off"; shift ;;
      -h|--help) usage; exit 0 ;;
      *) die "unknown prune arg: $1" ;;
    esac
  done

  prune_old_runs "" "$keep" "verbose"
}

cmd_status() {
  local run_id_arg=""
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --run-id) run_id_arg="${2:-}"; shift 2 ;;
      -h|--help) usage; exit 0 ;;
      *) die "unknown status arg: $1" ;;
    esac
  done

  local run_id
  run_id="$(resolve_run_id_arg "$run_id_arg")"
  cat "$(state_file "$run_id")"
}

main() {
  local command="${1:-}"
  [ -n "$command" ] || { usage; exit 1; }
  shift || true
  mkdir -p "$RUNS_DIR" "$STATE_DIR"

  case "$command" in
    prepare) cmd_prepare "$@" ;;
    open) cmd_open "$@" ;;
    commit) cmd_commit "$@" ;;
    cleanup) cmd_cleanup "$@" ;;
    prune) cmd_prune "$@" ;;
    status) cmd_status "$@" ;;
    -h|--help) usage ;;
    *) die "unknown command: $command" ;;
  esac
}

main "$@"
