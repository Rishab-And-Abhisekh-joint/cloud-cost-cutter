import { useEffect, useMemo, useState } from "react";

const TASKS = ["cleanup", "rightsize", "full_optimization"];
const DEFAULT_PROD_API_BASE_URL = "https://cloud-cost-env-api-production.up.railway.app";
const REQUEST_TIMEOUT_MS = Number(import.meta.env.VITE_REQUEST_TIMEOUT_MS || 15000);
const REQUEST_RETRIES = Number(import.meta.env.VITE_REQUEST_RETRIES || 2);

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

export default function App() {
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

  const apiHint = useMemo(() => API_BASE_URL.replace(/^https?:\/\//, ""), []);
  const currentCost = Number(activeProfile?.cost?.current_monthly_spend || previewProfile?.cost?.current_monthly_spend || 0);
  const potentialSavings = Number(liveDashboard?.potential_monthly_savings_usd || activeProfile?.cost?.max_possible_savings_8_steps || 0);
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

      try {
        const preview = await request(`/profile?task_name=${task}&seed=${seed}`, { method: "GET" });
        setPreviewProfile(preview);
      } catch {
        setPreviewProfile(null);
      }

      await refreshLiveDashboard(false);
    }

    bootstrap();
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      refreshLiveDashboard(false);
    }, 15000);
    return () => clearInterval(timer);
  }, [task, seed]);

  async function refreshLiveDashboard(showSpinner = true) {
    if (showSpinner) {
      setLiveLoading(true);
    }
    setLiveError("");

    try {
      const dashboard = await request(liveDashboardPath(task, seed), { method: "GET" });
      setLiveDashboard(dashboard);
    } catch (err) {
      setLiveError(`Live dashboard failed: ${err.message}`);
    } finally {
      if (showSpinner) {
        setLiveLoading(false);
      }
    }
  }

  async function refreshPreview() {
    setError("");
    setLoading(true);
    try {
      const preview = await request(`/profile?task_name=${task}&seed=${seed}`, { method: "GET" });
      setPreviewProfile(preview);
    } catch (err) {
      setError(`Preview failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function startEpisode() {
    setError("");
    setLoading(true);
    try {
      await request(`/reset/${task}?seed=${seed}`, { method: "POST" });
      const active = await request("/profile", { method: "GET" });
      setActiveProfile(active);
      await refreshLiveDashboard(false);
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

      <section className="hero-panel">
        <div>
          <p className="hero-kicker">Operational Snapshot</p>
          <p className="hero-copy">
            Monitor optimization pressure, run deterministic episodes, and execute safe actions from a single
            production-grade interface.
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
        <StatCard label="Active Task" value={currentTaskName} helper={`step ${activeStep}`} />
        <StatCard
          label="Monthly Spend"
          value={fmtMoney(currentCost)}
          helper={activeProfile?.seed ? `seed ${activeProfile.seed}` : "no active episode"}
        />
        <StatCard
          label="Potential Savings"
          value={fmtMoney(potentialSavings)}
          helper="ranked action estimate"
        />
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
          <span className="studio-meta">Task seeds are replayable for audit and comparison</span>
        </div>

        <div className="studio-controls">
          <div className="field-group">
            <label htmlFor="task">Task</label>
            <select id="task" value={task} onChange={(e) => setTask(e.target.value)}>
              {TASKS.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
          </div>

          <div className="field-group">
            <label htmlFor="seed">Seed</label>
            <input id="seed" value={seed} onChange={(e) => setSeed(e.target.value)} />
          </div>

          <div className="actions">
            <button type="button" onClick={refreshPreview} disabled={loading}>
              Preview Scenario
            </button>
            <button type="button" className="solid" onClick={startEpisode} disabled={loading}>
              Start Episode
            </button>
          </div>
        </div>
      </section>

      {error ? <p className="error-text">{error}</p> : null}

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
          <button type="button" onClick={() => refreshLiveDashboard(true)} disabled={liveLoading}>
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
            <h3>Prioritized Recommendations</h3>
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
                        <p className="rec-meta">
                          Risk {rec.risk} · Est. savings {fmtMoney(rec.estimated_monthly_savings_usd)}
                        </p>
                      </div>
                      <div className="rec-actions">
                        <button
                          type="button"
                          disabled={liveBusyKey !== ""}
                          onClick={() => runLiveAction(rec.action_type, rec.resource_id, false)}
                        >
                          {liveBusyKey === dryKey ? "Running..." : "Dry Run"}
                        </button>
                        <button
                          type="button"
                          className="solid"
                          disabled={liveBusyKey !== "" || !liveDashboard?.can_apply_actions}
                          onClick={() => runLiveAction(rec.action_type, rec.resource_id, true)}
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
                      <p>
                        {event.dry_run ? "Dry run" : "Executed"} | {event.ok ? "ok" : "failed"} | savings {fmtMoney(event.estimated_monthly_savings_usd)}
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
    </main>
  );
}
