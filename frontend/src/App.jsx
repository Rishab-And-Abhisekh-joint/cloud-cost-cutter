import { Suspense, lazy, useEffect, useMemo, useState, useCallback } from "react";
import { BrowserRouter, Navigate, NavLink, Route, Routes, useNavigate, useLocation } from "react-router-dom";
import { AreaChart, Area, BarChart, Bar, Cell, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { MetricCard, SectionCard, RiskBadge, DataTable, FilterBar, StatusBadge, CountBadge, ConfirmModal } from "./components/shared";

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

function useThemeColors() {
  const isDark = typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "dark";
  return {
    grid: isDark ? "#252836" : "#e2e5e9",
    axis: isDark ? "#64748b" : "#94a3b8",
    tooltipBg: isDark ? "#171a24" : "#ffffff",
    tooltipBorder: isDark ? "#252836" : "#e2e5e9",
    text: isDark ? "#f1f5f9" : "#0f172a",
  };
}

function ChartTooltip({ active, payload, label, formatter }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "var(--tooltip-bg)", border: "1px solid var(--tooltip-border)", borderRadius: 8, padding: "8px 12px", boxShadow: "var(--shadow-hover)", fontSize: "0.8rem" }}>
      {label != null && <p style={{ margin: "0 0 4px", fontSize: "0.7rem", color: "var(--text-muted)" }}>{label}</p>}
      {payload.map((entry, i) => (
        <p key={i} style={{ margin: 0, color: entry.color || "var(--text-primary)", fontWeight: 600 }}>
          {entry.name}: {formatter ? formatter(entry.value) : entry.value}
        </p>
      ))}
    </div>
  );
}

