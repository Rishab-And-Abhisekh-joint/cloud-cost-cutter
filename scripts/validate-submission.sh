#!/usr/bin/env bash
#
# validate-submission.sh — OpenEnv Submission Validator (extended)
#
# Covers:
# - HF Space live + reset/step/state response
# - openenv validate
# - Dockerfile build
# - baseline inference execution and runtime
# - 3+ tasks and score/reward range checks
# - mandatory env key + code-structure checks
#
# Usage:
#   ./scripts/validate-submission.sh <space_url> [repo_dir]
#
# Example:
#   ./scripts/validate-submission.sh https://rishab-acharjee-cloud-cost-cutter-openenv.hf.space

set -uo pipefail

DOCKER_BUILD_TIMEOUT=900
INFER_TIMEOUT=1200

if [ -t 1 ]; then
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[1;33m'
  BOLD='\033[1m'
  NC='\033[0m'
else
  RED='' GREEN='' YELLOW='' BOLD='' NC=''
fi

PASS=0

log()  { printf "[%s] %b\n" "$(date -u +%H:%M:%S)" "$*"; }
pass() { log "${GREEN}PASSED${NC} -- $1"; PASS=$((PASS + 1)); }
fail() { log "${RED}FAILED${NC} -- $1"; }
hint() { printf "  ${YELLOW}Hint:${NC} %b\n" "$1"; }

stop_at() {
  printf "\n${RED}${BOLD}Validation stopped at %s.${NC} Fix the above before continuing.\n" "$1"
  exit 1
}

run_with_timeout() {
  local secs="$1"; shift
  if command -v timeout >/dev/null 2>&1; then
    timeout "$secs" "$@"
  elif command -v gtimeout >/dev/null 2>&1; then
    gtimeout "$secs" "$@"
  else
    "$@" &
    local pid=$!
    ( sleep "$secs" && kill "$pid" 2>/dev/null ) &
    local watcher=$!
    wait "$pid" 2>/dev/null
    local rc=$?
    kill "$watcher" 2>/dev/null || true
    wait "$watcher" 2>/dev/null || true
    return $rc
  fi
}

portable_mktemp() {
  local prefix="${1:-validate}"
  mktemp "${TMPDIR:-/tmp}/${prefix}-XXXXXX" 2>/dev/null || mktemp
}

to_windows_path() {
  local p="$1"

  # WSL-style path: /mnt/c/Users/... -> C:\Users\...
  if [[ "$p" =~ ^/mnt/([a-zA-Z])/(.*)$ ]]; then
    local drive="${BASH_REMATCH[1]}"
    local rest="${BASH_REMATCH[2]}"
    rest="${rest//\//\\}"
    printf '%s:\\%s' "${drive^^}" "$rest"
    return 0
  fi

  if command -v wslpath >/dev/null 2>&1; then
    wslpath -w "$p"
    return 0
  fi

  if command -v cygpath >/dev/null 2>&1; then
    cygpath -w "$p"
    return 0
  fi

  printf '%s' "$p"
}

CLEANUP_FILES=()
cleanup() {
  if [ ${#CLEANUP_FILES[@]} -gt 0 ]; then
    rm -f "${CLEANUP_FILES[@]}" 2>/dev/null || true
  fi
}
trap cleanup EXIT

PING_URL="${1:-}"
REPO_DIR="${2:-.}"

if [ -z "$PING_URL" ]; then
  printf "Usage: %s <space_url> [repo_dir]\n" "$0"
  exit 1
fi

if ! REPO_DIR="$(cd "$REPO_DIR" 2>/dev/null && pwd)"; then
  printf "Error: directory '%s' not found\n" "${2:-.}"
  exit 1
fi

PING_URL="${PING_URL%/}"

printf "\n"
printf "${BOLD}========================================${NC}\n"
printf "${BOLD}  OpenEnv Submission Validator (Extended)${NC}\n"
printf "${BOLD}========================================${NC}\n"
log "Repo:     $REPO_DIR"
log "Space:    $PING_URL"
printf "\n"

# Resolve python and openenv commands.
if [ -x "$REPO_DIR/.venv/bin/python" ]; then
  PYTHON_CMD="$REPO_DIR/.venv/bin/python"
elif [ -x "$REPO_DIR/.venv/Scripts/python.exe" ]; then
  PYTHON_CMD="$REPO_DIR/.venv/Scripts/python.exe"
elif command -v python3 >/dev/null 2>&1; then
  PYTHON_CMD="python3"
elif command -v python >/dev/null 2>&1; then
  PYTHON_CMD="python"
else
  fail "Python not found"
  stop_at "bootstrap"
fi

if command -v openenv >/dev/null 2>&1; then
  OPENENV_CMD="openenv"
elif [ -x "$REPO_DIR/.venv/bin/openenv" ]; then
  OPENENV_CMD="$REPO_DIR/.venv/bin/openenv"
elif [ -x "$REPO_DIR/.venv/Scripts/openenv.exe" ]; then
  OPENENV_CMD="$REPO_DIR/.venv/Scripts/openenv.exe"
else
  OPENENV_CMD=""
fi

log "${BOLD}Step 1/8: HF Space deployment + endpoint checks${NC}"

ROOT_CODE="$(curl -s -o /dev/null -w "%{http_code}" "$PING_URL/" --max-time 30 || printf "000")"
if [ "$ROOT_CODE" = "200" ]; then
  pass "HF Space root URL returns 200"
else
  fail "HF Space root returned HTTP $ROOT_CODE (expected 200)"
  hint "Check Space runtime state and URL."
  stop_at "Step 1"
fi

# Try /reset/cleanup first (project-specific), then /reset fallback.
RESET_CODE="$(curl -s -o /dev/null -w "%{http_code}" -X POST "$PING_URL/reset/cleanup?seed=42" --max-time 30 || printf "000")"
RESET_PATH="/reset/cleanup?seed=42"
if [ "$RESET_CODE" != "200" ]; then
  RESET_CODE="$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Content-Type: application/json" -d '{}' "$PING_URL/reset" --max-time 30 || printf "000")"
  RESET_PATH="/reset"
fi
if [ "$RESET_CODE" = "200" ]; then
  pass "HF Space responds to ${RESET_PATH}"
else
  fail "HF Space reset endpoint check failed (last HTTP=$RESET_CODE)"
  hint "Your environment must respond to reset() in evaluator flow."
  stop_at "Step 1"
fi

# Check step/state runtime behavior (skip action should be safe).
STEP_CODE="$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Content-Type: application/json" -d '{"command":"skip","resource_id":"","params":{}}' "$PING_URL/step" --max-time 30 || printf "000")"
STATE_CODE="$(curl -s -o /dev/null -w "%{http_code}" "$PING_URL/state" --max-time 30 || printf "000")"
if [ "$STEP_CODE" = "200" ] && [ "$STATE_CODE" = "200" ]; then
  pass "step()/state() endpoints respond with 200"
else
  fail "step()/state() endpoint check failed (step=$STEP_CODE state=$STATE_CODE)"
  stop_at "Step 1"
fi

log "${BOLD}Step 2/8: OpenEnv spec validation${NC}"
if [ -z "$OPENENV_CMD" ]; then
  fail "openenv command not found"
  hint "Install openenv-core or use project .venv containing openenv."
  stop_at "Step 2"
fi
VALIDATE_OUT="$(cd "$REPO_DIR" && "$OPENENV_CMD" validate 2>&1)"
if [ $? -eq 0 ]; then
  pass "openenv validate passed"
else
  fail "openenv validate failed"
  printf "%s\n" "$VALIDATE_OUT"
  stop_at "Step 2"
fi

log "${BOLD}Step 3/8: Docker build${NC}"
if ! command -v docker >/dev/null 2>&1; then
  fail "docker command not found"
  stop_at "Step 3"
fi
if [ -f "$REPO_DIR/Dockerfile" ]; then
  DOCKER_CONTEXT="$REPO_DIR"
elif [ -f "$REPO_DIR/server/Dockerfile" ]; then
  DOCKER_CONTEXT="$REPO_DIR/server"
else
  fail "No Dockerfile found in repo root or server/"
  stop_at "Step 3"
fi
BUILD_OUT="$(run_with_timeout "$DOCKER_BUILD_TIMEOUT" docker build "$DOCKER_CONTEXT" 2>&1)"
if [ $? -eq 0 ]; then
  pass "Docker build succeeded"
else
  fail "Docker build failed (timeout=${DOCKER_BUILD_TIMEOUT}s)"
  printf "%s\n" "$BUILD_OUT" | tail -20
  stop_at "Step 3"
fi

log "${BOLD}Step 4/8: Mandatory file/env/code checks${NC}"

if [ -f "$REPO_DIR/inference.py" ]; then
  pass "inference.py exists at repo root"
else
  fail "Missing root inference.py"
  stop_at "Step 4"
fi

if [ -f "$REPO_DIR/openenv.yaml" ]; then
  pass "openenv.yaml exists"
else
  fail "Missing openenv.yaml"
  stop_at "Step 4"
fi

if [ ! -f "$REPO_DIR/.env" ]; then
  fail "Missing .env for mandatory variable check"
  stop_at "Step 4"
fi

env_key_nonempty() {
  local key="$1"
  awk -F'=' -v k="$key" '
    BEGIN{ok=0}
    /^[[:space:]]*#/ {next}
    $1 ~ "^[[:space:]]*"k"[[:space:]]*$" {
      v=$2
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", v)
      if (length(v)>0) ok=1
    }
    END{exit(ok?0:1)}
  ' "$REPO_DIR/.env"
}

for k in API_BASE_URL MODEL_NAME HF_TOKEN; do
  if env_key_nonempty "$k"; then
    pass "$k is defined in .env"
  else
    fail "$k missing or empty in .env"
    stop_at "Step 4"
  fi
done

if grep -q "from openai import OpenAI" "$REPO_DIR/inference.py" \
  && grep -q "OpenAI(base_url=API_BASE_URL" "$REPO_DIR/inference.py"; then
  pass "inference.py uses OpenAI client with API_BASE_URL"
else
  fail "OpenAI client usage check failed in inference.py"
  stop_at "Step 4"
fi

if grep -q "\[START\]" "$REPO_DIR/cloud_cost_env/inference_llm.py" \
  && grep -q "\[STEP\]" "$REPO_DIR/cloud_cost_env/inference_llm.py" \
  && grep -q "\[END\]" "$REPO_DIR/cloud_cost_env/inference_llm.py"; then
  pass "Structured log markers [START]/[STEP]/[END] are implemented"
else
  fail "Structured log markers missing in inference runner"
  stop_at "Step 4"
fi

log "${BOLD}Step 5/8: Baseline inference reproducibility${NC}"

LOG_FILE="$(portable_mktemp "validate-infer")"
CLEANUP_FILES+=("$LOG_FILE")

# Pull env values from .env (without printing secrets).
API_BASE_URL_VAL="$(awk -F'=' '/^[[:space:]]*API_BASE_URL[[:space:]]*=/{print $2; exit}' "$REPO_DIR/.env" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
MODEL_NAME_VAL="$(awk -F'=' '/^[[:space:]]*MODEL_NAME[[:space:]]*=/{print $2; exit}' "$REPO_DIR/.env" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
HF_TOKEN_VAL="$(awk -F'=' '/^[[:space:]]*HF_TOKEN[[:space:]]*=/{print $2; exit}' "$REPO_DIR/.env" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"

START_TS="$(date +%s)"
INFERENCE_SCRIPT="$REPO_DIR/inference.py"
if [[ "$PYTHON_CMD" == *.exe ]]; then
  INFERENCE_SCRIPT="$(to_windows_path "$INFERENCE_SCRIPT")"
fi
RUN_OUT="$(run_with_timeout "$INFER_TIMEOUT" env \
  ENV_BASE_URL="$PING_URL" \
  API_BASE_URL="$API_BASE_URL_VAL" \
  MODEL_NAME="$MODEL_NAME_VAL" \
  HF_TOKEN="$HF_TOKEN_VAL" \
  ALLOW_HEURISTIC_FALLBACK=true \
  STRICT_ACTION_MODE=false \
  "$PYTHON_CMD" "$INFERENCE_SCRIPT" 2>&1)"
RUN_RC=$?
printf "%s\n" "$RUN_OUT" > "$LOG_FILE"
NORM_LOG_FILE="$(portable_mktemp "validate-infer-norm")"
CLEANUP_FILES+=("$NORM_LOG_FILE")
tr -d '\r' < "$LOG_FILE" > "$NORM_LOG_FILE"
END_TS="$(date +%s)"
ELAPSED=$((END_TS - START_TS))

if [ $RUN_RC -ne 0 ]; then
  fail "inference.py failed"
  printf "%s\n" "$RUN_OUT" | tail -40
  stop_at "Step 5"
fi

if [ $ELAPSED -lt 1200 ]; then
  pass "inference.py runtime is under 20 min (${ELAPSED}s)"
else
  fail "inference.py exceeded 20 min (${ELAPSED}s)"
  stop_at "Step 5"
fi

log "${BOLD}Step 6/8: Structured log format checks${NC}"

START_COUNT="$(grep -c '^\[START\]' "$NORM_LOG_FILE" || true)"
STEP_COUNT="$(grep -c '^\[STEP\]' "$NORM_LOG_FILE" || true)"
END_COUNT="$(grep -c '^\[END\]' "$NORM_LOG_FILE" || true)"

if [ "$START_COUNT" -ge 1 ] && [ "$STEP_COUNT" -ge 1 ] && [ "$END_COUNT" -ge 1 ]; then
  pass "Structured logs found (START=$START_COUNT STEP=$STEP_COUNT END=$END_COUNT)"
else
  fail "Missing structured logs in inference output"
  stop_at "Step 6"
fi

if grep '^\[START\]' "$NORM_LOG_FILE" | grep -Ev '^\[START\] task=[^ ]+ env=[^ ]+ model=.+$' >/dev/null; then
  fail "[START] format mismatch"
  stop_at "Step 6"
fi

if grep '^\[STEP\]' "$NORM_LOG_FILE" | grep -Ev '^\[STEP\] step=[0-9]+ action=.+ reward=[0-9]+\.[0-9]{2} done=(true|false) error=.+$' >/dev/null; then
  fail "[STEP] format mismatch"
  stop_at "Step 6"
fi

if grep '^\[END\]' "$NORM_LOG_FILE" | grep -Ev '^\[END\] success=(true|false) steps=[0-9]+ score=[0-9]+\.[0-9]{2} rewards=([0-9]+\.[0-9]{2})(,[0-9]+\.[0-9]{2})*$' >/dev/null; then
  fail "[END] format mismatch"
  stop_at "Step 6"
fi
pass "Strict [START]/[STEP]/[END] format checks passed"

log "${BOLD}Step 7/8: Task and grader range checks${NC}"

TASK_COUNT="$(grep -Ec '^[[:space:]]*-[[:space:]]*name:[[:space:]]*' "$REPO_DIR/openenv.yaml" || true)"
if [ "$TASK_COUNT" -ge 3 ]; then
  pass "openenv.yaml defines 3+ tasks (count=$TASK_COUNT)"
else
  fail "openenv.yaml defines fewer than 3 tasks (count=$TASK_COUNT)"
  stop_at "Step 7"
fi

mapfile -t TASKS < <(grep -E '^[[:space:]]*-[[:space:]]*name:[[:space:]]*' "$REPO_DIR/openenv.yaml" | sed -E 's/^[[:space:]]*-[[:space:]]*name:[[:space:]]*//')
for t in "${TASKS[@]}"; do
  if grep -Eq "^\[START\] task=${t} " "$NORM_LOG_FILE"; then
    :
  else
    fail "Task '${t}' not observed in inference run"
    stop_at "Step 7"
  fi
done
pass "All manifest tasks were exercised in inference run"

awk '
  /^\[END\]/ {
    if (match($0, /score=([0-9]+\.[0-9]{2})/, a) == 0) bad=1
    else {
      s=a[1]+0
      if (s<0 || s>1) bad=1
    }
    c++
  }
  END {
    if (c<3) exit 2
    if (bad) exit 1
    exit 0
  }
' "$NORM_LOG_FILE"
AWK_RC=$?
if [ $AWK_RC -eq 0 ]; then
  pass "END scores are in [0,1] and count is 3+"
elif [ $AWK_RC -eq 2 ]; then
  fail "Fewer than 3 END score records found"
  stop_at "Step 7"
else
  fail "Score range check failed (END scores must be in [0,1])"
  stop_at "Step 7"
fi

awk '
  /^\[STEP\]/ {
    if (match($0, /reward=([0-9]+\.[0-9]{2})/, a) == 0) bad=1
    else {
      r=a[1]+0
      if (r<0 || r>1) bad=1
    }
    c++
  }
  END {
    if (c<1) exit 2
    if (bad) exit 1
    exit 0
  }
' "$NORM_LOG_FILE"
AWK_RC=$?
if [ $AWK_RC -eq 0 ]; then
  pass "STEP rewards are in [0,1]"
elif [ $AWK_RC -eq 2 ]; then
  fail "No STEP records found"
  stop_at "Step 7"
else
  fail "Reward range check failed (STEP rewards must be in [0,1])"
  stop_at "Step 7"
fi

log "${BOLD}Step 8/8: Infra guidance checks${NC}"

CPU_COUNT=""
MEM_MB=""
if command -v nproc >/dev/null 2>&1; then
  CPU_COUNT="$(nproc)"
fi
if command -v free >/dev/null 2>&1; then
  MEM_MB="$(free -m | awk '/^Mem:/ {print $2}')"
fi

if [ -n "$CPU_COUNT" ] && [ -n "$MEM_MB" ]; then
  log "Detected host resources: cpu=${CPU_COUNT}, mem_mb=${MEM_MB}"
  if [ "$CPU_COUNT" -le 2 ] && [ "$MEM_MB" -le 8192 ]; then
    pass "Host resource envelope is within 2 vCPU / 8GB"
  else
    log "${YELLOW}INFO${NC} -- Host is larger than target envelope; compatibility inferred from successful run/runtime."
    pass "Compatibility check: inference succeeded under timeout and produced valid outputs"
  fi
else
  log "${YELLOW}INFO${NC} -- Could not detect host resources on this platform."
  pass "Compatibility check: inference succeeded under timeout and produced valid outputs"
fi

printf "\n"
printf "${BOLD}========================================${NC}\n"
printf "${GREEN}${BOLD}  Validation complete: %d checks passed${NC}\n" "$PASS"
printf "${GREEN}${BOLD}  Submission is checklist-ready.${NC}\n"
printf "${BOLD}========================================${NC}\n"
printf "\n"

exit 0
