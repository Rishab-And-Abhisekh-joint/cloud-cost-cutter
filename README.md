---
title: CloudCostEnv
colorFrom: blue
colorTo: green
sdk: docker
app_port: 8000
pinned: false
---

# CloudCostEnv

CloudCostEnv is an OpenEnv-style RL environment for cloud cost optimization. It simulates cloud accounts with realistic waste patterns and asks an agent to optimize safely under SLA and dependency constraints.

Episodes are generated on reset from deterministic task profiles (not loaded from static fixtures at runtime):

- cleanup: seed 42, 30 core resources with explicit easy-case waste pattern
- rightsize: seed 123, 50 core resources with 12 over-provisioned targets and SLA/dependency constraints
- full_optimization: seed 777, 80 core resources plus 210 snapshots and 15 prod-critical compute resources

You can override the seed for reproducibility checks by setting RUN_SEED.

The repository now includes deployment-ready assets for:

- Railway backend (`Dockerfile`, `railway.json`)
- Vercel frontend dashboard (`frontend/`)

For Hugging Face Space submission, only the API runtime is required.
No custom UI is needed; lightweight `/` and `/web` responses are sufficient.

## Tasks

- `cleanup` (easy): remove clearly idle/orphaned resources.
- `rightsize` (medium): downsize over-provisioned resources while preserving SLAs.
- `full_optimization` (hard): combine cleanup, scheduling, rightsizing, snapshot cleanup, and reservations.

## Action And Observation Spaces

Action space (typed model: `CloudCostAction`):

- `command`: one of `terminate`, `rightsize`, `stop`, `schedule`, `delete_snapshot`, `purchase_reservation`, `detach_ip`, `release_ip`, `skip`, `inspect`
- `resource_id`: target resource identifier
- `params`: command-specific arguments (for example `{"new_type": "m5.xlarge"}` for rightsizing)

Observation space (typed model: `CloudCostObservation`):

- `resources_summary`: compact list of resources with type, status, monthly cost, risk, and waste signal
- `total_monthly_cost`: current monthly spend estimate
- `savings_achieved`: cumulative monthly savings achieved in the episode
- `waste_remaining`: estimated remaining savings opportunity
- `last_action_result`: server-side action result message
- `sla_violations`: SLA violations emitted for the latest step
- `recommendations`: top ranked suggestions for next actions
- `steps_remaining`: remaining episode budget
- `current_score`: normalized score strictly within `(0, 1)`

State space (typed model: `CloudCostState`) is available via `GET /state` and includes episode id, task name, step count, spend deltas, violations count, resources modified, max steps, and done flag.

## Quick Start

```bash
python -m venv .venv
. .venv/Scripts/Activate.ps1
pip install -e .
uvicorn cloud_cost_env.server.app:app --host 127.0.0.1 --port 8000
```

In a second terminal:

```bash
set ENV_BASE_URL=http://127.0.0.1:8000
set RUN_SEED=42
python -m cloud_cost_env.baseline_runner
```

Baseline helper (root wrapper):

```bash
python inference.py
```

Naming map:

- `inference.py` (repo root): OpenEnv submission entrypoint
- `cloud_cost_env/baseline_runner.py`: deterministic baseline policy loop
- `cloud_cost_env/inference_llm.py`: LLM-driven policy loop
- `cloud_cost_env/inference_rl.py`: RL policy loop backed by artifact scoring

Train and evaluate RL policy artifacts:

