const $ = (id) => document.getElementById(id);

const transactionLabels = {
  BalanceInquiry: "Balance inquiry",
  CashWithdrawal: "Cash withdrawal",
  CashDeposit: "Cash deposit",
  FastCash: "Fast cash",
  CardlessWithdrawal: "Cardless withdrawal",
  AdminBalanceTerminal: "Balance terminal",
  AdminCashAdjustment: "Cash adjustment",
  AdminPrintTotals: "Print totals"
};

const terminal = {
  stage: "idle",
  pin: "",
  customAmount: "",
  adminCode: "",
  pendingAdmin: "",
  customerType: "OnUs",
  sessionId: "",
  prompt: null,
  result: null,
  running: false,
  receiptPrinted: false
};

$("run").addEventListener("click", resetTerminal);
$("runTab").addEventListener("click", () => showTab("run"));
$("historyTab").addEventListener("click", () => showTab("history"));

loadManifest();
resetTerminal();

function showTab(tab) {
  $("runView").hidden = tab !== "run";
  $("historyView").hidden = tab !== "history";
  $("runTab").classList.toggle("active", tab === "run");
  $("historyTab").classList.toggle("active", tab === "history");
  if (tab === "history") loadHistory();
}

function resetTerminal() {
  terminal.stage = "idle";
  terminal.pin = "";
  terminal.customAmount = "";
  terminal.adminCode = "";
  terminal.pendingAdmin = "";
  terminal.customerType = "OnUs";
  terminal.sessionId = "";
  terminal.prompt = null;
  terminal.result = null;
  terminal.running = false;
  terminal.receiptPrinted = false;
  renderShellSummary({
    packageId: "cashblocks.example.atm-basic",
    selectedTransaction: "none",
    status: "waiting",
    eventCount: "0"
  });
  $("timeline").innerHTML = "";
  renderTerminal();
}

async function startInteractiveRun() {
  terminal.running = true;
  terminal.stage = "processing";
  renderTerminal();
  try {
    const response = await fetch("/api/session/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(simulationRequest())
    });
    applyInteractiveState(await response.json());
  } finally {
    terminal.running = false;
    renderTerminal();
  }
}

async function answerPrompt(value) {
  if (!terminal.sessionId || !terminal.prompt) return;
  terminal.running = true;
  terminal.stage = "processing";
  renderTerminal();
  try {
    const response = await fetch("/api/session/answer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: terminal.sessionId,
        promptId: terminal.prompt.id,
        value
      })
    });
    applyInteractiveState(await response.json());
  } finally {
    terminal.running = false;
    renderTerminal();
  }
}

function simulationRequest() {
  return {
    transaction: $("sessionMode").value === "cardless" ? "CardlessWithdrawal" : undefined,
    customerType: $("sessionMode").value === "cardless" ? "TOUCH" : terminal.customerType,
    receiptPrinterOut: $("receiptPrinterOut").checked,
    hostDeclined: $("hostDeclined").checked,
    dispenserOffline: $("dispenserOffline").checked,
    acceptorOffline: $("acceptorOffline").checked,
    cardReaderOffline: $("cardReaderOffline").checked,
    receiptWarningAnswer: $("receiptWarningAnswer").value
  };
}

