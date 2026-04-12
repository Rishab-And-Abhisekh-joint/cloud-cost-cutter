TESTER_HTML = """<!doctype html>
<html lang=\"en\">
<head>
  <meta charset=\"utf-8\" />
  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />
  <title>CloudCostEnv One-Input Tester</title>
  <style>
    :root {
      --bg: #0a1422;
      --panel: #12243a;
      --panel-soft: #0f2033;
      --text: #e8eff7;
      --muted: #9db0c3;
      --accent: #5db7ff;
      --ok: #38d68f;
      --warn: #ffcc66;
      --bad: #ff7575;
      --border: #29415d;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      color: var(--text);
      font-family: \"Segoe UI\", Tahoma, sans-serif;
      background: radial-gradient(circle at 15% 0%, #1d3a5b 0%, transparent 42%),
                  radial-gradient(circle at 95% 0%, #2a354c 0%, transparent 35%),
                  var(--bg);
    }

    .page {
      max-width: 980px;
      margin: 0 auto;
      padding: 24px 16px 40px;
      display: grid;
      gap: 14px;
    }

    .panel {
      border: 1px solid var(--border);
      border-radius: 14px;
      background: rgba(18, 36, 58, 0.85);
      padding: 14px;
    }

    .hero h1 {
      margin: 0;
      font-size: clamp(1.4rem, 3vw, 2rem);
    }

    .hero p {
      margin: 10px 0 0;
      color: var(--muted);
      line-height: 1.4;
    }

    .hero code {
      color: #d8e8ff;
      background: #0c1a2b;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 0 4px;
    }

    label {
      display: block;
      color: var(--muted);
      font-size: 0.9rem;
      margin-bottom: 8px;
    }

    textarea,
    button {
      font: inherit;
      border-radius: 10px;
    }

    textarea {
      width: 100%;
      min-height: 170px;
      padding: 10px;
      resize: vertical;
      color: var(--text);
      background: #0e1e31;
      border: 1px solid var(--border);
      line-height: 1.35;
    }

    .hint {
      margin: 8px 0 0;
      color: var(--muted);
      font-size: 0.84rem;
      line-height: 1.35;
    }

    .actions {
      margin-top: 12px;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    button {
      padding: 8px 12px;
      color: var(--text);
      background: #10304d;
      border: 1px solid var(--border);
      cursor: pointer;
    }

    button.primary {
      border: none;
      color: #07192a;
      font-weight: 700;
      background: linear-gradient(120deg, #55a9ff, #86ccff);
    }

    button:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    .status {
      margin: 12px 0 0;
      padding: 10px;
      border-radius: 10px;
      background: var(--panel-soft);
      border: 1px solid var(--border);
      color: var(--muted);
    }

    .status.ok {
      color: var(--ok);
    }

    .status.warn {
      color: var(--warn);
    }

    .status.bad {
      color: var(--bad);
    }

    .stats {
      display: grid;
      gap: 10px;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    }

    .stat {
      border: 1px solid var(--border);
      border-radius: 10px;
      background: #0e1f32;
      padding: 10px;
    }

    .stat p {
      margin: 0;
      color: var(--muted);
      font-size: 0.8rem;
    }

    .stat strong {
      display: block;
      margin-top: 4px;
      color: var(--text);
      font-size: 1.05rem;
    }

    .list {
      display: grid;
      gap: 8px;
      margin-top: 8px;
    }

    .item {
      border: 1px solid var(--border);
      border-radius: 10px;
      background: #0f1f33;
      padding: 10px;
      color: var(--muted);
      font-size: 0.9rem;
      line-height: 1.35;
    }

    .item strong {
      color: var(--text);
    }

    pre {
      margin: 0;
      border: 1px solid var(--border);
      border-radius: 10px;
      background: #091524;
      padding: 10px;
      max-height: 380px;
      overflow: auto;
      color: #d8e9ff;
      font-size: 0.83rem;
      line-height: 1.35;
      white-space: pre-wrap;
      word-break: break-word;
    }
  </style>
</head>
<body>
  <main class=\"page\">
    <section class=\"panel hero\">
      <h1>CloudCostEnv One-Input Tester</h1>
      <p>
        Use one input box for everything. Default is deterministic seed data
        (<code>task=full_optimization</code>, <code>seed=777</code>).
        You can submit JSON or key-value text.
      </p>
    </section>

    <section class=\"panel\">
      <label for=\"scenarioInput\">Single Input</label>
      <textarea id=\"scenarioInput\"></textarea>
      <p class=\"hint\">
        Modes: <strong>preview</strong>, <strong>dry</strong>, <strong>apply</strong>, <strong>step</strong>.<br/>
        JSON example: {\"task\":\"cleanup\",\"seed\":42,\"mode\":\"dry\"}<br/>
        Key-value example: task=rightsize seed=123 mode=step command=skip
      </p>
      <div class=\"actions\">
        <button class=\"primary\" id=\"runBtn\">Run</button>
        <button id=\"previewExampleBtn\">Example: Preview</button>
        <button id=\"dryExampleBtn\">Example: Dry Run</button>
        <button id=\"stepExampleBtn\">Example: Step</button>
      </div>
      <p id=\"status\" class=\"status\">Ready.</p>
    </section>

    <section class=\"panel\">
      <h2 style=\"margin:0 0 10px;\">Summary</h2>
      <div class=\"stats\" id=\"stats\"></div>
    </section>

    <section class=\"panel\">
      <h2 style=\"margin:0 0 10px;\">Top Recommendations</h2>
      <div class=\"list\" id=\"recommendations\"></div>
    </section>

    <section class=\"panel\">
      <h2 style=\"margin:0 0 10px;\">Output JSON</h2>
      <pre id=\"output\">{}</pre>
    </section>
  </main>

  <script>
    const DEFAULT_INPUT = `{
  \"task\": \"full_optimization\",
  \"seed\": 777,
  \"mode\": \"preview\"
}`;

    const PREVIEW_EXAMPLE = `{
  \"task\": \"full_optimization\",
  \"seed\": 777,
  \"mode\": \"preview\"
}`;

    const DRY_EXAMPLE = `{
  \"task\": \"full_optimization\",
  \"seed\": 777,
  \"mode\": \"dry\"
}`;

    const STEP_EXAMPLE = `{
  \"task\": \"cleanup\",
  \"seed\": 42,
  \"mode\": \"step\",
  \"command\": \"skip\",
  \"resource_id\": \"\",
  \"params\": {}
}`;

    const byId = (id) => document.getElementById(id);
    const inputEl = byId("scenarioInput");
    const statusEl = byId("status");
    const outputEl = byId("output");
    const statsEl = byId("stats");
    const recsEl = byId("recommendations");

    let busy = false;
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

    function renderJson(data) {
      outputEl.textContent = JSON.stringify(data, null, 2);
    }

    function normalizeValue(raw) {
      const value = String(raw).trim();
      if (value === "true") {
        return true;
      }
      if (value === "false") {
        return false;
      }
      if (/^-?\\d+$/.test(value)) {
        return Number(value);
      }
      if ((value.startsWith("{") && value.endsWith("}")) || (value.startsWith("[") && value.endsWith("]"))) {
        try {
          return JSON.parse(value);
        } catch {
          return value;
        }
      }
      return value.replace(/^\"|\"$/g, "").replace(/^'|'$/g, "");
    }

    function parseKeyValueInput(raw) {
      const parsed = {};
      const regex = /([a-zA-Z_][a-zA-Z0-9_]*)\\s*=\\s*([^\\n,]+)/g;
      let match;
      while ((match = regex.exec(raw)) !== null) {
        parsed[match[1]] = normalizeValue(match[2]);
      }
      return parsed;
    }

    function parseInput(raw) {
      const fallback = {
        task: "full_optimization",
        seed: 777,
        mode: "preview"
      };

      const text = String(raw || "").trim();
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
      const cards = [
        ["Task", result.config.task],
        ["Seed", String(result.config.seed)],
        ["Mode", result.config.mode],
        ["Live Recommendations", String(result.live_dashboard.recommendations.length)],
        ["Potential Savings", `$${Number(result.live_dashboard.potential_monthly_savings_usd || 0).toFixed(2)}`],
        ["Last Action", result.action_result ? (result.action_result.message || "done") : "none"]
      ];

      statsEl.innerHTML = "";
      for (const [label, value] of cards) {
        const el = document.createElement("article");
        el.className = "stat";
        el.innerHTML = `<p>${label}</p><strong>${value}</strong>`;
        statsEl.appendChild(el);
      }
    }

    function renderRecommendations(live) {
      recsEl.innerHTML = "";
      const recs = live.recommendations || [];
      if (!recs.length) {
        recsEl.innerHTML = "<div class='item'>No recommendations available.</div>";
        return;
      }

      for (const rec of recs.slice(0, 6)) {
        const item = document.createElement("div");
        item.className = "item";
        item.innerHTML =
          `<strong>${rec.action_type}</strong> on <strong>${rec.resource_id}</strong><br/>` +
          `${rec.reason}<br/>` +
          `Risk: ${rec.risk} | Estimated monthly savings: $${Number(rec.estimated_monthly_savings_usd || 0).toFixed(2)}`;
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
          const chosenAction = config.action_type || (live.recommendations[0] ? live.recommendations[0].action_type : null);
          const chosenResource = config.resource_id || (live.recommendations[0] ? live.recommendations[0].resource_id : null);

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
        setStatus("Done. Output generated from seeded data.", "ok");
      } catch (err) {
        setStatus(`Run failed: ${err.message}`, "bad");
      } finally {
        setBusy(false);
      }
    }

    byId("runBtn").onclick = runScenario;
    byId("previewExampleBtn").onclick = () => { inputEl.value = PREVIEW_EXAMPLE; };
    byId("dryExampleBtn").onclick = () => { inputEl.value = DRY_EXAMPLE; };
    byId("stepExampleBtn").onclick = () => { inputEl.value = STEP_EXAMPLE; };

    (async () => {
      try {
        const payload = await api("/health");
        setStatus(`Connected: ${payload.status}`, "ok");
      } catch {
        setStatus("Backend not reachable", "bad");
      }
    })();
  </script>
</body>
</html>
"""
