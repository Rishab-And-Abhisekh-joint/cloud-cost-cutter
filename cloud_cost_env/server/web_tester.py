TESTER_HTML = """<!doctype html>
<html lang=\"en\">
<head>
  <meta charset=\"utf-8\" />
  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />
  <title>CloudCostEnv Test Console</title>
  <style>
    :root {
      --bg: #081424;
      --panel: #11263d;
      --text: #e8f0f8;
      --muted: #93acc4;
      --ok: #39d98a;
      --warn: #ffcc66;
      --bad: #ff6d6d;
      --accent: #4da3ff;
      --border: #2a4460;
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      font-family: "Segoe UI", Tahoma, sans-serif;
      background: radial-gradient(circle at 20% 10%, #17385a 0%, transparent 35%),
                  radial-gradient(circle at 80% 0%, #2d2f46 0%, transparent 40%),
                  var(--bg);
      color: var(--text);
    }

    .shell {
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px;
      display: grid;
      gap: 14px;
    }

    .hero {
      border: 1px solid var(--border);
      border-radius: 14px;
      background: rgba(17, 38, 61, 0.75);
      padding: 16px;
    }

    .hero h1 {
      margin: 0;
      font-size: 1.6rem;
    }

    .hero p {
      margin: 8px 0 0;
      color: var(--muted);
    }

    .grid {
      display: grid;
      gap: 14px;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    }

    .panel {
      border: 1px solid var(--border);
      border-radius: 14px;
      background: rgba(17, 38, 61, 0.75);
      padding: 14px;
    }

    .panel h2 {
      margin: 0 0 10px;
      font-size: 1.1rem;
    }

    .row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 10px;
    }

    label {
      display: grid;
      gap: 6px;
      color: var(--muted);
      font-size: 0.88rem;
      min-width: 150px;
      flex: 1;
    }

    input, select, textarea, button {
      font: inherit;
      border-radius: 10px;
      border: 1px solid var(--border);
    }

    input, select, textarea {
      color: var(--text);
      background: #0d1f33;
      padding: 8px 10px;
    }

    textarea {
      min-height: 72px;
      resize: vertical;
      width: 100%;
    }

    button {
      background: #123251;
      color: var(--text);
      padding: 8px 12px;
      cursor: pointer;
    }

    button.primary {
      background: linear-gradient(120deg, #3f90ff, #63b6ff);
      color: #061423;
      border: none;
      font-weight: 700;
    }

    button:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    .status {
      margin: 0;
      padding: 8px 10px;
      border-radius: 10px;
      border: 1px solid var(--border);
      background: #0d1f33;
      color: var(--muted);
    }

    .status.ok { color: var(--ok); }
    .status.warn { color: var(--warn); }
    .status.bad { color: var(--bad); }

    pre {
      margin: 10px 0 0;
      border: 1px solid var(--border);
      border-radius: 10px;
      background: #091728;
      padding: 10px;
      max-height: 380px;
      overflow: auto;
      font-size: 0.84rem;
      line-height: 1.35;
      color: #d5e9ff;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .cards {
      display: grid;
      gap: 10px;
      margin-top: 10px;
    }

    .card {
      border: 1px solid var(--border);
      border-radius: 10px;
      background: #0d1f33;
      padding: 10px;
    }

    .card p {
      margin: 0 0 6px;
      color: var(--muted);
      font-size: 0.88rem;
    }

    .card strong {
      color: var(--text);
    }

    .tiny {
      color: var(--muted);
      font-size: 0.82rem;
      margin: 0;
    }
  </style>
</head>
<body>
  <main class=\"shell\">
    <section class=\"hero\">
      <h1>CloudCostEnv Test Console</h1>
      <p>Use this UI to test reset, step, state, profile, and live action flows without external tooling.</p>
    </section>

    <section class=\"grid\">
      <article class=\"panel\">
        <h2>Episode Controls</h2>
        <div class=\"row\">
          <label>
            Task
            <select id=\"task\">
              <option value=\"cleanup\">cleanup</option>
              <option value=\"rightsize\">rightsize</option>
              <option value=\"full_optimization\" selected>full_optimization</option>
            </select>
          </label>
          <label>
            Seed
            <input id=\"seed\" value=\"777\" />
          </label>
        </div>
        <div class=\"row\">
          <button class=\"primary\" id=\"resetBtn\">Reset Episode</button>
          <button id=\"healthBtn\">Health</button>
          <button id=\"profileBtn\">Profile</button>
          <button id=\"stateBtn\">State</button>
        </div>
      </article>

      <article class=\"panel\">
        <h2>Manual Step Action</h2>
        <div class=\"row\">
          <label>
            Command
            <select id=\"command\">
              <option>terminate</option>
              <option>rightsize</option>
              <option>stop</option>
              <option>schedule</option>
              <option>delete_snapshot</option>
              <option>purchase_reservation</option>
              <option selected>detach_ip</option>
              <option>release_ip</option>
              <option>skip</option>
              <option>inspect</option>
            </select>
          </label>
          <label>
            Resource ID
            <input id=\"resourceId\" placeholder=\"i-full-008 / vol-full-000 / ...\" />
          </label>
        </div>
        <label>
          Params JSON
          <textarea id=\"params\">{}</textarea>
        </label>
        <div class=\"row\">
          <button class=\"primary\" id=\"stepBtn\">Run Step</button>
        </div>
      </article>

      <article class=\"panel\">
        <h2>Live Dashboard Actions</h2>
        <div class=\"row\">
          <button class=\"primary\" id=\"liveBtn\">Load Recommendations</button>
        </div>
        <p class=\"tiny\" id=\"liveMeta\">No live data loaded.</p>
        <div class=\"cards\" id=\"recommendations\"></div>
      </article>

      <article class=\"panel\" style=\"grid-column: 1 / -1;\">
        <h2>API Output</h2>
        <p id=\"status\" class=\"status\">Ready.</p>
        <pre id=\"output\">{}</pre>
      </article>
    </section>
  </main>

  <script>
    const byId = (id) => document.getElementById(id);
    const statusEl = byId("status");
    const outputEl = byId("output");
    const recsEl = byId("recommendations");
    const liveMetaEl = byId("liveMeta");
    let busy = false;

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

    function showOutput(title, data) {
      outputEl.textContent = JSON.stringify({ title, data }, null, 2);
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
      const text = await response.text();
      let parsed = text;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }

      if (!response.ok) {
        const message = typeof parsed === "object" ? JSON.stringify(parsed) : String(parsed);
        throw new Error(message || `HTTP ${response.status}`);
      }

      return parsed;
    }

    function currentTaskSeed() {
      const taskName = byId("task").value;
      const seedRaw = byId("seed").value.trim();
      const seed = seedRaw === "" ? null : Number(seedRaw);
      return { taskName, seed: Number.isFinite(seed) ? seed : null };
    }

    async function loadLiveRecommendations() {
      const { taskName, seed } = currentTaskSeed();
      const params = new URLSearchParams({ task_name: taskName });
      if (seed !== null) {
        params.set("seed", String(seed));
      }

      const payload = await api(`/live/dashboard?${params.toString()}`);
      liveMetaEl.textContent =
        `Region ${payload.region} | Potential savings $${payload.potential_monthly_savings_usd.toFixed(2)} | ` +
        `Can apply: ${payload.can_apply_actions ? "yes" : "no"}`;

      recsEl.innerHTML = "";
      const recs = payload.recommendations || [];
      if (!recs.length) {
        recsEl.innerHTML = "<p class='tiny'>No recommendations returned.</p>";
        return payload;
      }

      for (const rec of recs) {
        const card = document.createElement("div");
        card.className = "card";
        card.innerHTML =
          `<p><strong>${rec.action_type}</strong> on ${rec.resource_id}</p>` +
          `<p>${rec.reason}</p>` +
          `<p>Risk: ${rec.risk} | Est: $${rec.estimated_monthly_savings_usd.toFixed(2)}</p>`;

        const actions = document.createElement("div");
        actions.className = "row";

        const dryBtn = document.createElement("button");
        dryBtn.textContent = "Dry Run";
        dryBtn.onclick = async () => {
          await runLiveAction(rec.action_type, rec.resource_id, false);
        };

        const applyBtn = document.createElement("button");
        applyBtn.textContent = "Apply";
        applyBtn.className = "primary";
        applyBtn.disabled = !payload.can_apply_actions;
        applyBtn.onclick = async () => {
          await runLiveAction(rec.action_type, rec.resource_id, true);
        };

        actions.appendChild(dryBtn);
        actions.appendChild(applyBtn);
        card.appendChild(actions);
        recsEl.appendChild(card);
      }

      return payload;
    }

    async function runLiveAction(actionType, resourceId, apply) {
      if (busy) {
        return;
      }
      try {
        setBusy(true);
        setStatus(`Running ${apply ? "apply" : "dry-run"} action...`, "warn");
        const payload = await api("/live/action", "POST", {
          action_type: actionType,
          resource_id: resourceId,
          apply
        });
        setStatus(payload.message || "Live action complete", payload.ok ? "ok" : "bad");
        showOutput("live_action", payload);
        await loadLiveRecommendations();
      } catch (err) {
        setStatus(`Live action failed: ${err.message}`, "bad");
      } finally {
        setBusy(false);
      }
    }

    byId("healthBtn").onclick = async () => {
      if (busy) return;
      try {
        setBusy(true);
        const payload = await api("/health");
        setStatus("Health check passed", "ok");
        showOutput("health", payload);
      } catch (err) {
        setStatus(`Health failed: ${err.message}`, "bad");
      } finally {
        setBusy(false);
      }
    };

    byId("resetBtn").onclick = async () => {
      if (busy) return;
      const { taskName, seed } = currentTaskSeed();
      try {
        setBusy(true);
        setStatus("Resetting episode...", "warn");
        const payload = await api("/reset", "POST", { task_name: taskName, seed });
        setStatus(`Episode reset for ${taskName}`, "ok");
        showOutput("reset", payload);
        await loadLiveRecommendations();
      } catch (err) {
        setStatus(`Reset failed: ${err.message}`, "bad");
      } finally {
        setBusy(false);
      }
    };

    byId("profileBtn").onclick = async () => {
      if (busy) return;
      const { taskName, seed } = currentTaskSeed();
      const params = new URLSearchParams({ task_name: taskName });
      if (seed !== null) {
        params.set("seed", String(seed));
      }
      try {
        setBusy(true);
        const payload = await api(`/profile?${params.toString()}`);
        setStatus("Profile loaded", "ok");
        showOutput("profile", payload);
      } catch (err) {
        setStatus(`Profile failed: ${err.message}`, "bad");
      } finally {
        setBusy(false);
      }
    };

    byId("stateBtn").onclick = async () => {
      if (busy) return;
      try {
        setBusy(true);
        const payload = await api("/state");
        setStatus("State loaded", "ok");
        showOutput("state", payload);
      } catch (err) {
        setStatus(`State failed: ${err.message}`, "bad");
      } finally {
        setBusy(false);
      }
    };

    byId("stepBtn").onclick = async () => {
      if (busy) return;
      const command = byId("command").value;
      const resourceId = byId("resourceId").value.trim();
      let params = {};
      try {
        params = JSON.parse(byId("params").value || "{}");
      } catch {
        setStatus("Params must be valid JSON", "bad");
        return;
      }

      try {
        setBusy(true);
        setStatus("Running step...", "warn");
        const payload = await api("/step", "POST", {
          command,
          resource_id: resourceId,
          params
        });
        setStatus(`Step complete. Reward ${payload.reward}`, "ok");
        showOutput("step", payload);
        await loadLiveRecommendations();
      } catch (err) {
        setStatus(`Step failed: ${err.message}`, "bad");
      } finally {
        setBusy(false);
      }
    };

    byId("liveBtn").onclick = async () => {
      if (busy) return;
      try {
        setBusy(true);
        setStatus("Loading live dashboard...", "warn");
        const payload = await loadLiveRecommendations();
        setStatus(`Loaded ${payload.recommendations.length} recommendations`, "ok");
        showOutput("live_dashboard", payload);
      } catch (err) {
        setStatus(`Live dashboard failed: ${err.message}`, "bad");
      } finally {
        setBusy(false);
      }
    };

    (async () => {
      try {
        const health = await api("/health");
        setStatus(`Connected: ${health.status}`, "ok");
      } catch {
        setStatus("Backend not reachable", "bad");
      }
    })();
  </script>
</body>
</html>
"""