function applyInteractiveState(state) {
  terminal.sessionId = state.sessionId || terminal.sessionId;
  terminal.prompt = state.prompt || null;
  terminal.result = state.completed ? state : null;

  if (state.completed) {
    terminal.stage = "result";
    renderResult(state);
    return;
  }

  if (state.prompt?.kind === "pin") terminal.stage = "pin";
  else if (state.prompt?.kind === "transaction") terminal.stage = "transaction";
  else if (state.prompt?.kind === "account") terminal.stage = "account";
  else if (state.prompt?.kind === "amount") terminal.stage = "amount";
  else if (state.prompt?.kind === "option") terminal.stage = "option";
  else terminal.stage = "processing";

  if (terminal.pendingAdmin && state.prompt?.kind === "transaction") {
    answerPrompt(terminal.pendingAdmin);
    terminal.pendingAdmin = "";
    return;
  }

  if (terminal.stage === "pin") terminal.pin = "";
  if (terminal.stage === "amount") terminal.customAmount = "";
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

  const details = [
    summary.selectedAccount ? detail("Account", summary.selectedAccount) : "",
    summary.selectedAmount ? detail("Amount", money(summary.selectedAmount)) : "",
    summary.balanceBefore != null ? detail("Balance before", money(summary.balanceBefore)) : "",
    summary.balanceAfter != null ? detail("Balance after", money(summary.balanceAfter)) : "",
    summary.terminalCashAfter != null ? detail("Terminal cash", money(summary.terminalCashAfter)) : "",
    terminal.receiptPrinted ? detail("Receipt", "Printed") : detail("Receipt", "Not printed")
  ].join("");

  $("terminalScreen").innerHTML = terminalFrame({
    status: summary.status,
    title: summary.screenTitle,
    message: summary.screenMessage,
    body: details + renderResultActions(summary),
    activeSlot: summary.selectedTransaction === "CashDeposit" ? "deposit" : "cash",
    operatorMessage: summary.operatorMessage,
    steps: summary.terminalSteps || []
  });
  bindTerminalActions();
  $("timeline").innerHTML = result.events.map(renderEvent).join("");
}

function renderTerminal() {
  if (terminal.stage === "result" && terminal.result) return;
  const screen = screenForStage();
  $("terminalScreen").innerHTML = terminalFrame(screen);
  bindTerminalActions();
}

function terminalFrame(screen) {
  return "<div class='terminal-bezel real-terminal'>" +
    sideKeys() +
    "<div class='atm-display'>" +
      "<div class='atm-topbar'><span>Cashblocks ATM</span><span>" + escapeHtml(screen.status) + "</span></div>" +
      "<div class='terminal-content'>" +
        "<div class='status-copy'>" + escapeHtml(screen.eyebrow || "") + "</div>" +
        "<h2>" + escapeHtml(screen.title) + "</h2>" +
        "<p>" + escapeHtml(screen.message) + "</p>" +
        (screen.body || "") +
        renderTerminalSteps(screen.steps || customerSteps(screen.status)) +
      "</div>" +
      "<div>" +
        "<div class='hardware-strip'>" +
          slot("Card", screen.activeSlot === "card") +
          slot("Cash", screen.activeSlot === "cash") +
          slot("Deposit", screen.activeSlot === "deposit") +
          slot("Receipt", screen.activeSlot === "receipt") +
        "</div>" +
        "<div class='operator-note'>" + escapeHtml(screen.operatorMessage || "") + "</div>" +
      "</div>" +
    "</div>" +
    sideKeys() +
  "</div>";
}

