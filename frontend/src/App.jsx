import { useEffect, useMemo, useState } from "react";

const TASKS = ["cleanup", "rightsize", "full_optimization"];
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";

function fmtMoney(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed: ${response.status}`);
  }

  return response.json();
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
    }

    bootstrap();
  }, []);

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
    } catch (err) {
      setError(`Reset failed: ${err.message}`);
    } finally {
      setLoading(false);
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
    </main>
  );
}
