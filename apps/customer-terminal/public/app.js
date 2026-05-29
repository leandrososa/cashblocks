const app = document.getElementById("app");

const labels = {
  BalanceInquiry: "Balance inquiry",
  CashWithdrawal: "Cash withdrawal",
  CashDeposit: "Cash deposit",
  FastCash: "Fast cash",
  CardlessWithdrawal: "Cardless withdrawal",
  AdminBalanceTerminal: "Balance terminal",
  AdminCashAdjustment: "Cash adjustment",
  AdminPrintTotals: "Print totals"
};

const state = {
  stage: "idle",
  sessionId: "",
  prompt: null,
  result: null,
  pin: "",
  amount: "",
  adminCode: "",
  receiptPrinted: false,
  pendingAdminTransaction: ""
};

render();

async function startSession(options = {}) {
  state.stage = "processing";
  render();
  const response = await fetch("/api/session/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(options)
  });
  applyState(await response.json());
}

async function answer(value) {
  if (!state.sessionId || !state.prompt) return;
  state.stage = "processing";
  render();
  const response = await fetch("/api/session/answer", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionId: state.sessionId,
      promptId: state.prompt.id,
      value
    })
  });
  applyState(await response.json());
}

function applyState(next) {
  state.sessionId = next.sessionId || state.sessionId;
  state.prompt = next.prompt || null;
  state.result = next.completed ? next : null;

  if (next.completed) {
    state.stage = "result";
    render();
    return;
  }

  if (state.pendingAdminTransaction && next.prompt?.kind === "transaction") {
    const transaction = state.pendingAdminTransaction;
    state.pendingAdminTransaction = "";
    answer(transaction);
    return;
  }

  if (next.prompt?.kind === "pin") state.stage = "pin";
  else if (next.prompt?.kind === "transaction") state.stage = "transaction";
  else if (next.prompt?.kind === "account") state.stage = "account";
  else if (next.prompt?.kind === "amount") state.stage = "amount";
  else if (next.prompt?.kind === "option") state.stage = "option";
  else state.stage = "processing";

  if (state.stage === "pin") state.pin = "";
  if (state.stage === "amount") state.amount = "";
  render();
}

function render() {
  app.innerHTML = frame(screen());
  document.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => handle(button.getAttribute("data-action") || ""));
  });
}