function screenForStage() {
  if (terminal.stage === "pin") {
    return {
      status: "PIN",
      eyebrow: "Secure customer input",
      title: "Enter your PIN",
      message: "Use the keypad. The simulator accepts any four digits.",
      activeSlot: "card",
      body: renderPinPad(),
      operatorMessage: "Card accepted. Waiting for PIN.",
      steps: customerSteps("pin")
    };
  }

  if (terminal.stage === "transaction") {
    return {
      status: "MENU",
      eyebrow: "Main menu",
      title: "Choose a transaction",
      message: "Select the service you want to perform.",
      activeSlot: "card",
      body: renderTransactionMenu(),
      operatorMessage: "Transaction selection is now handled inside the ATM screen.",
      steps: customerSteps("transaction")
    };
  }

  if (terminal.stage === "account") {
    return {
      status: "ACCOUNT",
      eyebrow: "Account selection",
      title: "Select account",
      message: "Choose which account this transaction should use.",
      activeSlot: "card",
      body: renderActions((terminal.prompt?.options || []).map((option) => ({
        label: option,
        action: "answer:" + option
      }))),
      operatorMessage: "The running flow requested an account.",
      steps: customerSteps("account")
    };
  }

  if (terminal.stage === "amount") {
    return {
      status: "AMOUNT",
      eyebrow: "Amount selection",
      title: terminal.prompt?.prompt || "Select amount",
      message: "Choose a preset amount or enter a custom amount with the keypad.",
      activeSlot: "cash",
      body: renderAmountPrompt(),
      operatorMessage: "The amount will be passed back to the runtime prompt.",
      steps: customerSteps("amount")
    };
  }

  if (terminal.stage === "option" && terminal.prompt) {
    return {
      status: "OPTION",
      eyebrow: "Customer decision",
      title: terminal.prompt.screen === "PrinterDown" ? "Receipt unavailable" : terminal.prompt.prompt,
      message: "Choose how to continue.",
      activeSlot: "receipt",
      body: renderActions((terminal.prompt.options || []).map((option) => ({
        label: option,
        action: "answer:" + option
      }))),
      operatorMessage: "The flow is paused at a customer option prompt.",
      steps: customerSteps("option")
    };
  }

  if (terminal.stage === "admin-code") {
    return {
      status: "SERVICE",
      eyebrow: "Operator access",
      title: "Enter service code",
      message: "Use 0000 in this simulator.",
      activeSlot: "card",
      body: renderAdminPad(),
      operatorMessage: "Admin is hidden behind a local service path, not customer transaction buttons.",
      steps: customerSteps("admin")
    };
  }

  if (terminal.stage === "admin-menu") {
    return {
      status: "SERVICE",
      eyebrow: "Operator menu",
      title: "Terminal administration",
      message: "Choose an operator function.",
      activeSlot: "receipt",
      body: renderActions([
      { label: "Balance terminal", action: "adminRun:AdminBalanceTerminal" },
      { label: "Cash adjustment", action: "adminRun:AdminCashAdjustment" },
      { label: "Print totals", action: "adminRun:AdminPrintTotals" },
        { label: "Exit service", action: "reset" }
      ]),
      operatorMessage: "Admin choices are still executed by the same running flow package.",
      steps: customerSteps("admin")
    };
  }

  if (terminal.stage === "processing") {
    return {
      status: "PROCESSING",
      eyebrow: "Please wait",
      title: "Processing",
      message: "The terminal is talking to simulated adapters and the flow runtime.",
      activeSlot: "cash",
      body: renderActions([{ label: "Processing...", action: "none", disabled: true }]),
      operatorMessage: "Runtime session is active.",
      steps: customerSteps("processing")
    };
  }

  if (terminal.stage === "cancelled") {
    return {
      status: "CANCELLED",
      eyebrow: "Session ended",
      title: "Transaction cancelled",
      message: "Your card has been returned.",
      activeSlot: "card",
      body: renderActions([{ label: "Start again", action: "reset" }]),
      operatorMessage: "Press Reset terminal to start again.",
      steps: customerSteps("cancelled")
    };
  }

  return {
    status: "WELCOME",
    eyebrow: "Idle screen",
    title: "Insert or tap card",
    message: "Start a complete customer session from the ATM screen.",
    activeSlot: "card",
    body: renderActions([
      { label: "Insert card", action: "insertCard" },
      { label: "Tap card", action: "insertCard" },
      { label: "Cardless access", action: "cardlessAccess" },
      { label: "Operator access", action: "operatorAccess" }
    ]),
    operatorMessage: "Fault toggles remain outside the customer screen for simulator setup only.",
    steps: customerSteps("idle")
  };
}

function renderTransactionMenu() {
  const options = terminal.prompt?.options || [];
  const customerOptions = options.filter((option) => !option.startsWith("Admin"));
  return renderActions([
    ...customerOptions.map((option) => ({ label: transactionLabels[option] || formatTransaction(option), action: "answer:" + option })),
    { label: "Operator access", action: "operatorAccess" }
  ]);
}

