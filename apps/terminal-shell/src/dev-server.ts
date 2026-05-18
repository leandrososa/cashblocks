import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import {
  getFlowManifest,
  readJournalHistory,
  runSimulation,
  type SimulationRequest
} from "./simulation.js";

const port = Number(process.env.PORT ?? 4173);

const server = createServer(async (request, response) => {
  try {
    await route(request, response);
  } catch (error) {
    writeJson(response, 500, {
      error: error instanceof Error ? error.message : "Unexpected server error"
    });
  }
});

server.listen(port, () => {
  console.log(`Cashblocks terminal shell listening on http://localhost:${port}`);
});

async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (method === "GET" && url.pathname === "/") {
    writeHtml(response, renderApp());
    return;
  }

  if (method === "GET" && url.pathname === "/api/manifest") {
    writeJson(response, 200, getFlowManifest());
    return;
  }

  if (method === "GET" && url.pathname === "/api/journal") {
    writeJson(response, 200, await readJournalHistory(process.env.CASHBLOCKS_JOURNAL_PATH));
    return;
  }

  if (method === "POST" && url.pathname === "/api/run") {
    const body = await readJson<SimulationRequest>(request);
    const result = await runSimulation({
      ...body,
      journalPath: process.env.CASHBLOCKS_JOURNAL_PATH
    });
    writeJson(response, 200, result);
    return;
  }

  writeJson(response, 404, { error: "Not found" });
}

function writeHtml(response: ServerResponse, html: string): void {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(html);
}

function writeJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload, null, 2));
}

async function readJson<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {} as T;
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

