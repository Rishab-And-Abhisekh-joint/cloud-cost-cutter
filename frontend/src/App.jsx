import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { BrowserRouter, Navigate, NavLink, Route, Routes, useNavigate, useLocation } from "react-router-dom";

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
    icon: "\u{1F9F9}",
  },
  rightsize: {
    title: "Rightsize Track",
    description: "Capacity tuning for compute and data tiers while preserving SLA safety.",
    icon: "\u{2696}\u{FE0F}",
  },
  full_optimization: {
    title: "Full Optimization",
    description: "Max savings path combining cleanup, rightsizing, scheduling, and guarded apply actions.",
    icon: "\u{1F680}",
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

function IconSvg({ name }) {
  const icons = {
    overview: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
    ),
    cleanup: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      </svg>
    ),
    rightsize: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="20" x2="18" y2="10" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="6" y1="20" x2="6" y2="14" />
      </svg>
    ),
    optimization: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
      </svg>
    ),
    agent: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
    spend: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="1" x2="12" y2="23" />
        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
      </svg>
    ),
    savings: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
        <polyline points="17 6 23 6 23 12" />
      </svg>
    ),
    actions: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
      </svg>
    ),
    pressure: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    ),
  };
  return icons[name] || null;
}

function StatCard({ label, value, helper, icon }) {
  return (
    <article className="kpi-card">
      {icon ? <span className="kpi-icon"><IconSvg name={icon} /></span> : null}
      <div className="kpi-content">
        <p className="kpi-label">{label}</p>
        <p className="kpi-value">{value}</p>
        {helper ? <p className="kpi-helper">{helper}</p> : null}
      </div>
    </article>
  );
}