```bash
# Train a tabular RL artifact and store versioned policy JSON
python -m cloud_cost_env.rl.train --episodes 1200 --output cloud_cost_env/data/rl/q_policy_v1.json

# Evaluate a trained artifact
python -m cloud_cost_env.rl.evaluate --policy cloud_cost_env/data/rl/q_policy_v1.json --episodes 120

# Compare against heuristic and baseline policies
python -m cloud_cost_env.rl.evaluate_heuristic --episodes 120
python -m cloud_cost_env.rl.evaluate_baseline --episodes 120

# Enforce RL quality thresholds (fails with non-zero exit on regression)
python -m cloud_cost_env.rl.quality_gate \
	--policy cloud_cost_env/data/rl/q_policy_v1.json \
	--episodes 180 \
	--min-mean-reward 0.87 \
	--min-mean-score 0.121 \
	--min-success-rate 0.87

# Run inference loop with RL policy
set RL_POLICY_PATH=cloud_cost_env/data/rl/q_policy_v1.json
python inference_rl.py
```

Enable RL runtime in API server:

```bash
set AGENT_CONTROL_MODE=auto
set RL_POLICY_PATH=cloud_cost_env/data/rl/q_policy_v1.json
uvicorn cloud_cost_env.server.app:app --host 127.0.0.1 --port 8000
```

Control mode behavior:

- `auto` (recommended): use RL when artifact is loaded and validation passes, otherwise heuristic fallback.
- `rl`: force RL mode (status reports validation error if policy is missing/invalid).
- `heuristic`: disable RL ranking and run heuristic-only behavior.

LLM runner (separate from baseline):

```bash
set ENV_BASE_URL=http://127.0.0.1:8000
set RUN_SEED=42
set HF_TOKEN=your_token
set MODEL_NAME=Qwen/Qwen2.5-72B-Instruct
set API_BASE_URL=https://router.huggingface.co/v1
python inference_llm.py
```

Strict reliability benchmarking mode (fail fast on malformed/invalid model actions):

```bash
set ENV_BASE_URL=http://127.0.0.1:8000
set HF_TOKEN=your_token
set MODEL_NAME=Qwen/Qwen2.5-72B-Instruct
set API_BASE_URL=https://router.huggingface.co/v1
set STRICT_ACTION_MODE=true
python inference_llm.py
```

If credentials are not available, the LLM runner can fall back to heuristics:

```bash
set ALLOW_HEURISTIC_FALLBACK=true
python inference_llm.py
```

## API

Run the FastAPI app:

```bash
uvicorn cloud_cost_env.server.app:app --reload
```

Endpoints:

- `POST /reset/{task_name}`
- `POST /step`
- `GET /state`
- `GET /profile`
- `GET /health`
- `GET /ready`
- `GET /agent/status`
- `GET /agent/next-action`
- `GET /live/dashboard`
- `POST /live/action`
- `GET /azure/dashboard`
- `GET /azure/approval`
- `POST /azure/connect`

Profile endpoint usage:

```bash
# Active episode profile (after calling reset)
curl http://127.0.0.1:8000/profile

# Preview profile for a task/seed without mutating current state
curl "http://127.0.0.1:8000/profile?task_name=full_optimization&seed=777"
```

Live dashboard endpoint usage:

```bash
# Get actionable recommendations and recent action history
curl "http://127.0.0.1:8000/live/dashboard?task_name=full_optimization&seed=777"

# Dry run (no mutation)
curl -X POST http://127.0.0.1:8000/live/action \
	-H "Content-Type: application/json" \
	-d '{"action_type":"release_eip","resource_id":"eip-123","apply":false}'

# Apply action (mutates active episode)
curl -X POST http://127.0.0.1:8000/live/action \
	-H "Content-Type: application/json" \
	-d '{"action_type":"release_eip","resource_id":"eip-123","apply":true}'
```

Agent runtime status usage:

```bash
# Returns whether RL is truly active (mode + artifact load + runtime validation)
curl http://127.0.0.1:8000/agent/status

# Force policy reload + revalidation
curl "http://127.0.0.1:8000/agent/status?refresh=true"

# Inspect next action from active control mode (rl or heuristic)
curl "http://127.0.0.1:8000/agent/next-action?task_name=full_optimization&seed=777"
```

Azure secure connect usage (requires explicit approval token):

