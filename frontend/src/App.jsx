import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { BrowserRouter, Navigate, NavLink, Route, Routes, useNavigate } from "react-router-dom";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const TASKS = ["cleanup", "rightsize", "full_optimization"];
const DEFAULT_PROD_API_BASE_URL = "https://cloud-cost-env-api-production.up.railway.app";
const REQUEST_TIMEOUT_MS = Number(import.meta.env.VITE_REQUEST_TIMEOUT_MS || 15000);
const REQUEST_RETRIES = Number(import.meta.env.VITE_REQUEST_RETRIES || 2);
const LazyUseCaseRoutePage = lazy(() => import("./routes/UseCaseRoutePage"));
const LazyRLStatusPage = lazy(() => import("./routes/RLStatusPage"));

const TASK_META = {
  cleanup: {
    title: "Cleanup Sweep",
    description: "Quick wins: remove unattached resources, stale snapshots, and idle artifacts.",
  },
  rightsize: {
    title: "Rightsize Track",
    description: "Capacity tuning for compute and data tiers while preserving SLA safety.",
  },
  full_optimization: {
    title: "Full Optimization",
    description: "Max savings path combining cleanup, rightsizing, scheduling, and guarded apply actions.",
  },
};

function resolveApiBaseUrl() {
  const configured = String(import.meta.env.VITE_API_BASE_URL || "").trim();
  if (configured) {
    return configured.replace(/\/+$/, "");
  }

  if (typeof window !== "undefined" && window.location.hostname === "localhost") {
    return "http://127.0.0.1:8000";
  }

  return DEFAULT_PROD_API_BASE_URL;
}