function renderAmountPrompt() {
  const prompt = terminal.prompt || {};
  const presets = prompt.presets || [];
  const presetButtons = presets.map((amount) => ({
    label: money(amount),
    action: "answer:" + amount
  }));
  return renderActions(presetButtons) +
    "<div class='amount-entry'>" +
      "<strong>Custom amount</strong>" +
      "<span>" + (terminal.customAmount ? money(Number(terminal.customAmount)) : "Enter amount") + "</span>" +
    "</div>" +
    renderNumberPad("amount");
}

function renderPinPad() {
  return "<div class='secure-dots'>" + "*".repeat(terminal.pin.length).padEnd(4, "•") + "</div>" +
    renderNumberPad("pin") +
    renderActions([
      { label: "Clear", action: "clearPin", disabled: terminal.pin.length === 0 },
      { label: "Cancel", action: "cancel" }
    ]);
}

function renderAdminPad() {
  return "<div class='secure-dots'>" + "*".repeat(terminal.adminCode.length).padEnd(4, "•") + "</div>" +
    renderNumberPad("admin") +
    renderActions([
      { label: "Clear", action: "clearAdmin", disabled: terminal.adminCode.length === 0 },
      { label: "Cancel", action: "cancel" }
    ]);
}

function renderNumberPad(mode) {
  return "<div class='pin-pad'>" + ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "Enter"].map((key) =>
    "<button class='pin-key' data-terminal-action='" + mode + ":" + key + "'>" + escapeHtml(key) + "</button>"
  ).join("") + "</div>";
}

function renderResultActions(summary) {
  if (summary.status === "failed") {
    return renderActions([
      { label: "Try again", action: "reset" },
      { label: "Call operator", action: "operatorAccess" }
    ]);
  }
  if (summary.status === "cancelled") {
    return renderActions([{ label: "Start again", action: "reset" }]);
  }
  return renderActions([
    { label: terminal.receiptPrinted ? "Receipt printed" : "Print receipt", action: "printReceipt", disabled: terminal.receiptPrinted },
    { label: "Finish", action: "finish" }
  ]);
}

function renderActions(actions) {
  return "<div class='atm-actions'>" + actions.map((action) =>
    "<button class='atm-action' data-terminal-action='" + escapeHtml(action.action) + "'" +
      (action.disabled ? " disabled" : "") + ">" + escapeHtml(action.label) + "</button>"
  ).join("") + "</div>";
}

function bindTerminalActions() {
  document.querySelectorAll("[data-terminal-action]").forEach((button) => {
    button.addEventListener("click", () => handleTerminalAction(button.getAttribute("data-terminal-action") || ""));
  });
}

function handleTerminalAction(action) {
  if (action === "none") return;
  if (action === "reset" || action === "finish") return resetTerminal();
  if (action === "printReceipt") {
    terminal.receiptPrinted = true;
    if (terminal.result) renderResult(terminal.result);
    return;
  }
  if (action === "cancel") {
    terminal.stage = "cancelled";
    renderTerminal();
    return;
  }
  if (action === "insertCard") return startInteractiveRun();
  if (action === "cardlessAccess") {
    terminal.customerType = "TOUCH";
    return startInteractiveRun();
  }
  if (action === "operatorAccess") {
    terminal.adminCode = "";
    terminal.stage = terminal.prompt?.kind === "transaction" ? "admin-code" : "admin-code";
    renderTerminal();
    return;
  }
  if (action === "clearPin") {
    terminal.pin = "";
    renderTerminal();
    return;
  }
  if (action === "clearAdmin") {
    terminal.adminCode = "";
    renderTerminal();
    return;
  }
  if (action.startsWith("answer:")) return answerPrompt(action.slice("answer:".length));
  if (action.startsWith("adminRun:")) {
    const transaction = action.slice("adminRun:".length);
    terminal.customerType = "OperatorAdmin";
    if (terminal.prompt?.kind === "transaction") return answerPrompt(transaction);
    terminal.pendingAdmin = transaction;
    return startInteractiveRun();
  }
  if (action.startsWith("pin:")) return handlePinKey(action.slice(4));
  if (action.startsWith("amount:")) return handleAmountKey(action.slice(7));
  if (action.startsWith("admin:")) return handleAdminKey(action.slice(6));
}

