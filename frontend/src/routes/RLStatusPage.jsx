export default function RLStatusPage({ rlStatus, rlLoading, rlError, onRefresh }) {
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

      <article className="rl-notes-card">
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
