import { MetricCard, SectionCard, StatusBadge } from "../components/shared";

function toTitleCase(value) {
  return String(value || "")
    .split("_")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

function RelativeTime({ iso }) {
  if (!iso) return <span className="rl-meta-na">—</span>;
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return <span className="rl-meta-na">—</span>;
    const now = Date.now();
    const diff = Math.max(0, Math.floor((now - d.getTime()) / 1000));
    let label;
    if (diff < 60) label = `${diff}s ago`;
    else if (diff < 3600) label = `${Math.floor(diff / 60)}m ago`;
    else if (diff < 86400) label = `${Math.floor(diff / 3600)}h ago`;
    else label = d.toLocaleDateString();
    return <span title={d.toISOString()}>{label}</span>;
  } catch {
    return <span className="rl-meta-na">—</span>;
  }
}

function UptimeIndicator({ validatedAt }) {
  const isRecent = (() => {
    if (!validatedAt) return false;
    try {
      const d = new Date(validatedAt);
      if (isNaN(d.getTime())) return false;
      return (Date.now() - d.getTime()) < 300000;
    } catch { return false; }
  })();
  return (
    <div className="rl-uptime">
      <div className={`rl-uptime-dot ${isRecent ? "rl-uptime-ok" : "rl-uptime-stale"}`} />
      <span className="rl-uptime-label">
        {validatedAt ? <><RelativeTime iso={validatedAt} /> — {isRecent ? "Healthy" : "Stale"}</> : "Not checked"}
      </span>
    </div>
  );
}

