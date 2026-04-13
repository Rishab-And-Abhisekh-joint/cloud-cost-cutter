import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BrowserRouter, Navigate, NavLink, Route, Routes, useNavigate, useParams } from "react-router-dom";

const TASKS = ["cleanup", "rightsize", "full_optimization"];
const DEFAULT_PROD_API_BASE_URL = "https://cloud-cost-env-api-production.up.railway.app";
const REQUEST_TIMEOUT_MS = Number(import.meta.env.VITE_REQUEST_TIMEOUT_MS || 15000);
const REQUEST_RETRIES = Number(import.meta.env.VITE_REQUEST_RETRIES || 2);
const PIE_COLORS = ["#2fc79e", "#ffb15f", "#64b1f4", "#f9838c", "#95d66f", "#9b8fff"];

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
  if (actionType === "release_eip") {
    return "Release EIP";
  }
  if (actionType === "delete_snapshot") {
    return "Delete Snapshot";
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
  if (actionType === "release_eip") {
    return "Network";
  }
  if (actionType === "delete_snapshot") {
    return "Snapshot";
  }
  return "Storage";
}

function buildResourcePie(profile) {
  const resources = profile?.resources || {};
  return [
    { name: "Compute", value: Number(resources.compute || 0) },
    { name: "Volumes", value: Number(resources.volumes || 0) },
    { name: "Databases", value: Number(resources.databases || 0) },
    { name: "Load Balancers", value: Number(resources.load_balancers || 0) },
    { name: "Snapshots", value: Number(resources.snapshots || 0) },
    { name: "Elastic IPs", value: Number(resources.elastic_ips || 0) },
  ].filter((entry) => entry.value > 0);
}

function buildWastePie(profile) {
  const waste = profile?.waste_signals || {};
  return [
    { name: "Idle Compute", value: Number(waste.idle_compute || 0) },
    { name: "Orphaned Volumes", value: Number(waste.orphaned_volumes || 0) },
    { name: "Unattached IPs", value: Number(waste.unattached_ips || 0) },
    { name: "Empty LBs", value: Number(waste.empty_load_balancers || 0) },
    { name: "Overprovisioned Compute", value: Number(waste.overprovisioned_compute || 0) },
    { name: "Overprovisioned DB", value: Number(waste.overprovisioned_databases || 0) },
  ].filter((entry) => entry.value > 0);
}

function buildCostBars(profile) {
  const cost = profile?.cost || {};
  const current = Number(cost.current_monthly_spend || 0);
  const target = Number(cost.target_monthly_spend || 0);
  const gap = Math.max(0, current - target);
  const maxSavings = Number(cost.max_possible_savings_8_steps || 0);
  return [
    { name: "Current", value: current },
    { name: "Target", value: target },
    { name: "Gap", value: gap },
    { name: "Max 8-Step", value: maxSavings },
  ];
}

function buildHistoryTrend(actionHistory) {
  const recent = (actionHistory || []).slice(-12);
  let cumulative = 0;
  return recent.map((entry, index) => {
    const saving = Number(entry?.estimated_monthly_savings_usd || 0);
    if (entry?.ok) {
      cumulative += saving;
    }
    return {
      step: `#${index + 1}`,
      stepSavings: Number(entry?.ok ? saving : 0),
      cumulativeSavings: Number(cumulative.toFixed(2)),
    };
  });
}