function MiniSparkline({ data, color, width, height }) {
  const w = width || 60;
  const h = height || 22;
  if (!data || data.length < 2) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg width={w} height={h} className="mini-sparkline">
      <polyline points={points} fill="none" stroke={color || "var(--green-500)"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function WasteSeverityDonut({ wasteSignals }) {
  const ws = wasteSignals || {};
  const idle = Number(ws.idle_compute || 0);
  const orphaned = Number(ws.orphaned_volumes || 0);
  const overComp = Number(ws.overprovisioned_compute || 0);
  const overDb = Number(ws.overprovisioned_databases || 0);
  const unattached = Number(ws.unattached_ips || 0);
  const emptyLb = Number(ws.empty_load_balancers || 0);

  const critical = idle;
  const high = overComp + overDb;
  const medium = orphaned + unattached;
  const low = emptyLb;

  const segments = [
    { name: "Critical", value: critical, color: "#ef4444" },
    { name: "High", value: high, color: "#f59e0b" },
    { name: "Medium", value: medium, color: "#3b82f6" },
    { name: "Low", value: low, color: "#94a3b8" },
  ].filter((s) => s.value > 0);

  const total = segments.reduce((s, d) => s + d.value, 0);
  if (!total) {
    return (
      <div className="waste-donut-empty">
        <p className="text-muted">No waste signals detected</p>
      </div>
    );
  }

  const r = 42;
  const circ = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className="waste-donut-wrap">
      <div className="waste-donut-chart">
        <svg viewBox="0 0 100 100">
          <circle cx="50" cy="50" r={r} fill="none" stroke="var(--track-bg)" strokeWidth="10" />
          {segments.map((seg) => {
            const pct = seg.value / total;
            const dash = pct * circ;
            const gap = circ - dash;
            const rotate = (offset / total) * 360 - 90;
            offset += seg.value;
            return (
              <circle key={seg.name} cx="50" cy="50" r={r} fill="none" stroke={seg.color} strokeWidth="10" strokeDasharray={`${dash} ${gap}`} strokeLinecap="butt" transform={`rotate(${rotate} 50 50)`} />
            );
          })}
        </svg>
        <div className="waste-donut-center">
          <strong>{total}</strong>
          <span>signals</span>
        </div>
      </div>
      <div className="waste-donut-legend">
        {segments.map((seg) => (
          <div className="waste-legend-row" key={seg.name}>
            <span className="legend-dot" style={{ background: seg.color }} />
            <span className="waste-legend-label">{seg.name}</span>
            <strong>{seg.value}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function buildSpendByTypeSteps(profile, liveDashboard) {
  const resources = profile?.resources || {};
  const cost = profile?.cost || {};
  const currentSpend = Number(cost.current_monthly_spend || 0);
  const totalRes = Number(resources.core_total || 1);
  const compute = Number(resources.compute || 0);
  const volumes = Number(resources.volumes || 0);
  const databases = Number(resources.databases || 0);
  const network = Number(resources.load_balancers || 0) + Number(resources.elastic_ips || 0);
  const snapshots = Number(resources.snapshots || 0);

  const computeShare = totalRes > 0 ? (compute / totalRes) * currentSpend * 0.55 : 0;
  const dbShare = totalRes > 0 ? (databases / totalRes) * currentSpend * 1.2 : 0;
  const volShare = totalRes > 0 ? (volumes / totalRes) * currentSpend * 0.6 : 0;
  const netShare = totalRes > 0 ? (network / totalRes) * currentSpend * 0.8 : 0;
  const snapShare = totalRes > 0 ? (snapshots / totalRes) * currentSpend * 0.3 : 0;

  const history = liveDashboard?.action_history || [];
  const steps = [];
  let cumSavings = 0;

  steps.push({
    step: "Init",
    Compute: Math.round(computeShare),
    Databases: Math.round(dbShare),
    Storage: Math.round(volShare),
    Network: Math.round(netShare),
    Snapshots: Math.round(snapShare),
  });

  if (history.length > 0) {
    history.forEach((h, i) => {
      const saving = h.ok ? Number(h.estimated_monthly_savings_usd || 0) : 0;
      cumSavings += saving;
      const factor = Math.max(0, 1 - cumSavings / Math.max(1, currentSpend));
      steps.push({
        step: `Step ${i + 1}`,
        Compute: Math.round(computeShare * factor),
        Databases: Math.round(dbShare * factor),
        Storage: Math.round(volShare * factor),
        Network: Math.round(netShare * factor),
        Snapshots: Math.round(snapShare * factor),
      });
    });
  } else {
    for (let i = 1; i <= 3; i++) {
      const factor = 1 - (i * 0.03);
      steps.push({
        step: `Step ${i}`,
        Compute: Math.round(computeShare * factor),
        Databases: Math.round(dbShare * factor),
        Storage: Math.round(volShare * factor),
        Network: Math.round(netShare * factor),
        Snapshots: Math.round(snapShare * factor),
      });
    }
  }
  return steps;
}

function OverviewPage({
  task, seed, loading, error, liveLoading, liveError, liveMessage, liveBusyKey,
  activeProfile, previewProfile, liveDashboard, optimizationPressure,
  currentTaskName, activeStep, currentCost, potentialSavings,
  onSeedChange, onTaskChange, onRefreshPreview, onStartEpisode,
  onRefreshLive, onRunLiveAction, onOpenUseCase,
}) {
  const chosenProfile = activeProfile || previewProfile;
  const colors = useThemeColors();

  const wasteSignals = chosenProfile?.waste_signals || {};
  const wasteTotal = sumValues(wasteSignals);
  const resourceTotal = Number(chosenProfile?.resources?.core_total || 0);
  const wasteScore = resourceTotal > 0 ? Math.min(100, (wasteTotal / resourceTotal) * 100) : 0;

  const actionsCount = liveDashboard?.action_history?.length || 0;
  const successActions = (liveDashboard?.action_history || []).filter((a) => a.ok && !a.dry_run).length;
  const savingsAchieved = (liveDashboard?.action_history || [])
    .filter((a) => a.ok && !a.dry_run)
    .reduce((sum, a) => sum + Number(a.estimated_monthly_savings_usd || 0), 0);

  const spendData = useMemo(
    () => buildSpendByTypeSteps(chosenProfile, liveDashboard),
    [chosenProfile, liveDashboard]
  );

  const topRecs = useMemo(() => {
    return (liveDashboard?.recommendations || [])
      .slice()
      .sort((a, b) => Number(b.estimated_monthly_savings_usd || 0) - Number(a.estimated_monthly_savings_usd || 0))
      .slice(0, 5);
  }, [liveDashboard?.recommendations]);

  const targetSpend = Number(chosenProfile?.cost?.target_monthly_spend || 0);
  const savingsProgress = currentCost > 0 && targetSpend > 0
    ? Math.min(100, (savingsAchieved / Math.max(1, currentCost - targetSpend)) * 100)
    : 0;

  const spendSparkline = useMemo(() => {
    if (!spendData.length) return [];
    return spendData.map((d) => (d.Compute || 0) + (d.Databases || 0) + (d.Storage || 0) + (d.Network || 0) + (d.Snapshots || 0));
  }, [spendData]);

  const savingsSparkline = useMemo(() => {
    const hist = liveDashboard?.action_history || [];
    if (!hist.length) return [0, potentialSavings * 0.3, potentialSavings * 0.6, potentialSavings];
    let cum = 0;
    return [0, ...hist.map((h) => { cum += h.ok ? Number(h.estimated_monthly_savings_usd || 0) : 0; return cum; })];
  }, [liveDashboard?.action_history, potentialSavings]);

  const wasteSparkline = useMemo(() => {
    return [wasteScore * 1.1, wasteScore * 1.05, wasteScore, wasteScore * 0.97];
  }, [wasteScore]);

  const pressureSparkline = useMemo(() => {
    return [optimizationPressure * 0.85, optimizationPressure * 0.9, optimizationPressure * 0.95, optimizationPressure];
  }, [optimizationPressure]);

  const rankedWasteSignals = useMemo(() => {
    const ws = chosenProfile?.waste_signals || {};
    return [
      { name: "Idle Compute", value: Number(ws.idle_compute || 0), severity: "critical" },
      { name: "Overprovisioned Compute", value: Number(ws.overprovisioned_compute || 0), severity: "high" },
      { name: "Overprovisioned DBs", value: Number(ws.overprovisioned_databases || 0), severity: "high" },
      { name: "Orphaned Volumes", value: Number(ws.orphaned_volumes || 0), severity: "medium" },
      { name: "Unattached IPs", value: Number(ws.unattached_ips || 0), severity: "medium" },
      { name: "Empty Load Balancers", value: Number(ws.empty_load_balancers || 0), severity: "low" },
    ].filter((s) => s.value > 0).sort((a, b) => b.value - a.value);
  }, [chosenProfile?.waste_signals]);

  return (
    <>
      <div className="page-header">
        <div>
          <h2 className="page-title">Overview</h2>
          <p className="page-subtitle">{toTitleCase(currentTaskName)} · Seed {activeProfile?.seed || seed} · Step {activeStep}</p>
        </div>
        <div className="page-header-actions">
          <div className="ov-controls">
            <select className="ov-select" value={task} onChange={(e) => onTaskChange(e.target.value)}>
              {TASKS.map((t) => <option key={t} value={t}>{toTitleCase(t)}</option>)}
            </select>
            <input className="ov-input" value={seed} onChange={(e) => onSeedChange(e.target.value)} placeholder="Seed" style={{ width: 70 }} />
          </div>
          <button type="button" onClick={onRefreshPreview} disabled={loading}>Refresh</button>
          <button type="button" className="solid" onClick={onStartEpisode} disabled={loading}>Start Episode</button>
        </div>
      </div>

      {error && <p className="error-text">{error}</p>}

      <section className="ov-kpi-row">
        <MetricCard
          icon={<IconSvg name="spend" />}
          iconVariant="blue"
          label="Monthly Spend"
          value={fmtMoney(currentCost)}
          delta={targetSpend > 0 ? fmtPercent(((currentCost - targetSpend) / targetSpend) * 100) : null}
          deltaDirection={currentCost > targetSpend ? "up" : "down"}
          helper={`Target ${fmtMoney(targetSpend)}`}
        >
          <MiniSparkline data={spendSparkline} color="#3b82f6" />
        </MetricCard>
        <MetricCard
          icon={<IconSvg name="savings" />}
          iconVariant="green"
          label="Potential Savings"
          value={fmtMoney(potentialSavings)}
          delta={currentCost > 0 ? fmtPercent((potentialSavings / currentCost) * 100) : null}
          deltaDirection="down"
          helper="max estimated reduction"
        >
          <MiniSparkline data={savingsSparkline} color="#22c55e" />
        </MetricCard>
        <MetricCard
          icon={<IconSvg name="waste" />}
          iconVariant="red"
          label="Waste Score"
          value={fmtPercent(wasteScore)}
          delta={`${wasteTotal} signals`}
          deltaDirection={wasteScore > 20 ? "up" : "down"}
          helper={`across ${resourceTotal} resources`}
        >
          <MiniSparkline data={wasteSparkline} color="#ef4444" />
        </MetricCard>
        <MetricCard
          icon={<IconSvg name="actions" />}
          iconVariant="amber"
          label="Actions Applied"
          value={String(successActions)}
          delta={actionsCount > 0 ? `${actionsCount} total` : null}
          helper={savingsAchieved > 0 ? `${fmtMoney(savingsAchieved)} saved` : "no savings yet"}
        >
          <MiniSparkline data={[0, successActions * 0.3, successActions * 0.7, successActions]} color="#f59e0b" />
        </MetricCard>
        <MetricCard
          icon={<IconSvg name="pressure" />}
          label="Optimization Pressure"
          value={fmtPercent(optimizationPressure)}
          delta={`step ${activeStep}`}
          deltaDirection={optimizationPressure > 15 ? "up" : "down"}
          helper={optimizationPressure > 30 ? "high pressure" : "manageable"}
        >
          <MiniSparkline data={pressureSparkline} color="#22c55e" />
        </MetricCard>
      </section>

      <section className="ov-mid-grid">
        <SectionCard title="Cost by Resource Type" badge={spendData.length > 1 ? `${spendData.length} steps` : null}>
          {currentCost > 0 ? (
            <div style={{ width: "100%", height: 260 }}>
              <ResponsiveContainer>
                <AreaChart data={spendData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} />
                  <XAxis dataKey="step" stroke={colors.axis} tick={{ fill: colors.axis, fontSize: 11 }} />
                  <YAxis stroke={colors.axis} tick={{ fill: colors.axis, fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip content={<ChartTooltip formatter={(v) => fmtMoney(v)} />} />
                  <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                  <Area type="monotone" dataKey="Compute" stackId="1" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.7} />
                  <Area type="monotone" dataKey="Databases" stackId="1" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.7} />
                  <Area type="monotone" dataKey="Storage" stackId="1" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.7} />
                  <Area type="monotone" dataKey="Network" stackId="1" stroke="#06b6d4" fill="#06b6d4" fillOpacity={0.7} />
                  <Area type="monotone" dataKey="Snapshots" stackId="1" stroke="#94a3b8" fill="#94a3b8" fillOpacity={0.5} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="empty-text">Cost data appears after loading a scenario.</p>
          )}
        </SectionCard>

        <SectionCard title="Waste Severity" badge={wasteTotal > 0 ? `${wasteTotal} total` : null}>
          <WasteSeverityDonut wasteSignals={chosenProfile?.waste_signals} />
          {rankedWasteSignals.length > 0 && (
            <div className="waste-ranked-list">
              {rankedWasteSignals.map((s) => (
                <div className="waste-ranked-row" key={s.name}>
                  <span className={`waste-severity-dot waste-sev-${s.severity}`} />
                  <span className="waste-ranked-name">{s.name}</span>
                  <strong className="waste-ranked-count">{s.value}</strong>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </section>

      <section className="ov-bottom-grid">
        <SectionCard title="Top Recommendations" badge={topRecs.length > 0 ? `${topRecs.length} actions` : null} noPadding>
          {topRecs.length > 0 ? (
            <table className="dt-table ov-rec-table">
              <thead>
                <tr className="dt-head-row">
                  <th className="dt-th">Resource</th>
                  <th className="dt-th">Action</th>
                  <th className="dt-th dt-right">Est. Savings</th>
                  <th className="dt-th" style={{ width: 60 }}>Risk</th>
                  <th className="dt-th" style={{ width: 120 }}></th>
                </tr>
              </thead>
              <tbody>
                {topRecs.map((rec) => {
                  const applyKey = `${rec.action_type}:${rec.resource_id}:apply`;
                  const dryKey = `${rec.action_type}:${rec.resource_id}:dry`;
                  return (
                    <tr className="dt-row" key={`${rec.action_type}:${rec.resource_id}`}>
                      <td className="dt-td">
                        <span className="ov-rec-name">{rec.resource_name}</span>
                        <span className="ov-rec-type">{signalLabel(rec.action_type)}</span>
                      </td>
                      <td className="dt-td">{recLabel(rec.action_type)}</td>
                      <td className="dt-td dt-right ov-rec-savings">{fmtMoney(rec.estimated_monthly_savings_usd)}</td>
                      <td className="dt-td"><RiskBadge risk={rec.risk} /></td>
                      <td className="dt-td">
                        <div className="ov-rec-btns">
                          <button
                            type="button"
                            className="ov-btn-sm"
                            disabled={liveBusyKey !== ""}
                            onClick={() => onRunLiveAction(rec.action_type, rec.resource_id, false)}
                          >
                            {liveBusyKey === dryKey ? "..." : "Dry"}
                          </button>
                          <button
                            type="button"
                            className="ov-btn-sm solid"
                            disabled={liveBusyKey !== "" || !liveDashboard?.can_apply_actions}
                            onClick={() => onRunLiveAction(rec.action_type, rec.resource_id, true)}
                          >
                            {liveBusyKey === applyKey ? "..." : "Apply"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div style={{ padding: 20 }}>
              <p className="empty-text">No recommendations yet. Start an episode to generate optimization suggestions.</p>
            </div>
          )}
          {liveError && <p className="error-text" style={{ padding: "0 16px 12px" }}>{liveError}</p>}
          {liveMessage && <p className="live-message" style={{ padding: "0 16px 12px" }}>{liveMessage}</p>}
        </SectionCard>

        <SectionCard title="Optimization Progress">
          <div className="ov-progress-wrap">
            <div className="ov-progress-ring">
              <svg viewBox="0 0 120 120">
                <circle cx="60" cy="60" r="50" fill="none" stroke="var(--ring-track)" strokeWidth="8" />
                <circle cx="60" cy="60" r="50" fill="none" stroke="#22c55e" strokeWidth="8"
                  strokeDasharray={`${optimizationPressure * 3.14} 314`}
                  strokeLinecap="round" transform="rotate(-90 60 60)" className="progress-ring-circle" />
              </svg>
              <div className="ov-ring-label">
                <strong>{fmtPercent(optimizationPressure)}</strong>
                <span>pressure</span>
              </div>
            </div>
            <div className="ov-progress-stats">
              <div className="ov-stat-row">
                <span className="ov-stat-label">Savings Achieved</span>
                <strong className="ov-stat-value green">{fmtMoney(savingsAchieved)}</strong>
              </div>
              <div className="ov-stat-row">
                <span className="ov-stat-label">Target Gap</span>
                <strong className="ov-stat-value">{fmtMoney(Math.max(0, currentCost - targetSpend))}</strong>
              </div>
              <div className="ov-stat-row">
                <span className="ov-stat-label">Progress to Target</span>
                <div className="ov-progress-bar-wrap">
                  <div className="ov-progress-bar">
                    <div className="ov-progress-fill" style={{ width: `${savingsProgress}%` }} />
                  </div>
                  <span className="ov-progress-pct">{fmtPercent(savingsProgress)}</span>
                </div>
              </div>
              <div className="ov-stat-row">
                <span className="ov-stat-label">Actions Applied</span>
                <strong className="ov-stat-value">{successActions} of {actionsCount}</strong>
              </div>
            </div>
          </div>
        </SectionCard>
      </section>

      <section className="ov-scenarios">
        <SectionCard title="Quick Scenarios" noPadding>
          <div className="ov-scenario-grid">
            {TASKS.map((t) => (
              <button key={t} className={`ov-scenario-card ${t === task ? "ov-scenario-active" : ""}`} onClick={() => onOpenUseCase(t)}>
                <div className="ov-scenario-icon"><IconSvg name={t === "cleanup" ? "cleanup" : t === "rightsize" ? "rightsize" : "optimization"} /></div>
                <div className="ov-scenario-text">
                  <strong>{TASK_META[t].title}</strong>
                  <span>{TASK_META[t].description}</span>
                </div>
              </button>
            ))}
          </div>
        </SectionCard>
      </section>
    </>
  );
}

function deriveResourceStatus(r) {
  const status = String(r.status || "").toLowerCase();
  if (status === "stopped" || status === "idle") return "idle";
  if (status === "orphaned" || status === "unattached") return "orphaned";
  if (r.waste_signal >= 0.7) return "overprovisioned";
  if (status.startsWith("age:")) return "active";
  return "active";
}

function deriveStatusLevel(status) {
  if (status === "idle") return "warning";
  if (status === "orphaned") return "critical";
  if (status === "overprovisioned") return "high";
  return "success";
}

function resourceTypeLabel(type) {
  const map = { compute: "Compute", volume: "Volume", database: "Database", load_balancer: "Load Balancer", snapshot: "Snapshot", elastic_ip: "Elastic IP" };
  return map[type] || toTitleCase(type);
}

function deriveSLA(tags) {
  return tags?.env === "prod" ? "Prod" : tags?.env === "staging" ? "Staging" : "Dev";
}

function ResourceInventoryPage({ task, seed }) {
  const [resources, setResources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState({});
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({ task_name: task });
        if (seed != null && seed !== "") params.set("seed", seed);
        const data = await request(`/live/resources?${params}`);
        if (!cancelled) setResources(data || []);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [task, seed]);

  const rows = useMemo(() => {
    return resources.map((r) => {
      const status = deriveResourceStatus(r);
      const name = r.tags?.Name || r.tags?.name || r.resource_id.replace(/^(i|vol|snap|db|lb|eip)-full-/, `${resourceTypeLabel(r.resource_type)} `);
      return {
        resource_id: r.resource_id,
        name,
        type: r.resource_type,
        typeLabel: resourceTypeLabel(r.resource_type),
        monthly_cost: r.monthly_cost,
        status,
        statusLevel: deriveStatusLevel(status),
        waste_signal: r.waste_signal,
        wasteLevel: r.waste_signal >= 0.7 ? "high" : r.waste_signal >= 0.4 ? "medium" : "low",
        sla: deriveSLA(r.tags),
        risk: r.risk,
        tags: r.tags || {},
        rawStatus: r.status,
      };
    });
  }, [resources]);

  const filteredRows = useMemo(() => {
    let result = rows;
    if (filters.type) result = result.filter((r) => r.type === filters.type);
    if (filters.status) result = result.filter((r) => r.status === filters.status);
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((r) => r.resource_id.toLowerCase().includes(q) || r.name.toLowerCase().includes(q));
    }
    return result;
  }, [rows, filters, search]);

  const typeCounts = useMemo(() => {
    const counts = {};
    rows.forEach((r) => {
      counts[r.type] = (counts[r.type] || 0) + 1;
    });
    return counts;
  }, [rows]);

  const typeOptions = useMemo(() => {
    return Object.keys(typeCounts).map((t) => ({ value: t, label: `${resourceTypeLabel(t)} (${typeCounts[t]})` }));
  }, [typeCounts]);

  const statusOptions = [
    { value: "active", label: "Active" },
    { value: "idle", label: "Idle" },
    { value: "orphaned", label: "Orphaned" },
    { value: "overprovisioned", label: "Overprovisioned" },
  ];

  const filterDefs = [
    { key: "type", label: "Type", options: typeOptions, allLabel: "All Types" },
    { key: "status", label: "Status", options: statusOptions, allLabel: "All Statuses" },
  ];

  const columns = [
    { key: "resource_id", header: "Resource ID", width: "140px", render: (v) => <span className="ri-id">{v}</span> },
    { key: "name", header: "Name", width: "150px", render: (v) => <span className="ri-name">{v}</span> },
    { key: "typeLabel", header: "Type", width: "110px" },
    { key: "monthly_cost", header: "Monthly Cost", align: "right", width: "110px", render: (v) => <span className="ri-cost">{fmtMoney(v)}</span>, sortValue: (row) => row.monthly_cost },
    { key: "status", header: "Status", width: "120px", render: (_, row) => <StatusBadge level={row.statusLevel} label={toTitleCase(row.status)} /> },
    { key: "waste_signal", header: "Waste", width: "80px", align: "right", render: (v) => {
      const pct = Math.round(v * 100);
      return <span className={`ri-waste ${v >= 0.7 ? "ri-waste-high" : v >= 0.4 ? "ri-waste-med" : ""}`}>{pct}%</span>;
    }, sortValue: (row) => row.waste_signal },
    { key: "sla", header: "SLA", width: "70px", render: (v) => <span className={`ri-sla ri-sla-${v.toLowerCase()}`}>{v}</span> },
    { key: "risk", header: "Risk", width: "70px", render: (v) => <RiskBadge risk={v} /> },
  ];

  const expandedContent = (row) => (
    <div className="ri-detail">
      <div className="ri-detail-grid">
        <div><span className="ri-detail-label">Resource ID</span><span className="ri-detail-value">{row.resource_id}</span></div>
        <div><span className="ri-detail-label">Name</span><span className="ri-detail-value">{row.name}</span></div>
        <div><span className="ri-detail-label">Type</span><span className="ri-detail-value">{row.typeLabel}</span></div>
        <div><span className="ri-detail-label">Monthly Cost</span><span className="ri-detail-value">{fmtMoney(row.monthly_cost)}</span></div>
        <div><span className="ri-detail-label">Status</span><span className="ri-detail-value">{toTitleCase(row.rawStatus)}</span></div>
        <div><span className="ri-detail-label">Waste Signal</span><span className="ri-detail-value">{Math.round(row.waste_signal * 100)}%</span></div>
        <div><span className="ri-detail-label">Risk Level</span><span className="ri-detail-value">{toTitleCase(row.risk)}</span></div>
        <div><span className="ri-detail-label">SLA Tier</span><span className="ri-detail-value">{row.sla}</span></div>
        {Object.keys(row.tags).length > 0 && (
          <div className="ri-detail-tags">
            <span className="ri-detail-label">Tags</span>
            <div className="ri-tag-list">
              {Object.entries(row.tags).map(([k, v]) => (
                <span className="ri-tag" key={k}>{k}: {v}</span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  const totalCost = rows.reduce((sum, r) => sum + r.monthly_cost, 0);
  const filteredCost = filteredRows.reduce((sum, r) => sum + r.monthly_cost, 0);
  const hasFilters = filters.type || filters.status || search;

  return (
    <>
      <div className="page-header">
        <div>
          <h2 className="page-title">Resource Inventory</h2>
          <p className="page-subtitle">{hasFilters ? `${filteredRows.length} of ${rows.length} resources · ${fmtMoney(filteredCost)} of ${fmtMoney(totalCost)}` : `${rows.length} resources · ${fmtMoney(totalCost)} monthly spend`}</p>
        </div>
      </div>

      {error && <p className="error-text">{error}</p>}

      <div className="ri-summary-bar">
        {Object.entries(typeCounts).sort((a, b) => b[1] - a[1]).map(([type, count]) => (
          <button
            key={type}
            className={`ri-type-chip ${filters.type === type ? "ri-type-active" : ""}`}
            onClick={() => setFilters((f) => ({ ...f, type: f.type === type ? "" : type }))}
          >
            <span className="ri-type-label">{resourceTypeLabel(type)}</span>
            <CountBadge count={count} />
          </button>
        ))}
      </div>

      <SectionCard noPadding>
        <FilterBar
          filters={filterDefs}
          values={filters}
          onChange={(key, val) => setFilters((f) => ({ ...f, [key]: val }))}
          searchPlaceholder="Search by name or ID..."
          searchValue={search}
          onSearchChange={setSearch}
          onClearAll={() => { setFilters({}); setSearch(""); }}
        />
        {loading ? (
          <div className="ri-loading"><p>Loading resources...</p></div>
        ) : (
          <DataTable
            columns={columns}
            data={filteredRows}
            rowKeyField="resource_id"
            expandedContent={expandedContent}
            stickyHeader
            emptyMessage="No resources match the current filters."
          />
        )}
      </SectionCard>
    </>
  );
}

function severityFromSavings(savings) {
  if (savings >= 100) return "critical";
  if (savings >= 50) return "high";
  if (savings >= 20) return "medium";
  return "low";
}

function severityLevel(sev) {
  if (sev === "critical") return "critical";
  if (sev === "high") return "high";
  if (sev === "medium") return "warning";
  return "success";
}

function actionTypeIcon(type) {
  const map = {
    stop_instance: "⏹",
    terminate_instance: "🗑",
    release_eip: "🔓",
    delete_snapshot: "📸",
    delete_volume: "💾",
    delete_load_balancer: "⚖️",
    rightsize_instance: "📐",
  };
  return map[type] || "⚡";
}

function ActionCenterPage({ liveDashboard, liveLoading, liveError, liveMessage, liveBusyKey, onRefreshLive, onRunLiveAction }) {
  const [dismissed, setDismissed] = useState(new Set());
  const [confirmAction, setConfirmAction] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const recommendations = liveDashboard?.recommendations || [];
  const actionHistory = liveDashboard?.action_history || [];
  const canApply = liveDashboard?.can_apply_actions !== false;

  const wasteSignals = useMemo(() => {
    return [...recommendations]
      .sort((a, b) => b.estimated_monthly_savings_usd - a.estimated_monthly_savings_usd)
      .map((r) => ({
        ...r,
        severity: severityFromSavings(r.estimated_monthly_savings_usd),
      }));
  }, [recommendations]);

  const activeRecs = useMemo(() => {
    return recommendations.filter((r) => !dismissed.has(`${r.action_type}:${r.resource_id}`));
  }, [recommendations, dismissed]);

  const totalWaste = wasteSignals.reduce((s, w) => s + w.estimated_monthly_savings_usd, 0);
  const totalPending = activeRecs.length;
  const totalApplied = actionHistory.filter((a) => a.executed).length;
  const totalSavingsApplied = actionHistory.filter((a) => a.executed).reduce((s, a) => s + a.estimated_monthly_savings_usd, 0);

  function handleDismiss(rec) {
    setDismissed((prev) => new Set(prev).add(`${rec.action_type}:${rec.resource_id}`));
  }

  function handleApplyClick(rec) {
    setConfirmAction(rec);
  }

  function handleConfirmApply() {
    if (confirmAction) {
      onRunLiveAction(confirmAction.action_type, confirmAction.resource_id, true);
      setConfirmAction(null);
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h2 className="page-title">Waste Detector & Action Center</h2>
          <p className="page-subtitle">Identify waste and apply agent-recommended optimizations</p>
        </div>
        <button className="btn-outline btn-sm" onClick={() => onRefreshLive()} disabled={liveLoading}>
          {liveLoading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {liveError && <p className="error-text">{liveError}</p>}
      {liveMessage && <p className="success-text">{liveMessage}</p>}

      <div className="ac-summary-bar">
        <MetricCard label="Total Waste Detected" value={fmtMoney(totalWaste)} helper="potential monthly savings" />
        <MetricCard label="Actions Pending" value={totalPending} helper={`of ${recommendations.length} recommendations`} />
        <MetricCard label="Actions Applied" value={totalApplied} helper={fmtMoney(totalSavingsApplied) + " saved"} />
        <MetricCard label="Waste Signals" value={wasteSignals.length} helper="resources with savings" />
      </div>

      <div className="ac-panels">
        <SectionCard title="Waste Detector" className="ac-waste-panel">
          {liveLoading && wasteSignals.length === 0 ? (
            <div className="ri-loading"><p>Loading waste signals...</p></div>
          ) : wasteSignals.length === 0 ? (
            <div className="ac-empty">
              <p>No waste signals detected. Your resources look well-optimized.</p>
            </div>
          ) : (
            <div className="ac-waste-list">
              {wasteSignals.map((w, idx) => (
                <div key={`${w.action_type}-${w.resource_id}-${idx}`} className="ac-waste-item">
                  <div className="ac-waste-icon">{actionTypeIcon(w.action_type)}</div>
                  <div className="ac-waste-info">
                    <div className="ac-waste-resource">{w.resource_name || w.resource_id}</div>
                    <div className="ac-waste-reason">{w.reason}</div>
                  </div>
                  <StatusBadge level={severityLevel(w.severity)} label={toTitleCase(w.severity)} />
                  <div className="ac-waste-savings">{fmtMoney(w.estimated_monthly_savings_usd)}<span>/mo</span></div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Action Queue" className="ac-action-panel">
          {activeRecs.length === 0 ? (
            <div className="ac-empty">
              <p>{recommendations.length > 0 ? "All recommendations dismissed." : "No recommendations available."}</p>
            </div>
          ) : (
            <div className="ac-action-list">
              {activeRecs.map((rec, idx) => {
                const busyDry = liveBusyKey === `${rec.action_type}:${rec.resource_id}:dry`;
                const busyApply = liveBusyKey === `${rec.action_type}:${rec.resource_id}:apply`;
                return (
                  <div key={`${rec.action_type}-${rec.resource_id}-${idx}`} className="ac-action-card">
                    <div className="ac-action-header">
                      <span className="ac-action-type">{actionTypeIcon(rec.action_type)} {toTitleCase(rec.action_type)}</span>
                      <RiskBadge risk={rec.risk} />
                    </div>
                    <div className="ac-action-target">
                      <span className="ac-action-resource">{rec.resource_name || rec.resource_id}</span>
                      <span className="ac-action-id">{rec.resource_id}</span>
                    </div>
                    <div className="ac-action-reason">{rec.reason}</div>
                    <div className="ac-action-footer">
                      <span className="ac-action-savings">{fmtMoney(rec.estimated_monthly_savings_usd)}/mo savings</span>
                      <div className="ac-action-buttons">
                        <button className="btn-ghost btn-sm" onClick={() => handleDismiss(rec)} disabled={busyDry || busyApply}>Dismiss</button>
                        <button className="btn-outline btn-sm" onClick={() => onRunLiveAction(rec.action_type, rec.resource_id, false)} disabled={busyDry || busyApply}>
                          {busyDry ? "Running..." : "Dry Run"}
                        </button>
                        {canApply && (
                          <button className="btn-solid btn-sm" onClick={() => handleApplyClick(rec)} disabled={busyDry || busyApply}>
                            {busyApply ? "Applying..." : "Apply"}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </SectionCard>
      </div>

      <SectionCard noPadding>
        <button className="ac-history-toggle" onClick={() => setHistoryOpen(!historyOpen)}>
          <span>Action History ({actionHistory.length})</span>
          <span className="ac-chevron">{historyOpen ? "▲" : "▼"}</span>
        </button>
        {historyOpen && (
          actionHistory.length === 0 ? (
            <div className="ac-empty" style={{ padding: "16px" }}>
              <p>No actions have been performed yet.</p>
            </div>
          ) : (
            <div className="ac-history-list">
              {[...actionHistory].reverse().map((a, idx) => (
                <div key={idx} className={`ac-history-item ${a.ok ? (a.executed ? "ac-h-applied" : "ac-h-dry") : "ac-h-failed"}`}>
                  <div className="ac-h-status">
                    <StatusBadge
                      level={a.ok ? (a.executed ? "success" : "info") : "critical"}
                      label={a.ok ? (a.executed ? "Applied" : "Dry Run") : "Failed"}
                    />
                  </div>
                  <div className="ac-h-info">
                    <span className="ac-h-action">{toTitleCase(a.action_type)}</span>
                    <span className="ac-h-resource">{a.resource_id}</span>
                  </div>
                  <div className="ac-h-message">{a.message}</div>
                  <div className="ac-h-meta">
                    <span>{fmtMoney(a.estimated_monthly_savings_usd)}/mo</span>
                    <span className="ac-h-time">{new Date(a.timestamp).toLocaleString()}</span>
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </SectionCard>

      <ConfirmModal
        open={!!confirmAction}
        title={`Apply: ${confirmAction ? toTitleCase(confirmAction.action_type) : ""}`}
        message={confirmAction ? `This will ${toTitleCase(confirmAction.action_type).toLowerCase()} resource "${confirmAction.resource_name || confirmAction.resource_id}". Estimated savings: ${fmtMoney(confirmAction.estimated_monthly_savings_usd)}/mo.` : ""}
        confirmLabel="Apply Action"
        risk={confirmAction?.risk}
        onConfirm={handleConfirmApply}
        onCancel={() => setConfirmAction(null)}
      />
    </>
  );
}

const VALID_CA_TABS = ["breakdown", "trends", "scenarios"];

function CostAnalyticsPage({ task, seed, previewProfile, liveDashboard }) {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const queryTab = params.get("tab");
  const queryScenario = params.get("scenario");
  const initialTab = VALID_CA_TABS.includes(queryTab) ? queryTab : "breakdown";
  const [activeTab, setActiveTab] = useState(initialTab);

  useEffect(() => {
    if (queryTab && VALID_CA_TABS.includes(queryTab) && queryTab !== activeTab) setActiveTab(queryTab);
  }, [queryTab]);
  const [scenarios, setScenarios] = useState({});
  const [scenariosLoading, setScenariosLoading] = useState(false);

  const profile = previewProfile;

  useEffect(() => {
    if (activeTab === "scenarios") {
      loadScenarios();
    }
  }, [activeTab, seed]);

  async function loadScenarios() {
    setScenariosLoading(true);
    const results = {};
    for (const t of TASKS) {
      try {
        results[t] = await request(`/profile?task_name=${t}&seed=${seed}`);
      } catch { results[t] = null; }
    }
    setScenarios(results);
    setScenariosLoading(false);
  }

  const resourceData = useMemo(() => {
    const r = profile?.resources || {};
    const costPer = { Compute: 350, Volumes: 40, Databases: 250, "Load Balancers": 80, Snapshots: 5, "Elastic IPs": 4 };
    return [{
      name: "Cost Breakdown",
      Compute: (r.compute || 0) * costPer.Compute,
      Volumes: (r.volumes || 0) * costPer.Volumes,
      Databases: (r.databases || 0) * costPer.Databases,
      "Load Balancers": (r.load_balancers || 0) * costPer["Load Balancers"],
      Snapshots: (r.snapshots || 0) * costPer.Snapshots,
      "Elastic IPs": (r.elastic_ips || 0) * costPer["Elastic IPs"],
    }];
  }, [profile]);
  const resourceTypes = ["Compute", "Volumes", "Databases", "Load Balancers", "Snapshots", "Elastic IPs"];

  const wasteData = useMemo(() => {
    const w = profile?.waste_signals || {};
    return [
      { name: "Idle Compute", value: w.idle_compute || 0 },
      { name: "Orphaned Volumes", value: w.orphaned_volumes || 0 },
      { name: "Unattached IPs", value: w.unattached_ips || 0 },
      { name: "Empty LBs", value: w.empty_load_balancers || 0 },
      { name: "Overprov. Compute", value: w.overprovisioned_compute || 0 },
      { name: "Overprov. DB", value: w.overprovisioned_databases || 0 },
    ].filter((d) => d.value > 0);
  }, [profile]);

  const costGrouped = useMemo(() => {
    const c = profile?.cost || {};
    const cur = c.current_monthly_spend || 0;
    const tgt = c.target_monthly_spend || 0;
    const max = c.max_possible_savings_8_steps || 0;
    return [{ name: "Monthly Cost", current: cur, target: tgt, savings: max }];
  }, [profile]);

  const historyTrend = useMemo(() => {
    const history = liveDashboard?.action_history || [];
    let cum = 0;
    return history.slice(-12).map((a, i) => {
      const s = a.ok ? (a.estimated_monthly_savings_usd || 0) : 0;
      cum += s;
      return { step: `#${i + 1}`, savings: s, cumulative: Math.round(cum) };
    });
  }, [liveDashboard]);

  const tabs = [
    { key: "breakdown", label: "Breakdown" },
    { key: "trends", label: "Trends" },
    { key: "scenarios", label: "Scenarios" },
  ];

  const currentSpend = profile?.cost?.current_monthly_spend || 0;
  const targetSpend = profile?.cost?.target_monthly_spend || 0;
  const maxSavings = profile?.cost?.max_possible_savings_8_steps || 0;
  const velocityPct = currentSpend > 0 ? Math.min(100, Math.round((maxSavings / currentSpend) * 100)) : 0;

  return (
    <>
      <div className="page-header">
        <div>
          <h2 className="page-title">Cost Analytics</h2>
          <p className="page-subtitle">Cost breakdown, savings trends, and scenario comparisons</p>
        </div>
      </div>

      <div className="ca-tabs">
        {tabs.map((t) => (
          <button key={t.key} className={`ca-tab ${activeTab === t.key ? "ca-tab-active" : ""}`} onClick={() => setActiveTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === "breakdown" && (
        <div className="ca-content">
          <div className="ca-chart-grid">
            <SectionCard title="Estimated Cost by Resource Type">
              {profile?.resources ? (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={resourceData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="name" tick={{ fill: "var(--text-muted)", fontSize: 11 }} />
                    <YAxis tick={{ fill: "var(--text-muted)", fontSize: 11 }} tickFormatter={(v) => `$${Math.round(v / 1000)}k`} />
                    <Tooltip contentStyle={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 6, fontSize: "0.8rem" }} formatter={(v) => fmtMoney(v)} />
                    <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                    {resourceTypes.map((type, i) => (
                      <Bar key={type} dataKey={type} stackId="cost" fill={CHART_COLORS[i % CHART_COLORS.length]} radius={i === resourceTypes.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              ) : <p className="ca-empty">No resource data available. Load a profile first.</p>}
            </SectionCard>

            <SectionCard title="Waste by Category">
              {wasteData.length > 0 ? (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={wasteData} layout="vertical" margin={{ left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis type="number" tick={{ fill: "var(--text-muted)", fontSize: 11 }} />
                    <YAxis dataKey="name" type="category" width={120} tick={{ fill: "var(--text-muted)", fontSize: 11 }} />
                    <Tooltip contentStyle={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 6, fontSize: "0.8rem" }} />
                    <Bar dataKey="value" radius={[0, 4, 4, 0]} fill="#ef4444" />
                  </BarChart>
                </ResponsiveContainer>
              ) : <p className="ca-empty">No waste signals detected.</p>}
            </SectionCard>

            <SectionCard title="Current vs Target Spend" className="ca-full-width">
              {currentSpend > 0 ? (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={costGrouped} barCategoryGap="30%">
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="name" tick={{ fill: "var(--text-muted)", fontSize: 11 }} />
                    <YAxis tick={{ fill: "var(--text-muted)", fontSize: 11 }} tickFormatter={(v) => `$${Math.round(v / 1000)}k`} />
                    <Tooltip contentStyle={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 6, fontSize: "0.8rem" }} formatter={(v) => fmtMoney(v)} />
                    <Legend />
                    <Bar dataKey="current" name="Current Spend" fill="#ef4444" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="target" name="Target Spend" fill="#22c55e" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="savings" name="Max Savings" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : <p className="ca-empty">Cost data appears after loading a profile.</p>}
            </SectionCard>
          </div>
        </div>
      )}

      {activeTab === "trends" && (
        <div className="ca-content">
          <div className="ca-kpi-row">
            <MetricCard label="Current Spend" value={fmtMoney(currentSpend)} helper="monthly" />
            <MetricCard label="Target Spend" value={fmtMoney(targetSpend)} helper="25% reduction goal" />
            <MetricCard label="Max Savings" value={fmtMoney(maxSavings)} helper="in 8 steps" />
            <MetricCard label="Optimization Velocity" value={`${velocityPct}%`} helper="savings as % of spend" />
          </div>

          <div className="ca-chart-grid">
            <SectionCard title="Savings Over Time">
              {historyTrend.length > 0 ? (
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={historyTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="step" tick={{ fill: "var(--text-muted)", fontSize: 11 }} />
                    <YAxis tick={{ fill: "var(--text-muted)", fontSize: 11 }} />
                    <Tooltip contentStyle={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 6, fontSize: "0.8rem" }} formatter={(v) => fmtMoney(v)} />
                    <Legend />
                    <Line type="monotone" dataKey="savings" name="Step Savings" stroke="#f59e0b" strokeWidth={2.5} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="cumulative" name="Cumulative" stroke="#22c55e" strokeWidth={2.5} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              ) : <p className="ca-empty">No action history yet. Apply actions to see savings trends.</p>}
            </SectionCard>

            <SectionCard title="Cumulative Savings">
              {historyTrend.length > 0 ? (
                <ResponsiveContainer width="100%" height={280}>
                  <AreaChart data={historyTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="step" tick={{ fill: "var(--text-muted)", fontSize: 11 }} />
                    <YAxis tick={{ fill: "var(--text-muted)", fontSize: 11 }} />
                    <Tooltip contentStyle={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 6, fontSize: "0.8rem" }} formatter={(v) => fmtMoney(v)} />
                    <Area type="monotone" dataKey="cumulative" name="Cumulative" stroke="#22c55e" fill="#22c55e" fillOpacity={0.15} strokeWidth={2.5} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : <p className="ca-empty">No cumulative data yet.</p>}
            </SectionCard>

            <SectionCard title="Optimization Velocity" className="ca-full-width">
              <div className="ca-gauge">
                <div className="ca-gauge-bar">
                  <div className="ca-gauge-fill" style={{ width: `${velocityPct}%` }} />
                </div>
                <div className="ca-gauge-labels">
                  <span>0%</span>
                  <span className="ca-gauge-value">{velocityPct}% potential savings ratio</span>
                  <span>100%</span>
                </div>
              </div>
            </SectionCard>
          </div>
        </div>
      )}

      {activeTab === "scenarios" && (
        <div className="ca-content">
          {scenariosLoading ? (
            <div className="ri-loading"><p>Loading scenario comparisons...</p></div>
          ) : (
            <div className="ca-scenarios">
              {TASKS.map((t) => {
                const sp = scenarios[t];
                if (!sp) return (
                  <SectionCard key={t} title={TASK_META[t]?.title || toTitleCase(t)}>
                    <p className="ca-empty">Failed to load profile.</p>
                  </SectionCard>
                );
                const cur = sp.cost?.current_monthly_spend || 0;
                const tgt = sp.cost?.target_monthly_spend || 0;
                const max = sp.cost?.max_possible_savings_8_steps || 0;
                const ws = sp.waste_signals || {};
                const totalWaste = Object.values(ws).reduce((s, v) => s + v, 0);
                const barData = [{ name: "Cost", current: cur, target: tgt, savings: max }];
                return (
                  <SectionCard key={t} title={TASK_META[t]?.title || toTitleCase(t)} className={`ca-scenario-card ${queryScenario === t ? "ca-scenario-highlight" : ""}`}>
                    <p className="ca-scenario-desc">{TASK_META[t]?.description}</p>
                    <div className="ca-scenario-kpis">
                      <div className="ca-scenario-kpi">
                        <span className="ca-scenario-kpi-label">Current</span>
                        <span className="ca-scenario-kpi-value">{fmtMoney(cur)}</span>
                      </div>
                      <div className="ca-scenario-kpi">
                        <span className="ca-scenario-kpi-label">Target</span>
                        <span className="ca-scenario-kpi-value ca-green">{fmtMoney(tgt)}</span>
                      </div>
                      <div className="ca-scenario-kpi">
                        <span className="ca-scenario-kpi-label">Max Savings</span>
                        <span className="ca-scenario-kpi-value ca-blue">{fmtMoney(max)}</span>
                      </div>
                      <div className="ca-scenario-kpi">
                        <span className="ca-scenario-kpi-label">Waste Signals</span>
                        <span className="ca-scenario-kpi-value ca-red">{totalWaste}</span>
                      </div>
                    </div>
                    <ResponsiveContainer width="100%" height={160}>
                      <BarChart data={barData} barCategoryGap="20%">
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                        <XAxis dataKey="name" tick={{ fill: "var(--text-muted)", fontSize: 10 }} />
                        <YAxis tick={{ fill: "var(--text-muted)", fontSize: 10 }} tickFormatter={(v) => `$${Math.round(v / 1000)}k`} />
                        <Tooltip contentStyle={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 6, fontSize: "0.75rem" }} formatter={(v) => fmtMoney(v)} />
                        <Bar dataKey="current" name="Current" fill="#ef4444" radius={[3, 3, 0, 0]} />
                        <Bar dataKey="target" name="Target" fill="#22c55e" radius={[3, 3, 0, 0]} />
                        <Bar dataKey="savings" name="Max Savings" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </SectionCard>
                );
              })}
            </div>
          )}
        </div>
      )}
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

function routeLabel(pathname) {
  const path = String(pathname || "");
  if (path.startsWith("/overview")) return "Overview";
  if (path.startsWith("/resources")) return "Resource Inventory";
  if (path.startsWith("/actions") || path.startsWith("/waste")) return "Action Center";
  if (path.startsWith("/cost-analytics")) return "Cost Analytics";
  if (path.startsWith("/use-cases")) return "Scenario Lab";
  if (path.startsWith("/rl-status")) return "Agent + RL";
  return "Dashboard";
}

function CommandRail({ health, pageLabel, taskName, seed, mode, recommendationCount, appliedActions, potentialSavings, activeStep }) {
  const healthState = health === "online" ? "ok" : health === "offline" ? "down" : "checking";
  const healthLabel = health === "online" ? "API Online" : health === "offline" ? "API Offline" : "API Checking";
  return (
    <div className="command-rail" role="status" aria-live="polite">
      <div className="command-rail-main">
        <span className={`command-pill command-pill-${healthState}`}>
          <span className="command-dot" />
          {healthLabel}
        </span>
        <span className="command-pill command-pill-neutral">{pageLabel}</span>
        <span className="command-pill command-pill-soft">Scenario {toTitleCase(taskName)}</span>
        <span className="command-pill command-pill-soft">Seed {String(seed).trim() || "-"}</span>
      </div>
      <div className="command-rail-stats">
        <span className="command-stat"><strong>{recommendationCount}</strong> recs</span>
        <span className="command-stat"><strong>{appliedActions}</strong> applied</span>
        <span className="command-stat"><strong>{fmtMoney(potentialSavings)}</strong> potential</span>
        <span className="command-stat"><strong>{activeStep}</strong> step</span>
        <span className="command-stat command-stat-mode">Mode {toTitleCase(mode)}</span>
      </div>
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
        <button
          className="sidebar-toggle"
          onClick={onToggleSidebar}
          aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
          title={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {sidebarOpen ? <><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></> : <><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="18" x2="21" y2="18" /></>}
          </svg>
        </button>
      </div>

      <nav className="sidebar-nav" aria-label="Main navigation">
        <p className="sidebar-section-label">{sidebarOpen ? "ANALYTICS" : ""}</p>
        <NavLink to="/overview" title="Overview" className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}>
          <IconSvg name="overview" />
          {sidebarOpen && <span>Overview</span>}
        </NavLink>
        <NavLink to="/resources" title="Resource Inventory" className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}>
          <IconSvg name="resources" />
          {sidebarOpen && <span>Resources</span>}
        </NavLink>
        <NavLink to="/cost-analytics" title="Cost Analytics" className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}>
          <IconSvg name="analytics" />
          {sidebarOpen && <span>Cost Analytics</span>}
        </NavLink>

        <p className="sidebar-section-label">{sidebarOpen ? "OPERATIONS" : ""}</p>
        <NavLink to="/waste" title="Waste Detector" className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}>
          <IconSvg name="waste" />
          {sidebarOpen && <span>Waste Detector</span>}
        </NavLink>
        <NavLink to="/actions" title="Action Center" className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}>
          <IconSvg name="actioncenter" />
          {sidebarOpen && <span>Action Center</span>}
        </NavLink>

        <p className="sidebar-section-label">{sidebarOpen ? "SCENARIOS" : ""}</p>
        <NavLink to="/use-cases/cleanup" title="Cleanup" className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}>
          <IconSvg name="cleanup" />
          {sidebarOpen && <span>Cleanup</span>}
        </NavLink>
        <NavLink to="/use-cases/rightsize" title="Rightsize" className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}>
          <IconSvg name="rightsize" />
          {sidebarOpen && <span>Rightsize</span>}
        </NavLink>
        <NavLink to="/use-cases/full_optimization" title="Full Optimization" className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}>
          <IconSvg name="optimization" />
          {sidebarOpen && <span>Full Optimization</span>}
        </NavLink>

        <p className="sidebar-section-label">{sidebarOpen ? "SYSTEM" : ""}</p>
        <NavLink to="/rl-status" title="Agent and RL Status" className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}>
          <IconSvg name="agent" />
          {sidebarOpen && <span>Agent + RL</span>}
        </NavLink>
      </nav>

      <div className="sidebar-footer">
        <button
          className="theme-toggle-btn"
          onClick={onToggleTheme}
          aria-label="Toggle theme"
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          <IconSvg name={theme === "dark" ? "sun" : "moon"} />
          {sidebarOpen && <span>{theme === "dark" ? "Light Mode" : "Dark Mode"}</span>}
        </button>
      </div>
    </aside>
  );
}

function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();

  const [theme, setTheme] = useState(() => {
    try {
      const stored = localStorage.getItem("cc-theme");
      return stored === "dark" ? "dark" : "light";
    } catch { return "light"; }
  });
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window !== "undefined") {
      return window.innerWidth > 1024;
    }
    return true;
  });
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

  useEffect(() => {
    if (typeof window !== "undefined" && window.innerWidth <= 768) {
      setSidebarOpen(false);
    }
  }, [location.pathname]);

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
  const recommendationCount = liveDashboard?.recommendations?.length || 0;
  const appliedActions = (liveDashboard?.action_history || []).filter((item) => item.ok && item.executed).length;
  const runtimeMode = activeProfile?.mode || previewProfile?.mode || "preview";

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
        <CommandRail
          health={health}
          pageLabel={routeLabel(location.pathname)}
          taskName={currentTaskName}
          seed={seed}
          mode={runtimeMode}
          recommendationCount={recommendationCount}
          appliedActions={appliedActions}
          potentialSavings={potentialSavings}
          activeStep={activeStep}
        />
        <div className="route-canvas">
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
            <ResourceInventoryPage task={task} seed={seed} />
          } />
          <Route path="/waste" element={<Navigate to="/actions" replace />} />
          <Route path="/actions" element={
            <ActionCenterPage
              liveDashboard={liveDashboard} liveLoading={liveLoading} liveError={liveError}
              liveMessage={liveMessage} liveBusyKey={liveBusyKey}
              onRefreshLive={refreshLiveDashboard} onRunLiveAction={runLiveAction}
            />
          } />
          <Route path="/cost-analytics" element={
            <CostAnalyticsPage task={task} seed={seed} previewProfile={previewProfile} liveDashboard={liveDashboard} />
          } />
          <Route path="/rl-status" element={
            <Suspense fallback={<p className="chart-empty">Loading RL status...</p>}>
              <LazyRLStatusPage rlStatus={rlStatus} rlLoading={rlLoading} rlError={rlError} onRefresh={refreshAgentStatus} />
            </Suspense>
          } />
          <Route path="*" element={<Navigate to="/overview" replace />} />
          </Routes>
        </div>
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
