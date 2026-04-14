# CloudCostEnv

A cloud cost optimization Reinforcement Learning environment built on the OpenEnv framework. It simulates cloud infrastructure with realistic "waste" patterns and provides an API for agents to perform FinOps actions (rightsizing, terminating idle resources, purchasing reservations, etc.).

## Architecture

- **Backend**: Python 3.11 + FastAPI (port 8000)
- **Frontend**: React + Vite (port 5000)

### Backend (`cloud_cost_env/`)
- `server/app.py` — FastAPI application, main entry point
- `server/environment.py` — RL simulation environment
- `server/action_engine.py` — Action execution logic
- `models.py` — Pydantic models
- `rl/` — Q-learning training, evaluation, and policy scripts
- `data/` — Task definitions, instance catalogs, trained RL policy artifacts

### Frontend (`frontend/`)
- React SPA communicating with backend at `http://127.0.0.1:8000`
- Uses Recharts for visualizations, React Router for navigation
- `src/App.jsx` — Main app shell with live dashboard and scenario studio
- **Design**: Clean SaaS light theme with sidebar navigation
  - Layout: Fixed left sidebar (240px, collapsible) + scrollable main content area
  - Color palette: Light gray body (#f3f4f6), white cards, green (#22c55e) accent
  - Typography: Inter font family, clean hierarchy
  - Cards: 12px border-radius, subtle shadows, clean borders
  - Charts: Green/blue/amber palette on light backgrounds
  - KPI cards with SVG icons, progress ring visualization
  - Table-style use case listing, tabbed sections
  - Accessibility: Focus-visible outlines, responsive down to mobile
  - Plain CSS (no Tailwind) — all styles in `src/styles.css`

## Running Locally

Two workflows are configured:
1. **Backend API** — `python -m cloud_cost_env.server.app` on port 8000
2. **Start application** — `cd frontend && npm run dev` on port 5000

## Key Environment Variables

- `PORT` — Backend port (default: 8000)
- `ALLOWED_ORIGINS` — CORS allowed origins (default: `*`)
- `AGENT_CONTROL_MODE` — `auto`, `rl`, or `heuristic` (default: `auto`)
- `LIVE_DASHBOARD_ALLOW_APPLY` — Enable/disable live action apply (default: `true`)
- `VITE_API_BASE_URL` — Override backend API URL in frontend

## API Endpoints

- `GET /health` — Health check
- `GET /live/dashboard` — Live cost optimization dashboard
- `POST /reset/{task_name}` — Reset environment for a task
- `POST /step` — Execute an RL action
- `GET /state` — Get current environment state
- `GET /agent/status` — Agent and RL policy status
- `GET /agent/next-action` — Next recommended action

## Deployment

Configured as autoscale deployment. Build step compiles the React frontend, run step starts the FastAPI backend.
