import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { BrowserRouter, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const TASKS = ["cleanup", "rightsize", "full_optimization"];
const DEFAULT_PROD_API_BASE_URL = "https://cloud-cost-env-api-production.up.railway.app";
const REQUEST_TIMEOUT_MS = Number(import.meta.env.VITE_REQUEST_TIMEOUT_MS || 15000);
const REQUEST_RETRIES = Number(import.meta.env.VITE_REQUEST_RETRIES || 2);
const THEME_STORAGE_KEY = "cc-theme";
const LazyUseCaseRoutePage = lazy(() => import("./routes/UseCaseRoutePage"));
const LazyRLStatusPage = lazy(() => import("./routes/RLStatusPage"));

const TASK_META = {
  cleanup: {
    title: "Cleanup",
    description: "Removes idle and orphaned assets to recover quick savings.",
  },
  rightsize: {
    title: "Rightsize",
    description: "Tunes compute and database capacity to reduce excess spend.",
  },
  full_optimization: {
    title: "Full Optimization",
    description: "Combines cleanup and rightsize decisions into a complete savings path.",
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

function sanitizeText(value) {
  if (value === null || value === undefined) {
    return "-";
  }
  const text = String(value).trim();
  return text ? text : "-";
}

function riskBadgeClass(risk) {
  const normalized = String(risk || "").toLowerCase();
  if (normalized === "high") {
    return "badge-high";
  }
  if (normalized === "medium") {
    return "badge-warning";
  }
  if (normalized === "low") {
    return "badge-success";
  }
  return "badge-neutral";
}

function actionBadgeClass(value) {
  const normalized = String(value || "").toLowerCase();
  if (normalized === "high") {
    return "badge-critical";
  }
  if (normalized === "medium") {
    return "badge-warning";
  }
  return "badge-success";
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

function buildResourceCostData(rows) {
  const totals = new Map();
  (rows || []).forEach((item) => {
    const key = sanitizeText(item.resource_type);
    const value = Number(item.monthly_cost || 0);
    totals.set(key, Number((totals.get(key) || 0) + value));
  });

  return Array.from(totals.entries())
    .map(([name, monthlyCost]) => ({ name: toTitleCase(name), monthlyCost: Number(monthlyCost.toFixed(2)) }))
    .sort((a, b) => b.monthlyCost - a.monthlyCost)
    .slice(0, 10);
}

function buildWasteCategoryData(wasteSignals) {
  const source = wasteSignals || {};
  return [
    { name: "Idle Compute", value: Number(source.idle_compute || 0) },
    { name: "Orphaned Volumes", value: Number(source.orphaned_volumes || 0) },
    { name: "Unattached IPs", value: Number(source.unattached_ips || 0) },
    { name: "Empty Load Balancers", value: Number(source.empty_load_balancers || 0) },
    { name: "Overprovisioned Compute", value: Number(source.overprovisioned_compute || 0) },
    { name: "Overprovisioned Databases", value: Number(source.overprovisioned_databases || 0) },
  ];
}

function buildSavingsTrend(actionHistory) {
  const recent = (actionHistory || []).slice(-12);
  let cumulative = 0;
  return recent.map((item, index) => {
    const savings = item?.ok ? Number(item.estimated_monthly_savings_usd || 0) : 0;
    cumulative += savings;
    return {
      step: `S${index + 1}`,
      savings: Number(savings.toFixed(2)),
      cumulative: Number(cumulative.toFixed(2)),
    };
  });
}

function sidebarIcon(name) {
  if (name === "overview") {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="M3 4h6v5H3V4zm8 0h6v8h-6V4zM3 11h6v5H3v-5zm8 3h6v2h-6v-2z" />
      </svg>
    );
  }
  if (name === "resources") {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="M10 2l7 3.5v9L10 18l-7-3.5v-9L10 2zm0 2.1L5 6.6l5 2.5 5-2.5L10 4.1zM5 8.6v4.8l4 2v-4.8l-4-2zm10 0l-4 2v4.8l4-2V8.6z" />
      </svg>
    );
  }
  if (name === "cost") {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="M3 15h2V9H3v6zm4 0h2V5H7v10zm4 0h2v-3h-2v3zm4 0h2V7h-2v8z" />
      </svg>
    );
  }
  if (name === "waste") {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="M6 4h8l1 2h2v2H3V6h2l1-2zm0 5h2v6H6V9zm4 0h2v6h-2V9zm4 0h2v6h-2V9z" />
      </svg>
    );
  }
  if (name === "actions") {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="M12.8 3a4 4 0 10.2 8l3.8 3.8 1.4-1.4-3.8-3.8A4 4 0 0012.8 3zM6 10l2 2-4 4H2v-2l4-4z" />
      </svg>
    );
  }
  if (name === "scenario") {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="M10 2l8 4v8l-8 4-8-4V6l8-4zm0 2.2L4 7v6l6 3 6-3V7l-6-2.8z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 2a8 8 0 110 16 8 8 0 010-16zm1 4H9v5h5V9h-3V6z" />
    </svg>
  );
}