function screen() {
  if (state.stage === "pin") {
    return {
      status: "PIN",
      eyebrow: "Secure input",
      title: "Enter your PIN",
      message: "Use the keypad. This simulator accepts any four digits.",
      active: "card",
      body: secureDots(state.pin) + keypad("pin") + actions([
        { label: "Clear", action: "clearPin" },
        { label: "Cancel", action: "reset" }
      ])
    };
  }

  if (state.stage === "transaction") {
    const customerOptions = (state.prompt?.options || []).filter((option) => !option.startsWith("Admin"));
    return {
      status: "MENU",
      eyebrow: "Main menu",
      title: "Choose a transaction",
      message: "Select the service you want to perform.",
      active: "card",
      body: actions([
        ...customerOptions.map((option) => ({ label: labels[option] || option, action: "answer:" + option })),
        { label: "Operator access", action: "operator" }
      ])
    };
  }

  if (state.stage === "account") {
    return {
      status: "ACCOUNT",
      eyebrow: "Account",
      title: "Select account",
      message: "Choose which account to use.",
      active: "card",
      body: actions((state.prompt?.options || []).map((option) => ({ label: option, action: "answer:" + option })))
    };
  }

  if (state.stage === "amount") {
    const presets = state.prompt?.presets || [];
    return {
      status: "AMOUNT",
      eyebrow: "Amount",
      title: state.prompt?.prompt || "Select amount",
      message: "Choose a preset amount or enter a custom amount.",
      active: "cash",
      body: actions(presets.map((amount) => ({ label: money(amount), action: "answer:" + amount }))) +
        "<div class='amount-entry'>" + (state.amount ? money(Number(state.amount)) : "Enter amount") + "</div>" +
        keypad("amount")
    };
  }

  if (state.stage === "option") {
    return {
      status: "OPTION",
      eyebrow: "Decision",
      title: state.prompt?.screen === "PrinterDown" ? "Receipt unavailable" : state.prompt?.prompt || "Choose option",
      message: "Choose how to continue.",
      active: "receipt",
      body: actions((state.prompt?.options || []).map((option) => ({ label: option, action: "answer:" + option })))
    };
  }

  if (state.stage === "operator-code") {
    return {
      status: "SERVICE",
      eyebrow: "Operator",
      title: "Enter service code",
      message: "Use 0000 in this simulator.",
      active: "card",
      body: secureDots(state.adminCode) + keypad("admin") + actions([
        { label: "Clear", action: "clearAdmin" },
        { label: "Cancel", action: "reset" }
      ])
    };
  }

  if (state.stage === "operator-menu") {
    return {
      status: "SERVICE",
      eyebrow: "Operator menu",
      title: "Terminal administration",
      message: "Choose an operator function.",
      active: "receipt",
      body: actions([
        { label: "Balance terminal", action: "admin:AdminBalanceTerminal" },
        { label: "Cash adjustment", action: "admin:AdminCashAdjustment" },
        { label: "Print totals", action: "admin:AdminPrintTotals" },
        { label: "Exit service", action: "reset" }
      ])
    };
  }

  if (state.stage === "processing") {
    return {
      status: "PROCESSING",
      eyebrow: "Please wait",
      title: "Processing",
      message: "The terminal is completing your request.",
      active: "cash",
      body: actions([{ label: "Processing...", action: "none", disabled: true }])
    };
  }

  if (state.stage === "result" && state.result) {
    const summary = state.result.summary;
    return {
      status: summary.status,
      eyebrow: summary.failed ? "Unable to complete" : "Complete",
      title: summary.screenTitle,
      message: summary.screenMessage,
      active: summary.selectedTransaction === "CashDeposit" ? "deposit" : "receipt",
      body: details(summary) + actions(resultActions(summary))
    };
  }

  return {
    status: "WELCOME",
    eyebrow: "Welcome",
    title: "Insert or tap card",
    message: "Start a complete Cashblocks ATM session.",
    active: "card",
    body: actions([
      { label: "Insert card", action: "start" },
      { label: "Tap card", action: "start" },
      { label: "Cardless access", action: "cardless" },
      { label: "Operator access", action: "operator" }
    ])
  };
}

function frame(view) {
  return "<div class='terminal'>" +
    sideKeys() +
    "<section class='screen'>" +
      "<div class='topbar'><span>Cashblocks ATM</span><span>" + escapeHtml(view.status) + "</span></div>" +
      "<div class='content'>" +
        "<div class='eyebrow'>" + escapeHtml(view.eyebrow) + "</div>" +
        "<h1>" + escapeHtml(view.title) + "</h1>" +
        "<p>" + escapeHtml(view.message) + "</p>" +
        view.body +
      "</div>" +
      "<div class='hardware'>" +
        slot("Card", view.active === "card") +
        slot("Cash", view.active === "cash") +
        slot("Deposit", view.active === "deposit") +
        slot("Receipt", view.active === "receipt") +
      "</div>" +
    "</section>" +
    sideKeys() +
  "</div>";
}

function handle(action) {
  if (action === "none") return;
  if (action === "reset") return reset();
  if (action === "start") return startSession();
  if (action === "cardless") return startSession({ customerType: "TOUCH" });
  if (action === "operator") {
    state.adminCode = "";
    state.stage = "operator-code";
    return render();
  }
  if (action === "print") {
    state.receiptPrinted = true;
    return render();
  }
  if (action === "finish") return reset();
  if (action === "clearPin") {
    state.pin = "";
    return render();
  }
  if (action === "clearAdmin") {
    state.adminCode = "";
    return render();
  }
  if (action.startsWith("answer:")) return answer(action.slice("answer:".length));
  if (action.startsWith("pin:")) return handlePin(action.slice(4));
  if (action.startsWith("amount:")) return handleAmount(action.slice(7));
  if (action.startsWith("admin:")) return runAdmin(action.slice(6));
}