```bash
# 1) Ask server for one-time approval token (short-lived)
curl http://127.0.0.1:8000/azure/approval

# 2) Connect using approved=true and the returned token
curl -X POST http://127.0.0.1:8000/azure/connect \
	-H "Content-Type: application/json" \
	-d '{
	  "approved": true,
	  "approval_token": "<token-from-previous-call>",
	  "subscription_id": "<azure-subscription-guid>",
	  "resource_group": null,
	  "tenant_id": null,
	  "max_resources": 200
	}'

# 3) Read latest cached Azure dashboard snapshot
curl http://127.0.0.1:8000/azure/dashboard
```

Production Azure identity setup (Railway + real Azure resources):

```powershell
./scripts/setup_azure_identity_railway.ps1 \
	-SubscriptionId "72ccb77e-5f2f-4879-bafd-ef720cb1790a" \
	-TenantId "f95e6f26-57a8-43b6-80cc-f425f998310b" \
	-ResourceGroup "careorbit-rg" \
	-RailwayService "cloud-cost-env-api" \
	-RailwayEnvironment "production"
```

What this script does:

- Creates a Reader-scoped Azure service principal on the target resource group.
- Sets `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_CLIENT_SECRET`, and `AZURE_SUBSCRIPTION_ID` on Railway.
- Calls `/azure/approval`, `/azure/connect`, and `/azure/dashboard` to verify live connectivity.

## Production Deployment (Railway + Vercel)

Install CLIs if needed:

```bash
npm install -g @railway/cli vercel
```

### 1) Deploy backend to Railway

Railway uses the root `Dockerfile` and `railway.json` in this repo.

Required Railway environment variables:

- `ALLOWED_ORIGINS`: set to your Vercel URL (for example `https://cloud-cost-dashboard.vercel.app`)

Optional backend environment variables:

- `RUN_SEED`
- `LOG_LEVEL`
- `FORWARDED_ALLOW_IPS`
- `UVICORN_WORKERS`
- `RATE_LIMIT_WINDOW_SECONDS`
- `RATE_LIMIT_RESET_PER_WINDOW`
- `RATE_LIMIT_STEP_PER_WINDOW`
- `RATE_LIMIT_LIVE_ACTION_PER_WINDOW`
- `RATE_LIMIT_AZURE_APPROVAL_PER_WINDOW`
- `RATE_LIMIT_AZURE_CONNECT_PER_WINDOW`

Deploy flow:

```bash
# from repo root
railway init
railway up
```

After deployment, verify health:

```bash
curl https://<your-railway-domain>/health
```

### 2) Deploy frontend to Vercel

The frontend is a Vite React app under `frontend/`.

Required Vercel environment variables:

- `VITE_API_BASE_URL`: your Railway backend URL (for example `https://<your-railway-domain>`)

Vercel settings:

- Root Directory: `frontend`
- Build Command: `npm run build`
- Output Directory: `dist`

Deploy flow:

```bash
# from repo root
cd frontend
vercel
```

### 3) Wire CORS after Vercel URL is known

Update Railway `ALLOWED_ORIGINS` to the final Vercel domain and redeploy.

## GitHub + CI/CD

GitHub repository:

- https://github.com/Rishab-And-Abhisekh-joint/cloud-cost-cutter

CI workflow file:

- `.github/workflows/deploy.yml`

What it does on every push to `main`:

- Run RL quality regression gate before deployment and fail on threshold regressions (currently reward>=0.87, score>=0.121, success>=0.87)
- Deploy backend to Railway using `railway up --ci`
- Run a backend smoke test against `/health` and fail the workflow if it does not return `{"status":"ok"}`
- Deploy frontend to Vercel when `VERCEL_TOKEN` is configured

Configured GitHub Actions variables:

- `RAILWAY_PROJECT_ID`
- `RAILWAY_SERVICE_NAME`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`

Configured GitHub Actions secrets:

- `RAILWAY_TOKEN` (use a Railway project token for this project/environment)

Workflow toggle:

- In `.github/workflows/deploy.yml`, set `ENABLE_RAILWAY_DEPLOY` to `"true"` only after adding a valid Railway project token.

Required to enable frontend auto-deploy in CI:

- Add `VERCEL_TOKEN` as a repository secret (create from https://vercel.com/account/tokens)

## .env Parameters

Use [.env.example](.env.example) as your template.

Required for baseline runner:

- `ENV_BASE_URL`

Required for LLM runner (unless fallback mode is enabled):

- One credential: `HF_TOKEN` or `API_KEY` or `OPENAI_API_KEY`
- `MODEL_NAME`
- `API_BASE_URL`

Common optional parameters:

- `RUN_SEED`
- `ALLOWED_ORIGINS`
- `LIVE_DASHBOARD_ALLOW_APPLY` (set `false` to force dry-run only)
- `LOG_LEVEL` (default `INFO`)
- `FORWARDED_ALLOW_IPS` (default `*`)
- `UVICORN_WORKERS` (default `1` in Docker runtime; keep `1` unless state is externalized)
- `RATE_LIMIT_WINDOW_SECONDS` (default `60`)
- `RATE_LIMIT_RESET_PER_WINDOW` (default `60`)
- `RATE_LIMIT_STEP_PER_WINDOW` (default `180`)
- `RATE_LIMIT_LIVE_ACTION_PER_WINDOW` (default `60`)
- `RATE_LIMIT_AZURE_APPROVAL_PER_WINDOW` (default `30`)
- `RATE_LIMIT_AZURE_CONNECT_PER_WINDOW` (default `6`)
- `AWS_REGION` (display label for live dashboard)
- `AWS_ACCOUNT_ID` and `AWS_ACCOUNT_ARN` (optional display metadata)
- `AZURE_APPROVAL_WINDOW_SECONDS` (approval token lifetime for `/azure/connect`, default `600`)
- `ALLOW_HEURISTIC_FALLBACK`
- `STRICT_ACTION_MODE`
- `MAX_STEPS`
- `TEMPERATURE`
- `MAX_TOKENS`

LLM endpoint variable notes:

- Preferred: `API_BASE_URL`
- Backward-compatible alias: `LLM_API_BASE_URL`

Frontend parameter:

- `VITE_API_BASE_URL` (set in Vercel project env vars)
- `VITE_REQUEST_TIMEOUT_MS` (default `15000`)
- `VITE_REQUEST_RETRIES` (default `2`, safe methods only)

## Reward

Per step:

`reward = savings_component + efficiency_bonus - sla_penalty - destruction_penalty`

Where savings are normalized by theoretical max possible savings for the episode.

## Baseline Reproducibility

Reference baseline run (heuristic fallback, `MAX_STEPS=8`, production API):

- `cleanup`: `score=0.70`, rewards=`0.22,0.22,0.22,0.02,0.02,0.01,0.00,0.00`
- `rightsize`: `score=0.92`, rewards=`0.28,0.28,0.15,0.09,0.09,0.01,0.00,0.00`
- `full_optimization`: `score=0.99`, rewards=`0.17,0.17,0.17,0.17,0.08,0.08,0.08,0.08`

These scores are reproducible with deterministic task seeds and the same environment settings.

## Project Structure

- `cloud_cost_env/models.py`: Pydantic models
- `cloud_cost_env/data/generator.py`: deterministic account generation
- `cloud_cost_env/server/environment.py`: reset/step logic
- `cloud_cost_env/server/action_engine.py`: action execution
- `cloud_cost_env/server/grader.py`: deterministic scoring
- `cloud_cost_env/baseline_runner.py`: baseline local inference loop
- `cloud_cost_env/inference_llm.py`: LLM-driven inference loop with robust JSON parsing
- `Dockerfile` + `railway.json`: Railway backend deployment
- `frontend/`: Vercel dashboard (Vite + React)