function recLabel(actionType) {
  if (actionType === "stop_instance") return "Stop Instance";
  if (actionType === "terminate_instance") return "Terminate Instance";
  if (actionType === "release_eip") return "Release EIP";
  if (actionType === "delete_snapshot") return "Delete Snapshot";
  if (actionType === "delete_load_balancer") return "Delete Load Balancer";
  if (actionType === "rightsize_instance") return "Rightsize Instance";
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
  if (actionType === "stop_instance") return "Compute";
  if (actionType === "terminate_instance") return "Compute";
  if (actionType === "release_eip") return "Network";
  if (actionType === "delete_snapshot") return "Snapshot";
  if (actionType === "delete_load_balancer") return "Network";
  if (actionType === "rightsize_instance") return "Compute";
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
  const criticalDensity =
    Number(resources.compute || 0) > 0
      ? (Number(safety.prod_critical_compute || 0) / Number(resources.compute || 1)) * 100
      : 0;

  return (
    <article className="profile-card">
      <header className="profile-header">
        <div>
          <h3>{title}</h3>
          <p>{profile.task_name} · seed {profile.seed}</p>
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
          <strong>{fmtMoney(Math.max(0, Number(cost.current_monthly_spend || 0) - Number(cost.target_monthly_spend || 0)))}</strong>
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
        Showing top {ranked.length} opportunities · {executedCount} applied successfully
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
  return (
    <>
      <div className="page-header">
        <div>
          <h2 className="page-title">Cloud Cost Optimization Dashboard</h2>
          <p className="page-subtitle">Seed {activeProfile?.seed || seed} · {toTitleCase(currentTaskName)}</p>
        </div>
        <div className="page-header-actions">
          <button type="button" onClick={onRefreshPreview} disabled={loading}>Refresh Preview</button>
          <button type="button" className="solid" onClick={onStartEpisode} disabled={loading}>Start Episode</button>
        </div>
      </div>

      <section className="kpi-grid">
        <StatCard icon="pressure" label="Optimization Pressure" value={fmtPercent(optimizationPressure)} helper={`step ${activeStep}`} />
        <StatCard icon="spend" label="Monthly Spend" value={fmtMoney(currentCost)} helper={activeProfile?.seed ? `seed ${activeProfile.seed}` : "no active episode"} />
        <StatCard icon="savings" label="Potential Savings" value={fmtMoney(potentialSavings)} helper="ranked action estimate" />
        <StatCard
          icon="actions"
          label="Actions Logged"
          value={String(liveDashboard?.action_history?.length || 0)}
          helper={liveDashboard?.can_apply_actions ? "apply enabled" : "dry-run mode"}
        />
      </section>

      <div className="charts-row">
        <article className="card">
          <div className="card-header">
            <h3>Savings Opportunity Spectrum</h3>
          </div>
          <div className="card-body">
            <SavingsTrend recommendations={liveDashboard?.recommendations} actionHistory={liveDashboard?.action_history} />
          </div>
        </article>

        <article className="card">
          <div className="card-header">
            <h3>Optimization Progress</h3>
          </div>
          <div className="card-body progress-ring-wrap">
            <div className="progress-ring">
              <svg viewBox="0 0 120 120">
                <circle cx="60" cy="60" r="52" fill="none" stroke="#e5e7eb" strokeWidth="10" />
                <circle
                  cx="60" cy="60" r="52" fill="none"
                  stroke="#22c55e" strokeWidth="10"
                  strokeDasharray={`${optimizationPressure * 3.27} 327`}
                  strokeLinecap="round"
                  transform="rotate(-90 60 60)"
                  className="progress-ring-circle"
                />
              </svg>
              <div className="progress-ring-label">
                <strong>{fmtPercent(optimizationPressure)}</strong>
                <span>Overall</span>
              </div>
            </div>
            <div className="progress-legend">
              <div><span className="legend-dot" style={{ background: "#22c55e" }} /> Savings Found</div>
              <div><span className="legend-dot" style={{ background: "#3b82f6" }} /> Actions Applied</div>
              <div><span className="legend-dot" style={{ background: "#f59e0b" }} /> Remaining Gap</div>
            </div>
          </div>
        </article>
      </div>

      <section className="studio-panel">
        <div className="card-header">
          <h3>Scenario Studio</h3>
          <span className="card-badge">Configure</span>
        </div>
        <div className="studio-controls">
          <div className="field-group">
            <label htmlFor="task">Task</label>
            <select id="task" value={task} onChange={(e) => onTaskChange(e.target.value)}>
              {TASKS.map((entry) => (
                <option key={entry} value={entry}>{toTitleCase(entry)}</option>
              ))}
            </select>
          </div>
          <div className="field-group">
            <label htmlFor="seed">Seed</label>
            <input id="seed" value={seed} onChange={(e) => onSeedChange(e.target.value)} />
          </div>
          <div className="actions">
            <button type="button" onClick={onRefreshPreview} disabled={loading}>Preview Scenario</button>
            <button type="button" className="solid" onClick={onStartEpisode} disabled={loading}>Start Episode</button>
            <button type="button" onClick={() => onOpenUseCase(task)}>Open Use-Case</button>
          </div>
        </div>
      </section>

      {error ? <p className="error-text">{error}</p> : null}

      <section className="tab-section">
        <div className="tab-header">
          <h3>Use Cases</h3>
        </div>
        <div className="usecase-table">
          <div className="table-header">
            <span>Use Case</span>
            <span>Description</span>
            <span>Action</span>
          </div>
          {TASKS.map((entry) => (
            <div key={entry} className="table-row">
              <span className="table-cell-title">{TASK_META[entry].title}</span>
              <span className="table-cell-desc">{TASK_META[entry].description}</span>
              <span><button type="button" onClick={() => onOpenUseCase(entry)}>View Charts</button></span>
            </div>
          ))}
        </div>
      </section>

      <section className="profile-stack">
        <ProfileCard title="Preview Profile" profile={previewProfile} />
        <ProfileCard title="Active Profile" profile={activeProfile} />
      </section>

      <section className="ops-shell">
        <div className="card-header">
          <h3>Live Operations Console</h3>
          <button type="button" onClick={() => onRefreshLive(true)} disabled={liveLoading}>
            {liveLoading ? "Refreshing..." : "Refresh Live"}
          </button>
        </div>

        {liveError ? <p className="error-text">{liveError}</p> : null}
        {liveMessage ? <p className="live-message">{liveMessage}</p> : null}

        <div className="kpi-grid compact">
          <StatCard label="Live Connection" value={liveDashboard?.connected ? "Connected" : "Offline"} helper={liveDashboard?.region || "unknown region"} />
          <StatCard label="Potential Savings" value={fmtMoney(liveDashboard?.potential_monthly_savings_usd || 0)} helper="monthly estimate" />
          <StatCard label="Can Apply" value={liveDashboard?.can_apply_actions ? "Yes" : "No"} helper="toggle via env var" />
          <StatCard label="Action History" value={String(liveDashboard?.action_history?.length || 0)} helper="latest 20 events" />
        </div>

        <div className="ops-grid">
          <article className="card">
            <div className="card-header"><h3>Prioritized Recommendations</h3></div>
            <div className="card-body">
              {liveDashboard?.recommendations?.length ? (
                <ul className="rec-list">
                  {liveDashboard.recommendations.map((rec) => {
                    const dryKey = `${rec.action_type}:${rec.resource_id}:dry`;
                    const applyKey = `${rec.action_type}:${rec.resource_id}:apply`;
                    return (
                      <li className="rec-item" key={`${rec.action_type}:${rec.resource_id}`}>
                        <div className="rec-copy">
                          <p className="rec-title">{recLabel(rec.action_type)} · {rec.resource_name}</p>
                          <p className="rec-badge">{signalLabel(rec.action_type)}</p>
                          <p className="rec-meta">{rec.reason}</p>
                          <p className="rec-meta rec-metrics">
                            <span className={`status-chip status-${String(rec.risk || "low").toLowerCase()}`}>Risk {rec.risk}</span>
                            <span>Est. savings {fmtMoney(rec.estimated_monthly_savings_usd)}</span>
                          </p>
                        </div>
                        <div className="rec-actions">
                          <button type="button" disabled={liveBusyKey !== ""} onClick={() => onRunLiveAction(rec.action_type, rec.resource_id, false)}>
                            {liveBusyKey === dryKey ? "Running..." : "Dry Run"}
                          </button>
                          <button type="button" className="solid" disabled={liveBusyKey !== "" || !liveDashboard?.can_apply_actions} onClick={() => onRunLiveAction(rec.action_type, rec.resource_id, true)}>
                            {liveBusyKey === applyKey ? "Applying..." : "Apply"}
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="empty-text">No recommendations yet. Start an episode and refresh live data.</p>
              )}
            </div>
          </article>

          <article className="card">
            <div className="card-header"><h3>Recent Actions</h3></div>
            <div className="card-body">
              {liveDashboard?.action_history?.length ? (
                <ul className="history-list">
                  {liveDashboard.action_history.slice().reverse().map((event, idx) => (
                    <li className="history-item" key={`${event.timestamp}-${event.resource_id}-${idx}`}>
                      <p><strong>{recLabel(event.action_type)}</strong> on {event.resource_id}</p>
                      <p className="history-meta-line">
                        <span className={`status-chip ${event.ok ? "status-active" : "status-high"}`}>{event.ok ? "ok" : "failed"}</span>
                        <span>{event.dry_run ? "Dry run" : "Executed"}</span>
                        <span>savings {fmtMoney(event.estimated_monthly_savings_usd)}</span>
                      </p>
                      <p>{event.message}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="empty-text">No actions recorded yet.</p>
              )}
            </div>
          </article>

          <article className="card wide">
            <div className="card-header"><h3>Resource Footprint Map</h3></div>
            <div className="card-body">
              <ResourceMap counts={liveDashboard?.resource_counts} />
            </div>
          </article>
        </div>
      </section>
    </>
  );
}

function Sidebar({ sidebarOpen, onToggleSidebar }) {
  const location = useLocation();

  return (
    <aside className={`sidebar ${sidebarOpen ? "open" : "collapsed"}`}>
      <div className="sidebar-brand">
        <div className="brand-mark">CC</div>
        {sidebarOpen && (
          <div className="brand-text">
            <strong>CloudCost</strong>
            <span>Optimization Console</span>
          </div>
        )}
        <button className="sidebar-toggle" onClick={onToggleSidebar} aria-label="Toggle sidebar">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {sidebarOpen ? <><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></> : <><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="18" x2="21" y2="18" /></>}
          </svg>
        </button>
      </div>

      <nav className="sidebar-nav" aria-label="Main navigation">
        <p className="sidebar-section-label">{sidebarOpen ? "MAIN MENU" : ""}</p>
        <NavLink to="/overview" className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}>
          <IconSvg name="overview" />
          {sidebarOpen && <span>Overview</span>}
        </NavLink>

        <p className="sidebar-section-label">{sidebarOpen ? "USE CASES" : ""}</p>
        <NavLink to="/use-cases/cleanup" className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}>
          <IconSvg name="cleanup" />
          {sidebarOpen && <span>Cleanup</span>}
        </NavLink>
        <NavLink to="/use-cases/rightsize" className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}>
          <IconSvg name="rightsize" />
          {sidebarOpen && <span>Rightsize</span>}
        </NavLink>
        <NavLink to="/use-cases/full_optimization" className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}>
          <IconSvg name="optimization" />
          {sidebarOpen && <span>Full Optimization</span>}
        </NavLink>

        <p className="sidebar-section-label">{sidebarOpen ? "SYSTEM" : ""}</p>
        <NavLink to="/rl-status" className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}>
          <IconSvg name="agent" />
          {sidebarOpen && <span>Agent + RL</span>}
        </NavLink>
      </nav>
    </aside>
  );
}

function AppShell() {
  const navigate = useNavigate();

  const [sidebarOpen, setSidebarOpen] = useState(true);
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

  const currentCost = Number(activeProfile?.cost?.current_monthly_spend || previewProfile?.cost?.current_monthly_spend || 0);
  const potentialSavings = Number(
    liveDashboard?.potential_monthly_savings_usd || activeProfile?.cost?.max_possible_savings_8_steps || 0
  );
  const optimizationPressure = currentCost > 0 ? Math.min(100, (potentialSavings / currentCost) * 100) : 0;
  const currentTaskName = activeProfile?.task_name || task;
  const activeStep = Number(activeProfile?.step_count || 0);

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

  async function refreshLiveDashboard(showSpinner = true, taskName = task, seedValue = seed) {
    if (showSpinner) setLiveLoading(true);
    setLiveError("");
    try {
      const data = await request(liveDashboardPath(taskName, seedValue), { method: "GET" });
      setLiveDashboard(data);
    } catch (err) {
      setLiveError(`Live dashboard: ${err.message}`);
    } finally {
      if (showSpinner) setLiveLoading(false);
    }
  }

  async function refreshPreview(showSpinner = true, taskName = task, seedValue = seed) {
    if (showSpinner) setLoading(true);
    setError("");
    try {
      const preview = await request(`/profile?task_name=${taskName}&seed=${seedValue}`, { method: "GET" });
      setPreviewProfile(preview);
    } catch (err) {
      setError(`Preview failed: ${err.message}`);
    } finally {
      if (showSpinner) setLoading(false);
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
        body: JSON.stringify({ action_type: actionType, resource_id: resourceId, apply }),
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
    if (showSpinner) setRlLoading(true);
    setRlError("");
    try {
      const status = await request("/agent/status", { method: "GET" });
      setRlStatus(status);
    } catch (err) {
      setRlError(`Agent status failed: ${err.message}`);
    } finally {
      if (showSpinner) setRlLoading(false);
    }
  }

  function handleTaskChange(nextTask) {
    if (TASKS.includes(nextTask)) setTask(nextTask);
  }

  function openUseCase(nextTask) {
    if (!TASKS.includes(nextTask)) return;
    setTask(nextTask);
    navigate(`/use-cases/${nextTask}`);
  }

  return (
    <div className="app-layout">
      <Sidebar sidebarOpen={sidebarOpen} onToggleSidebar={() => setSidebarOpen(!sidebarOpen)} />
      <main className="main-content">
        <Routes>
          <Route path="/" element={<Navigate to="/overview" replace />} />
          <Route
            path="/overview"
            element={
              <OverviewPage
                task={task}
                seed={seed}
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
                <LazyRLStatusPage rlStatus={rlStatus} rlLoading={rlLoading} rlError={rlError} onRefresh={refreshAgentStatus} />
              </Suspense>
            }
          />
          <Route path="*" element={<Navigate to="/overview" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  );
}
