import { useMemo } from "react";
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

const PIE_COLORS = ["#22c55e", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4"];

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

function signalLabel(actionType) {
  if (actionType === "stop_instance") {
    return "Compute";
  }
  if (actionType === "terminate_instance") {
    return "Compute";
  }
  if (actionType === "release_eip") {
    return "Network";
  }
  if (actionType === "delete_snapshot") {
    return "Snapshot";
  }
  if (actionType === "delete_load_balancer") {
    return "Network";
  }
  if (actionType === "rightsize_instance") {
    return "Compute";
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

export default function UseCaseCharts({ profile, liveDashboard }) {
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
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="name" stroke="#9ca3af" />
              <YAxis stroke="#9ca3af" />
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
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="step" stroke="#9ca3af" />
              <YAxis stroke="#9ca3af" />
              <Tooltip formatter={(value) => fmtMoney(Number(value || 0))} />
              <Legend />
              <Line type="monotone" dataKey="stepSavings" stroke="#f59e0b" strokeWidth={2.4} dot={false} />
              <Line type="monotone" dataKey="cumulativeSavings" stroke="#22c55e" strokeWidth={2.4} dot={false} />
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
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis type="number" stroke="#9ca3af" />
              <YAxis dataKey="resource" type="category" width={120} stroke="#9ca3af" />
              <Tooltip formatter={(value) => fmtMoney(Number(value || 0))} />
              <Bar dataKey="savings" radius={[0, 8, 8, 0]} fill="#22c55e" />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <NoChartData message="No recommendation bars available yet." />
        )}
      </ChartCard>
    </section>
  );
}