function MetricCard({ label, value, helper }) {
  return (
    <article className="metric-card">
      <p className="metric-label">{label}</p>
      <p className="metric-value">{value}</p>
      <p className="metric-helper">{helper}</p>
    </article>
  );
}

function ResourceInventoryTable({ rows, loading, error }) {
  return (
    <article className="section-card" id="resources">
      <div className="section-header">
        <div className="section-title-wrap">
          <span className="section-icon">{sidebarIcon("resources")}</span>
          <h3>Resource Inventory</h3>
        </div>
      </div>

      {error ? <p className="error-text">{error}</p> : null}
      {loading ? <p className="empty-text">Loading resources...</p> : null}

      {!loading && !error ? (
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Monthly Cost</th>
                <th>Status</th>
                <th>Risk</th>
                <th>Waste Signal</th>
              </tr>
            </thead>
            <tbody>
              {rows.length ? (
                rows.map((row) => (
                  <tr key={row.resource_id}>
                    <td>{sanitizeText(row.resource_id)}</td>
                    <td>{toTitleCase(sanitizeText(row.resource_type))}</td>
                    <td>{fmtMoney(row.monthly_cost)}</td>
                    <td>{sanitizeText(row.status)}</td>
                    <td>
                      <span className={`badge ${riskBadgeClass(row.risk)}`}>{sanitizeText(row.risk)}</span>
                    </td>
                    <td>{fmtPercent(Number(row.waste_signal || 0) * 100)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="empty-cell">
                    No resources available yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : null}
    </article>
  );
}

function ActionCenter({
  wasteTotal,
  idleResources,
  orphanedResources,
  pendingActions,
  recommendations,
  liveBusyKey,
  canApplyActions,
  onRunLiveAction,
}) {
  return (
    <article className="section-card" id="action-center">
      <div className="section-header">
        <div className="section-title-wrap">
          <span className="section-icon">{sidebarIcon("actions")}</span>
          <h3>Action Center</h3>
        </div>
      </div>

      <div className="metric-grid compact-grid">
        <MetricCard label="Total Waste Detected" value={String(wasteTotal)} helper="Signals from active profile" />
        <MetricCard label="Idle Resources" value={String(idleResources)} helper="Idle compute + idle status" />
        <MetricCard label="Orphaned Resources" value={String(orphanedResources)} helper="Orphaned volumes and unattached IPs" />
        <MetricCard label="Pending Actions" value={String(pendingActions)} helper="Current recommendation queue" />
      </div>

      <div className="action-list">
        {recommendations.length ? (
          recommendations.map((rec) => {
            const dryKey = `${rec.action_type}:${rec.resource_id}:dry`;
            const applyKey = `${rec.action_type}:${rec.resource_id}:apply`;
            return (
              <div className="action-row" key={`${rec.action_type}:${rec.resource_id}`}>
                <div className="action-row-main">
                  <p className="action-title">{recLabel(rec.action_type)}</p>
                  <p className="action-subtext">
                    {sanitizeText(rec.resource_id)} · {sanitizeText(rec.resource_name)}
                  </p>
                  <p className="action-subtext">{sanitizeText(rec.reason)}</p>
                </div>

                <div className="action-row-meta">
                  <span className={`badge ${actionBadgeClass(rec.risk)}`}>{sanitizeText(rec.risk)}</span>
                  <span className="badge badge-info">{fmtMoney(rec.estimated_monthly_savings_usd)}</span>
                </div>

                <div className="action-row-buttons">
                  <button
                    type="button"
                    className="btn-outline btn-sm"
                    disabled={liveBusyKey !== ""}
                    onClick={() => onRunLiveAction(rec.action_type, rec.resource_id, false)}
                  >
                    {liveBusyKey === dryKey ? "Running..." : "Dry Run"}
                  </button>
                  <button
                    type="button"
                    className="btn-solid btn-sm"
                    disabled={liveBusyKey !== "" || !canApplyActions}
                    onClick={() => onRunLiveAction(rec.action_type, rec.resource_id, true)}
                  >
                    {liveBusyKey === applyKey ? "Applying..." : "Apply"}
                  </button>
                </div>
              </div>
            );
          })
        ) : (
          <p className="empty-text">No pending actions. Refresh live data to load recommendations.</p>
        )}
      </div>
    </article>
  );
}

function CostAnalytics({
  resourceRows,
  wasteSignals,
  currentSpend,
  targetSpend,
  maxSavings,
  actionHistory,
  optimizationVelocity,
  scenarioProfiles,
}) {
  const resourceCostData = useMemo(() => buildResourceCostData(resourceRows), [resourceRows]);
  const wasteCategoryData = useMemo(() => buildWasteCategoryData(wasteSignals), [wasteSignals]);
  const savingsData = useMemo(() => buildSavingsTrend(actionHistory), [actionHistory]);

  const envelopeData = [
    {
      name: "Spend",
      current: Number(currentSpend || 0),
      target: Number(targetSpend || 0),
      max: Number(maxSavings || 0),
    },
  ];

  return (
    <>
      <article className="section-card" id="cost-analytics">
        <div className="section-header">
          <div className="section-title-wrap">
            <span className="section-icon">{sidebarIcon("cost")}</span>
            <h3>Cost Analytics Breakdown</h3>
          </div>
        </div>

        <div className="chart-grid chart-grid-three">
          <div className="chart-card">
            <p className="chart-title">Resource Cost by Type</p>
            {resourceCostData.length ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={resourceCostData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="name" stroke="var(--text-muted)" />
                  <YAxis stroke="var(--text-muted)" />
                  <Tooltip formatter={(value) => fmtMoney(value)} />
                  <Bar dataKey="monthlyCost" stackId="resource" fill="var(--blue-500)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="chart-empty">No resource cost data.</p>
            )}
          </div>

          <div className="chart-card" id="waste-detector">
            <p className="chart-title">Waste Categories</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={wasteCategoryData} layout="vertical" margin={{ left: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis type="number" stroke="var(--text-muted)" />
                <YAxis dataKey="name" type="category" width={128} stroke="var(--text-muted)" />
                <Tooltip />
                <Bar dataKey="value" fill="var(--red-500)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="chart-card">
            <p className="chart-title">Current vs Target vs Max Savings</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={envelopeData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="name" stroke="var(--text-muted)" />
                <YAxis stroke="var(--text-muted)" />
                <Tooltip formatter={(value) => fmtMoney(value)} />
                <Legend />
                <Bar dataKey="current" fill="var(--blue-500)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="target" fill="var(--green-500)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="max" fill="var(--purple-500)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </article>

      <article className="section-card">
        <div className="section-header">
          <div className="section-title-wrap">
            <span className="section-icon">{sidebarIcon("overview")}</span>
            <h3>Cost Analytics Trends</h3>
          </div>
        </div>

        <div className="chart-grid chart-grid-two">
          <div className="chart-card">
            <p className="chart-title">Savings Over Time</p>
            {savingsData.length ? (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={savingsData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="step" stroke="var(--text-muted)" />
                  <YAxis stroke="var(--text-muted)" />
                  <Tooltip formatter={(value) => fmtMoney(value)} />
                  <Line type="monotone" dataKey="savings" stroke="var(--green-500)" strokeWidth={2.2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <p className="chart-empty">No savings history yet.</p>
            )}
          </div>

          <div className="chart-card">
            <p className="chart-title">Cumulative Savings</p>
            {savingsData.length ? (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={savingsData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="step" stroke="var(--text-muted)" />
                  <YAxis stroke="var(--text-muted)" />
                  <Tooltip formatter={(value) => fmtMoney(value)} />
                  <Area type="monotone" dataKey="cumulative" stroke="var(--cyan-500)" fill="rgba(6, 182, 212, 0.2)" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <p className="chart-empty">No cumulative savings yet.</p>
            )}
          </div>
        </div>

        <div className="velocity-card">
          <p className="chart-title">Optimization Velocity</p>
          <div className="velocity-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={optimizationVelocity}>
            <div className="velocity-fill" style={{ width: `${optimizationVelocity}%` }} />
          </div>
          <p className="velocity-value">{optimizationVelocity}%</p>
        </div>
      </article>

      <article className="section-card">
        <div className="section-header">
          <div className="section-title-wrap">
            <span className="section-icon">{sidebarIcon("scenario")}</span>
            <h3>Cost Analytics Scenarios</h3>
          </div>
        </div>

        <div className="scenario-grid">
          {TASKS.map((taskName) => {
            const profile = scenarioProfiles[taskName];
            const spend = Number(profile?.cost?.current_monthly_spend || 0);
            const target = Number(profile?.cost?.target_monthly_spend || 0);
            const savings = Number(profile?.cost?.max_possible_savings_8_steps || 0);

            return (
              <article className="scenario-card" key={taskName}>
                <p className="scenario-title">{TASK_META[taskName].title}</p>
                <div className="scenario-kpis">
                  <div>
                    <p className="metric-label">Current</p>
                    <p className="metric-value">{fmtMoney(spend)}</p>
                  </div>
                  <div>
                    <p className="metric-label">Target</p>
                    <p className="metric-value">{fmtMoney(target)}</p>
                  </div>
                  <div>
                    <p className="metric-label">Max Savings</p>
                    <p className="metric-value">{fmtMoney(savings)}</p>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </article>
    </>
  );
}

function OverviewPage({
  currentSpend,
  targetSpend,
  wasteScore,
  savingsAchieved,
  wasteSignals,
  resourceRows,
  resourcesLoading,
  resourcesError,
  recommendations,
  liveDashboard,
  liveBusyKey,
  liveError,
  liveMessage,
  actionHistory,
  scenarioProfiles,
  onRunLiveAction,
}) {
  const wasteTotal = sumValues(wasteSignals);
  const idleResources = Number(wasteSignals?.idle_compute || 0);
  const orphanedResources = Number(wasteSignals?.orphaned_volumes || 0) + Number(wasteSignals?.unattached_ips || 0);
  const pendingActions = recommendations.length;
  const optimizationVelocity = Math.max(
    0,
    Math.min(100, Math.round((savingsAchieved / Math.max(1, currentSpend || 1)) * 100))
  );

  return (
    <>
      <article className="section-card">
        <div className="section-header">
          <div className="section-title-wrap">
            <span className="section-icon">{sidebarIcon("overview")}</span>
            <h3 className="section-eyebrow">Analytics</h3>
          </div>
        </div>
        <h2 className="page-title">Overview</h2>

        <div className="metric-grid" id="overview-kpis">
          <MetricCard label="Monthly Spend" value={fmtMoney(currentSpend)} helper="cost.current_monthly_spend" />
          <MetricCard label="Target Spend" value={fmtMoney(targetSpend)} helper="cost.target_monthly_spend" />
          <MetricCard label="Waste Score" value={fmtPercent(wasteScore)} helper="(waste_total / resource_total) * 100" />
          <MetricCard label="Savings Achieved" value={fmtMoney(savingsAchieved)} helper="sum(action_history[ok=true])" />
        </div>

        {liveError ? <p className="error-text">{liveError}</p> : null}
        {liveMessage ? <p className="live-message">{liveMessage}</p> : null}
      </article>

      <ResourceInventoryTable rows={resourceRows} loading={resourcesLoading} error={resourcesError} />

      <ActionCenter
        wasteTotal={wasteTotal}
        idleResources={idleResources}
        orphanedResources={orphanedResources}
        pendingActions={pendingActions}
        recommendations={recommendations}
        liveBusyKey={liveBusyKey}
        canApplyActions={Boolean(liveDashboard?.can_apply_actions)}
        onRunLiveAction={onRunLiveAction}
      />

      <CostAnalytics
        resourceRows={resourceRows}
        wasteSignals={wasteSignals}
        currentSpend={currentSpend}
        targetSpend={targetSpend}
        maxSavings={Number(liveDashboard?.potential_monthly_savings_usd || 0)}
        actionHistory={actionHistory}
        optimizationVelocity={optimizationVelocity}
        scenarioProfiles={scenarioProfiles}
      />
    </>
  );
}

function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();

  const [seed, setSeed] = useState("777");
  const [task, setTask] = useState("full_optimization");
  const [health, setHealth] = useState("checking");
  const [activeProfile, setActiveProfile] = useState(null);
  const [previewProfile, setPreviewProfile] = useState(null);
  const [scenarioProfiles, setScenarioProfiles] = useState({});
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
  const [resourceRows, setResourceRows] = useState([]);
  const [resourcesLoading, setResourcesLoading] = useState(false);
  const [resourcesError, setResourcesError] = useState("");
  const [theme, setTheme] = useState(() => {
    if (typeof window === "undefined") {
      return "light";
    }
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    return saved === "dark" ? "dark" : "light";
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const apiHint = useMemo(() => API_BASE_URL.replace(/^https?:\/\//, ""), []);
  const baselineProfile = activeProfile || previewProfile;
  const currentSpend = Number(baselineProfile?.cost?.current_monthly_spend || 0);
  const targetSpend = Number(baselineProfile?.cost?.target_monthly_spend || 0);
  const wasteSignals = baselineProfile?.waste_signals || {};
  const resourceTotal = Math.max(
    1,
    Number(liveDashboard?.resource_counts?.compute_instances || 0) +
      Number(liveDashboard?.resource_counts?.storage_volumes || 0) +
      Number(liveDashboard?.resource_counts?.databases || 0) +
      Number(liveDashboard?.resource_counts?.load_balancers || 0) +
      Number(liveDashboard?.resource_counts?.snapshots || 0) +
      Number(liveDashboard?.resource_counts?.elastic_ips || 0)
  );
  const wasteScore = (sumValues(wasteSignals) / resourceTotal) * 100;
  const actionHistory = liveDashboard?.action_history || [];
  const savingsAchieved = actionHistory
    .filter((item) => item?.ok)
    .reduce((acc, item) => acc + Number(item?.estimated_monthly_savings_usd || 0), 0);
  const recommendations = liveDashboard?.recommendations || [];
  const lastUpdate = liveDashboard?.updated_at ? new Date(liveDashboard.updated_at).toLocaleTimeString() : "n/a";

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("data-theme", theme);
    }
    if (typeof window !== "undefined") {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    }
  }, [theme]);

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

      await Promise.all([
        refreshPreview(false, task, seed),
        refreshLiveDashboard(false, task, seed),
        refreshLiveResources(false, task, seed),
        refreshScenarioProfiles(task, seed),
        refreshAgentStatus(false),
      ]);
    }

    bootstrap();
  }, []);

  useEffect(() => {
    refreshPreview(false, task, seed);
    refreshLiveDashboard(false, task, seed);
    refreshLiveResources(false, task, seed);
    refreshScenarioProfiles(task, seed);

    const timer = setInterval(() => {
      refreshLiveDashboard(false, task, seed);
      refreshLiveResources(false, task, seed);
    }, 15000);

    return () => clearInterval(timer);
  }, [task, seed]);

  useEffect(() => {
    const timer = setInterval(() => {
      refreshAgentStatus(false);
    }, 30000);

    return () => clearInterval(timer);
  }, []);

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

  async function refreshLiveDashboard(showSpinner = true, taskName = task, seedValue = seed) {
    if (showSpinner) {
      setLiveLoading(true);
    }
    setLiveError("");

    try {
      const dashboard = await request(`/live/dashboard?task_name=${taskName}&seed=${seedValue}`, { method: "GET" });
      setLiveDashboard(dashboard);
    } catch (err) {
      setLiveError(`Live dashboard failed: ${err.message}`);
    } finally {
      if (showSpinner) {
        setLiveLoading(false);
      }
    }
  }

  async function refreshLiveResources(showSpinner = true, taskName = task, seedValue = seed) {
    if (showSpinner) {
      setResourcesLoading(true);
    }
    setResourcesError("");

    try {
      const rows = await request(`/live/resources?task_name=${taskName}&seed=${seedValue}`, { method: "GET" });
      setResourceRows(Array.isArray(rows) ? rows : []);
    } catch (err) {
      setResourcesError(`Resource inventory failed: ${err.message}`);
      setResourceRows([]);
    } finally {
      if (showSpinner) {
        setResourcesLoading(false);
      }
    }
  }

  async function refreshScenarioProfiles(taskName = task, seedValue = seed) {
    const entries = await Promise.all(
      TASKS.map(async (taskKey) => {
        try {
          const profile = await request(`/profile?task_name=${taskKey}&seed=${seedValue}`, { method: "GET" });
          return [taskKey, profile];
        } catch {
          return [taskKey, null];
        }
      })
    );
    setScenarioProfiles(Object.fromEntries(entries));
  }

  async function startEpisode(taskName = task, seedValue = seed) {
    setError("");
    setLoading(true);

    try {
      await request(`/reset/${taskName}?seed=${seedValue}`, { method: "POST" });
      const active = await request("/profile", { method: "GET" });
      setActiveProfile(active);
      await Promise.all([
        refreshPreview(false, taskName, seedValue),
        refreshLiveDashboard(false, taskName, seedValue),
        refreshLiveResources(false, taskName, seedValue),
        refreshScenarioProfiles(taskName, seedValue),
      ]);
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
      await Promise.all([refreshLiveDashboard(false), refreshLiveResources(false)]);

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

  function openOverviewAnchor(anchorId) {
    navigate("/overview");
    window.setTimeout(() => {
      const element = document.getElementById(anchorId);
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 50);
  }

  function toggleTheme() {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  }

  return (
    <main className={`workspace-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <aside className="sidebar">
        <div className="sidebar-brand">
          <button type="button" className="brand-toggle btn-ghost btn-sm" onClick={() => setSidebarCollapsed((prev) => !prev)}>
            {sidebarCollapsed ? "Expand" : "Collapse"}
          </button>
          <div className="brand-mark">CC</div>
          <div className="brand-copy">
            <p className="brand-name">CloudCost</p>
            <p className="brand-subtitle">Optimization Console</p>
          </div>
        </div>

        <div className="sidebar-group">
          <p className="sidebar-group-title">Analytics</p>
          <NavLink to="/overview" className={({ isActive }) => `side-link ${isActive ? "active" : ""}`}>
            <span className="side-link-icon">{sidebarIcon("overview")}</span>
            <span className="side-link-label">Overview</span>
          </NavLink>
          <button type="button" className="side-link side-link-button" onClick={() => openOverviewAnchor("resources")}> 
            <span className="side-link-icon">{sidebarIcon("resources")}</span>
            <span className="side-link-label">Resources</span>
          </button>
          <button type="button" className="side-link side-link-button" onClick={() => openOverviewAnchor("cost-analytics")}>
            <span className="side-link-icon">{sidebarIcon("cost")}</span>
            <span className="side-link-label">Cost Analytics</span>
          </button>
        </div>

        <div className="sidebar-group">
          <p className="sidebar-group-title">Operations</p>
          <button type="button" className="side-link side-link-button" onClick={() => openOverviewAnchor("waste-detector")}> 
            <span className="side-link-icon">{sidebarIcon("waste")}</span>
            <span className="side-link-label">Waste Detector</span>
          </button>
          <button type="button" className="side-link side-link-button" onClick={() => openOverviewAnchor("action-center")}> 
            <span className="side-link-icon">{sidebarIcon("actions")}</span>
            <span className="side-link-label">Action Center</span>
          </button>
        </div>

        <div className="sidebar-group">
          <p className="sidebar-group-title">Scenarios</p>
          <NavLink to="/use-cases/cleanup" className={({ isActive }) => `side-link ${isActive ? "active" : ""}`}>
            <span className="side-link-icon">{sidebarIcon("scenario")}</span>
            <span className="side-link-label">Cleanup</span>
          </NavLink>
          <NavLink to="/use-cases/rightsize" className={({ isActive }) => `side-link ${isActive ? "active" : ""}`}>
            <span className="side-link-icon">{sidebarIcon("scenario")}</span>
            <span className="side-link-label">Rightsize</span>
          </NavLink>
          <NavLink to="/use-cases/full_optimization" className={({ isActive }) => `side-link ${isActive ? "active" : ""}`}>
            <span className="side-link-icon">{sidebarIcon("scenario")}</span>
            <span className="side-link-label">Full Optimization</span>
          </NavLink>
        </div>

        <div className="sidebar-group sidebar-group-last">
          <p className="sidebar-group-title">System</p>
          <NavLink to="/rl-status" className={({ isActive }) => `side-link ${isActive ? "active" : ""}`}>
            <span className="side-link-icon">{sidebarIcon("system")}</span>
            <span className="side-link-label">Agent + RL</span>
          </NavLink>
        </div>

        <button type="button" className="theme-toggle btn-outline btn-sm" onClick={toggleTheme}>
          {theme === "dark" ? "Light Mode" : "Dark Mode"}
        </button>
      </aside>

      <section className="workspace-main">
        <header className="topbar-card">
          <div className="topbar-meta">
            <span className={`badge ${health === "online" ? "badge-success" : "badge-critical"}`}>Backend {health}</span>
            <span className="badge badge-info">API {apiHint}</span>
            <span className="badge badge-neutral">Updated {lastUpdate}</span>
            <span className="badge badge-neutral">Route {location.pathname}</span>
          </div>

          <div className="topbar-actions">
            <div className="field-inline">
              <label htmlFor="top-task">Scenario</label>
              <select id="top-task" value={task} onChange={(event) => handleTaskChange(event.target.value)}>
                {TASKS.map((entry) => (
                  <option key={entry} value={entry}>
                    {toTitleCase(entry)}
                  </option>
                ))}
              </select>
            </div>

            <div className="field-inline">
              <label htmlFor="top-seed">Seed</label>
              <input id="top-seed" value={seed} onChange={(event) => setSeed(event.target.value)} />
            </div>

            <button type="button" className="btn-outline btn-sm" onClick={() => refreshPreview(true)} disabled={loading}>
              {loading ? "Loading..." : "Refresh"}
            </button>
            <button type="button" className="btn-solid btn-sm" onClick={() => startEpisode(task, seed)} disabled={loading}>
              Start Episode
            </button>
            <button type="button" className="btn-outline btn-sm" onClick={() => refreshLiveDashboard(true)} disabled={liveLoading}>
              {liveLoading ? "Refreshing..." : "Refresh Live"}
            </button>
          </div>
        </header>

        {error ? <p className="error-text">{error}</p> : null}

        <section className="route-panel">
          <Routes>
            <Route path="/" element={<Navigate to="/overview" replace />} />
            <Route
              path="/overview"
              element={
                <OverviewPage
                  currentSpend={currentSpend}
                  targetSpend={targetSpend}
                  wasteScore={wasteScore}
                  savingsAchieved={savingsAchieved}
                  wasteSignals={wasteSignals}
                  resourceRows={resourceRows}
                  resourcesLoading={resourcesLoading}
                  resourcesError={resourcesError}
                  recommendations={recommendations}
                  liveDashboard={liveDashboard}
                  liveBusyKey={liveBusyKey}
                  liveError={liveError}
                  liveMessage={liveMessage}
                  actionHistory={actionHistory}
                  scenarioProfiles={scenarioProfiles}
                  onRunLiveAction={runLiveAction}
                />
              }
            />
            <Route
              path="/use-cases/:taskName"
              element={
                <Suspense fallback={<p className="chart-empty">Loading scenario page...</p>}>
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
                    StatCard={MetricCard}
                    ProfileCard={({ title, profile }) => (
                      <article className="section-card profile-card-alt">
                        <div className="section-title-wrap">
                          <span className="section-icon">{sidebarIcon("resources")}</span>
                          <h3>{title}</h3>
                        </div>
                        {profile ? (
                          <div className="metric-grid compact-grid">
                            <MetricCard
                              label="Monthly Spend"
                              value={fmtMoney(profile?.cost?.current_monthly_spend || 0)}
                              helper="Profile"
                            />
                            <MetricCard
                              label="Target Spend"
                              value={fmtMoney(profile?.cost?.target_monthly_spend || 0)}
                              helper="Profile"
                            />
                            <MetricCard
                              label="Waste Score"
                              value={fmtPercent(
                                (sumValues(profile?.waste_signals || {}) /
                                  Math.max(1, Number(profile?.resources?.core_total || 1))) *
                                  100
                              )}
                              helper="From waste signals"
                            />
                            <MetricCard
                              label="Max Savings"
                              value={fmtMoney(profile?.cost?.max_possible_savings_8_steps || 0)}
                              helper="8-step estimate"
                            />
                          </div>
                        ) : (
                          <p className="empty-text">No profile available.</p>
                        )}
                      </article>
                    )}
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