function renderApp(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Cashblocks Terminal Shell</title>
    <style>
      :root {
        color-scheme: dark;
        --ink: #fff8ec;
        --muted: #b9ad9b;
        --line: rgba(255, 248, 236, 0.16);
        --panel: rgba(18, 30, 38, 0.86);
        --panel-strong: #101820;
        --accent: #f5b84b;
        --good: #62d48f;
        --bad: #ff776d;
      }

      * { box-sizing: border-box; }

      body {
        margin: 0;
        min-height: 100vh;
        background:
          radial-gradient(circle at 20% 0%, rgba(245, 184, 75, 0.18), transparent 32rem),
          linear-gradient(135deg, #0d151c 0%, #14242e 55%, #241b13 100%);
        color: var(--ink);
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      }

      main {
        width: min(1180px, calc(100vw - 32px));
        margin: 0 auto;
        padding: 36px 0;
      }

      header {
        display: flex;
        align-items: end;
        justify-content: space-between;
        gap: 24px;
        margin-bottom: 28px;
      }

      h1 {
        margin: 0;
        font-size: clamp(32px, 5vw, 68px);
        letter-spacing: -0.07em;
      }

      .subtitle {
        max-width: 660px;
        color: var(--muted);
        line-height: 1.55;
      }

      .grid {
        display: grid;
        grid-template-columns: 360px 1fr;
        gap: 18px;
      }

      section {
        border: 1px solid var(--line);
        background: var(--panel);
        border-radius: 24px;
        box-shadow: 0 24px 70px rgba(0, 0, 0, 0.28);
      }

      .controls {
        padding: 22px;
        position: sticky;
        top: 18px;
      }

      label {
        display: grid;
        gap: 8px;
        color: var(--muted);
        font-size: 13px;
        margin-bottom: 16px;
      }

      select, button {
        width: 100%;
        border: 1px solid var(--line);
        border-radius: 14px;
        background: #0f1a22;
        color: var(--ink);
        padding: 12px 14px;
        font: inherit;
      }

      button {
        cursor: pointer;
        background: var(--accent);
        color: #1b1308;
        border: none;
        font-weight: 800;
        margin-top: 10px;
      }

      .check {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        border-top: 1px solid var(--line);
        padding: 12px 0;
        margin: 0;
      }

      .check input {
        width: 20px;
        height: 20px;
        accent-color: var(--accent);
      }

      .output {
        overflow: hidden;
      }

      .tabs {
        display: flex;
        gap: 10px;
        margin-bottom: 18px;
      }

      .package-card {
        padding: 18px;
        margin-bottom: 18px;
      }

      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 12px;
      }

      .chip {
        display: inline-flex;
        border: 1px solid var(--line);
        border-radius: 999px;
        padding: 6px 10px;
        color: var(--muted);
        background: rgba(8, 15, 20, 0.38);
        font-size: 12px;
      }

      .tab {
        width: auto;
        padding: 10px 14px;
        background: rgba(16, 24, 32, 0.88);
        color: var(--ink);
        border: 1px solid var(--line);
      }

      .tab.active {
        background: var(--accent);
        color: #1b1308;
      }

      .summary {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 1px;
        background: var(--line);
      }

      .terminal-screen {
        margin: 22px;
        padding: 28px;
        min-height: 220px;
        border: 1px solid rgba(245, 184, 75, 0.38);
        border-radius: 22px;
        background:
          radial-gradient(circle at 85% 20%, rgba(245, 184, 75, 0.14), transparent 18rem),
          linear-gradient(160deg, #091017 0%, #0f2029 100%);
      }

      .terminal-screen .eyebrow {
        color: var(--accent);
        text-transform: uppercase;
        letter-spacing: 0.14em;
        font-size: 12px;
        margin-bottom: 18px;
      }

      .terminal-screen h2 {
        margin: 0;
        font-size: clamp(30px, 4vw, 54px);
        letter-spacing: -0.06em;
      }

      .terminal-screen p {
        max-width: 720px;
        color: var(--muted);
        line-height: 1.55;
      }

      .operator-note {
        margin-top: 18px;
        padding-top: 18px;
        border-top: 1px solid var(--line);
        color: var(--muted);
        font-size: 13px;
      }

      .metric {
        background: rgba(16, 24, 32, 0.88);
        padding: 18px;
      }

      .metric span {
        display: block;
        color: var(--muted);
        font-size: 12px;
        margin-bottom: 8px;
      }

      .metric strong {
        font-size: 18px;
      }

      .timeline {
        padding: 22px;
        display: grid;
        gap: 12px;
      }

      .event {
        display: grid;
        grid-template-columns: 72px 1fr;
        gap: 16px;
        padding: 14px;
        border: 1px solid var(--line);
        border-radius: 16px;
        background: rgba(8, 15, 20, 0.45);
      }

      .session {
        display: grid;
        gap: 8px;
        padding: 16px;
        border: 1px solid var(--line);
        border-radius: 18px;
        background: rgba(8, 15, 20, 0.45);
        margin-bottom: 12px;
      }

      .session button {
        width: fit-content;
        margin: 0;
        padding: 8px 12px;
      }

      .seq {
        color: var(--accent);
        font-weight: 800;
      }

      .type {
        font-weight: 800;
      }

      .payload {
        margin-top: 8px;
        color: var(--muted);
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        font-size: 12px;
      }

      .good { color: var(--good); }
      .bad { color: var(--bad); }

      @media (max-width: 860px) {
        header, .grid { display: block; }
        .controls { position: static; margin-bottom: 18px; }
        .summary { grid-template-columns: repeat(2, 1fr); }
      }
    </style>
  </head>
  <body>
    <main>
      <header>
        <div>
          <h1>Cashblocks Shell</h1>
          <p class="subtitle">Run the ATM demo flow against simulated terminal devices. Flip faults, run a transaction, and inspect the journal timeline.</p>
        </div>
      </header>

      <div class="tabs">
        <button class="tab active" id="runTab">Run Simulation</button>
        <button class="tab" id="historyTab">Journal History</button>
      </div>

      <div class="grid" id="runView">
        <section class="controls">
          <section class="package-card" id="packageCard">
            <strong>Loading package...</strong>
          </section>

          <label>
            Transaction
            <select id="transaction">
              <option>BalanceInquiry</option>
              <option>CashWithdrawal</option>
              <option>CashDeposit</option>
              <option>FastCash</option>
              <option>CardlessWithdrawal</option>
              <option>AdminBalanceTerminal</option>
              <option>AdminCashAdjustment</option>
              <option>AdminPrintTotals</option>
            </select>
          </label>

          <label class="check">Receipt printer out <input id="receiptPrinterOut" type="checkbox"></label>
          <label class="check">Host declined <input id="hostDeclined" type="checkbox"></label>
          <label class="check">Dispenser offline <input id="dispenserOffline" type="checkbox"></label>
          <label class="check">Acceptor offline <input id="acceptorOffline" type="checkbox"></label>
          <label class="check">Card reader offline <input id="cardReaderOffline" type="checkbox"></label>

          <label>
            Receipt warning answer
            <select id="receiptWarningAnswer">
              <option>YES</option>
              <option>NO</option>
            </select>
          </label>

          <button id="run">Run flow</button>
        </section>

        <section class="output">
          <div class="summary" id="summary"></div>
          <div class="terminal-screen" id="terminalScreen"></div>
          <div class="timeline" id="timeline"></div>
        </section>
      </div>

      <section class="output" id="historyView" hidden>
        <div class="summary" id="historySummary"></div>
        <div class="timeline" id="history"></div>
      </section>
    </main>

    <script>
      const $ = (id) => document.getElementById(id);

      $("run").addEventListener("click", run);
      $("runTab").addEventListener("click", () => showTab("run"));
      $("historyTab").addEventListener("click", () => showTab("history"));
      loadManifest();
      run();

      function showTab(tab) {
        $("runView").hidden = tab !== "run";
        $("historyView").hidden = tab !== "history";
        $("runTab").classList.toggle("active", tab === "run");
        $("historyTab").classList.toggle("active", tab === "history");
        if (tab === "history") loadHistory();
      }

      async function run() {
        $("run").disabled = true;
        $("run").textContent = "Running...";
        try {
          const response = await fetch("/api/run", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              transaction: $("transaction").value,
              receiptPrinterOut: $("receiptPrinterOut").checked,
              hostDeclined: $("hostDeclined").checked,
              dispenserOffline: $("dispenserOffline").checked,
              acceptorOffline: $("acceptorOffline").checked,
              cardReaderOffline: $("cardReaderOffline").checked,
              receiptWarningAnswer: $("receiptWarningAnswer").value
            })
          });
          render(await response.json());
        } finally {
          $("run").disabled = false;
          $("run").textContent = "Run flow";
        }
      }

      async function loadManifest() {
        const response = await fetch("/api/manifest");
        renderManifest(await response.json());
      }

      async function loadHistory() {
        const response = await fetch("/api/journal");
        renderHistory(await response.json());
      }

      function render(result) {
        const summary = result.summary;
        $("summary").innerHTML = [
          metric("Package", summary.packageId),
          metric("Transaction", summary.selectedTransaction || "none"),
          metric("Status", statusLabel(summary.status)),
          metric("Events", String(summary.eventCount))
        ].join("");

        $("terminalScreen").innerHTML =
          "<div class='eyebrow'>Terminal screen</div>" +
          "<h2>" + escapeHtml(summary.screenTitle) + "</h2>" +
          "<p>" + escapeHtml(summary.screenMessage) + "</p>" +
          "<div class='operator-note'>" + escapeHtml(summary.operatorMessage) + "</div>";

        $("timeline").innerHTML = result.events.map((event) => {
          const payload = event.payload ? JSON.stringify(event.payload, null, 2) : "";
          return "<article class='event'>" +
            "<div class='seq'>#" + event.seq + "</div>" +
            "<div><div class='type'>" + escapeHtml(event.type) + "</div>" +
            "<div class='payload'>" + escapeHtml(payload) + "</div></div>" +
            "</article>";
        }).join("");
      }

      function renderManifest(manifest) {
        $("packageCard").innerHTML =
          "<strong>" + escapeHtml(manifest.id) + "@" + escapeHtml(manifest.version) + "</strong>" +
          "<div class='payload'>" + escapeHtml(manifest.description || "") + "</div>" +
          "<div class='chips'>" + (manifest.capabilities || []).map((capability) =>
            "<span class='chip'>" + escapeHtml(capability) + "</span>"
          ).join("") + "</div>" +
          "<div class='chips'>" + (manifest.modules || []).map((moduleName) =>
            "<span class='chip'>" + escapeHtml(moduleName) + "</span>"
          ).join("") + "</div>";
      }

      function renderHistory(history) {
        $("historySummary").innerHTML = [
          metric("Journal", history.configured ? "configured" : "not configured"),
          metric("Sessions", String(history.sessions.length)),
          metric("Path", history.journalPath || "set CASHBLOCKS_JOURNAL_PATH"),
          metric("Newest", history.sessions[0]?.events.at(-1)?.ts || "none")
        ].join("");

        $("history").innerHTML = history.sessions.map((session) => {
          return "<article class='session'>" +
            "<strong>" + escapeHtml(session.sessionId) + "</strong>" +
            "<span>Status: " + escapeHtml(session.summary.status) + " · Events: " + session.summary.eventCount + "</span>" +
            "<span>Transaction: " + escapeHtml(session.summary.selectedTransaction || "none") + "</span>" +
            "<button data-session='" + escapeHtml(session.sessionId) + "'>Show events</button>" +
            "<div class='timeline' hidden>" + session.events.map((event) => {
              const payload = event.payload ? JSON.stringify(event.payload, null, 2) : "";
              return "<article class='event'>" +
                "<div class='seq'>#" + event.seq + "</div>" +
                "<div><div class='type'>" + escapeHtml(event.type) + "</div>" +
                "<div class='payload'>" + escapeHtml(payload) + "</div></div>" +
                "</article>";
            }).join("") + "</div>" +
            "</article>";
        }).join("");

        document.querySelectorAll("[data-session]").forEach((button) => {
          button.addEventListener("click", () => {
            const timeline = button.nextElementSibling;
            timeline.hidden = !timeline.hidden;
            button.textContent = timeline.hidden ? "Show events" : "Hide events";
          });
        });
      }

      function metric(label, value) {
        return "<div class='metric'><span>" + label + "</span><strong>" + value + "</strong></div>";
      }

      function statusLabel(status) {
        if (status === "failed") return "<span class='bad'>failed</span>";
        if (status === "completed") return "<span class='good'>completed</span>";
        return escapeHtml(status);
      }

      function escapeHtml(value) {
        return String(value)
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;");
      }
    </script>
  </body>
</html>`;
}
