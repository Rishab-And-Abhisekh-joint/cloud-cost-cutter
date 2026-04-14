import { Suspense, lazy, useEffect } from "react";
import { Navigate, useParams, Link } from "react-router-dom";

const LazyUseCaseCharts = lazy(() => import("../UseCaseCharts"));

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
  taskMeta,
  StatCard,
  ProfileCard,
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
          <h2>{taskMeta[taskName].title}</h2>
          <p>{taskMeta[taskName].description}</p>
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

      <Suspense fallback={<p className="chart-empty">Loading chart modules...</p>}>
        <LazyUseCaseCharts profile={chosenProfile} liveDashboard={liveDashboard} />
      </Suspense>

      <div style={{ margin: "16px 0", textAlign: "center" }}>
        <Link to={`/cost-analytics?tab=scenarios&scenario=${taskName}`} className="btn-outline" style={{ display: "inline-block", padding: "8px 16px", textDecoration: "none", fontSize: "0.8rem", fontWeight: 600 }}>
          View Full Cost Analytics →
        </Link>
      </div>

      <section className="profile-stack">
        <ProfileCard title="Use-Case Preview" profile={scopedPreview} />
        <ProfileCard title="Use-Case Active" profile={scopedActive} />
      </section>
    </>
  );
}

export default function UseCaseRoutePage({
  task,
  onTaskChange,
  tasks,
  taskMeta,
  seed,
  loading,
  previewProfile,
  activeProfile,
  liveDashboard,
  onSeedChange,
  onRefreshPreview,
  onStartEpisode,
  onRefreshLive,
  StatCard,
  ProfileCard,
}) {
  const { taskName = "" } = useParams();

  useEffect(() => {
    if (tasks.includes(taskName) && taskName !== task) {
      onTaskChange(taskName);
    }
  }, [taskName, task, onTaskChange, tasks]);

  if (!tasks.includes(taskName)) {
    return <Navigate to="/use-cases/full_optimization" replace />;
  }

  return (
    <UseCasePage
      taskName={taskName}
      seed={seed}
      loading={loading}
      previewProfile={previewProfile}
      activeProfile={activeProfile}
      liveDashboard={liveDashboard}
      onSeedChange={onSeedChange}
      onRefreshPreview={onRefreshPreview}
      onStartEpisode={onStartEpisode}
      onRefreshLive={onRefreshLive}
      taskMeta={taskMeta}
      StatCard={StatCard}
      ProfileCard={ProfileCard}
    />
  );
}