function buildRecommendationBars(recommendations) {
  return (recommendations || [])
    .slice()
    .sort((a, b) => Number(b.estimated_monthly_savings_usd || 0) - Number(a.estimated_monthly_savings_usd || 0))
    .slice(0, 8)
    .map((rec) => ({
      name: `${toTitleCase(signalLabel(rec.action_type))}`,
      savings: Number(rec.estimated_monthly_savings_usd || 0),
      resource: rec.resource_name,
    }));
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

function ChartCard({ title, subtitle, children }) {
  return (
    <article className="chart-card">
      <header className="chart-head">
        <h3>{title}</h3>
        {subtitle ? <p>{subtitle}</p> : null}
      </header>
      <div className="chart-body">{children}</div>
    </article>
  );
}

function NoChartData({ message }) {
  return <p className="chart-empty">{message}</p>;
}

function UseCaseCharts({ profile, liveDashboard }) {
  const resourcePie = useMemo(() => buildResourcePie(profile), [profile]);
  const wastePie = useMemo(() => buildWastePie(profile), [profile]);
  const costBars = useMemo(() => buildCostBars(profile), [profile]);
  const historyTrend = useMemo(() => buildHistoryTrend(liveDashboard?.action_history), [liveDashboard?.action_history]);
  const recommendationBars = useMemo(
    () => buildRecommendationBars(liveDashboard?.recommendations),
    [liveDashboard?.recommendations]
  );

  return (
    <section className="charts-grid">
      <ChartCard title="Resource Composition" subtitle="Pie chart by resource counts">
        {resourcePie.length ? (
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie data={resourcePie} dataKey="value" nameKey="name" innerRadius={52} outerRadius={86} paddingAngle={2}>
                {resourcePie.map((entry, index) => (
                  <Cell key={entry.name} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <NoChartData message="No resource composition available yet." />
        )}
      </ChartCard>

      <ChartCard title="Waste Signal Mix" subtitle="Pie chart of optimization opportunities">
        {wastePie.length ? (
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie data={wastePie} dataKey="value" nameKey="name" innerRadius={52} outerRadius={86} paddingAngle={2}>
                {wastePie.map((entry, index) => (
                  <Cell key={entry.name} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <NoChartData message="No waste signals available yet." />
        )}
      </ChartCard>

      <ChartCard title="Cost Envelope" subtitle="Current vs target and expected max savings">
        {costBars.some((entry) => entry.value > 0) ? (
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={costBars}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(180, 210, 230, 0.18)" />
              <XAxis dataKey="name" stroke="#9eb6c9" />
              <YAxis stroke="#9eb6c9" />
              <Tooltip formatter={(value) => fmtMoney(Number(value || 0))} />
              <Bar dataKey="value" radius={[8, 8, 0, 0]}>
                {costBars.map((entry, index) => (
                  <Cell key={entry.name} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <NoChartData message="Cost data appears after preview or episode start." />
        )}
      </ChartCard>

      <ChartCard title="Action Savings Trend" subtitle="Recent live action savings progression">
        {historyTrend.length ? (
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={historyTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(180, 210, 230, 0.18)" />
              <XAxis dataKey="step" stroke="#9eb6c9" />
              <YAxis stroke="#9eb6c9" />
              <Tooltip formatter={(value) => fmtMoney(Number(value || 0))} />
              <Legend />
              <Line type="monotone" dataKey="stepSavings" stroke="#ffb15f" strokeWidth={2.4} dot={false} />
              <Line type="monotone" dataKey="cumulativeSavings" stroke="#2fc79e" strokeWidth={2.4} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <NoChartData message="No action trend yet. Run dry/apply actions in Live Operations." />
        )}
      </ChartCard>

      <ChartCard title="Top Recommendation Savings" subtitle="Bar chart of highest monthly opportunities">
        {recommendationBars.length ? (
          <ResponsiveContainer width="100%" height={270}>
            <BarChart data={recommendationBars} layout="vertical" margin={{ left: 24 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(180, 210, 230, 0.18)" />
              <XAxis type="number" stroke="#9eb6c9" />
              <YAxis dataKey="resource" type="category" width={120} stroke="#9eb6c9" />
              <Tooltip formatter={(value) => fmtMoney(Number(value || 0))} />
              <Bar dataKey="savings" radius={[0, 8, 8, 0]} fill="#2fc79e" />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <NoChartData message="No recommendation bars available yet." />
        )}
      </ChartCard>
    </section>
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
  return (
    <>
      <section className="hero-panel">
        <div>
          <p className="hero-kicker">Operational Snapshot</p>
          <p className="hero-copy">
            Multi-page command center with dedicated use-case screens, chart-first analytics, and live execution controls.
          </p>
        </div>
        <div className="pressure-panel">
          <p>Optimization Pressure</p>
          <strong>{fmtPercent(optimizationPressure)}</strong>
          <div className="pressure-track">
            <div className="pressure-fill" style={{ width: `${optimizationPressure}%` }} />
          </div>
          <small>
            Potential savings {fmtMoney(potentialSavings)} of current spend {fmtMoney(currentCost)}
          </small>
        </div>
      </section>

      <section className="kpi-grid">
        <StatCard label="Active Task" value={toTitleCase(currentTaskName)} helper={`step ${activeStep}`} />
        <StatCard
          label="Monthly Spend"
          value={fmtMoney(currentCost)}
          helper={activeProfile?.seed ? `seed ${activeProfile.seed}` : "no active episode"}
        />
        <StatCard label="Potential Savings" value={fmtMoney(potentialSavings)} helper="ranked action estimate" />
        <StatCard
          label="Actions Logged"
          value={String(liveDashboard?.action_history?.length || 0)}
          helper={liveDashboard?.can_apply_actions ? "apply enabled" : "dry-run mode"}
        />
      </section>

      <section className="studio-panel">
        <div className="studio-head">
          <div>
            <p className="eyebrow">Scenario Studio</p>
            <h2>Configure Deterministic Benchmark Runs</h2>
          </div>
          <span className="studio-meta">Backend {health} · API {apiHint} · Updated {lastUpdate}</span>
        </div>

        <div className="studio-controls">
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
        </div>
      </section>

      {error ? <p className="error-text">{error}</p> : null}

      <section className="usecase-grid">
        {TASKS.map((entry) => (
          <article key={entry} className="usecase-card">
            <p className="eyebrow">Use Case</p>
            <h3>{TASK_META[entry].title}</h3>
            <p>{TASK_META[entry].description}</p>
            <button type="button" onClick={() => onOpenUseCase(entry)}>
              View {toTitleCase(entry)} Charts
            </button>
          </article>
        ))}
      </section>

      <section className="profile-stack">
        <ProfileCard title="Preview Profile" profile={previewProfile} />
        <ProfileCard title="Active Profile" profile={activeProfile} />
      </section>

      <section className="ops-shell">
        <div className="ops-top">
          <div>
            <p className="eyebrow">Live Dashboard</p>
            <h2>Optimization Queue And Execution Console</h2>
          </div>
          <button type="button" onClick={() => onRefreshLive(true)} disabled={liveLoading}>
            {liveLoading ? "Refreshing..." : "Refresh Live"}
          </button>
        </div>

        {liveError ? <p className="error-text">{liveError}</p> : null}
        {liveMessage ? <p className="live-message">{liveMessage}</p> : null}

        <div className="kpi-grid compact">
          <StatCard
            label="Live Connection"
            value={liveDashboard?.connected ? "connected" : "offline"}
            helper={liveDashboard?.region || "unknown region"}
          />
          <StatCard
            label="Potential Savings"
            value={fmtMoney(liveDashboard?.potential_monthly_savings_usd || 0)}
            helper="monthly estimate"
          />
          <StatCard
            label="Can Apply"
            value={liveDashboard?.can_apply_actions ? "yes" : "no"}
            helper="toggle via LIVE_DASHBOARD_ALLOW_APPLY"
          />
          <StatCard
            label="Action History"
            value={String(liveDashboard?.action_history?.length || 0)}
            helper="latest 20 events"
          />
        </div>

        <div className="ops-grid">
          <article className="ops-card">
            <h3>Savings Opportunity Spectrum</h3>
            <SavingsTrend recommendations={liveDashboard?.recommendations} actionHistory={liveDashboard?.action_history} />
          </article>

          <article className="ops-card">
            <h3>Prioritized Recommendations</h3>
            {liveDashboard?.recommendations?.length ? (
              <ul className="rec-list">
                {liveDashboard.recommendations.map((rec) => {
                  const dryKey = `${rec.action_type}:${rec.resource_id}:dry`;
                  const applyKey = `${rec.action_type}:${rec.resource_id}:apply`;

                  return (
                    <li className="rec-item" key={`${rec.action_type}:${rec.resource_id}`}>
                      <div className="rec-copy">
                        <p className="rec-title">
                          {recLabel(rec.action_type)} · {rec.resource_name}
                        </p>
                        <p className="rec-badge">{signalLabel(rec.action_type)}</p>
                        <p className="rec-meta">{rec.reason}</p>
                        <p className="rec-meta rec-metrics">
                          <span className={`risk-chip risk-${String(rec.risk || "low").toLowerCase()}`}>
                            Risk {rec.risk}
                          </span>
                          <span>Est. savings {fmtMoney(rec.estimated_monthly_savings_usd)}</span>
                        </p>
                      </div>
                      <div className="rec-actions">
                        <button
                          type="button"
                          disabled={liveBusyKey !== ""}
                          onClick={() => onRunLiveAction(rec.action_type, rec.resource_id, false)}
                        >
                          {liveBusyKey === dryKey ? "Running..." : "Dry Run"}
                        </button>
                        <button
                          type="button"
                          className="solid"
                          disabled={liveBusyKey !== "" || !liveDashboard?.can_apply_actions}
                          onClick={() => onRunLiveAction(rec.action_type, rec.resource_id, true)}
                        >
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
          </article>

          <article className="ops-card">
            <h3>Recent Actions</h3>
            {liveDashboard?.action_history?.length ? (
              <ul className="history-list">
                {liveDashboard.action_history
                  .slice()
                  .reverse()
                  .map((event, idx) => (
                    <li className="history-item" key={`${event.timestamp}-${event.resource_id}-${idx}`}>
                      <p>
                        <strong>{recLabel(event.action_type)}</strong> on {event.resource_id}
                      </p>
                      <p className="history-meta-line">
                        <span className={`history-chip ${event.ok ? "history-chip-ok" : "history-chip-fail"}`}>
                          {event.ok ? "ok" : "failed"}
                        </span>
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
          </article>

          <article className="ops-card wide">
            <h3>Resource Footprint Map</h3>
            <ResourceMap counts={liveDashboard?.resource_counts} />
          </article>
        </div>
      </section>
    </>
  );
}

function UseCasePage({
  taskName,
  seed,
  loading,
  previewProfile,
  activeProfile,
  liveDashboard,
  onSeedChange,
  onRefreshPreview,
  onStartEpisode,
  onRefreshLive,
}) {
  const scopedPreview = previewProfile?.task_name === taskName ? previewProfile : null;
  const scopedActive = activeProfile?.task_name === taskName ? activeProfile : null;
  const chosenProfile = scopedActive || scopedPreview;
  const monthlySpend = Number(chosenProfile?.cost?.current_monthly_spend || 0);
  const targetSpend = Number(chosenProfile?.cost?.target_monthly_spend || 0);
  const maxSavings = Number(chosenProfile?.cost?.max_possible_savings_8_steps || 0);

  return (
    <>
      <section className="page-intro">
        <div>
          <p className="eyebrow">Use Case · {toTitleCase(taskName)}</p>
          <h2>{TASK_META[taskName].title}</h2>
          <p>{TASK_META[taskName].description}</p>
        </div>
        <div className="page-intro-actions">
          <div className="field-group compact">
            <label htmlFor="seed-use-case">Seed</label>
            <input id="seed-use-case" value={seed} onChange={(e) => onSeedChange(e.target.value)} />
          </div>
          <button type="button" onClick={onRefreshPreview} disabled={loading}>
            Refresh Preview
          </button>
          <button type="button" className="solid" onClick={onStartEpisode} disabled={loading}>
            Run Episode
          </button>
          <button type="button" onClick={() => onRefreshLive(true)}>
            Refresh Live Data
          </button>
        </div>
      </section>

      <section className="kpi-grid">
        <StatCard label="Use-Case Spend" value={fmtMoney(monthlySpend)} helper={`seed ${seed}`} />
        <StatCard label="Target Spend" value={fmtMoney(targetSpend)} helper="profile target" />
        <StatCard label="Gap" value={fmtMoney(Math.max(0, monthlySpend - targetSpend))} helper="current - target" />
        <StatCard label="Max 8-Step Savings" value={fmtMoney(maxSavings)} helper="upper bound estimate" />
      </section>

      <UseCaseCharts profile={chosenProfile} liveDashboard={liveDashboard} />

      <section className="profile-stack">
        <ProfileCard title="Use-Case Preview" profile={scopedPreview} />
        <ProfileCard title="Use-Case Active" profile={scopedActive} />
      </section>
    </>
  );
}

function RLStatusPage({ rlStatus, rlLoading, rlError, onRefresh }) {
  const rlEnabled = Boolean(rlStatus?.rl_enabled);

  return (
    <section className="rl-shell">
      <div className="page-intro">
        <div>
          <p className="eyebrow">Agent Runtime Check</p>
          <h2>RL Runtime Status</h2>
          <p>Transparent report of whether a real RL policy is active or the system is currently heuristic-driven.</p>
        </div>
        <div className="page-intro-actions">
          <button type="button" onClick={() => onRefresh(true)} disabled={rlLoading}>
            {rlLoading ? "Refreshing..." : "Refresh Status"}
          </button>
        </div>
      </div>

      {rlError ? <p className="error-text">{rlError}</p> : null}

      <div className="rl-status-banner">
        {rlEnabled ? (
          <p className="status-note status-note-good">RL policy is active and loaded in runtime.</p>
        ) : (
          <p className="status-note status-note-warn">
            RL policy is not active right now. Current decision flow is heuristic/action-engine based.
          </p>
        )}
      </div>

      <section className="rl-grid">
        <article className="rl-card">
          <p className="kpi-label">Control Mode</p>
          <p className="kpi-value">{String(rlStatus?.control_mode || "unknown")}</p>
          <p className="kpi-helper">Configured runtime mode reported by backend</p>
        </article>
        <article className="rl-card">
          <p className="kpi-label">RL Enabled</p>
          <p className="kpi-value">{rlEnabled ? "Yes" : "No"}</p>
          <p className="kpi-helper">True only when mode=rl and policy artifact is loaded</p>
        </article>
        <article className="rl-card">
          <p className="kpi-label">Policy Artifact</p>
          <p className="kpi-value">{rlStatus?.rl_policy_loaded ? "Loaded" : "Not Loaded"}</p>
          <p className="kpi-helper">Path: {rlStatus?.rl_policy_path || "not configured"}</p>
        </article>
        <article className="rl-card">
          <p className="kpi-label">Decision Engine</p>
          <p className="kpi-value">{rlStatus?.decision_engine || "unknown"}</p>
          <p className="kpi-helper">Backend action execution engine currently in use</p>
        </article>
      </section>

      <article className="ops-card wide rl-notes-card">
        <h3>Backend Notes</h3>
        {rlStatus?.notes?.length ? (
          <ul className="rl-note-list">
            {rlStatus.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        ) : (
          <p className="empty-text">No runtime notes available.</p>
        )}
      </article>
    </section>
  );
}

function UseCaseRoute({ task, onTaskChange, ...pageProps }) {
  const { taskName = "" } = useParams();

  useEffect(() => {
    if (TASKS.includes(taskName) && taskName !== task) {
      onTaskChange(taskName);
    }
  }, [taskName, task, onTaskChange]);

  if (!TASKS.includes(taskName)) {
    return <Navigate to="/use-cases/full_optimization" replace />;
  }

  return <UseCasePage taskName={taskName} {...pageProps} />;
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
    <main className="ui-shell">
      <div className="noise-layer" />
      <div className="orb orb-a" />
      <div className="orb orb-b" />

      <header className="topbar">
        <div className="brand-wrap">
          <div className="brand-mark">CC</div>
          <div>
            <p className="eyebrow">CloudCostEnv Command Center</p>
            <h1>Professional FinOps Operations Dashboard</h1>
          </div>
        </div>
        <div className="status-cluster">
          <span className={`pill ${health === "online" ? "pill-good" : "pill-bad"}`}>Backend {health}</span>
          <span className="pill pill-soft">API {apiHint}</span>
          <span className="pill pill-soft">Updated {lastUpdate}</span>
        </div>
      </header>

      <nav className="main-nav" aria-label="Dashboard pages">
        <NavLink to="/overview" className={({ isActive }) => `main-nav-link ${isActive ? "active" : ""}`}>
          Overview
        </NavLink>
        {TASKS.map((entry) => (
          <NavLink
            key={entry}
            to={`/use-cases/${entry}`}
            className={({ isActive }) => `main-nav-link ${isActive ? "active" : ""}`}
          >
            {toTitleCase(entry)}
          </NavLink>
        ))}
        <NavLink to="/rl-status" className={({ isActive }) => `main-nav-link ${isActive ? "active" : ""}`}>
          Agent + RL
        </NavLink>
      </nav>

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
              <UseCaseRoute
                task={task}
                onTaskChange={handleTaskChange}
                seed={seed}
                loading={loading}
                previewProfile={previewProfile}
                activeProfile={activeProfile}
                liveDashboard={liveDashboard}
                onSeedChange={setSeed}
                onRefreshPreview={() => refreshPreview(true)}
                onStartEpisode={() => startEpisode(task, seed)}
                onRefreshLive={refreshLiveDashboard}
              />
            }
          />
          <Route
            path="/rl-status"
            element={
              <RLStatusPage
                rlStatus={rlStatus}
                rlLoading={rlLoading}
                rlError={rlError}
                onRefresh={refreshAgentStatus}
              />
            }
          />
          <Route path="*" element={<Navigate to="/overview" replace />} />
        </Routes>
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