export default function RLStatusPage({ rlStatus, rlLoading, rlError, onRefresh }) {
  const rlEnabled = Boolean(rlStatus?.rl_enabled);
  const controlMode = rlStatus?.control_mode || "unknown";
  const policyLoaded = Boolean(rlStatus?.rl_policy_loaded);
  const policyValidated = Boolean(rlStatus?.rl_policy_validated);
  const validationError = rlStatus?.rl_validation_error;
  const notes = rlStatus?.notes || [];
  const training = rlStatus?.training || {};
  const metrics = rlStatus?.metrics || {};
  const hasTraining = Object.keys(training).length > 0;
  const hasMetrics = Object.keys(metrics).length > 0;
  const lastChecked = rlStatus?.rl_last_validated_at || null;
  const noteIcons = ["⚙", "🔒", "📡", "⚠"];
  const checkedLabel = (() => {
    if (!lastChecked) return "—";
    try {
      const d = new Date(lastChecked);
      if (isNaN(d.getTime())) return "—";
      return d.toLocaleTimeString();
    } catch { return "—"; }
  })();

  return (
    <>
      <div className="page-header">
        <div>
          <h2 className="page-title">Agent & RL Status</h2>
          <p className="page-subtitle">Runtime monitoring, policy details, and decision log</p>
        </div>
        <button className="btn-outline btn-sm" onClick={() => onRefresh(true)} disabled={rlLoading}>
          {rlLoading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {rlError && <p className="error-text">{rlError}</p>}

      <div className={`rl-hero ${rlEnabled ? "rl-hero-active" : "rl-hero-heuristic"}`}>
        <div className="rl-hero-indicator">
          <div className={`rl-pulse ${rlEnabled ? "rl-pulse-green" : "rl-pulse-amber"}`} />
        </div>
        <div className="rl-hero-info">
          <div className="rl-hero-status">
            <StatusBadge level={rlEnabled ? "success" : "warning"} label={rlEnabled ? "RL Active" : "Heuristic Fallback"} />
          </div>
          <h3 className="rl-hero-title">{rlEnabled ? "RL Policy is Active" : "Heuristic Mode Active"}</h3>
          <p className="rl-hero-desc">
            {rlEnabled
              ? "A trained reinforcement learning policy is loaded and making optimization decisions."
              : "No RL policy is active. The system uses heuristic ranking to select optimization actions."}
          </p>
          <UptimeIndicator validatedAt={rlStatus?.rl_last_validated_at} />
        </div>
        <div className="rl-hero-meta">
          <div className="rl-hero-meta-item">
            <span className="rl-meta-label">Control Mode</span>
            <span className="rl-meta-value">{toTitleCase(controlMode)}</span>
          </div>
          <div className="rl-hero-meta-item">
            <span className="rl-meta-label">Decision Engine</span>
            <span className="rl-meta-value">{rlStatus?.decision_engine || "—"}</span>
          </div>
          <div className="rl-hero-meta-item">
            <span className="rl-meta-label">Recommendation</span>
            <span className="rl-meta-value">{rlStatus?.recommendation_engine || "—"}</span>
          </div>
        </div>
      </div>

      <h3 className="rl-section-title">Policy Details</h3>
      <div className="rl-policy-grid">
        <div className="rl-policy-card">
          <span className="rl-policy-label">Artifact Path</span>
          <span className="rl-policy-value rl-mono">{rlStatus?.rl_policy_path || "Not configured"}</span>
        </div>
        <div className="rl-policy-card">
          <span className="rl-policy-label">Version</span>
          <span className="rl-policy-value">{rlStatus?.rl_policy_version || "—"}</span>
        </div>
        <div className="rl-policy-card">
          <span className="rl-policy-label">Created</span>
          <span className="rl-policy-value">
            {rlStatus?.rl_policy_created_at ? new Date(rlStatus.rl_policy_created_at).toLocaleString() : "—"}
          </span>
        </div>
        <div className="rl-policy-card">
          <span className="rl-policy-label">State Count</span>
          <span className="rl-policy-value">{rlStatus?.policy_state_count ?? "—"}</span>
        </div>
        <div className="rl-policy-card">
          <span className="rl-policy-label">Policy Loaded</span>
          <span className="rl-policy-value">
            <StatusBadge level={policyLoaded ? "success" : "critical"} label={policyLoaded ? "Loaded" : "Not Loaded"} />
          </span>
        </div>
        <div className="rl-policy-card">
          <span className="rl-policy-label">Validation</span>
          <span className="rl-policy-value">
            <StatusBadge level={policyValidated ? "success" : validationError ? "critical" : "warning"} label={policyValidated ? "Passed" : "Failed"} />
          </span>
        </div>
        <div className="rl-policy-card">
          <span className="rl-policy-label">Last Validated</span>
          <span className="rl-policy-value">
            <RelativeTime iso={rlStatus?.rl_last_validated_at} />
          </span>
        </div>
        <div className="rl-policy-card">
          <span className="rl-policy-label">Config Mode</span>
          <span className="rl-policy-value">{rlStatus?.control_mode_config || "—"}</span>
        </div>
      </div>

      {validationError && (
        <div className="rl-error-banner">
          <span className="rl-error-icon">⚠</span>
          <div>
            <strong>Validation Error</strong>
            <p>{validationError}</p>
          </div>
        </div>
      )}

      {(hasTraining || hasMetrics) && (
        <>
          <h3 className="rl-section-title">Training Metrics</h3>
          <div className="rl-metrics-grid">
            {Object.entries(training).map(([k, v]) => (
              <MetricCard key={`t-${k}`} label={toTitleCase(k)} value={typeof v === "number" ? v.toLocaleString() : String(v)} helper="training" />
            ))}
            {Object.entries(metrics).map(([k, v]) => (
              <MetricCard key={`m-${k}`} label={toTitleCase(k)} value={typeof v === "number" ? v.toLocaleString() : String(v)} helper="metric" />
            ))}
          </div>
        </>
      )}

      <h3 className="rl-section-title">Decision Log</h3>
      <SectionCard noPadding>
        {notes.length > 0 ? (
          <div className="rl-timeline">
            {notes.map((note, i) => (
              <div key={i} className="rl-timeline-item">
                <div className="rl-timeline-dot" />
                <div className="rl-timeline-line" />
                <div className="rl-timeline-content">
                  <span className="rl-timeline-icon">{noteIcons[i % noteIcons.length]}</span>
                  <div>
                    <p className="rl-timeline-text">{note}</p>
                    <span className="rl-timeline-ts">{checkedLabel}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rl-empty">No runtime notes available.</div>
        )}
      </SectionCard>
    </>
  );
}