function handlePinKey(key) {
  if (key === "Enter") {
    if (terminal.pin.length >= 4) answerPrompt(terminal.pin);
    return;
  }
  if (terminal.pin.length < 4) terminal.pin += key;
  if (terminal.pin.length === 4) return answerPrompt(terminal.pin);
  renderTerminal();
}

function handleAmountKey(key) {
  if (key === "Enter") {
    if (Number(terminal.customAmount) > 0) answerPrompt(terminal.customAmount);
    return;
  }
  if (terminal.customAmount.length < 5) terminal.customAmount += key;
  renderTerminal();
}

function handleAdminKey(key) {
  if (key === "Enter") {
    if (terminal.adminCode === "0000") {
      terminal.stage = "admin-menu";
      terminal.customerType = "OperatorAdmin";
      renderTerminal();
    }
    return;
  }
  if (terminal.adminCode.length < 4) terminal.adminCode += key;
  if (terminal.adminCode === "0000") {
    terminal.stage = "admin-menu";
    terminal.customerType = "OperatorAdmin";
  }
  renderTerminal();
}

function customerSteps(stage) {
  const done = (label, detail) => ({ label, detail, state: "done" });
  const active = (label, detail) => ({ label, detail, state: "active" });
  const skipped = (label, detail) => ({ label, detail, state: "skipped" });
  const failed = (label, detail) => ({ label, detail, state: "failed" });

  if (stage === "idle" || stage === "WELCOME") {
    return [active("Insert or tap card", "Waiting for customer."), skipped("Enter PIN", "Not started."), skipped("Choose transaction", "Menu hidden.")];
  }
  if (stage === "pin" || stage === "PIN") {
    return [done("Insert or tap card", "Card accepted."), active("Enter PIN", terminal.pin.length + "/4 digits."), skipped("Choose transaction", "Waiting for PIN.")];
  }
  if (stage === "transaction" || stage === "MENU") {
    return [done("Insert or tap card", "Card accepted."), done("Enter PIN", "PIN accepted."), active("Choose transaction", "Main menu displayed.")];
  }
  if (stage === "account" || stage === "ACCOUNT") {
    return [done("Choose transaction", "Transaction selected."), active("Select account", "Waiting for account.")];
  }
  if (stage === "amount" || stage === "AMOUNT") {
    return [done("Select account", "Account selected."), active("Select amount", "Waiting for amount.")];
  }
  if (stage === "processing" || stage === "PROCESSING") {
    return [done("Customer input", "Required choices captured."), active("Process transaction", "Adapters running.")];
  }
  if (stage === "cancelled" || stage === "CANCELLED") {
    return [failed("Session cancelled", "Customer ended the session.")];
  }
  return [active("Continue", "Waiting for customer.")];
}

function renderTerminalSteps(steps) {
  return "<div class='atm-progress'>" + steps.map((step) =>
    "<div class='atm-step " + escapeHtml(step.state) + "'>" +
      "<span class='dot'></span>" +
      "<span><strong>" + escapeHtml(step.label) + "</strong>" + escapeHtml(step.detail) + "</span>" +
    "</div>"
  ).join("") + "</div>";
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

function sideKeys() {
  return "<div class='side-keys'><div class='side-key'></div><div class='side-key'></div><div class='side-key'></div><div class='side-key'></div></div>";
}

function slot(label, active) {
  return "<div class='slot " + (active ? "active" : "") + "'>" + escapeHtml(label) + "</div>";
}

function detail(label, value) {
  return "<div class='detail-row'><span>" + escapeHtml(label) + "</span><strong>" + escapeHtml(value) + "</strong></div>";
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

function money(amount) {
  return "$" + Number(amount || 0).toLocaleString("en-US");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
