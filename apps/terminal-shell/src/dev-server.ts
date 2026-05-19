import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { runFlow } from "../../../packages/flow-sdk/src/index.js";
import {
  CashblocksRuntime,
  QueuedCustomerInteraction,
  RuntimeSimulator,
  type PendingCustomerPrompt,
  type RuntimeSimulatorOptions
} from "../../../packages/runtime-core/src/index.js";
import {
  getFlowManifest,
  readJournalHistory,
  runSimulation,
  summarizeEvents,
  type SimulationRequest
} from "./simulation.js";
import flow from "../../../examples/atm-basic/src/flow.js";
import manifest from "../../../examples/atm-basic/cashblocks.flow.json" with { type: "json" };

const port = Number(process.env.PORT ?? 4173);
const interactiveSessions = new Map<string, InteractiveSession>();

type InteractiveSession = {
  id: string;
  runtime: CashblocksRuntime;
  interaction: QueuedCustomerInteraction;
  result?: Awaited<ReturnType<typeof runFlow>>;
  resultPromise: Promise<Awaited<ReturnType<typeof runFlow>>>;
};

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

  if (method === "POST" && url.pathname === "/api/session/start") {
    const body = await readJson<SimulationRequest>(request);
    const session = startInteractiveSession({
      ...body,
      journalPath: process.env.CASHBLOCKS_JOURNAL_PATH
    });
    writeJson(response, 200, await interactiveSessionState(session));
    return;
  }

  if (method === "POST" && url.pathname === "/api/session/answer") {
    const body = await readJson<{ sessionId: string; promptId: string; value: string }>(request);
    const session = interactiveSessions.get(body.sessionId);
    if (!session) {
      writeJson(response, 404, { error: "Interactive session not found." });
      return;
    }
    if (!session.interaction.answer(body.promptId, body.value)) {
      writeJson(response, 409, { error: "Prompt is no longer pending." });
      return;
    }
    writeJson(response, 200, await interactiveSessionState(session));
    return;
  }

  writeJson(response, 404, { error: "Not found" });
}

function startInteractiveSession(request: SimulationRequest): InteractiveSession {
  const interaction = new QueuedCustomerInteraction();
  const runtime = new CashblocksRuntime({
    interaction,
    simulator: new RuntimeSimulator(buildSimulatorOptions(request)),
    journalPath: request.journalPath
  });
  const id = runtime.SessionId;
  const session: InteractiveSession = {
    id,
    runtime,
    interaction,
    resultPromise: Promise.resolve(undefined as never)
  };

  session.resultPromise = runFlow(flow, {
    runtime,
    flowPackage: manifest
  }).then(async (result) => {
    await result.runtime.Journal.flush();
    session.result = result;
    return result;
  });
  session.resultPromise.catch(() => undefined);
  interactiveSessions.set(id, session);
  return session;
}

function buildSimulatorOptions(request: SimulationRequest): RuntimeSimulatorOptions {
  return {
    customerSelections: [request.transaction ?? "BalanceInquiry"],
    optionSelections: [request.receiptWarningAnswer ?? "YES"],
    receiptPrinter: request.receiptPrinterOut
      ? { health: "DEGRADED", paper: "OUT" }
      : { health: "HEALTHY", paper: "OK" },
    hostApproved: !request.hostDeclined,
    dispenserOnline: !request.dispenserOffline,
    acceptorOnline: !request.acceptorOffline,
    cardReaderOnline: !request.cardReaderOffline
  };
}

async function interactiveSessionState(session: InteractiveSession): Promise<Record<string, unknown>> {
  await waitForPromptOrResult(session);
  const events = session.runtime.Journal.all();
  const ok = session.result?.ok ?? !events.some((event) => event.type === "flow.failed");

  return {
    sessionId: session.id,
    prompt: serializePrompt(session.interaction.current()),
    completed: Boolean(session.result),
    manifest,
    summary: summarizeEvents(events, ok),
    events
  };
}

