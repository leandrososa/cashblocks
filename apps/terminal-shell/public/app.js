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
      body: JSON.stringify(simulationRequest())
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

function simulationRequest() {
  return {
    transaction: $("transaction").value,
    receiptPrinterOut: $("receiptPrinterOut").checked,
    hostDeclined: $("hostDeclined").checked,
    dispenserOffline: $("dispenserOffline").checked,
    acceptorOffline: $("acceptorOffline").checked,
    cardReaderOffline: $("cardReaderOffline").checked,
    receiptWarningAnswer: $("receiptWarningAnswer").value
  };
}

function applyInteractiveState(state) {
  demo.sessionId = state.sessionId || demo.sessionId;
  demo.prompt = state.prompt || null;
  demo.result = state.completed ? state : null;

  if (state.completed) {
    demo.stage = "result";
    renderResult(state);
    return;
  }

  if (state.prompt?.kind === "pin") demo.stage = "pin";
  else if (state.prompt?.kind === "transaction") demo.stage = "select";
  else if (state.prompt?.kind === "option") demo.stage = "option";
  else demo.stage = "processing";

  if (demo.stage === "pin") demo.pin = "";
}

async function loadManifest() {
  const response = await fetch("/api/manifest");
  renderManifest(await response.json());
}

async function loadHistory() {
  const response = await fetch("/api/journal");
  renderHistory(await response.json());
}

function renderResult(result) {
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

  $("timeline").innerHTML = result.events.map(renderEvent).join("");
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
      operatorMessage: "Running the real flow package through /api/session.",
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
  if (action === "reset") return resetDemo();
  if (action === "cancel") {
    demo.stage = "cancelled";
    renderInteractiveTerminal();
    return;
  }
  if (action === "insertCard") return startInteractiveRun();
  if (action === "clearPin") {
    demo.pin = "";
    renderInteractiveTerminal();
    return;
  }
  if (action.startsWith("pin:")) {
    const key = action.slice(4);
    if (key === "Enter") {
      if (demo.pin.length >= 4) answerPrompt(demo.pin);
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
  if (action === "confirmTransaction") return answerPrompt(demo.selectedTransaction);
  if (action.startsWith("answerOption:")) answerPrompt(action.slice("answerOption:".length));
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
    return "<div class='atm-actions'><button class='atm-action'>Insert card</button><button class='atm-action'>Tap card</button></div>";
  }
  if (summary.status === "cancelled") {
    return "<div class='atm-actions'><button class='atm-action'>Return card</button><button class='atm-action'>End session</button></div>";
  }
  if (summary.status === "failed") {
    return "<div class='atm-actions'><button class='atm-action'>Try another transaction</button><button class='atm-action'>Call operator</button></div>";
  }
  return "<div class='atm-actions'><button class='atm-action'>Print receipt</button><button class='atm-action'>Finish</button></div>";
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

  $("history").innerHTML = history.sessions.map((session) =>
    "<article class='session'>" +
      "<strong>" + escapeHtml(session.sessionId) + "</strong>" +
      "<span>Status: " + escapeHtml(session.summary.status) + " · Events: " + session.summary.eventCount + "</span>" +
      "<span>Transaction: " + escapeHtml(session.summary.selectedTransaction || "none") + "</span>" +
      "<button data-session='" + escapeHtml(session.sessionId) + "'>Show events</button>" +
      "<div class='timeline' hidden>" + session.events.map(renderEvent).join("") + "</div>" +
    "</article>"
  ).join("");

  document.querySelectorAll("[data-session]").forEach((button) => {
    button.addEventListener("click", () => {
      const timeline = button.nextElementSibling;
      timeline.hidden = !timeline.hidden;
      button.textContent = timeline.hidden ? "Show events" : "Hide events";
    });
  });
}

function renderEvent(event) {
  const payload = event.payload ? JSON.stringify(event.payload, null, 2) : "";
  return "<article class='event'>" +
    "<div class='seq'>#" + event.seq + "</div>" +
    "<div><div class='type'>" + escapeHtml(event.type) + "</div>" +
    "<div class='payload'>" + escapeHtml(payload) + "</div></div>" +
  "</article>";
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