const API_BASE_URL = resolveApiBaseUrl();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toTitleCase(value) {
  return String(value || "")
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function fmtMoney(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function fmtPercent(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function fmtHours(totalMinutes) {
  const safeMinutes = Math.max(0, Math.round(Number(totalMinutes || 0)));
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function buildWeeklyHours(actionHistory = []) {
  const labels = ["Sep 7", "Sep 8", "Sep 9", "Sep 10", "Sep 11", "Sep 12", "Sep 13"];
  const seeds = [18, 20, 24, 22, 27, 32, 28];
  const historyBoost = Math.min(9, Number(actionHistory.length || 0));

  return labels.map((name, index) => {
    const signal = Number(actionHistory[index]?.estimated_monthly_savings_usd || 0);
    const billable = seeds[index] + historyBoost * 0.5 + Math.min(7, signal / 120);
    const nonBillable = Math.max(4, 12 - index * 0.7 + historyBoost * 0.2);
    return {
      name,
      billable: Number(billable.toFixed(1)),
      nonBillable: Number(nonBillable.toFixed(1)),
    };
  });
}

function sumValues(record) {
  if (!record || typeof record !== "object") {
    return 0;
  }
  return Object.values(record).reduce((acc, value) => acc + Number(value || 0), 0);
}

async function request(path, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const canRetry = method === "GET" || method === "HEAD" || method === "OPTIONS";
  let lastError = null;

  for (let attempt = 0; attempt <= REQUEST_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(`${API_BASE_URL}${path}`, {
        headers: { "Content-Type": "application/json", ...(options.headers || {}) },
        ...options,
        signal: controller.signal,
      });

      const text = await response.text();
      let payload = null;

      if (text) {
        try {
          payload = JSON.parse(text);
        } catch {
          payload = text;
        }
      }

      if (!response.ok) {
        const detail =
          payload && typeof payload === "object"
            ? payload.detail || JSON.stringify(payload)
            : String(payload || `Request failed: ${response.status}`);
        const error = new Error(detail);
        error.status = response.status;
        throw error;
      }

      return payload ?? {};
    } catch (error) {
      lastError = error;
      const status = Number(error?.status || 0);
      const isAbort = error?.name === "AbortError";
      const retriable = canRetry && (isAbort || status === 429 || status >= 500 || status === 0);

      if (retriable && attempt < REQUEST_RETRIES) {
        await sleep((attempt + 1) * 350);
        continue;
      }

      if (isAbort) {
        throw new Error(`Request timed out after ${REQUEST_TIMEOUT_MS}ms`);
      }

      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError || new Error("Request failed");
}

function StatCard({ label, value, helper }) {
  return (
    <article className="kpi-card">
      <p className="kpi-label">{label}</p>
      <p className="kpi-value">{value}</p>
      {helper ? <p className="kpi-helper">{helper}</p> : null}
    </article>
  );
}

function recLabel(actionType) {
  if (actionType === "stop_instance") {
    return "Stop Instance";
  }
  if (actionType === "terminate_instance") {
    return "Terminate Instance";
  }
  if (actionType === "release_eip") {
    return "Release EIP";
  }
  if (actionType === "delete_snapshot") {
    return "Delete Snapshot";
  }
  if (actionType === "delete_load_balancer") {
    return "Delete Load Balancer";
  }
  if (actionType === "rightsize_instance") {
    return "Rightsize Instance";
  }
  return "Delete Volume";
}

function liveDashboardPath(task, seed) {
  const params = new URLSearchParams({ task_name: task });
  if (String(seed).trim() !== "") {
    params.set("seed", String(seed).trim());
  }
  return `/live/dashboard?${params.toString()}`;
}

function signalLabel(actionType) {
  if (actionType === "stop_instance") {
    return "Compute";
  }
  if (actionType === "terminate_instance") {
    return "Compute";
  }
  if (actionType === "release_eip") {
    return "Network";
  }
  if (actionType === "delete_snapshot") {
    return "Snapshot";
  }
  if (actionType === "delete_load_balancer") {
    return "Network";
  }
  if (actionType === "rightsize_instance") {
    return "Compute";
  }
  return "Storage";
}

function ProfileCard({ title, profile }) {
  if (!profile) {
    return (
      <article className="profile-card muted profile-loading">
        <header>
          <h3>{title}</h3>
          <p>Waiting for data</p>
        </header>
        <p>No profile loaded yet.</p>
      </article>
    );
  }

  const resources = profile.resources || {};
  const wasteSignals = profile.waste_signals || {};
  const safety = profile.safety || {};
  const cost = profile.cost || {};

  const wasteTotal = sumValues(wasteSignals);
  const savingsGap = Math.max(0, Number(cost.current_monthly_spend || 0) - Number(cost.target_monthly_spend || 0));
  const criticalDensity =
    Number(resources.compute || 0) > 0
      ? (Number(safety.prod_critical_compute || 0) / Number(resources.compute || 1)) * 100
      : 0;

  return (
    <article className="profile-card">
      <header className="profile-header">
        <div>
          <h3>{title}</h3>
          <p>
            {profile.task_name} · seed {profile.seed}
          </p>
        </div>
        <span className={`profile-mode profile-mode-${profile.mode}`}>{profile.mode}</span>
      </header>

      <div className="profile-grid">
        <div className="profile-metric">
          <p>Monthly Spend</p>
          <strong>{fmtMoney(cost.current_monthly_spend)}</strong>
        </div>
        <div className="profile-metric">
          <p>Target Spend</p>
          <strong>{fmtMoney(cost.target_monthly_spend)}</strong>
        </div>
        <div className="profile-metric">
          <p>Savings Gap</p>
          <strong>{fmtMoney(savingsGap)}</strong>
        </div>
        <div className="profile-metric">
          <p>Max Savings (8 steps)</p>
          <strong>{fmtMoney(cost.max_possible_savings_8_steps)}</strong>
        </div>
        <div className="profile-metric">
          <p>Core Resources</p>
          <strong>{Number(resources.core_total || 0)}</strong>
        </div>
        <div className="profile-metric">
          <p>Waste Signals</p>
          <strong>{wasteTotal}</strong>
        </div>
      </div>

      <div className="profile-rail">
        <div>
          <p>Critical Prod Density</p>
          <strong>{fmtPercent(criticalDensity)}</strong>
        </div>
        <div>
          <p>Dependency Edges</p>
          <strong>{Number(safety.dependency_edges || 0)}</strong>
        </div>
        <div>
          <p>Snapshots</p>
          <strong>{Number(resources.snapshots || 0)}</strong>
        </div>
      </div>
    </article>
  );
}

function ResourceMap({ counts }) {
  const entries = Object.entries(counts || {}).sort((a, b) => Number(b[1]) - Number(a[1]));
  if (!entries.length) {
    return <p className="empty-text">Resource map is available once live dashboard data is loaded.</p>;
  }

  const maxValue = Number(entries[0][1] || 1);

  return (
    <div className="resource-map">
      {entries.map(([name, value]) => {
        const pct = Math.max(5, (Number(value || 0) / maxValue) * 100);
        return (
          <div className="resource-row" key={name}>
            <div className="resource-meta">
              <span>{name.replace(/_/g, " ")}</span>
              <strong>{Number(value || 0)}</strong>
            </div>
            <div className="resource-bar-track">
              <div className="resource-bar-fill" style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SavingsTrend({ recommendations, actionHistory }) {
  const ranked = (recommendations || [])
    .slice()
    .sort((a, b) => Number(b.estimated_monthly_savings_usd || 0) - Number(a.estimated_monthly_savings_usd || 0))
    .slice(0, 6);

  if (!ranked.length) {
    return <p className="empty-text">Savings spectrum appears once live recommendations are available.</p>;
  }

  const maxSavings = Math.max(1, Number(ranked[0]?.estimated_monthly_savings_usd || 1));
  const executedCount = (actionHistory || []).filter((item) => !item?.dry_run && item?.ok).length;

  return (
    <div className="savings-trend">
      <p className="trend-note">
        Showing top {ranked.length} opportunities · {executedCount} applied successfully this run
      </p>

      <div className="trend-list" role="list" aria-label="Top savings opportunities">
        {ranked.map((entry, index) => {
          const savings = Number(entry.estimated_monthly_savings_usd || 0);
          const width = Math.max(8, (savings / maxSavings) * 100);
          return (
            <div className="trend-row" role="listitem" key={`${entry.action_type}:${entry.resource_id}`}>
              <div className="trend-meta">
                <p>{recLabel(entry.action_type)}</p>
                <strong>{fmtMoney(savings)}</strong>
              </div>
              <div className="trend-track">
                <div className="trend-bar" style={{ width: `${width}%`, animationDelay: `${index * 70}ms` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function OverviewPage({
  task,
  seed,
  health,
  apiHint,
  lastUpdate,
  loading,
  error,
  liveLoading,
  liveError,
  liveMessage,
  liveBusyKey,
  activeProfile,
  previewProfile,
  liveDashboard,
  optimizationPressure,
  currentTaskName,
  activeStep,
  currentCost,
  potentialSavings,
  onSeedChange,
  onTaskChange,
  onRefreshPreview,
  onStartEpisode,
  onRefreshLive,
  onRunLiveAction,
  onOpenUseCase,
}) {
  const actionHistory = liveDashboard?.action_history || [];
  const recommendations = liveDashboard?.recommendations || [];
  const weeklyHours = useMemo(() => buildWeeklyHours(actionHistory), [actionHistory]);
  const totalMinutes = 118 * 60 + activeStep * 14 + actionHistory.length * 9;
  const totalBudget = Math.max(currentCost, currentCost + potentialSavings);
  const budgetRemaining = Math.max(0, totalBudget - currentCost);
  const progressValue = Math.max(0, Math.min(100, Math.round(optimizationPressure)));

  return (
    <>
      <section className="metric-strip">
        <article className="summary-card">
          <div className="summary-icon">H</div>
          <p className="summary-label">Total Hours</p>
          <p className="summary-value">{fmtHours(totalMinutes)}</p>
          <p className="summary-help">Derived from active steps and execution history</p>
        </article>
        <article className="summary-card">
          <div className="summary-icon">B</div>
          <p className="summary-label">Total Budget</p>
          <p className="summary-value">{fmtMoney(totalBudget)}</p>
          <p className="summary-help">Current spend plus projected optimization capacity</p>
        </article>
        <article className="summary-card">
          <div className="summary-icon">R</div>
          <p className="summary-label">Budget Remaining</p>
          <p className="summary-value">{fmtMoney(budgetRemaining)}</p>
          <p className="summary-help">Available room against active monthly budget</p>
        </article>
      </section>

      <section className="analytics-grid">
        <article className="panel-card hours-panel">
          <div className="panel-head">
            <h3>Hours per week</h3>
            <button type="button" onClick={() => onRefreshLive(true)} disabled={liveLoading}>
              {liveLoading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
          <div className="hours-chart-wrap">
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={weeklyHours} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="4 4" stroke="rgba(176, 182, 193, 0.62)" vertical={false} />
                <XAxis dataKey="name" stroke="#8e9aa8" tickLine={false} axisLine={false} />
                <YAxis stroke="#8e9aa8" tickLine={false} axisLine={false} />
                <Tooltip formatter={(value) => `${Number(value || 0).toFixed(1)} h`} />
                <Legend />
                <Line type="monotone" dataKey="billable" stroke="#2b7fff" strokeWidth={2.5} dot={false} />
                <Line
                  type="monotone"
                  dataKey="nonBillable"
                  stroke="#9ba8b8"
                  strokeWidth={2.2}
                  strokeDasharray="6 4"
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </article>

        <article className="panel-card progress-panel">
          <div className="panel-head">
            <h3>Task progress</h3>
          </div>
          <div className="progress-ring" style={{ "--progress": progressValue }}>
            <div className="progress-ring-inner">
              <strong>{progressValue}%</strong>
              <span>Overall</span>
            </div>
          </div>
          <ul className="progress-legend">
            <li>
              <span className="legend-dot dot-blue" /> Design
            </li>
            <li>
              <span className="legend-dot dot-orange" /> Business
            </li>
            <li>
              <span className="legend-dot dot-yellow" /> Project management
            </li>
          </ul>
        </article>
      </section>

      <section className="control-bar">
        <div className="field-group">
          <label htmlFor="task">Task</label>
          <select id="task" value={task} onChange={(e) => onTaskChange(e.target.value)}>
            {TASKS.map((entry) => (
              <option key={entry} value={entry}>
                {toTitleCase(entry)}
              </option>
            ))}
          </select>
        </div>

        <div className="field-group">
          <label htmlFor="seed">Seed</label>
          <input id="seed" value={seed} onChange={(e) => onSeedChange(e.target.value)} />
        </div>

        <div className="actions">
          <button type="button" onClick={onRefreshPreview} disabled={loading}>
            Preview Scenario
          </button>
          <button type="button" className="solid" onClick={onStartEpisode} disabled={loading}>
            Start Episode
          </button>
          <button type="button" onClick={() => onOpenUseCase(task)}>
            Open Use-Case Page
          </button>
        </div>
      </section>

      {error ? <p className="error-text">{error}</p> : null}
      {liveError ? <p className="error-text">{liveError}</p> : null}
      {liveMessage ? <p className="live-message">{liveMessage}</p> : null}

      <section className="task-table-panel">
        <div className="task-table-title">
          <div className="task-tabs" role="tablist" aria-label="Task categories">
            <button type="button" className="task-tab active">
              Billable Tasks
            </button>
            <button type="button" className="task-tab">
              Non Billable Tasks
            </button>
          </div>
          <button type="button" onClick={() => onOpenUseCase(task)}>
            View detailed charts
          </button>
        </div>

        <div className="task-table">
          <div className="task-table-head">
            <span>Task</span>
            <span>Team members</span>
            <span>Working hours</span>
            <span>Billable amount</span>
            <span>Total cost</span>
            <span>Status</span>
            <span>Action</span>
          </div>

          {recommendations.length ? (
            recommendations.slice(0, 6).map((rec) => {
              const estimated = Number(rec.estimated_monthly_savings_usd || 0);
              const dryKey = `${rec.action_type}:${rec.resource_id}:dry`;
              const risk = String(rec.risk || "low").toLowerCase();
              const statusLabel = risk === "high" ? "Review" : "Active";
              const statusClass = risk === "high" ? "status-pill review" : "status-pill active";

              return (
                <div className="task-row" key={`${rec.action_type}:${rec.resource_id}`}>
                  <span>{recLabel(rec.action_type)}</span>
                  <span>{signalLabel(rec.action_type)}</span>
                  <span>{(estimated / 26).toFixed(1)}</span>
                  <span>{fmtMoney(estimated)}</span>
                  <span>{fmtMoney(estimated * 1.08)}</span>
                  <span>
                    <span className={statusClass}>{statusLabel}</span>
                  </span>
                  <span>
                    <button
                      type="button"
                      className="row-action"
                      disabled={liveBusyKey !== ""}
                      onClick={() => onRunLiveAction(rec.action_type, rec.resource_id, false)}
                    >
                      {liveBusyKey === dryKey ? "Running" : "Dry run"}
                    </button>
                  </span>
                </div>
              );
            })
          ) : (
            <p className="empty-text table-empty">No tasks yet. Start an episode and refresh live data.</p>
          )}
        </div>
      </section>

      <section className="profile-stack">
        <ProfileCard title="Preview Profile" profile={previewProfile} />
        <ProfileCard title="Active Profile" profile={activeProfile} />
      </section>
    </>
  );
}

function AppShell() {
  const navigate = useNavigate();

  const [seed, setSeed] = useState("777");
  const [task, setTask] = useState("full_optimization");
  const [health, setHealth] = useState("checking");
  const [activeProfile, setActiveProfile] = useState(null);
  const [previewProfile, setPreviewProfile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [liveDashboard, setLiveDashboard] = useState(null);
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveBusyKey, setLiveBusyKey] = useState("");
  const [liveError, setLiveError] = useState("");
  const [liveMessage, setLiveMessage] = useState("");
  const [rlStatus, setRlStatus] = useState(null);
  const [rlLoading, setRlLoading] = useState(false);
  const [rlError, setRlError] = useState("");

  const apiHint = useMemo(() => API_BASE_URL.replace(/^https?:\/\//, ""), []);
  const currentCost = Number(activeProfile?.cost?.current_monthly_spend || previewProfile?.cost?.current_monthly_spend || 0);
  const potentialSavings = Number(
    liveDashboard?.potential_monthly_savings_usd || activeProfile?.cost?.max_possible_savings_8_steps || 0
  );
  const optimizationPressure = currentCost > 0 ? Math.min(100, (potentialSavings / currentCost) * 100) : 0;
  const currentTaskName = activeProfile?.task_name || task;
  const activeStep = Number(activeProfile?.step_count || 0);
  const lastUpdate = liveDashboard?.updated_at ? new Date(liveDashboard.updated_at).toLocaleTimeString() : "n/a";

  useEffect(() => {
    async function bootstrap() {
      try {
        await request("/health", { method: "GET" });
        setHealth("online");
      } catch {
        setHealth("offline");
      }

      try {
        const active = await request("/profile", { method: "GET" });
        setActiveProfile(active);
      } catch {
        setActiveProfile(null);
      }

      await refreshPreview(false, task, seed);
      await refreshLiveDashboard(false, task, seed);
      await refreshAgentStatus(false);
    }

    bootstrap();
  }, []);

  useEffect(() => {
    refreshPreview(false, task, seed);
    refreshLiveDashboard(false, task, seed);

    const timer = setInterval(() => {
      refreshLiveDashboard(false, task, seed);
    }, 15000);

    return () => clearInterval(timer);
  }, [task, seed]);

  useEffect(() => {
    const timer = setInterval(() => {
      refreshAgentStatus(false);
    }, 30000);

    return () => clearInterval(timer);
  }, []);

  async function refreshLiveDashboard(showSpinner = true, taskName = task, seedValue = seed) {
    if (showSpinner) {
      setLiveLoading(true);
    }
    setLiveError("");

    try {
      const dashboard = await request(liveDashboardPath(taskName, seedValue), { method: "GET" });
      setLiveDashboard(dashboard);
    } catch (err) {
      setLiveError(`Live dashboard failed: ${err.message}`);
    } finally {
      if (showSpinner) {
        setLiveLoading(false);
      }
    }
  }

  async function refreshPreview(showSpinner = true, taskName = task, seedValue = seed) {
    setError("");
    if (showSpinner) {
      setLoading(true);
    }

    try {
      const preview = await request(`/profile?task_name=${taskName}&seed=${seedValue}`, { method: "GET" });
      setPreviewProfile(preview);
    } catch (err) {
      setError(`Preview failed: ${err.message}`);
    } finally {
      if (showSpinner) {
        setLoading(false);
      }
    }
  }

  async function startEpisode(taskName = task, seedValue = seed) {
    setError("");
    setLoading(true);

    try {
      await request(`/reset/${taskName}?seed=${seedValue}`, { method: "POST" });
      const active = await request("/profile", { method: "GET" });
      setActiveProfile(active);
      await refreshPreview(false, taskName, seedValue);
      await refreshLiveDashboard(false, taskName, seedValue);
    } catch (err) {
      setError(`Reset failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function runLiveAction(actionType, resourceId, apply) {
    const op = apply ? "apply" : "dry";
    const key = `${actionType}:${resourceId}:${op}`;
    setLiveBusyKey(key);
    setLiveError("");
    setLiveMessage("");

    try {
      const result = await request("/live/action", {
        method: "POST",
        body: JSON.stringify({
          action_type: actionType,
          resource_id: resourceId,
          apply,
        }),
      });

      setLiveMessage(result.message || "Action completed");
      await refreshLiveDashboard(false);

      try {
        const active = await request("/profile", { method: "GET" });
        setActiveProfile(active);
      } catch {
        setActiveProfile(null);
      }
    } catch (err) {
      setLiveError(`Live action failed: ${err.message}`);
    } finally {
      setLiveBusyKey("");
    }
  }

  async function refreshAgentStatus(showSpinner = true) {
    if (showSpinner) {
      setRlLoading(true);
    }
    setRlError("");

    try {
      const status = await request("/agent/status", { method: "GET" });
      setRlStatus(status);
    } catch (err) {
      setRlError(`Agent status failed: ${err.message}`);
    } finally {
      if (showSpinner) {
        setRlLoading(false);
      }
    }
  }

  function handleTaskChange(nextTask) {
    if (TASKS.includes(nextTask)) {
      setTask(nextTask);
    }
  }

  function openUseCase(nextTask) {
    if (!TASKS.includes(nextTask)) {
      return;
    }
    setTask(nextTask);
    navigate(`/use-cases/${nextTask}`);
  }

  return (
    <main className="workspace-shell">
      <aside className="sidebar">
        <div className="sidebar-top">
          <p className="sidebar-space">Jone&apos;s space</p>
          <p className="sidebar-email">jackson.graham@example.com</p>
          <button type="button" className="sidebar-new">
            + New project
          </button>
          <input className="sidebar-search" value="Search" readOnly aria-label="Search" />
        </div>

        <p className="sidebar-section-title">Main menu</p>
        <nav className="sidebar-nav" aria-label="Main menu">
          <span className="sidebar-nav-item active">Projects</span>
          <span className="sidebar-nav-item">Time Tracking</span>
          <span className="sidebar-nav-item">Expenses</span>
          <span className="sidebar-nav-item">Team</span>
          <span className="sidebar-nav-item">Invoices</span>
          <span className="sidebar-nav-item">Management</span>
        </nav>

        <div className="sidebar-divider" />
        <p className="sidebar-section-title">Favorites</p>
        <div className="sidebar-favorites">
          <span className="sidebar-favorite-item">Product V2.0</span>
          <span className="sidebar-favorite-item">Construction Site Support</span>
          <span className="sidebar-favorite-item">User Interview For Ecommerce</span>
          <span className="sidebar-favorite-item">UX Design And Research</span>
        </div>

        <div className="sidebar-divider" />
        <p className="sidebar-section-title">Dashboard views</p>
        <nav className="sidebar-routes" aria-label="Dashboard pages">
          <NavLink to="/overview" className={({ isActive }) => `sidebar-route-link ${isActive ? "active" : ""}`}>
            Project Overview
          </NavLink>
          {TASKS.map((entry) => (
            <NavLink
              key={entry}
              to={`/use-cases/${entry}`}
              className={({ isActive }) => `sidebar-route-link ${isActive ? "active" : ""}`}
            >
              {toTitleCase(entry)}
            </NavLink>
          ))}
          <NavLink to="/rl-status" className={({ isActive }) => `sidebar-route-link ${isActive ? "active" : ""}`}>
            Agent + RL
          </NavLink>
        </nav>
      </aside>

      <section className="workspace-main">
        <header className="workspace-topbar">
          <button type="button" className="back-btn">
            Back to projects
          </button>
          <div className="workspace-actions">
            <span className={`pill ${health === "online" ? "pill-good" : "pill-bad"}`}>Backend {health}</span>
            <span className="pill pill-soft">API {apiHint}</span>
            <span className="pill pill-soft">Updated {lastUpdate}</span>
            <button type="button">Edit project</button>
            <button type="button" className="solid">
              Create Invoice
            </button>
          </div>
        </header>

        <section className="project-heading">
          <h1>Cloud-Based Accounting SaaS project</h1>
          <p>
            Sep 7, 2024 - Sep 21, 2024 · Current task {toTitleCase(currentTaskName)} · Step {activeStep}
          </p>
        </section>

        <section className="route-panel">
          <Routes>
            <Route path="/" element={<Navigate to="/overview" replace />} />
            <Route
              path="/overview"
              element={
                <OverviewPage
                  task={task}
                  seed={seed}
                  health={health}
                  apiHint={apiHint}
                  lastUpdate={lastUpdate}
                  loading={loading}
                  error={error}
                  liveLoading={liveLoading}
                  liveError={liveError}
                  liveMessage={liveMessage}
                  liveBusyKey={liveBusyKey}
                  activeProfile={activeProfile}
                  previewProfile={previewProfile}
                  liveDashboard={liveDashboard}
                  optimizationPressure={optimizationPressure}
                  currentTaskName={currentTaskName}
                  activeStep={activeStep}
                  currentCost={currentCost}
                  potentialSavings={potentialSavings}
                  onSeedChange={setSeed}
                  onTaskChange={handleTaskChange}
                  onRefreshPreview={() => refreshPreview(true)}
                  onStartEpisode={() => startEpisode(task, seed)}
                  onRefreshLive={refreshLiveDashboard}
                  onRunLiveAction={runLiveAction}
                  onOpenUseCase={openUseCase}
                />
              }
            />
            <Route
              path="/use-cases/:taskName"
              element={
                <Suspense fallback={<p className="chart-empty">Loading use-case route...</p>}>
                  <LazyUseCaseRoutePage
                    task={task}
                    onTaskChange={handleTaskChange}
                    tasks={TASKS}
                    taskMeta={TASK_META}
                    seed={seed}
                    loading={loading}
                    previewProfile={previewProfile}
                    activeProfile={activeProfile}
                    liveDashboard={liveDashboard}
                    onSeedChange={setSeed}
                    onRefreshPreview={() => refreshPreview(true)}
                    onStartEpisode={() => startEpisode(task, seed)}
                    onRefreshLive={refreshLiveDashboard}
                    StatCard={StatCard}
                    ProfileCard={ProfileCard}
                  />
                </Suspense>
              }
            />
            <Route
              path="/rl-status"
              element={
                <Suspense fallback={<p className="chart-empty">Loading RL status...</p>}>
                  <LazyRLStatusPage
                    rlStatus={rlStatus}
                    rlLoading={rlLoading}
                    rlError={rlError}
                    onRefresh={refreshAgentStatus}
                  />
                </Suspense>
              }
            />
            <Route path="*" element={<Navigate to="/overview" replace />} />
          </Routes>
        </section>
      </section>
    </main>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  );
}