async function waitForPromptOrResult(session: InteractiveSession): Promise<void> {
  if (session.interaction.current() || session.result) {
    return;
  }

  await Promise.race([
    new Promise<void>((resolve) => {
      const unsubscribe = session.interaction.onPrompt(() => {
        unsubscribe();
        resolve();
      });
    }),
    session.resultPromise.then(() => undefined)
  ]);
}

function serializePrompt(prompt?: PendingCustomerPrompt): Record<string, unknown> | undefined {
  if (!prompt) {
    return undefined;
  }

  return {
    id: prompt.id,
    ...prompt.prompt
  };
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
        padding: 22px;
        min-height: 520px;
        border: 1px solid rgba(245, 184, 75, 0.38);
        border-radius: 34px;
        background:
          radial-gradient(circle at 85% 20%, rgba(245, 184, 75, 0.14), transparent 18rem),
          linear-gradient(160deg, #070c12 0%, #0f2029 100%);
        box-shadow: inset 0 0 0 10px rgba(255, 248, 236, 0.04);
      }

      .terminal-bezel {
        display: grid;
        grid-template-columns: 44px 1fr 44px;
        gap: 18px;
        height: 100%;
      }

      .side-keys {
        display: grid;
        align-content: center;
        gap: 24px;
      }

      .side-key {
        width: 44px;
        height: 34px;
        border: 1px solid rgba(255, 248, 236, 0.22);
        border-radius: 10px;
        background: linear-gradient(180deg, #2b3740, #111a21);
        box-shadow: 0 6px 0 rgba(0, 0, 0, 0.22);
      }

      .atm-display {
        min-height: 470px;
        display: grid;
        grid-template-rows: auto 1fr auto;
        padding: 28px;
        border-radius: 24px;
        background:
          linear-gradient(180deg, rgba(28, 74, 92, 0.48), rgba(6, 15, 21, 0.84)),
          repeating-linear-gradient(0deg, rgba(255,255,255,0.025), rgba(255,255,255,0.025) 1px, transparent 1px, transparent 5px);
        border: 1px solid rgba(255, 248, 236, 0.14);
      }

      .atm-topbar {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        color: var(--accent);
        text-transform: uppercase;
        letter-spacing: 0.14em;
        font-size: 12px;
        margin-bottom: 18px;
      }

      .atm-display h2 {
        margin: 0;
        font-size: clamp(34px, 5vw, 70px);
        letter-spacing: -0.06em;
        line-height: 0.95;
      }

      .atm-display p {
        max-width: 720px;
        color: var(--muted);
        line-height: 1.55;
        font-size: 18px;
      }

      .atm-actions {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
        margin-top: 24px;
      }

      .atm-action {
        border: 1px solid rgba(255, 248, 236, 0.18);
        border-radius: 14px;
        padding: 14px;
        background: rgba(255, 248, 236, 0.06);
        color: var(--ink);
        margin: 0;
        text-align: left;
        font-weight: 800;
      }

      .atm-action:disabled {
        cursor: default;
        opacity: 0.46;
      }

      .atm-progress {
        display: grid;
        gap: 8px;
        margin-top: 24px;
      }

      .atm-step {
        display: grid;
        grid-template-columns: 18px 1fr;
        gap: 10px;
        align-items: start;
        color: var(--muted);
        font-size: 13px;
      }

      .dot {
        width: 12px;
        height: 12px;
        margin-top: 3px;
        border-radius: 999px;
        background: var(--muted);
      }

      .atm-step.done .dot { background: var(--good); }
      .atm-step.failed .dot { background: var(--bad); }
      .atm-step.active .dot { background: var(--accent); box-shadow: 0 0 22px rgba(245, 184, 75, 0.7); }
      .atm-step.skipped { opacity: 0.58; }

      .atm-step strong {
        display: block;
        color: var(--ink);
      }

      .operator-note {
        margin-top: 18px;
        padding-top: 18px;
        border-top: 1px solid var(--line);
        color: var(--muted);
        font-size: 13px;
      }

      .hardware-strip {
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        gap: 10px;
        margin-top: 18px;
      }

      .slot {
        height: 38px;
        border: 1px solid rgba(255, 248, 236, 0.16);
        border-radius: 999px;
        background: #090f14;
        color: var(--muted);
        display: grid;
        place-items: center;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.1em;
      }

      .slot.active {
        border-color: rgba(245, 184, 75, 0.7);
        color: var(--ink);
        box-shadow: 0 0 24px rgba(245, 184, 75, 0.2);
      }

      .pin-pad {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 8px;
        margin-top: 18px;
        max-width: 320px;
      }

      .pin-key {
        margin: 0;
        background: rgba(255, 248, 236, 0.08);
        color: var(--ink);
        border: 1px solid rgba(255, 248, 236, 0.14);
      }

      .status-copy {
        color: var(--muted);
        font-size: 12px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
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

      const demo = {
        stage: "idle",
        pin: "",
        selectedTransaction: $("transaction").value,
        sessionId: "",
        prompt: null,
        result: null,
        running: false
      };

      $("run").addEventListener("click", resetDemo);
      $("transaction").addEventListener("change", () => {
        demo.selectedTransaction = $("transaction").value;
        if (demo.stage === "select") renderInteractiveTerminal();
      });
      $("runTab").addEventListener("click", () => showTab("run"));
      $("historyTab").addEventListener("click", () => showTab("history"));
      loadManifest();
      resetDemo();

      function showTab(tab) {
        $("runView").hidden = tab !== "run";
        $("historyView").hidden = tab !== "history";
        $("runTab").classList.toggle("active", tab === "run");
        $("historyTab").classList.toggle("active", tab === "history");
        if (tab === "history") loadHistory();
      }

      function resetDemo() {
        demo.stage = "idle";
        demo.pin = "";
        demo.selectedTransaction = $("transaction").value;
        demo.sessionId = "";
        demo.prompt = null;
        demo.result = null;
        demo.running = false;
        $("run").textContent = "Reset terminal";
        $("run").disabled = false;
        renderShellSummary({
          packageId: "cashblocks.example.atm-basic",
          selectedTransaction: "none",
          status: "waiting",
          eventCount: "0"
        });
        $("timeline").innerHTML = "";
        renderInteractiveTerminal();
      }

      async function startInteractiveRun() {
        demo.running = true;
        demo.stage = "processing";
        renderInteractiveTerminal();
        try {
          const response = await fetch("/api/session/start", {
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
          applyInteractiveState(await response.json());
        } finally {
          demo.running = false;
          renderInteractiveTerminal();
        }
      }

      async function answerPrompt(value) {
        if (!demo.sessionId || !demo.prompt) return;
        demo.running = true;
        demo.stage = "processing";
        renderInteractiveTerminal();
        try {
          const response = await fetch("/api/session/answer", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              sessionId: demo.sessionId,
              promptId: demo.prompt.id,
              value
            })
          });
          applyInteractiveState(await response.json());
        } finally {
          demo.running = false;
          renderInteractiveTerminal();
        }
      }

      function applyInteractiveState(state) {
        demo.sessionId = state.sessionId || demo.sessionId;
        demo.prompt = state.prompt || null;
        demo.result = state.completed ? state : null;

        if (state.completed) {
          demo.stage = "result";
          render(state);
          return;
        }

        if (state.prompt?.kind === "pin") {
          demo.stage = "pin";
          demo.pin = "";
          return;
        }

        if (state.prompt?.kind === "transaction") {
          demo.stage = "select";
          return;
        }

        if (state.prompt?.kind === "option") {
          demo.stage = "option";
          return;
        }

        demo.stage = "processing";
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
        renderShellSummary({
          packageId: summary.packageId,
          selectedTransaction: summary.selectedTransaction || "none",
          status: statusLabel(summary.status),
          eventCount: String(summary.eventCount)
        });

        $("terminalScreen").innerHTML =
          "<div class='terminal-bezel'>" +
            sideKeys() +
            "<div class='atm-display'>" +
              "<div class='atm-topbar'><span>Cashblocks ATM</span><span>" + escapeHtml(summary.status) + "</span></div>" +
              "<div>" +
                "<h2>" + escapeHtml(summary.screenTitle) + "</h2>" +
                "<p>" + escapeHtml(summary.screenMessage) + "</p>" +
                renderAtmActions(summary) +
                renderTerminalSteps(summary.terminalSteps || []) +
              "</div>" +
              "<div>" +
                "<div class='hardware-strip'><div class='slot'>Card</div><div class='slot'>Cash</div><div class='slot'>Receipt</div></div>" +
                "<div class='operator-note'>" + escapeHtml(summary.operatorMessage) + "</div>" +
              "</div>" +
            "</div>" +
            sideKeys() +
          "</div>";

        $("timeline").innerHTML = result.events.map((event) => {
          const payload = event.payload ? JSON.stringify(event.payload, null, 2) : "";
          return "<article class='event'>" +
            "<div class='seq'>#" + event.seq + "</div>" +
            "<div><div class='type'>" + escapeHtml(event.type) + "</div>" +
            "<div class='payload'>" + escapeHtml(payload) + "</div></div>" +
            "</article>";
        }).join("");
      }

      function renderInteractiveTerminal() {
        if (demo.stage === "result" && demo.result) return;

        const screen = interactiveScreen();
        $("terminalScreen").innerHTML =
          "<div class='terminal-bezel'>" +
            sideKeys() +
            "<div class='atm-display'>" +
              "<div class='atm-topbar'><span>Cashblocks ATM</span><span>" + escapeHtml(screen.status) + "</span></div>" +
              "<div>" +
                "<div class='status-copy'>" + escapeHtml(screen.eyebrow) + "</div>" +
                "<h2>" + escapeHtml(screen.title) + "</h2>" +
                "<p>" + escapeHtml(screen.message) + "</p>" +
                renderInteractiveActions(screen.actions) +
                renderPinPad(screen.pinPad) +
                renderTerminalSteps(screen.steps) +
              "</div>" +
              "<div>" +
                "<div class='hardware-strip'>" +
                  "<div class='slot " + (screen.activeSlot === "card" ? "active" : "") + "'>Card</div>" +
                  "<div class='slot " + (screen.activeSlot === "cash" ? "active" : "") + "'>Cash</div>" +
                  "<div class='slot " + (screen.activeSlot === "receipt" ? "active" : "") + "'>Receipt</div>" +
                "</div>" +
                "<div class='operator-note'>" + escapeHtml(screen.operatorMessage) + "</div>" +
              "</div>" +
            "</div>" +
            sideKeys() +
          "</div>";

        document.querySelectorAll("[data-terminal-action]").forEach((button) => {
          button.addEventListener("click", () => handleTerminalAction(button.getAttribute("data-terminal-action") || ""));
        });
      }

      function interactiveScreen() {
        if (demo.stage === "pin") {
          return {
            status: "PIN",
            eyebrow: "Secure customer input",
            title: "Enter PIN",
            message: "Use the simulated PIN pad. Any four digits are accepted by this demo runtime.",
            operatorMessage: "Card credential accepted. Waiting for PIN entry.",
            activeSlot: "card",
            pinPad: true,
            actions: [
              { label: "Clear", action: "clearPin", disabled: demo.pin.length === 0 },
              { label: "Cancel", action: "cancel" }
            ],
            steps: interactiveSteps("pin")
          };
        }

        if (demo.stage === "select") {
          return {
            status: "SELECT",
            eyebrow: "Main menu",
            title: "Select transaction",
            message: "Choose the transaction on the left panel, then confirm it on the terminal screen.",
            operatorMessage: "The customer is now inside the transaction menu.",
            activeSlot: selectedCashSlot(),
            pinPad: false,
            actions: [
              { label: "Confirm " + formatTransaction(demo.selectedTransaction), action: "confirmTransaction" },
              { label: "Cancel", action: "cancel" }
            ],
            steps: interactiveSteps("select")
          };
        }

        if (demo.stage === "option" && demo.prompt) {
          return {
            status: "OPTION",
            eyebrow: "Customer decision",
            title: demo.prompt.screen === "PrinterDown" ? "Receipt unavailable" : demo.prompt.prompt,
            message: "Choose one of the options requested by the running flow.",
            operatorMessage: "The flow is paused at a customer option prompt.",
            activeSlot: "receipt",
            pinPad: false,
            actions: (demo.prompt.options || []).map((option) => ({
              label: option,
              action: "answerOption:" + option
            })),
            steps: interactiveSteps("option")
          };
        }

        if (demo.stage === "processing") {
          return {
            status: "PROCESSING",
            eyebrow: "Runtime executing flow",
            title: "Please wait",
            message: "The selected flow is talking to simulated host and device adapters.",
            operatorMessage: "Running the real flow package through /api/run.",
            activeSlot: selectedCashSlot(),
            pinPad: false,
            actions: [
              { label: "Processing...", action: "none", disabled: true },
              { label: "Do not remove card", action: "none", disabled: true }
            ],
            steps: interactiveSteps("processing")
          };
        }

        if (demo.stage === "cancelled") {
          return {
            status: "CANCELLED",
            eyebrow: "Session ended",
            title: "Transaction cancelled",
            message: "The simulated customer cancelled before the flow package executed.",
            operatorMessage: "Press Reset terminal to start again.",
            activeSlot: "card",
            pinPad: false,
            actions: [
              { label: "Start again", action: "reset" },
              { label: "Return card", action: "reset" }
            ],
            steps: interactiveSteps("cancelled")
          };
        }

        return {
          status: "WELCOME",
          eyebrow: "Idle screen",
          title: "Insert or tap card",
          message: "Start a customer session from the terminal screen, not from a pre-finished result.",
          operatorMessage: "Fault toggles remain configurable on the left before the flow executes.",
          activeSlot: "card",
          pinPad: false,
          actions: [
            { label: "Insert card", action: "insertCard" },
            { label: "Tap card", action: "insertCard" }
          ],
          steps: interactiveSteps("idle")
        };
      }

      function interactiveSteps(stage) {
        const done = (label, detail) => ({ label, detail, state: "done" });
        const active = (label, detail) => ({ label, detail, state: "active" });
        const skipped = (label, detail) => ({ label, detail, state: "skipped" });
        const failed = (label, detail) => ({ label, detail, state: "failed" });

        if (stage === "idle") {
          return [
            active("Insert or tap card", "Waiting for customer credential."),
            skipped("Enter PIN", "PIN entry not reached."),
            skipped("Select transaction", "Menu not displayed yet."),
            skipped("Authorize and operate devices", "Runtime has not executed.")
          ];
        }

        if (stage === "pin") {
          return [
            done("Insert or tap card", "Card accepted by the terminal."),
            active("Enter PIN", demo.pin.length + "/4 digits entered."),
            skipped("Select transaction", "Waiting for PIN completion."),
            skipped("Authorize and operate devices", "Runtime has not executed.")
          ];
        }

        if (stage === "select") {
          return [
            done("Insert or tap card", "Card accepted by the terminal."),
            done("Enter PIN", "PIN accepted by simulator."),
            active("Select transaction", formatTransaction(demo.selectedTransaction) + " highlighted."),
            skipped("Authorize and operate devices", "Waiting for confirmation.")
          ];
        }

        if (stage === "processing") {
          return [
            done("Insert or tap card", "Card accepted by the terminal."),
            done("Enter PIN", "PIN accepted by simulator."),
            done("Select transaction", formatTransaction(demo.selectedTransaction) + " selected."),
            active("Authorize and operate devices", "Flow package is running.")
          ];
        }

        if (stage === "option") {
          return [
            done("Insert or tap card", "Card accepted by the terminal."),
            done("Enter PIN", "PIN accepted by simulator."),
            skipped("Select transaction", "Waiting for customer option."),
            active("Customer option", "Flow is paused at " + (demo.prompt?.screen || "option") + ".")
          ];
        }

        return [
          done("Insert or tap card", "Card accepted by the terminal."),
          failed("Session cancelled", "Customer ended the session."),
          skipped("Select transaction", "No transaction confirmed."),
          skipped("Authorize and operate devices", "Runtime was not executed.")
        ];
      }

      function renderInteractiveActions(actions) {
        return "<div class='atm-actions'>" + actions.map((action) =>
          "<button class='atm-action' data-terminal-action='" + escapeHtml(action.action) + "'" +
            (action.disabled ? " disabled" : "") + ">" + escapeHtml(action.label) + "</button>"
        ).join("") + "</div>";
      }

      function renderPinPad(show) {
        if (!show) return "";
        const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "Enter"];
        return "<div class='pin-pad'>" + keys.map((key) =>
          "<button class='pin-key' data-terminal-action='pin:" + key + "'>" +
            (key === "Enter" ? "Enter " + "*".repeat(demo.pin.length) : key) +
          "</button>"
        ).join("") + "</div>";
      }

      function handleTerminalAction(action) {
        if (action === "none") return;
        if (action === "reset") {
          resetDemo();
          return;
        }
        if (action === "cancel") {
          demo.stage = "cancelled";
          renderInteractiveTerminal();
          return;
        }
        if (action === "insertCard") {
          startInteractiveRun();
          return;
        }
        if (action === "clearPin") {
          demo.pin = "";
          renderInteractiveTerminal();
          return;
        }
        if (action.startsWith("pin:")) {
          const key = action.slice(4);
          if (key === "Enter") {
            if (demo.pin.length >= 4) {
              answerPrompt(demo.pin);
            }
            return;
          }
          if (demo.pin.length < 4) demo.pin += key;
          if (demo.pin.length === 4) {
            answerPrompt(demo.pin);
            return;
          }
          renderInteractiveTerminal();
          return;
        }
        if (action === "confirmTransaction") {
          answerPrompt(demo.selectedTransaction);
          return;
        }
        if (action.startsWith("answerOption:")) {
          answerPrompt(action.slice("answerOption:".length));
        }
      }

      function selectedCashSlot() {
        if (demo.selectedTransaction === "CashWithdrawal" || demo.selectedTransaction === "FastCash") return "cash";
        if (demo.selectedTransaction === "CashDeposit") return "cash";
        return "receipt";
      }

      function renderShellSummary(summary) {
        $("summary").innerHTML = [
          metric("Package", summary.packageId),
          metric("Transaction", summary.selectedTransaction),
          metric("Status", summary.status),
          metric("Events", summary.eventCount)
        ].join("");
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

      function sideKeys() {
        return "<div class='side-keys'><div class='side-key'></div><div class='side-key'></div><div class='side-key'></div><div class='side-key'></div></div>";
      }

      function renderAtmActions(summary) {
        if (summary.status === "idle") {
          return "<div class='atm-actions'><div class='atm-action'>Insert card</div><div class='atm-action'>Tap card</div></div>";
        }

        if (summary.status === "cancelled") {
          return "<div class='atm-actions'><div class='atm-action'>Return card</div><div class='atm-action'>End session</div></div>";
        }

        if (summary.status === "failed") {
          return "<div class='atm-actions'><div class='atm-action'>Try another transaction</div><div class='atm-action'>Call operator</div></div>";
        }

        return "<div class='atm-actions'><div class='atm-action'>Print receipt</div><div class='atm-action'>Finish</div></div>";
      }

      function renderTerminalSteps(steps) {
        return "<div class='atm-progress'>" + steps.map((step) =>
          "<div class='atm-step " + escapeHtml(step.state) + "'>" +
            "<span class='dot'></span>" +
            "<span><strong>" + escapeHtml(step.label) + "</strong>" + escapeHtml(step.detail) + "</span>" +
          "</div>"
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

      function formatTransaction(transaction) {
        return String(transaction || "Transaction").replace(/([a-z])([A-Z])/g, "$1 $2");
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
