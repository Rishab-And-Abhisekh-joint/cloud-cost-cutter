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
    <article className="stat-card">
      <p className="stat-label">{label}</p>
      <p className="stat-value">{value}</p>
      {helper ? <p className="stat-helper">{helper}</p> : null}
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

function ProfileCard({ title, profile }) {
  if (!profile) {
    return (
      <article className="profile-card muted">
        <h3>{title}</h3>
        <p>No data yet.</p>
      </article>
    );
  }

  return (
    <article className="profile-card">
      <h3>{title}</h3>
      <div className="profile-grid">
        <div>
          <p>Task</p>
          <strong>{profile.task}</strong>
        </div>
        <div>
          <p>Seed</p>
          <strong>{profile.seed}</strong>
        </div>
        <div>
          <p>Total Cost</p>
          <strong>{fmtMoney(profile.total_monthly_cost)}</strong>
        </div>
        <div>
          <p>Potential Waste</p>
          <strong>{fmtMoney(profile.theoretical_max_savings)}</strong>
        </div>
        <div>
          <p>Resources</p>
          <strong>{profile.resource_count}</strong>
        </div>
        <div>
          <p>SLA Sensitive</p>
          <strong>{profile.sla_sensitive_count}</strong>
        </div>
      </div>
    </article>
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
    <main className="page-shell">
      <div className="ambient one" />
      <div className="ambient two" />
      <header className="hero">
        <p className="eyebrow">CloudCostEnv Live Control</p>
        <h1>Deploy Once, Benchmark Anywhere</h1>
        <p className="subtitle">
          This dashboard talks directly to your Railway-hosted environment API.
          Validate profiles, start seeded episodes, and track scenario scale from Vercel.
        </p>
      </header>

      <section className="stats">
        <StatCard label="Backend" value={health} helper={apiHint} />
        <StatCard
          label="Current Task"
          value={activeProfile?.task || "none"}
          helper={activeProfile ? `seed ${activeProfile.seed}` : "no active episode"}
        />
        <StatCard
          label="Current Potential Waste"
          value={fmtMoney(activeProfile?.theoretical_max_savings || 0)}
          helper="theoretical ceiling"
        />
      </section>

      <section className="control-panel">
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
      </section>

      {error ? <p className="error-text">{error}</p> : null}

      <section className="profiles">
        <ProfileCard title="Preview Profile" profile={previewProfile} />
        <ProfileCard title="Active Profile" profile={activeProfile} />
      </section>

      <section className="live-shell">
        <div className="live-top">
          <div>
            <p className="eyebrow">Live Dashboard</p>
            <h2>Actionable Recommendations</h2>
          </div>
          <button type="button" onClick={() => refreshLiveDashboard(true)} disabled={liveLoading}>
            {liveLoading ? "Refreshing..." : "Refresh Live"}
          </button>
        </div>

        {liveError ? <p className="error-text">{liveError}</p> : null}
        {liveMessage ? <p className="live-message">{liveMessage}</p> : null}

        <div className="live-stats">
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

        <div className="live-grid">
          <article className="live-card">
            <h3>Recommendations</h3>
            {liveDashboard?.recommendations?.length ? (
              <ul className="rec-list">
                {liveDashboard.recommendations.map((rec) => {
                  const dryKey = `${rec.action_type}:${rec.resource_id}:dry`;
                  const applyKey = `${rec.action_type}:${rec.resource_id}:apply`;

                  return (
                    <li className="rec-item" key={`${rec.action_type}:${rec.resource_id}`}>
                      <div className="rec-copy">
                        <p className="rec-title">
                          {recLabel(rec.action_type)} - {rec.resource_name}
                        </p>
                        <p className="rec-meta">{rec.reason}</p>
                        <p className="rec-meta">
                          Risk: {rec.risk} | Est. savings: {fmtMoney(rec.estimated_monthly_savings_usd)}
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
              <p className="empty-text">No live recommendations available yet.</p>
            )}
          </article>

          <article className="live-card">
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
        </div>
      </section>
    </main>
  );
}
