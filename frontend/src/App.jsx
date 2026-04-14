import { Suspense, lazy, useEffect, useMemo, useState, useCallback } from "react";
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

const CHART_COLORS = ["#22c55e", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4"];

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
  if (!record || typeof record !== "object") return 0;
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
        try { payload = JSON.parse(text); } catch { payload = text; }
      }
      if (!response.ok) {
        const detail = payload && typeof payload === "object"
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
      if (isAbort) throw new Error(`Request timed out after ${REQUEST_TIMEOUT_MS}ms`);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error("Request failed");
}

function IconSvg({ name, size }) {
  const s = size || 16;
  const icons = {
    overview: (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
    ),
    resources: (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
        <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
        <line x1="6" y1="6" x2="6.01" y2="6" />
        <line x1="6" y1="18" x2="6.01" y2="18" />
      </svg>
    ),
    waste: (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    ),
    actioncenter: (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="9 11 12 14 22 4" />
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
      </svg>
    ),
    analytics: (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="20" x2="18" y2="10" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="6" y1="20" x2="6" y2="14" />
      </svg>
    ),
    cleanup: (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      </svg>
    ),
    rightsize: (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      </svg>
    ),
    optimization: (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
      </svg>
    ),
    agent: (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
    spend: (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="1" x2="12" y2="23" />
        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
      </svg>
    ),
    savings: (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
        <polyline points="17 6 23 6 23 12" />
      </svg>
    ),
    actions: (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
      </svg>
    ),
    pressure: (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    ),
    sun: (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="5" />
        <line x1="12" y1="1" x2="12" y2="3" />
        <line x1="12" y1="21" x2="12" y2="23" />
        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
        <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
        <line x1="1" y1="12" x2="3" y2="12" />
        <line x1="21" y1="12" x2="23" y2="12" />
        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
        <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
      </svg>
    ),
    moon: (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      </svg>
    ),
  };
  return icons[name] || null;
}

function StatCard({ label, value, helper, icon, iconColor }) {
  return (
    <article className="kpi-card">
      {icon ? <span className={`kpi-icon ${iconColor || ""}`}><IconSvg name={icon} /></span> : null}
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

function MiniDonutChart({ data, label, sublabel }) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  if (!data.length || total === 0) {
    return (
      <div className="mini-chart-card">
        <p className="mini-chart-title">{label}</p>
        <p className="mini-chart-subtitle">No data</p>
      </div>
    );
  }

  const r = 38;
  const circ = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className="mini-chart-card">
      <p className="mini-chart-title">{label}</p>
      <div className="mini-ring">
        <svg viewBox="0 0 100 100">
          <circle cx="50" cy="50" r={r} fill="none" stroke="var(--track-bg)" strokeWidth="8" />
          {data.map((seg, i) => {
            const pct = seg.value / total;
            const dash = pct * circ;
            const gap = circ - dash;
            const rotate = (offset / total) * 360 - 90;
            offset += seg.value;
            return (
              <circle
                key={seg.name}
                cx="50" cy="50" r={r}
                fill="none"
                stroke={CHART_COLORS[i % CHART_COLORS.length]}
                strokeWidth="8"
                strokeDasharray={`${dash} ${gap}`}
                strokeLinecap="round"
                transform={`rotate(${rotate} 50 50)`}
              />
            );
          })}
        </svg>
        <div className="mini-ring-label">
          <strong>{total}</strong>
          <span>{sublabel || "total"}</span>
        </div>
      </div>
      <div className="mini-legend">
        {data.map((seg, i) => (
          <div className="mini-legend-item" key={seg.name}>
            <span className="mini-legend-dot" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
            {seg.name}
          </div>
        ))}
      </div>
    </div>
  );
}

function WasteGauge({ wasteSignals }) {
  const entries = [
    { name: "Idle Compute", value: Number(wasteSignals?.idle_compute || 0), color: "#ef4444" },
    { name: "Orphaned Vols", value: Number(wasteSignals?.orphaned_volumes || 0), color: "#f59e0b" },
    { name: "Unattached IPs", value: Number(wasteSignals?.unattached_ips || 0), color: "#3b82f6" },
    { name: "Empty LBs", value: Number(wasteSignals?.empty_load_balancers || 0), color: "#8b5cf6" },
    { name: "Overprov. Compute", value: Number(wasteSignals?.overprovisioned_compute || 0), color: "#06b6d4" },
    { name: "Overprov. DB", value: Number(wasteSignals?.overprovisioned_databases || 0), color: "#22c55e" },
  ].filter((e) => e.value > 0);

  const maxVal = Math.max(1, ...entries.map((e) => e.value));

  if (!entries.length) {
    return (
      <div className="mini-chart-card">
        <p className="mini-chart-title">Waste Signals</p>
        <p className="mini-chart-subtitle">No waste detected</p>
      </div>
    );
  }

  return (
    <div className="mini-chart-card">
      <p className="mini-chart-title">Waste Signals</p>
      <div className="gauge-bar-wrap">
        {entries.map((e) => (
          <div className="gauge-row" key={e.name}>
            <div className="gauge-label">
              <span>{e.name}</span>
              <strong>{e.value}</strong>
            </div>
            <div className="gauge-track">
              <div className="gauge-fill" style={{ width: `${(e.value / maxVal) * 100}%`, background: e.color }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CostBreakdownChart({ cost }) {
  const current = Number(cost?.current_monthly_spend || 0);
  const target = Number(cost?.target_monthly_spend || 0);
  const maxSavings = Number(cost?.max_possible_savings_8_steps || 0);
  const gap = Math.max(0, current - target);
  const maxVal = Math.max(1, current, target, maxSavings);

  const bars = [
    { name: "Current Spend", value: current, color: "#3b82f6" },
    { name: "Target Spend", value: target, color: "#22c55e" },
    { name: "Gap", value: gap, color: "#f59e0b" },
    { name: "Max Savings", value: maxSavings, color: "#8b5cf6" },
  ];

  if (current === 0) {
    return (
      <div className="mini-chart-card">
        <p className="mini-chart-title">Cost Breakdown</p>
        <p className="mini-chart-subtitle">No cost data</p>
      </div>
    );
  }

  return (
    <div className="mini-chart-card">
      <p className="mini-chart-title">Cost Breakdown</p>
      <div className="cost-bar-chart">
        {bars.map((b) => (
          <div className="cost-bar-row" key={b.name}>
            <div className="cost-bar-label">
              <span>{b.name}</span>
              <strong>{fmtMoney(b.value)}</strong>
            </div>
            <div className="cost-bar-track">
              <div className="cost-bar-fill" style={{ width: `${(b.value / maxVal) * 100}%`, background: b.color }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
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
        <div className="profile-metric"><p>Monthly Spend</p><strong>{fmtMoney(cost.current_monthly_spend)}</strong></div>
        <div className="profile-metric"><p>Target Spend</p><strong>{fmtMoney(cost.target_monthly_spend)}</strong></div>
        <div className="profile-metric"><p>Savings Gap</p><strong>{fmtMoney(Math.max(0, Number(cost.current_monthly_spend || 0) - Number(cost.target_monthly_spend || 0)))}</strong></div>
        <div className="profile-metric"><p>Max Savings (8 steps)</p><strong>{fmtMoney(cost.max_possible_savings_8_steps)}</strong></div>
        <div className="profile-metric"><p>Core Resources</p><strong>{Number(resources.core_total || 0)}</strong></div>
        <div className="profile-metric"><p>Waste Signals</p><strong>{wasteTotal}</strong></div>
      </div>
      <div className="profile-rail">
        <div><p>Critical Prod Density</p><strong>{fmtPercent(criticalDensity)}</strong></div>
        <div><p>Dependency Edges</p><strong>{Number(safety.dependency_edges || 0)}</strong></div>
        <div><p>Snapshots</p><strong>{Number(resources.snapshots || 0)}</strong></div>
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
      <p className="trend-note">Showing top {ranked.length} opportunities · {executedCount} applied successfully</p>
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
  task, seed, loading, error, liveLoading, liveError, liveMessage, liveBusyKey,
  activeProfile, previewProfile, liveDashboard, optimizationPressure,
  currentTaskName, activeStep, currentCost, potentialSavings,
  onSeedChange, onTaskChange, onRefreshPreview, onStartEpisode,
  onRefreshLive, onRunLiveAction, onOpenUseCase,
}) {
  const chosenProfile = activeProfile || previewProfile;
  const resources = chosenProfile?.resources || {};
  const resourcePieData = [
    { name: "Compute", value: Number(resources.compute || 0) },
    { name: "Volumes", value: Number(resources.volumes || 0) },
    { name: "Databases", value: Number(resources.databases || 0) },
    { name: "Load Balancers", value: Number(resources.load_balancers || 0) },
    { name: "Snapshots", value: Number(resources.snapshots || 0) },
    { name: "Elastic IPs", value: Number(resources.elastic_ips || 0) },
  ].filter((d) => d.value > 0);

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
        <StatCard icon="spend" iconColor="blue" label="Monthly Spend" value={fmtMoney(currentCost)} helper={activeProfile?.seed ? `seed ${activeProfile.seed}` : "no active episode"} />
        <StatCard icon="savings" label="Potential Savings" value={fmtMoney(potentialSavings)} helper="ranked action estimate" />
        <StatCard icon="actions" iconColor="amber" label="Actions Logged" value={String(liveDashboard?.action_history?.length || 0)} helper={liveDashboard?.can_apply_actions ? "apply enabled" : "dry-run mode"} />
      </section>

      <section className="visual-grid">
        <MiniDonutChart data={resourcePieData} label="Resource Distribution" sublabel="resources" />
        <WasteGauge wasteSignals={chosenProfile?.waste_signals} />
        <CostBreakdownChart cost={chosenProfile?.cost} />
      </section>

      <div className="charts-row">
        <article className="card">
          <div className="card-header"><h3>Savings Opportunity Spectrum</h3></div>
          <div className="card-body">
            <SavingsTrend recommendations={liveDashboard?.recommendations} actionHistory={liveDashboard?.action_history} />
          </div>
        </article>
        <article className="card">
          <div className="card-header"><h3>Optimization Progress</h3></div>
          <div className="card-body progress-ring-wrap">
            <div className="progress-ring">
              <svg viewBox="0 0 120 120">
                <circle cx="60" cy="60" r="52" fill="none" stroke="var(--ring-track)" strokeWidth="10" />
                <circle cx="60" cy="60" r="52" fill="none" stroke="#22c55e" strokeWidth="10" strokeDasharray={`${optimizationPressure * 3.27} 327`} strokeLinecap="round" transform="rotate(-90 60 60)" className="progress-ring-circle" />
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
        <div className="tab-header"><h3>Use Cases</h3></div>
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

function StubPage({ icon, title, description }) {
  return (
    <div className="stub-page">
      <div className="stub-page-icon"><IconSvg name={icon} size={24} /></div>
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  );
}

function Sidebar({ sidebarOpen, onToggleSidebar, theme, onToggleTheme }) {
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
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {sidebarOpen ? <><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></> : <><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="18" x2="21" y2="18" /></>}
          </svg>
        </button>
      </div>

      <nav className="sidebar-nav" aria-label="Main navigation">
        <p className="sidebar-section-label">{sidebarOpen ? "ANALYTICS" : ""}</p>
        <NavLink to="/overview" className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}>
          <IconSvg name="overview" />
          {sidebarOpen && <span>Overview</span>}
        </NavLink>
        <NavLink to="/resources" className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}>
          <IconSvg name="resources" />
          {sidebarOpen && <span>Resources</span>}
        </NavLink>
        <NavLink to="/cost-analytics" className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}>
          <IconSvg name="analytics" />
          {sidebarOpen && <span>Cost Analytics</span>}
        </NavLink>

        <p className="sidebar-section-label">{sidebarOpen ? "OPERATIONS" : ""}</p>
        <NavLink to="/waste" className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}>
          <IconSvg name="waste" />
          {sidebarOpen && <span>Waste Detector</span>}
        </NavLink>
        <NavLink to="/actions" className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}>
          <IconSvg name="actioncenter" />
          {sidebarOpen && <span>Action Center</span>}
        </NavLink>

        <p className="sidebar-section-label">{sidebarOpen ? "SCENARIOS" : ""}</p>
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

      <div className="sidebar-footer">
        <button className="theme-toggle-btn" onClick={onToggleTheme} aria-label="Toggle theme">
          <IconSvg name={theme === "dark" ? "sun" : "moon"} />
          {sidebarOpen && <span>{theme === "dark" ? "Light Mode" : "Dark Mode"}</span>}
        </button>
      </div>
    </aside>
  );
}

function AppShell() {
  const navigate = useNavigate();

  const [theme, setTheme] = useState(() => {
    try {
      const stored = localStorage.getItem("cc-theme");
      return stored === "dark" ? "dark" : "light";
    } catch { return "light"; }
  });
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

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem("cc-theme", theme); } catch {}
  }, [theme]);

  function toggleTheme() {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  }

  const currentCost = Number(activeProfile?.cost?.current_monthly_spend || previewProfile?.cost?.current_monthly_spend || 0);
  const potentialSavings = Number(
    liveDashboard?.potential_monthly_savings_usd || activeProfile?.cost?.max_possible_savings_8_steps || 0
  );
  const optimizationPressure = currentCost > 0 ? Math.min(100, (potentialSavings / currentCost) * 100) : 0;
  const currentTaskName = activeProfile?.task_name || task;
  const activeStep = Number(activeProfile?.step_count || 0);

  useEffect(() => {
    async function bootstrap() {
      try { await request("/health", { method: "GET" }); setHealth("online"); } catch { setHealth("offline"); }
      try { const active = await request("/profile", { method: "GET" }); setActiveProfile(active); } catch { setActiveProfile(null); }
      await refreshPreview(false, task, seed);
      await refreshLiveDashboard(false, task, seed);
      await refreshAgentStatus(false);
    }
    bootstrap();
  }, []);

  useEffect(() => {
    refreshPreview(false, task, seed);
    refreshLiveDashboard(false, task, seed);
    const timer = setInterval(() => { refreshLiveDashboard(false, task, seed); }, 15000);
    return () => clearInterval(timer);
  }, [task, seed]);

  async function refreshLiveDashboard(showSpinner = true, taskName = task, seedValue = seed) {
    if (showSpinner) setLiveLoading(true);
    setLiveError("");
    try { const data = await request(liveDashboardPath(taskName, seedValue), { method: "GET" }); setLiveDashboard(data); }
    catch (err) { setLiveError(`Live dashboard: ${err.message}`); }
    finally { if (showSpinner) setLiveLoading(false); }
  }

  async function refreshPreview(showSpinner = true, taskName = task, seedValue = seed) {
    if (showSpinner) setLoading(true);
    setError("");
    try { const preview = await request(`/profile?task_name=${taskName}&seed=${seedValue}`, { method: "GET" }); setPreviewProfile(preview); }
    catch (err) { setError(`Preview failed: ${err.message}`); }
    finally { if (showSpinner) setLoading(false); }
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
    } catch (err) { setError(`Reset failed: ${err.message}`); }
    finally { setLoading(false); }
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
      try { const active = await request("/profile", { method: "GET" }); setActiveProfile(active); } catch { setActiveProfile(null); }
    } catch (err) { setLiveError(`Live action failed: ${err.message}`); }
    finally { setLiveBusyKey(""); }
  }

  async function refreshAgentStatus(showSpinner = true) {
    if (showSpinner) setRlLoading(true);
    setRlError("");
    try { const status = await request("/agent/status", { method: "GET" }); setRlStatus(status); }
    catch (err) { setRlError(`Agent status failed: ${err.message}`); }
    finally { if (showSpinner) setRlLoading(false); }
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
      <Sidebar sidebarOpen={sidebarOpen} onToggleSidebar={() => setSidebarOpen(!sidebarOpen)} theme={theme} onToggleTheme={toggleTheme} />
      <main className="main-content">
        <Routes>
          <Route path="/" element={<Navigate to="/overview" replace />} />
          <Route path="/overview" element={
            <OverviewPage
              task={task} seed={seed} loading={loading} error={error}
              liveLoading={liveLoading} liveError={liveError} liveMessage={liveMessage}
              liveBusyKey={liveBusyKey} activeProfile={activeProfile}
              previewProfile={previewProfile} liveDashboard={liveDashboard}
              optimizationPressure={optimizationPressure} currentTaskName={currentTaskName}
              activeStep={activeStep} currentCost={currentCost} potentialSavings={potentialSavings}
              onSeedChange={setSeed} onTaskChange={handleTaskChange}
              onRefreshPreview={() => refreshPreview(true)}
              onStartEpisode={() => startEpisode(task, seed)}
              onRefreshLive={refreshLiveDashboard} onRunLiveAction={runLiveAction}
              onOpenUseCase={openUseCase}
            />
          } />
          <Route path="/use-cases/:taskName" element={
            <Suspense fallback={<p className="chart-empty">Loading use-case route...</p>}>
              <LazyUseCaseRoutePage
                task={task} onTaskChange={handleTaskChange} tasks={TASKS}
                taskMeta={TASK_META} seed={seed} loading={loading}
                previewProfile={previewProfile} activeProfile={activeProfile}
                liveDashboard={liveDashboard} onSeedChange={setSeed}
                onRefreshPreview={() => refreshPreview(true)}
                onStartEpisode={() => startEpisode(task, seed)}
                onRefreshLive={refreshLiveDashboard}
                StatCard={StatCard} ProfileCard={ProfileCard}
              />
            </Suspense>
          } />
          <Route path="/resources" element={
            <StubPage icon="resources" title="Resource Inventory" description="Full table of all cloud resources with type, cost, status, waste signals, and SLA badges. Coming in the next update." />
          } />
          <Route path="/waste" element={
            <StubPage icon="waste" title="Waste Detector" description="Prioritized waste signal detection with severity rankings and estimated savings per resource. Coming in the next update." />
          } />
          <Route path="/actions" element={
            <StubPage icon="actioncenter" title="Action Center" description="Agent-recommended optimization actions with risk assessment, apply/dismiss controls, and action history. Coming in the next update." />
          } />
          <Route path="/cost-analytics" element={
            <StubPage icon="analytics" title="Cost Analytics" description="Cost breakdown by resource type, savings timeline, and scenario comparisons across optimization tasks. Coming in the next update." />
          } />
          <Route path="/rl-status" element={
            <Suspense fallback={<p className="chart-empty">Loading RL status...</p>}>
              <LazyRLStatusPage rlStatus={rlStatus} rlLoading={rlLoading} rlError={rlError} onRefresh={refreshAgentStatus} />
            </Suspense>
          } />
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