function runAdmin(transaction) {
  state.pendingAdminTransaction = transaction;
  return startSession({ customerType: "OperatorAdmin", transaction });
}

function handlePin(key) {
  if (key === "Enter") {
    if (state.pin.length >= 4) answer(state.pin);
    return;
  }
  if (state.pin.length < 4) state.pin += key;
  if (state.pin.length === 4) return answer(state.pin);
  render();
}

function handleAmount(key) {
  if (key === "Enter") {
    if (Number(state.amount) > 0) answer(state.amount);
    return;
  }
  if (state.amount.length < 5) state.amount += key;
  render();
}

function handleAdmin(key) {
  if (key === "Enter") {
    if (state.adminCode === "0000") state.stage = "operator-menu";
    return render();
  }
  if (state.adminCode.length < 4) state.adminCode += key;
  if (state.adminCode === "0000") state.stage = "operator-menu";
  render();
}

function reset() {
  state.stage = "idle";
  state.sessionId = "";
  state.prompt = null;
  state.result = null;
  state.pin = "";
  state.amount = "";
  state.adminCode = "";
  state.receiptPrinted = false;
  state.pendingAdminTransaction = "";
  render();
}

function actions(items) {
  return "<div class='actions'>" + items.map((item, index) =>
    "<button class='action " + (index === 0 ? "primary" : "") + "' data-action='" + escapeHtml(item.action) + "'" +
      (item.disabled ? " disabled" : "") + ">" + escapeHtml(item.label) + "</button>"
  ).join("") + "</div>";
}

function keypad(mode) {
  return "<div class='keypad'>" + ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "Enter"].map((key) =>
    "<button class='key' data-action='" + mode + ":" + key + "'>" + escapeHtml(key) + "</button>"
  ).join("") + "</div>";
}

function resultActions(summary) {
  if (summary.failed) {
    return [
      { label: "Try again", action: "reset" },
      { label: "Operator access", action: "operator" }
    ];
  }
  return [
    { label: state.receiptPrinted ? "Receipt printed" : "Print receipt", action: "print", disabled: state.receiptPrinted },
    { label: "Finish", action: "finish" }
  ];
}

function details(summary) {
  const rows = [
    summary.selectedAccount ? detail("Account", summary.selectedAccount) : "",
    summary.selectedAmount ? detail("Amount", money(summary.selectedAmount)) : "",
    summary.balanceBefore != null ? detail("Balance before", money(summary.balanceBefore)) : "",
    summary.balanceAfter != null ? detail("Balance after", money(summary.balanceAfter)) : "",
    summary.terminalCashAfter != null ? detail("Terminal cash", money(summary.terminalCashAfter)) : "",
    detail("Receipt", state.receiptPrinted ? "Printed" : "Not printed")
  ].filter(Boolean);
  return "<div class='details'>" + rows.join("") + "</div>";
}

function detail(label, value) {
  return "<div class='detail'><span>" + escapeHtml(label) + "</span><strong>" + escapeHtml(value) + "</strong></div>";
}

function secureDots(value) {
  return "<div class='secure'>" + "*".repeat(value.length).padEnd(4, "•") + "</div>";
}

function sideKeys() {
  return "<aside class='side'><div class='side-key'></div><div class='side-key'></div><div class='side-key'></div><div class='side-key'></div></aside>";
}

function slot(label, active) {
  return "<div class='slot " + (active ? "active" : "") + "'>" + escapeHtml(label) + "</div>";
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
