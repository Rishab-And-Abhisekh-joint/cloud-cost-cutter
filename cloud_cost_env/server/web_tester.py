TESTER_HTML = """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>CloudCostEnv Graphic Console</title>
  <style>
    :root {
      --bg-1: #06121f;
      --bg-2: #0f2d45;
      --bg-3: #0f1f32;
      --panel: rgba(10, 24, 39, 0.8);
      --panel-strong: rgba(7, 18, 30, 0.95);
      --text: #eaf3fb;
      --muted: #9cb5c8;
      --accent: #58b7ff;
      --accent-2: #3be1c1;
      --ok: #31d48b;
      --warn: #f5c75f;
      --bad: #ff7d7d;
      --border: #23435f;
      --glow: rgba(88, 183, 255, 0.45);
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      font-family: "Segoe UI", "Trebuchet MS", sans-serif;
      color: var(--text);
      background:
        radial-gradient(circle at 12% -5%, #2e4b6e 0%, transparent 38%),
        radial-gradient(circle at 95% 0%, #1f4f4b 0%, transparent 32%),
        linear-gradient(130deg, var(--bg-1), var(--bg-2) 52%, var(--bg-3));
      min-height: 100vh;
      overflow-x: hidden;
    }

    body::before,
    body::after {
      content: "";
      position: fixed;
      width: 360px;
      height: 360px;
      border-radius: 50%;
      filter: blur(70px);
      pointer-events: none;
      z-index: 0;
      animation: drift 16s ease-in-out infinite;
    }

    body::before {
      top: -80px;
      left: -90px;
      background: rgba(98, 166, 255, 0.22);
    }

    body::after {
      bottom: -120px;
      right: -120px;
      background: rgba(40, 216, 177, 0.2);
      animation-delay: -6s;
    }

    @keyframes drift {
      0% { transform: translate(0, 0); }
      50% { transform: translate(20px, 18px); }
      100% { transform: translate(0, 0); }
    }

    .wrap {
      position: relative;
      z-index: 1;
      max-width: 1160px;
      margin: 0 auto;
      padding: 24px 14px 44px;
      display: grid;
      gap: 14px;
    }

    .panel {
      border: 1px solid var(--border);
      border-radius: 16px;
      background: var(--panel);
      backdrop-filter: blur(4px);
      padding: 14px;
      box-shadow: 0 8px 30px rgba(0, 0, 0, 0.22);
    }

    .panel.hero {
      background:
        linear-gradient(120deg, rgba(24, 63, 96, 0.86), rgba(9, 31, 44, 0.9)),
        radial-gradient(circle at 80% 20%, rgba(62, 224, 185, 0.22), transparent 45%);
      border-color: #316286;
    }

    h1 {
      margin: 0;
      font-size: clamp(1.45rem, 2.5vw, 2.2rem);
      letter-spacing: 0.2px;
    }

    h2 {
      margin: 0;
      font-size: 1.02rem;
    }

    p {
      margin: 10px 0 0;
      color: var(--muted);
      line-height: 1.4;
    }

    .hero-grid {
      margin-top: 14px;
      display: grid;
      gap: 10px;
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
    }

    .hero-pill {
      padding: 10px;
      border-radius: 12px;
      border: 1px solid #2f5676;
      background: rgba(10, 26, 40, 0.65);
    }

    .hero-pill span {
      display: block;
      color: var(--muted);
      font-size: 0.78rem;
      text-transform: uppercase;
      letter-spacing: 0.8px;
    }

    .hero-pill strong {
      display: block;
      margin-top: 5px;
      font-size: 1.03rem;
      color: #eff7ff;
    }

    .grid-2 {
      display: grid;
      gap: 14px;
      grid-template-columns: 1.15fr 1fr;
      align-items: start;
    }

    @media (max-width: 980px) {
      .grid-2 {
        grid-template-columns: 1fr;
      }
    }

    label {
      display: block;
      margin-bottom: 8px;
      color: var(--muted);
      font-size: 0.9rem;
    }

    textarea,
    input,
    button {
      font: inherit;
      border-radius: 10px;
    }

    textarea,
    input {
      width: 100%;
      color: var(--text);
      background: rgba(8, 20, 33, 0.9);
      border: 1px solid var(--border);
      padding: 10px;
    }

    textarea {
      min-height: 190px;
      resize: vertical;
      line-height: 1.35;
    }

    .hint {
      margin-top: 10px;
      font-size: 0.83rem;
      color: var(--muted);
      line-height: 1.4;
    }

    .buttons {
      margin-top: 12px;
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    button {
      padding: 8px 12px;
      color: var(--text);
      border: 1px solid var(--border);
      background: linear-gradient(120deg, #143252, #133049);
      cursor: pointer;
      transition: transform 120ms ease, box-shadow 120ms ease;
    }

    button:hover {
      transform: translateY(-1px);
      box-shadow: 0 0 0 2px rgba(87, 173, 255, 0.15);
    }

    button.primary {
      border: none;
      color: #032338;
      font-weight: 700;
      background: linear-gradient(120deg, #64bcff, #8be1ce);
      box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.15), 0 6px 18px var(--glow);
    }

    button:disabled {
      opacity: 0.55;
      cursor: not-allowed;
      transform: none;
      box-shadow: none;
    }

    .status {
      margin: 12px 0 0;
      border-radius: 10px;
      border: 1px solid var(--border);
      background: rgba(9, 21, 34, 0.78);
      padding: 10px;
      color: var(--muted);
    }

    .status.ok { color: var(--ok); }
    .status.warn { color: var(--warn); }
    .status.bad { color: var(--bad); }

    .cards {
      display: grid;
      gap: 10px;
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
    }

    .card {
      border: 1px solid var(--border);
      border-radius: 12px;
      background: linear-gradient(160deg, rgba(14, 35, 55, 0.95), rgba(9, 20, 33, 0.95));
      padding: 10px;
    }

    .card p {
      margin: 0;
      color: var(--muted);
      font-size: 0.76rem;
      text-transform: uppercase;
      letter-spacing: 0.7px;
    }

    .card strong {
      display: block;
      margin-top: 6px;
      font-size: 1.12rem;
      color: #f4f9ff;
    }

    .meter-wrap {
      margin-top: 8px;
      width: 100%;
      height: 7px;
      border-radius: 999px;
      overflow: hidden;
      background: rgba(18, 38, 57, 0.9);
      border: 1px solid #2e4a63;
    }

    .meter-fill {
      height: 100%;
      width: 0;
      background: linear-gradient(90deg, #45c7ff, #38e0bf);
      transition: width 240ms ease;
    }

    .list {
      display: grid;
      gap: 8px;
      margin-top: 10px;
    }

    .item {
      border: 1px solid var(--border);
      border-radius: 12px;
      background: rgba(7, 18, 31, 0.9);
      padding: 10px;
      color: var(--muted);
      line-height: 1.35;
      font-size: 0.9rem;
    }

    .item strong {
      color: #ecf6ff;
    }

    .azure-grid {
      display: grid;
      gap: 8px;
      grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
      margin-top: 10px;
    }

    .bar {
      border: 1px solid var(--border);
      border-radius: 10px;
      background: rgba(7, 17, 30, 0.9);
      padding: 8px;
    }

    .bar-header {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      font-size: 0.78rem;
      color: var(--muted);
      margin-bottom: 6px;
    }

    .bar-track {
      width: 100%;
      height: 8px;
      border-radius: 999px;
      overflow: hidden;
      background: rgba(20, 44, 63, 0.95);
    }

    .bar-fill {
      height: 100%;
      width: 0;
      border-radius: 999px;
      background: linear-gradient(90deg, #5eb7ff, #3be1c1);
      transition: width 260ms ease;
    }

    .row {
      display: grid;
      gap: 8px;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    }

    pre {
      margin: 0;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: #06101c;
      color: #d9ecff;
      padding: 10px;
      max-height: 360px;
      overflow: auto;
      white-space: pre-wrap;
      word-break: break-word;
      font-size: 0.82rem;
      line-height: 1.35;
    }

    .tiny {
      margin-top: 8px;
      color: var(--muted);
      font-size: 0.78rem;
    }

    .token {
      margin-top: 8px;
      color: #cfe6ff;
      font-size: 0.78rem;
      line-height: 1.35;
      word-break: break-all;
      border: 1px dashed #2d5070;
      border-radius: 10px;
      padding: 8px;
      background: rgba(9, 20, 32, 0.85);
    }
  </style>
</head>
<body>
  <main class="wrap">
    <section class="panel hero">
      <h1>CloudCostEnv Graphic Console</h1>
      <p>
        One-screen control center for seeded simulation and secure Azure live inventory.
        Press Enter in the scenario box to run a seeded flow. Shift+Enter adds a new line.
      </p>
      <div class="hero-grid">
        <div class="hero-pill"><span>Simulation</span><strong>Deterministic and safe</strong></div>
        <div class="hero-pill"><span>Azure</span><strong>User-approved secure connect</strong></div>
        <div class="hero-pill"><span>Flow</span><strong>Preview, dry, apply, step</strong></div>
        <div class="hero-pill"><span>Telemetry</span><strong>Visual cards and bars</strong></div>
      </div>
    </section>

    <section class="grid-2">
      <div class="panel">
        <h2>Scenario Input</h2>
        <p class="tiny">Submit JSON or key-value text.</p>
        <label for="scenarioInput">Single Input</label>
        <textarea id="scenarioInput"></textarea>
        <p class="hint">
          Modes: preview, dry, apply, step.<br/>
          JSON: {"task":"cleanup","seed":42,"mode":"dry"}<br/>
          Key-value: task=rightsize seed=123 mode=step command=skip
        </p>
        <div class="buttons">
          <button class="primary" id="runBtn">Run Seeded Flow</button>
          <button id="previewExampleBtn">Preview</button>
          <button id="dryExampleBtn">Dry</button>
          <button id="stepExampleBtn">Step</button>
          <button id="autoDemoBtn">Auto Demo</button>
        </div>
        <p id="status" class="status">Ready.</p>
      </div>

      <div class="panel">
        <h2>Run Summary</h2>
        <p class="tiny">Instant visual readout for latest run.</p>
        <div class="cards" id="stats"></div>
        <div class="meter-wrap" style="margin-top:12px;">
          <div id="savingsMeter" class="meter-fill"></div>
        </div>
        <p class="tiny" id="meterText">Potential savings meter is waiting for a run.</p>
      </div>
    </section>

    <section class="panel">
      <h2>Top Recommendations</h2>
      <div class="list" id="recommendations"></div>
    </section>

    <section class="panel">
      <h2>Azure Secure Connect</h2>
      <p class="tiny">
        This uses secure Azure identity flow. No raw credentials are entered in this UI.
        You must explicitly request approval and confirm consent before connect.
      </p>
      <div class="row" style="margin-top:10px;">
        <div>
          <label for="azureSubscription">Subscription ID</label>
          <input id="azureSubscription" placeholder="00000000-0000-0000-0000-000000000000" />
        </div>
        <div>
          <label for="azureResourceGroup">Resource Group (optional)</label>
          <input id="azureResourceGroup" placeholder="rg-production" />
        </div>
        <div>
          <label for="azureTenant">Tenant ID (optional)</label>
          <input id="azureTenant" placeholder="11111111-1111-1111-1111-111111111111" />
        </div>
        <div>
          <label for="azureMaxResources">Max Resources Sampled</label>
          <input id="azureMaxResources" type="number" value="200" min="10" max="1000" />
        </div>
      </div>
      <div class="tiny" style="margin-top:10px;">
        <input type="checkbox" id="azureApprove" />
        <label for="azureApprove" style="display:inline;color:#cde3f9;">
          I approve this app to connect to my Azure subscription and read inventory.
        </label>
      </div>
      <div class="buttons" style="margin-top:10px;">
        <button id="azureApprovalBtn">1) Request Approval Token</button>
        <button class="primary" id="azureConnectBtn">2) Connect Azure</button>
        <button id="azureRefreshBtn">Refresh Azure Dashboard</button>
      </div>
      <div id="azureToken" class="token">No approval token issued yet.</div>
      <p id="azureStatus" class="status">Azure dashboard not connected.</p>

      <div class="azure-grid" id="azureTypeBars"></div>
      <div class="list" id="azureRecommendations"></div>
      <div class="list" id="azureSamples"></div>
    </section>

    <section class="panel">
      <h2>Raw Output</h2>
      <pre id="output">{}</pre>
    </section>
  </main>

  <script>
    const DEFAULT_INPUT = `{
  "task": "full_optimization",
  "seed": 777,
  "mode": "preview"
}`;

    const PREVIEW_EXAMPLE = `{
  "task": "full_optimization",
  "seed": 777,
  "mode": "preview"
}`;

    const DRY_EXAMPLE = `{
  "task": "full_optimization",
  "seed": 777,
  "mode": "dry"
}`;

    const STEP_EXAMPLE = `{
  "task": "cleanup",
  "seed": 42,
  "mode": "step",
  "command": "skip",
  "resource_id": "",
  "params": {}
}`;

    const byId = (id) => document.getElementById(id);
    const inputEl = byId("scenarioInput");
    const statusEl = byId("status");
    const outputEl = byId("output");
    const statsEl = byId("stats");
    const recsEl = byId("recommendations");
    const meterEl = byId("savingsMeter");
    const meterTextEl = byId("meterText");
    const azureStatusEl = byId("azureStatus");
    const azureTokenEl = byId("azureToken");
    const azureTypeBarsEl = byId("azureTypeBars");
    const azureRecsEl = byId("azureRecommendations");
    const azureSamplesEl = byId("azureSamples");

    let busy = false;
    let azureApprovalToken = null;

    inputEl.value = DEFAULT_INPUT;

    function setBusy(nextBusy) {
      busy = nextBusy;
      document.querySelectorAll("button").forEach((btn) => {
        btn.disabled = nextBusy;
      });
    }

    function setStatus(message, mode) {
      statusEl.textContent = message;
      statusEl.className = `status ${mode || ""}`.trim();
    }

    function setAzureStatus(message, mode) {
      azureStatusEl.textContent = message;
      azureStatusEl.className = `status ${mode || ""}`.trim();
    }

    function renderJson(data) {
      outputEl.textContent = JSON.stringify(data, null, 2);
    }

    function fmtMoney(value) {
      return `$${Number(value || 0).toFixed(2)}`;
    }

    function normalizeValue(raw) {
      const value = String(raw).trim();
      if (!value) {
        return "";
      }
      if (value === "true") {
        return true;
      }
      if (value === "false") {
        return false;
      }
      const asNumber = Number(value);
      if (Number.isFinite(asNumber) && /^-?\d+(\.\d+)?$/.test(value)) {
        return asNumber;
      }
      if ((value.startsWith("{") && value.endsWith("}")) || (value.startsWith("[") && value.endsWith("]"))) {
        try {
          return JSON.parse(value);
        } catch {
          return value;
        }
      }
      return value.replace(/^"|"$/g, "").replace(/^'|'$/g, "");
    }

    function parseKeyValueInput(raw) {
      const parsed = {};
      const normalized = String(raw || "").replace(/,/g, "\\n");
      const lines = normalized.split("\\n");

      for (const lineRaw of lines) {
        const line = lineRaw.trim();
        if (!line) {
          continue;
        }

        const eq = line.indexOf("=");
        const colon = line.indexOf(":");
        const splitIndex = eq >= 0 ? eq : colon;
        if (splitIndex <= 0) {
          continue;
        }

        const key = line.slice(0, splitIndex).trim();
        const valueRaw = line.slice(splitIndex + 1).trim();
        if (!key) {
          continue;
        }

        parsed[key] = normalizeValue(valueRaw);
      }

      return parsed;
    }

    function parseInput(raw) {
      const fallback = {
        task: "full_optimization",
        seed: 777,
        mode: "preview"
      };

      const textRaw = String(raw || "").trim();
      let text = textRaw;

      if ((text.startsWith("'") && text.endsWith("'")) || (text.startsWith('"') && text.endsWith('"'))) {
        text = text.slice(1, -1).trim();
      }

      if (!text) {
        return fallback;
      }

      let data = null;
      try {
        const json = JSON.parse(text);
        if (json && typeof json === "object") {
          data = json;
        }
      } catch {
        data = parseKeyValueInput(text);
      }

      const merged = { ...fallback, ...(data || {}) };
      merged.task = String(merged.task || fallback.task).trim() || fallback.task;
      merged.mode = String(merged.mode || fallback.mode).toLowerCase().trim() || fallback.mode;

      if (!["preview", "dry", "apply", "step"].includes(merged.mode)) {
        merged.mode = "preview";
      }

      const seedValue = Number(merged.seed);
      merged.seed = Number.isFinite(seedValue) ? seedValue : fallback.seed;

      if (merged.params == null) {
        merged.params = {};
      }
      if (typeof merged.params === "string") {
        try {
          merged.params = JSON.parse(merged.params);
        } catch {
          merged.params = {};
        }
      }
      if (typeof merged.params !== "object" || Array.isArray(merged.params)) {
        merged.params = {};
      }

      if (merged.apply == null) {
        merged.apply = merged.mode === "apply";
      }

      return merged;
    }

    async function api(path, method = "GET", body = null) {
      const options = {
        method,
        headers: { "Content-Type": "application/json" }
      };
      if (body !== null) {
        options.body = JSON.stringify(body);
      }

      const response = await fetch(path, options);
      const rawText = await response.text();
      let payload = rawText;
      try {
        payload = JSON.parse(rawText);
      } catch {
        payload = rawText;
      }

      if (!response.ok) {
        const message = typeof payload === "object" ? JSON.stringify(payload) : String(payload);
        throw new Error(message || `HTTP ${response.status}`);
      }

      return payload;
    }

    function renderSummary(result) {
      const savings = Number(result.live_dashboard.potential_monthly_savings_usd || 0);
      const currentCost = Number(result.state.current_monthly_cost || 0);
      const savingsRatio = currentCost > 0 ? Math.min(100, (savings / currentCost) * 100) : 0;

      const cards = [
        ["Task", result.config.task],
        ["Seed", String(result.config.seed)],
        ["Mode", result.config.mode],
        ["Current Cost", fmtMoney(currentCost)],
        ["Potential Savings", fmtMoney(savings)],
        ["Recommendations", String((result.live_dashboard.recommendations || []).length)]
      ];

      statsEl.innerHTML = "";
      for (const [label, value] of cards) {
        const el = document.createElement("article");
        el.className = "card";
        el.innerHTML = `<p>${label}</p><strong>${value}</strong>`;
        statsEl.appendChild(el);
      }

      meterEl.style.width = `${savingsRatio.toFixed(1)}%`;
      meterTextEl.textContent = `Savings pressure: ${savingsRatio.toFixed(1)}% of current monthly cost.`;
    }

    function renderRecommendations(live) {
      recsEl.innerHTML = "";
      const recs = live.recommendations || [];
      if (!recs.length) {
        recsEl.innerHTML = "<div class='item'>No recommendations available right now.</div>";
        return;
      }

      for (const rec of recs.slice(0, 6)) {
        const item = document.createElement("div");
        item.className = "item";
        item.innerHTML =
          `<strong>${rec.action_type}</strong> on <strong>${rec.resource_id}</strong><br/>` +
          `${rec.reason}<br/>` +
          `Risk: ${rec.risk} | Estimated monthly savings: ${fmtMoney(rec.estimated_monthly_savings_usd)}`;
        recsEl.appendChild(item);
      }
    }

    async function runScenario() {
      if (busy) {
        return;
      }

      let config;
      try {
        config = parseInput(inputEl.value);
      } catch (err) {
        setStatus(`Input parse failed: ${err.message}`, "bad");
        return;
      }

      try {
        setBusy(true);
        setStatus("Running seeded test flow...", "warn");

        const health = await api("/health");
        const reset = await api("/reset", "POST", { task_name: config.task, seed: config.seed });
        const profile = await api(`/profile?task_name=${encodeURIComponent(config.task)}&seed=${encodeURIComponent(String(config.seed))}`);
        const live = await api(`/live/dashboard?task_name=${encodeURIComponent(config.task)}&seed=${encodeURIComponent(String(config.seed))}`);

        let actionResult = null;
        if (config.mode === "dry" || config.mode === "apply") {
          const topRec = live.recommendations && live.recommendations.length ? live.recommendations[0] : null;
          const chosenAction = config.action_type || (topRec ? topRec.action_type : null);
          const chosenResource = config.resource_id || (topRec ? topRec.resource_id : null);

          if (chosenAction && chosenResource) {
            actionResult = await api("/live/action", "POST", {
              action_type: chosenAction,
              resource_id: chosenResource,
              apply: Boolean(config.apply)
            });
          }
        }

        if (config.mode === "step") {
          const command = String(config.command || "skip");
          const resourceId = String(config.resource_id || "");
          actionResult = await api("/step", "POST", {
            command,
            resource_id: resourceId,
            params: config.params || {}
          });
        }

        const state = await api("/state");

        const result = {
          config,
          health,
          reset,
          profile,
          live_dashboard: live,
          action_result: actionResult,
          state
        };

        renderSummary(result);
        renderRecommendations(live);
        renderJson(result);
        setStatus("Done. Graphic summary updated.", "ok");
      } catch (err) {
        setStatus(`Run failed: ${err.message}`, "bad");
        renderJson({ error: String(err.message || err), input: config || null });
      } finally {
        setBusy(false);
      }
    }

    function renderAzureBars(typeCounts) {
      azureTypeBarsEl.innerHTML = "";
      const entries = Object.entries(typeCounts || {}).sort((a, b) => b[1] - a[1]).slice(0, 10);
      if (!entries.length) {
        azureTypeBarsEl.innerHTML = "<div class='item'>No Azure resource type data yet.</div>";
        return;
      }

      const maxValue = entries[0][1] || 1;
      for (const [resourceType, count] of entries) {
        const bar = document.createElement("div");
        bar.className = "bar";
        const width = Math.max(4, (count / maxValue) * 100);
        bar.innerHTML =
          `<div class='bar-header'><span>${resourceType}</span><span>${count}</span></div>` +
          `<div class='bar-track'><div class='bar-fill' style='width:${width}%;'></div></div>`;
        azureTypeBarsEl.appendChild(bar);
      }
    }

    function renderAzureRecommendations(recommendations) {
      azureRecsEl.innerHTML = "";
      const recs = recommendations || [];
      if (!recs.length) {
        azureRecsEl.innerHTML = "<div class='item'>No Azure recommendations available yet.</div>";
        return;
      }

      for (const rec of recs.slice(0, 6)) {
        const row = document.createElement("div");
        row.className = "item";
        row.innerHTML =
          `<strong>${rec.title}</strong><br/>` +
          `Severity: ${rec.severity}<br/>` +
          `${rec.reason}<br/>` +
          `Action: ${rec.action}`;
        azureRecsEl.appendChild(row);
      }
    }

    function renderAzureSamples(samples, dashboard) {
      azureSamplesEl.innerHTML = "";
      const info = document.createElement("div");
      info.className = "item";
      info.innerHTML =
        `<strong>Azure scope</strong><br/>` +
        `Subscription: ${dashboard.subscription_id || "n/a"}<br/>` +
        `Tenant: ${dashboard.tenant_id || "n/a"}<br/>` +
        `Resource group: ${dashboard.resource_group || "(all)"}<br/>` +
        `Sampled resources: ${dashboard.sampled_resources || 0}`;
      azureSamplesEl.appendChild(info);

      const list = samples || [];
      for (const item of list.slice(0, 8)) {
        const row = document.createElement("div");
        row.className = "item";
        row.innerHTML =
          `<strong>${item.name}</strong><br/>` +
          `${item.resource_type}<br/>` +
          `RG: ${item.resource_group || "n/a"} | Region: ${item.location || "n/a"}`;
        azureSamplesEl.appendChild(row);
      }
    }

    function renderAzureDashboard(dashboard) {
      renderAzureBars(dashboard.resource_type_counts || {});
      renderAzureRecommendations(dashboard.recommendations || []);
      renderAzureSamples(dashboard.sample_resources || [], dashboard);
      renderJson({
        source: "azure",
        dashboard
      });

      if (dashboard.connected) {
        setAzureStatus("Azure connected and inventory loaded.", "ok");
      } else {
        const notes = dashboard.notes || [];
        setAzureStatus(notes.length ? notes[0] : "Azure is not connected.", "warn");
      }
    }

    async function requestAzureApproval() {
      try {
        setAzureStatus("Requesting approval token...", "warn");
        const approval = await api("/azure/approval");
        azureApprovalToken = approval.token;
        azureTokenEl.textContent = `Token: ${approval.token} | Expires: ${approval.expires_at}`;
        setAzureStatus("Approval token ready. Check consent and connect.", "ok");
      } catch (err) {
        setAzureStatus(`Approval failed: ${err.message}`, "bad");
      }
    }

    async function connectAzure() {
      const approved = byId("azureApprove").checked;
      if (!approved) {
        setAzureStatus("Consent checkbox is required before connect.", "bad");
        return;
      }
      if (!azureApprovalToken) {
        setAzureStatus("Request approval token first.", "warn");
        return;
      }

      const subscriptionId = String(byId("azureSubscription").value || "").trim();
      const resourceGroup = String(byId("azureResourceGroup").value || "").trim();
      const tenantId = String(byId("azureTenant").value || "").trim();
      const maxResources = Number(byId("azureMaxResources").value || 200);

      if (!subscriptionId) {
        setAzureStatus("Subscription ID is required.", "bad");
        return;
      }

      try {
        setAzureStatus("Connecting to Azure securely...", "warn");
        const payload = {
          approved: true,
          approval_token: azureApprovalToken,
          subscription_id: subscriptionId,
          resource_group: resourceGroup || null,
          tenant_id: tenantId || null,
          max_resources: Number.isFinite(maxResources) ? Math.min(1000, Math.max(10, maxResources)) : 200
        };

        const dashboard = await api("/azure/connect", "POST", payload);
        renderAzureDashboard(dashboard);
        azureApprovalToken = null;
        azureTokenEl.textContent = "Token consumed. Request a new approval token for another connect action.";
      } catch (err) {
        setAzureStatus(`Azure connect failed: ${err.message}`, "bad");
      }
    }

    async function refreshAzureDashboard() {
      try {
        setAzureStatus("Refreshing Azure dashboard...", "warn");
        const dashboard = await api("/azure/dashboard");
        renderAzureDashboard(dashboard);
      } catch (err) {
        setAzureStatus(`Refresh failed: ${err.message}`, "bad");
      }
    }

    async function runAutoDemo() {
      if (busy) {
        return;
      }
      try {
        setBusy(true);
        inputEl.value = PREVIEW_EXAMPLE;
        await runScenario();
        inputEl.value = DRY_EXAMPLE;
        await runScenario();
        setStatus("Auto demo finished: preview then dry run.", "ok");
      } finally {
        setBusy(false);
      }
    }

    byId("runBtn").onclick = runScenario;
    byId("previewExampleBtn").onclick = () => { inputEl.value = PREVIEW_EXAMPLE; };
    byId("dryExampleBtn").onclick = () => { inputEl.value = DRY_EXAMPLE; };
    byId("stepExampleBtn").onclick = () => { inputEl.value = STEP_EXAMPLE; };
    byId("autoDemoBtn").onclick = runAutoDemo;

    byId("azureApprovalBtn").onclick = requestAzureApproval;
    byId("azureConnectBtn").onclick = connectAzure;
    byId("azureRefreshBtn").onclick = refreshAzureDashboard;

    inputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        runScenario();
      }
    });

    (async () => {
      try {
        const payload = await api("/health");
        setStatus(`Connected: ${payload.status}`, "ok");
      } catch {
        setStatus("Backend not reachable", "bad");
      }

      try {
        const dashboard = await api("/azure/dashboard");
        renderAzureDashboard(dashboard);
      } catch {
        setAzureStatus("Azure dashboard endpoint unavailable.", "bad");
      }
    })();
  </script>
</body>
</html>
"""
