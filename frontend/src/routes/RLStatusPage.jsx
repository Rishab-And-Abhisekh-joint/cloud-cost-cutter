function fmtValue(value) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  return String(value);
}

function RLItem({ label, value }) {
  return (
    <article className="rl-detail-item">
      <p className="kpi-label">{label}</p>
      <p className="kpi-value">{fmtValue(value)}</p>
    </article>
  );
}

export default function RLStatusPage({ rlStatus, rlLoading, rlError, onRefresh }) {
  const rlEnabled = Boolean(rlStatus?.rl_enabled);

  return (
    <section className="rl-shell">
      <div className="page-intro">
        <div>
          <p className="eyebrow">System</p>
          <h2>Agent + RL</h2>
          <p>Live runtime status for policy validation, decision engine source, and recommendation mode.</p>
        </div>
        <div className="page-intro-actions">
          <button type="button" className="btn-outline btn-sm" onClick={() => onRefresh(true)} disabled={rlLoading}>
            {rlLoading ? "Refreshing..." : "Refresh Status"}
          </button>
        </div>
      </div>

      {rlError ? <p className="error-text">{rlError}</p> : null}

      <div className="rl-status-banner">
        {rlEnabled ? (
          <p className="badge badge-success">RL policy is active in runtime.</p>
        ) : (
          <p className="badge badge-warning">RL policy is not active. Runtime is heuristic-driven.</p>
        )}
      </div>

      <section className="rl-details-grid">
        <RLItem label="Control Mode" value={rlStatus?.control_mode} />
        <RLItem label="Decision Engine" value={rlStatus?.decision_engine} />
        <RLItem label="Recommendation" value={rlStatus?.recommendation_engine} />
        <RLItem label="Artifact Path" value={rlStatus?.rl_policy_path} />
        <RLItem label="Version" value={rlStatus?.rl_policy_version} />
        <RLItem label="Created" value={rlStatus?.rl_policy_created_at} />
        <RLItem label="State Count" value={rlStatus?.policy_state_count} />
        <RLItem label="Policy Loaded" value={rlStatus?.rl_policy_loaded} />
        <RLItem label="Validation" value={rlStatus?.rl_policy_validated} />
        <RLItem label="Last Validated" value={rlStatus?.rl_last_validated_at} />
        <RLItem label="Config Mode" value={rlStatus?.control_mode_config} />
      </section>

      {rlStatus?.rl_validation_error ? (
        <article className="section-card">
          <div className="section-title-wrap">
            <h3>Validation Error</h3>
          </div>
          <p className="error-text">{rlStatus.rl_validation_error}</p>
        </article>
      ) : null}

      <article className="section-card">
        <div className="section-title-wrap">
          <h3>Backend Notes</h3>
        </div>
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