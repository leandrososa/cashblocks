const app = document.getElementById("app");
const skipLink = document.querySelector(".skip-link");

const copy = {
  es: {
    skip: "Ir al contenido principal",
    english: "English",
    accessibility: "Accesibilidad",
    accessibilityOn: "Desactivar modo de alta legibilidad",
    accessibilityOff: "Activar modo de alta legibilidad",
    secureSession: "Sesión segura",
    initializing: "Preparando el terminal",
    initializingMessage: "Estará disponible en unos segundos.",
    insertCard: "Inserte o acerque su tarjeta para comenzar",
    cardless: "Operar sin tarjeta",
    cardDetected: "Tarjeta detectada",
    cardDetectedMessage: "Mantenga la tarjeta en el lector mientras iniciamos su sesión.",
    pinEyebrow: "Ingreso seguro",
    pinTitle: "Ingrese su PIN",
    pinMessage: "Cubra el teclado mientras ingresa sus cuatro dígitos.",
    transactionEyebrow: "Hola",
    transactionTitle: "¿Qué desea hacer?",
    transactionMessage: "Seleccione una operación para continuar.",
    accountEyebrow: "Cuenta",
    accountTitle: "Seleccione una cuenta",
    accountMessage: "Elija la cuenta que desea utilizar.",
    amountEyebrow: "Importe",
    amountTitle: "Seleccione un importe",
    amountMessage: "Elija una opción o ingrese otro importe.",
    enterAmount: "Otro importe",
    processingEyebrow: "Por favor espere",
    processingTitle: "Estamos procesando su operación",
    processingMessage: "No retire su tarjeta ni se aleje del terminal.",
    completeEyebrow: "Operación finalizada",
    unableEyebrow: "No pudimos completar la operación",
    printReceipt: "Imprimir comprobante",
    receiptPrinted: "Comprobante impreso",
    finish: "Finalizar",
    tryAgain: "Volver al inicio",
    cancel: "Cancelar",
    clear: "Borrar",
    enter: "Aceptar",
    connectionTitle: "El terminal necesita atención",
    connectionMessage: "No pudimos continuar. Puede volver al inicio o intentar operar sin tarjeta.",
    returnHome: "Volver al inicio",
    readerUnavailable: "El lector está reconectando",
    readerReady: "Lector listo",
    campaignFallbackTitle: "Bienvenido a Cashblocks",
    campaignFallbackBody: "Una forma simple y segura de operar.",
    receipt: "Comprobante",
    printed: "Impreso",
    notPrinted: "No impreso",
    account: "Cuenta",
    amount: "Importe",
    balanceBefore: "Saldo anterior",
    balanceAfter: "Saldo actual",
    terminalCashBefore: "Efectivo anterior",
    terminalCash: "Efectivo del terminal",
    operation: "Operación",
    cashAdjustment: "Ajuste de efectivo",
    accounts: "Cuentas",
    cardlessEyebrow: "Acceso sin tarjeta",
    cardlessTitle: "Ingrese su código de retiro",
    cardlessMessage: "Use el código de un solo uso generado por su banco.",
    confirmCashEyebrow: "Confirmación",
    confirmWithdrawal: "Confirme el retiro",
    confirmFastCash: "Confirme el retiro rápido",
    insertDepositEyebrow: "Depósito",
    insertDeposit: "Ingrese el efectivo",
    balanceDeliveryEyebrow: "Consulta de saldo",
    balanceDelivery: "Elija cómo recibir su saldo",
    receiptUnavailableEyebrow: "Comprobante",
    receiptUnavailable: "El comprobante no está disponible",
    receiptUnavailableMessage: "Puede continuar y ver el resultado en pantalla.",
    decisionEyebrow: "Confirmación",
    chooseOption: "Elija cómo continuar.",
    mode: "Modalidad",
    cardlessWithdrawal: "Retiro sin tarjeta",
    selectedAccount: "la cuenta seleccionada",
    selectedAmount: "el importe seleccionado",
    continue: "Continuar",
    showOnScreen: "Ver en pantalla",
    withdraw100: "Retirar $100",
    cashInserted: "Efectivo ingresado",
    confirm: "Confirmar"
  },
  en: {
    skip: "Skip to main content",
    english: "Español",
    accessibility: "Accessibility",
    accessibilityOn: "Turn high-legibility mode off",
    accessibilityOff: "Turn high-legibility mode on",
    secureSession: "Secure session",
    initializing: "Preparing the terminal",
    initializingMessage: "It will be available in a few seconds.",
    insertCard: "Insert or tap your card to begin",
    cardless: "Bank without a card",
    cardDetected: "Card detected",
    cardDetectedMessage: "Keep your card in the reader while we start your session.",
    pinEyebrow: "Secure entry",
    pinTitle: "Enter your PIN",
    pinMessage: "Cover the keypad while entering your four digits.",
    transactionEyebrow: "Welcome",
    transactionTitle: "What would you like to do?",
    transactionMessage: "Select a transaction to continue.",
    accountEyebrow: "Account",
    accountTitle: "Select an account",
    accountMessage: "Choose the account you want to use.",
    amountEyebrow: "Amount",
    amountTitle: "Select an amount",
    amountMessage: "Choose an option or enter another amount.",
    enterAmount: "Other amount",
    processingEyebrow: "Please wait",
    processingTitle: "We are processing your transaction",
    processingMessage: "Do not remove your card or leave the terminal.",
    completeEyebrow: "Transaction complete",
    unableEyebrow: "We could not complete the transaction",
    printReceipt: "Print receipt",
    receiptPrinted: "Receipt printed",
    finish: "Finish",
    tryAgain: "Return to start",
    cancel: "Cancel",
    clear: "Clear",
    enter: "Enter",
    connectionTitle: "The terminal needs attention",
    connectionMessage: "We could not continue. Return to the start or use cardless banking.",
    returnHome: "Return to start",
    readerUnavailable: "Card reader reconnecting",
    readerReady: "Card reader ready",
    campaignFallbackTitle: "Welcome to Cashblocks",
    campaignFallbackBody: "A simple and secure way to bank.",
    receipt: "Receipt",
    printed: "Printed",
    notPrinted: "Not printed",
    account: "Account",
    amount: "Amount",
    balanceBefore: "Balance before",
    balanceAfter: "Current balance",
    terminalCashBefore: "Terminal cash before",
    terminalCash: "Terminal cash",
    operation: "Operation",
    cashAdjustment: "Cash adjustment",
    accounts: "Accounts",
    cardlessEyebrow: "Cardless access",
    cardlessTitle: "Enter your withdrawal code",
    cardlessMessage: "Use the one-time code generated by your bank.",
    confirmCashEyebrow: "Confirmation",
    confirmWithdrawal: "Confirm withdrawal",
    confirmFastCash: "Confirm fast cash",
    insertDepositEyebrow: "Deposit",
    insertDeposit: "Insert your cash",
    balanceDeliveryEyebrow: "Balance inquiry",
    balanceDelivery: "Choose how to receive your balance",
    receiptUnavailableEyebrow: "Receipt",
    receiptUnavailable: "Receipt unavailable",
    receiptUnavailableMessage: "You can continue and view the result on screen.",
    decisionEyebrow: "Confirmation",
    chooseOption: "Choose how to continue.",
    mode: "Mode",
    cardlessWithdrawal: "Cardless withdrawal",
    selectedAccount: "the selected account",
    selectedAmount: "the selected amount",
    continue: "Continue",
    showOnScreen: "Show on screen",
    withdraw100: "Withdraw $100",
    cashInserted: "Cash inserted",
    confirm: "Confirm"
  }
};

const transactionLabels = {
  es: {
    BalanceInquiry: "Consultar saldo",
    CashWithdrawal: "Retirar efectivo",
    CashDeposit: "Depositar efectivo",
    FastCash: "Retiro rápido",
    CardlessWithdrawal: "Retiro sin tarjeta"
  },
  en: {
    BalanceInquiry: "Check balance",
    CashWithdrawal: "Withdraw cash",
    CashDeposit: "Deposit cash",
    FastCash: "Fast cash",
    CardlessWithdrawal: "Cardless withdrawal"
  }
};

const accountLabels = {
  es: { Checking: "Cuenta corriente", Savings: "Caja de ahorro", Credit: "Crédito" },
  en: { Checking: "Checking", Savings: "Savings", Credit: "Credit" }
};

const state = {
  stage: "boot",
  locale: savedValue("cashblocks.locale", ["es", "en"], "es"),
  highLegibility: localStorage.getItem("cashblocks.highLegibility") === "true",
  sessionId: "",
  prompt: null,
  result: null,
  pin: "",
  amount: "",
  receiptPrinted: false,
  currentAccount: "",
  currentAmount: 0,
  campaigns: [],
  campaignIndex: 0,
  displayConnected: false,
  errorMessage: ""
};

let campaignTimer;
let displayEvents;

initialize();

async function initialize() {
  applyPreferences();
  bindGlobalDevelopmentControl();
  connectDisplayEvents();
  render();
  await loadCampaigns();
  if (state.stage === "boot") state.stage = "idle";
  render();
}

function savedValue(key, allowed, fallback) {
  const value = localStorage.getItem(key);
  return allowed.includes(value) ? value : fallback;
}

async function loadCampaigns() {
  try {
    const response = await fetch("/campaigns/campaigns.json", {
      headers: { accept: "application/json" }
    });
    if (!response.ok) throw new Error(`Campaign manifest returned ${response.status}.`);
    state.campaigns = validateCampaignManifest(await response.json());
    preloadNextCampaign();
  } catch (error) {
    console.error(error);
    state.campaigns = [];
  }
}

function validateCampaignManifest(value) {
  if (
    !isPlainObject(value) ||
    value.version !== 1 ||
    !Array.isArray(value.campaigns) ||
    value.campaigns.length > 10
  ) {
    throw new Error("Campaign manifest is invalid.");
  }
  return value.campaigns.map((campaign) => {
    if (
      !isPlainObject(campaign) ||
      typeof campaign.id !== "string" ||
      !/^[a-z0-9-]{1,64}$/.test(campaign.id) ||
      typeof campaign.image !== "string" ||
      !/^\/campaigns\/[a-z0-9-]+\.(?:png|jpe?g)$/.test(campaign.image) ||
      !Number.isSafeInteger(campaign.durationMs) ||
      campaign.durationMs < 5000 ||
      campaign.durationMs > 30000 ||
      !isLocalizedCampaignContent(campaign.content)
    ) {
      throw new Error("Campaign entry is invalid.");
    }
    return campaign;
  });
}

function isLocalizedCampaignContent(value) {
  if (!isPlainObject(value)) return false;
  return ["es", "en"].every((locale) => {
    const content = value[locale];
    return (
      isPlainObject(content) &&
      boundedText(content.headline, 80) &&
      boundedText(content.body, 120) &&
      boundedText(content.alt, 160)
    );
  });
}

function boundedText(value, maximum) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum;
}

function isPlainObject(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function connectDisplayEvents() {
  if (!("EventSource" in window)) {
    state.displayConnected = false;
    return;
  }
  displayEvents?.close();
  displayEvents = new EventSource("/api/display-events");
  displayEvents.onopen = () => {
    state.displayConnected = true;
    updateConnectionStatus();
  };
  displayEvents.onmessage = (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (message.type === "display-ready") {
      state.displayConnected = true;
      updateConnectionStatus();
      return;
    }
    if (message.type === "card-detected" && ["boot", "idle"].includes(state.stage)) {
      stopCampaignRotation();
      state.stage = "card-detected";
      render();
      return;
    }
    if (
      message.type === "session-started" &&
      ["boot", "idle", "card-detected"].includes(state.stage)
    ) {
      applyState(message.state);
      return;
    }
    if (
      message.type === "activation-failed" &&
      ["boot", "idle", "card-detected"].includes(state.stage)
    ) {
      showError(message.message);
    }
  };
  displayEvents.onerror = () => {
    state.displayConnected = false;
    updateConnectionStatus();
  };
}

function updateConnectionStatus() {
  const status = document.querySelector("[data-reader-status]");
  if (!status) return;
  status.textContent = state.displayConnected ? text("readerReady") : text("readerUnavailable");
  status.classList.toggle("is-offline", !state.displayConnected);
}

async function simulateCardPresentation() {
  if (state.stage !== "idle") return;
  try {
    await requestJson("/api/development/card-presented", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}"
    });
  } catch (error) {
    if (error.status !== 404) showError(error.message);
  }
}

function bindGlobalDevelopmentControl() {
  window.addEventListener("keydown", (event) => {
    if (event.shiftKey && event.key.toLowerCase() === "c") {
      event.preventDefault();
      void simulateCardPresentation();
    }
  });
  Object.defineProperty(window, "cashblocksDeveloper", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: Object.freeze({ presentCard: simulateCardPresentation })
  });
}

async function startSession(options = {}) {
  stopCampaignRotation();
  state.stage = "processing";
  render();
  try {
    applyState(
      await requestJson("/api/session/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(options)
      })
    );
  } catch (error) {
    showError(error.message);
  }
}

async function answer(value) {
  if (!state.sessionId || !state.prompt) return;
  rememberAnswer(value);
  const prompt = state.prompt;
  state.stage = "processing";
  render();
  try {
    applyState(
      await requestJson("/api/session/answer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: state.sessionId,
          promptId: prompt.id,
          value
        })
      })
    );
  } catch (error) {
    showError(error.message);
  }
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(
      typeof payload.error === "string"
        ? payload.error
        : `The terminal returned ${response.status}.`
    );
    error.status = response.status;
    throw error;
  }
  return payload;
}

function applyState(next) {
  if (!isPlainObject(next)) {
    showError("The terminal returned an invalid session state.");
    return;
  }
  if (next.completed && !isPlainObject(next.summary)) {
    showError("The terminal returned an invalid session state.");
    return;
  }
  state.sessionId = typeof next.sessionId === "string" ? next.sessionId : state.sessionId;
  state.prompt = isPlainObject(next.prompt) ? next.prompt : null;
  state.result = next.completed ? next : null;

  if (next.completed) {
    state.stage = "result";
    render();
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

function rememberAnswer(value) {
  if (state.prompt?.kind === "transaction") {
    state.currentAccount = "";
    state.currentAmount = 0;
  }
  if (state.prompt?.kind === "account") state.currentAccount = value;
  if (state.prompt?.kind === "amount") state.currentAmount = Number(value) || 0;
  if (
    state.prompt?.kind === "option" &&
    state.prompt.screen === "FastCashConfirm" &&
    value === "Withdraw100"
  ) {
    state.currentAmount = 100;
  }
}

function render() {
  applyPreferences();
  app.innerHTML = screen();
  app.querySelectorAll("[data-action]").forEach((control) => {
    control.addEventListener("click", () => {
      void handleAction(control.getAttribute("data-action") || "");
    });
  });
  const campaignImage = app.querySelector("[data-campaign-id]");
  campaignImage?.addEventListener("error", () => {
    const campaignId = campaignImage.getAttribute("data-campaign-id");
    state.campaigns = state.campaigns.filter(
      (campaign) => campaign.id !== campaignId
    );
    state.campaignIndex = 0;
    render();
  });
  if (state.stage === "idle") scheduleCampaignRotation();
  else stopCampaignRotation();
}

function screen() {
  if (state.stage === "boot") return statusScreen("loader", text("initializing"), text("initializingMessage"));
  if (state.stage === "idle") return idleScreen();
  if (state.stage === "card-detected") {
    return statusScreen("card", text("cardDetected"), text("cardDetectedMessage"));
  }
  if (state.stage === "pin") {
    return transactionFrame({
      eyebrow: text("pinEyebrow"),
      title: text("pinTitle"),
      message: text("pinMessage"),
      body: `<div class="pin-layout">
        ${secureDots(state.pin)}
        ${keypad("pin")}
      </div>`
    });
  }
  if (state.stage === "transaction") return transactionMenu();
  if (state.stage === "account") {
    const items = (state.prompt?.options || []).map((option) => ({
      label: accountLabel(option),
      action: `answer:${option}`,
      icon: "account"
    }));
    return transactionFrame({
      eyebrow: text("accountEyebrow"),
      title: text("accountTitle"),
      message: text("accountMessage"),
      body: actions(items, "selection-list")
    });
  }
  if (state.stage === "amount") {
    const presets = state.prompt?.presets || [];
    return transactionFrame({
      eyebrow: text("amountEyebrow"),
      title: state.prompt?.prompt ? localizedPrompt(state.prompt.prompt) : text("amountTitle"),
      message: text("amountMessage"),
      body: `<div class="amount-layout">
        <div class="amount-selection">
          ${actions(
            presets.map((amount) => ({
              label: money(amount),
              action: `answer:${amount}`,
              icon: "cash"
            })),
            "preset-list"
          )}
          <div class="custom-amount">
            <span>${escapeHtml(text("enterAmount"))}</span>
            <strong>${state.amount ? escapeHtml(money(Number(state.amount))) : "0"}</strong>
          </div>
        </div>
        ${keypad("amount")}
      </div>`
    });
  }
  if (state.stage === "option") return optionScreen();
  if (state.stage === "processing") {
    return statusScreen("processing", text("processingTitle"), text("processingMessage"));
  }
  if (state.stage === "result" && state.result) return resultScreen();
  if (state.stage === "error") {
    return transactionFrame({
      eyebrow: text("unableEyebrow"),
      title: text("connectionTitle"),
      message: state.errorMessage || text("connectionMessage"),
      body: actions([
        { label: text("returnHome"), action: "reset", icon: "back", primary: true },
        { label: text("cardless"), action: "cardless", icon: "cardless" }
      ], "selection-list")
    });
  }
  return idleScreen();
}

function idleScreen() {
  const campaign = currentCampaign();
  const campaignContent = campaign?.content[state.locale];
  const campaignMarkup = campaign
    ? `<article class="campaign" aria-label="${escapeHtml(campaignContent.headline)}">
        <img
          class="campaign-image"
          src="${escapeHtml(campaign.image)}"
          alt="${escapeHtml(campaignContent.alt)}"
          data-campaign-id="${escapeHtml(campaign.id)}"
          width="1672"
          height="941"
        >
        <div class="campaign-copy">
          <h1>${escapeHtml(campaignContent.headline)}</h1>
          <p>${escapeHtml(campaignContent.body)}</p>
        </div>
      </article>`
    : `<article class="campaign campaign-fallback">
        ${icon("bank", "campaign-fallback-icon")}
        <div class="campaign-copy">
          <h1>${escapeHtml(text("campaignFallbackTitle"))}</h1>
          <p>${escapeHtml(text("campaignFallbackBody"))}</p>
        </div>
      </article>`;

  return `<div class="terminal-shell idle-shell">
    ${header(false)}
    <main id="main-content" class="idle-main">
      ${campaignMarkup}
      ${campaignIndicators()}
      <section class="activation-panel" aria-labelledby="activation-title">
        <div class="activation-instruction">
          <div class="activation-icons" aria-hidden="true">
            ${icon("card")}
            ${icon("contactless")}
          </div>
          <h2 id="activation-title">${escapeHtml(text("insertCard"))}</h2>
        </div>
        <button class="button button-secondary cardless-action" data-action="cardless">
          ${icon("cardless")}
          <span>${escapeHtml(text("cardless"))}</span>
        </button>
      </section>
      <p class="reader-status ${state.displayConnected ? "" : "is-offline"}" data-reader-status role="status">
        ${escapeHtml(state.displayConnected ? text("readerReady") : text("readerUnavailable"))}
      </p>
    </main>
  </div>`;
}

function transactionMenu() {
  const allowed = (state.prompt?.options || []).filter(
    (option) => !option.startsWith("Admin") && option !== "CardlessWithdrawal"
  );
  const prioritized = [
    "CashWithdrawal",
    "BalanceInquiry",
    "CashDeposit",
    "FastCash"
  ].filter((option) => allowed.includes(option));
  return transactionFrame({
    eyebrow: text("transactionEyebrow"),
    title: text("transactionTitle"),
    message: text("transactionMessage"),
    body: actions(
      prioritized.map((option) => ({
        label: transactionLabel(option),
        action: `answer:${option}`,
        icon: transactionIcon(option)
      })),
      "transaction-list"
    )
  });
}

function optionScreen() {
  const optionItems = (state.prompt?.options || []).map((option, index) => ({
    label: formatOptionLabel(option),
    action: `answer:${option}`,
    icon: index === 0 ? "confirm" : "back",
    primary: index === 0
  }));
  const view = optionScreenView(state.prompt?.screen);
  return transactionFrame({
    eyebrow: view.eyebrow,
    title: view.title,
    message: view.message,
    body: optionContext(view) + actions(optionItems, "confirmation-actions")
  });
}

function resultScreen() {
  const summary = state.result.summary;
  const failed = Boolean(summary.failed);
  const result = localizedResult(summary);
  return transactionFrame({
    eyebrow: failed ? text("unableEyebrow") : text("completeEyebrow"),
    title: result.title,
    message: result.message,
    tone: failed ? "error" : "success",
    body: details(summary) + actions(resultActions(summary), "confirmation-actions")
  });
}

function header(session) {
  return `<header class="terminal-header">
    <div class="wordmark" aria-label="Cashblocks">CASHBLOCKS</div>
    ${session ? `<div class="secure-session">${icon("lock")}<span>${escapeHtml(text("secureSession"))}</span></div>` : ""}
    <nav class="utility-actions" aria-label="${state.locale === "es" ? "Preferencias" : "Preferences"}">
      <button class="utility-button" data-action="language">${escapeHtml(text("english"))}</button>
      <button
        class="utility-button accessibility-button"
        data-action="accessibility"
        aria-pressed="${state.highLegibility}"
        aria-label="${escapeHtml(
          state.highLegibility ? text("accessibilityOn") : text("accessibilityOff")
        )}"
      >
        ${icon("accessibility")}
        <span>${escapeHtml(text("accessibility"))}</span>
      </button>
    </nav>
  </header>`;
}

function transactionFrame(view) {
  return `<div class="terminal-shell transaction-shell ${view.tone ? `tone-${view.tone}` : ""}">
    ${header(true)}
    <main id="main-content" class="transaction-main">
      <div class="screen-heading">
        <div class="eyebrow">${escapeHtml(view.eyebrow)}</div>
        <h1>${escapeHtml(view.title)}</h1>
        <p>${escapeHtml(view.message)}</p>
      </div>
      <div class="screen-body">${view.body}</div>
    </main>
  </div>`;
}

function statusScreen(iconName, title, message) {
  return `<div class="terminal-shell status-shell">
    ${header(Boolean(state.sessionId))}
    <main id="main-content" class="status-main" role="status" aria-live="polite">
      <div class="status-symbol ${iconName === "processing" ? "is-processing" : ""}">
        ${icon(iconName === "loader" ? "bank" : iconName)}
      </div>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(message)}</p>
    </main>
  </div>`;
}

function actions(items, className = "") {
  return `<div class="actions ${className}">${items
    .map(
      (item) => `<button
        class="action-row ${item.primary ? "is-primary" : ""}"
        data-action="${escapeHtml(item.action)}"
        ${item.disabled ? "disabled" : ""}
      >
        <span class="action-icon">${icon(item.icon || "arrow")}</span>
        <span class="action-label">${escapeHtml(item.label)}</span>
        ${item.primary ? "" : `<span class="action-arrow">${icon("arrow")}</span>`}
      </button>`
    )
    .join("")}</div>`;
}

function keypad(mode) {
  const keys = [
    "1", "2", "3", "4", "5", "6", "7", "8", "9",
    "Clear", "0", "Enter"
  ];
  return `<div class="keypad" role="group" aria-label="${escapeHtml(
    mode === "pin" ? text("pinTitle") : text("amountTitle")
  )}">${keys
    .map((key) => {
      const label = key === "Clear" ? text("clear") : key === "Enter" ? text("enter") : key;
      return `<button
        class="key ${key === "Enter" ? "key-enter" : ""}"
        data-action="${mode}:${key}"
      >${escapeHtml(label)}</button>`;
    })
    .join("")}</div>`;
}

function secureDots(value) {
  const label =
    state.locale === "es"
      ? `${value.length} de 4 dígitos ingresados`
      : `${value.length} of 4 digits entered`;
  return `<div class="secure-entry" aria-label="${escapeHtml(label)}">
    ${Array.from({ length: 4 }, (_, index) =>
      `<span class="${index < value.length ? "is-filled" : ""}"></span>`
    ).join("")}
  </div>`;
}

function resultActions(summary) {
  if (summary.failed) {
    return [
      { label: text("tryAgain"), action: "reset", icon: "back", primary: true }
    ];
  }
  return [
    {
      label: state.receiptPrinted ? text("receiptPrinted") : text("printReceipt"),
      action: "print",
      icon: "receipt",
      disabled: state.receiptPrinted
    },
    { label: text("finish"), action: "finish", icon: "confirm", primary: true }
  ];
}

function details(summary) {
  const rows = [
    summary.adminOperation ? detail(text("operation"), formatAdminOperation(summary.adminOperation)) : "",
    summary.cashAdjustment ? detail(text("cashAdjustment"), summary.cashAdjustment) : "",
    summary.selectedAccount ? detail(text("account"), accountLabel(summary.selectedAccount)) : "",
    summary.selectedAmount ? detail(text("amount"), money(summary.selectedAmount)) : "",
    summary.balanceBefore != null ? detail(text("balanceBefore"), money(summary.balanceBefore)) : "",
    summary.balanceAfter != null ? detail(text("balanceAfter"), money(summary.balanceAfter)) : "",
    summary.terminalCashBefore != null ? detail(text("terminalCashBefore"), money(summary.terminalCashBefore)) : "",
    summary.terminalCashAfter != null ? detail(text("terminalCash"), money(summary.terminalCashAfter)) : "",
    summary.accounts ? detail(text("accounts"), formatAccounts(summary.accounts)) : "",
    detail(text("receipt"), state.receiptPrinted ? text("printed") : text("notPrinted"))
  ].filter(Boolean);
  return `<dl class="details">${rows.join("")}</dl>`;
}

function detail(label, value) {
  return `<div class="detail"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

function optionScreenView(screen) {
  const account = state.currentAccount ? accountLabel(state.currentAccount) : text("selectedAccount");
  const amount = state.currentAmount ? money(state.currentAmount) : text("selectedAmount");
  if (screen === "PrinterDown") {
    return {
      eyebrow: text("receiptUnavailableEyebrow"),
      title: text("receiptUnavailable"),
      message: text("receiptUnavailableMessage"),
      context: []
    };
  }
  if (screen === "CardlessAccess") {
    return {
      eyebrow: text("cardlessEyebrow"),
      title: text("cardlessTitle"),
      message: text("cardlessMessage"),
      context: [{ label: text("mode"), value: text("cardlessWithdrawal") }]
    };
  }
  if (screen === "WithdrawalConfirm" || screen === "CardlessWithdrawalConfirm") {
    return {
      eyebrow: text("confirmCashEyebrow"),
      title: text("confirmWithdrawal"),
      message:
        state.locale === "es"
          ? `Retire ${amount} de ${account}.`
          : `Withdraw ${amount} from ${account}.`,
      context: transactionContext()
    };
  }
  if (screen === "FastCashConfirm") {
    return {
      eyebrow: text("confirmCashEyebrow"),
      title: text("confirmFastCash"),
      message:
        state.locale === "es"
          ? `Retire ${money(100)} de ${account}.`
          : `Withdraw ${money(100)} from ${account}.`,
      context: [
        { label: text("account"), value: account },
        { label: text("amount"), value: money(100) }
      ]
    };
  }
  if (screen === "DepositInsertCash") {
    return {
      eyebrow: text("insertDepositEyebrow"),
      title: text("insertDeposit"),
      message:
        state.locale === "es"
          ? `Ingrese ${amount} y confirme cuando el terminal lo haya aceptado.`
          : `Insert ${amount} and confirm when the terminal has accepted it.`,
      context: transactionContext()
    };
  }
  if (screen === "BalanceDisplay") {
    return {
      eyebrow: text("balanceDeliveryEyebrow"),
      title: text("balanceDelivery"),
      message:
        state.locale === "es"
          ? `Consulte el saldo de ${account} en pantalla o en un comprobante.`
          : `View the ${account} balance on screen or on a receipt.`,
      context: [{ label: text("account"), value: account }]
    };
  }
  return {
    eyebrow: text("decisionEyebrow"),
    title: state.prompt?.prompt || text("decisionEyebrow"),
    message: text("chooseOption"),
    context: []
  };
}

function transactionContext() {
  return [
    state.currentAccount
      ? { label: text("account"), value: accountLabel(state.currentAccount) }
      : null,
    state.currentAmount
      ? { label: text("amount"), value: money(state.currentAmount) }
      : null
  ].filter(Boolean);
}

function optionContext(view) {
  if (!view.context.length) return "";
  return `<dl class="context-panel">${view.context
    .map(
      (item) =>
        `<div><dt>${escapeHtml(item.label)}</dt><dd>${escapeHtml(item.value)}</dd></div>`
    )
    .join("")}</dl>`;
}

function formatOptionLabel(option) {
  if (["YES", "Continue"].includes(option)) return text("continue");
  if (["NO", "CANCEL", "Cancel"].includes(option)) return text("cancel");
  if (option === "Confirm") return text("confirm");
  if (option === "Withdraw100") return text("withdraw100");
  if (option === "CashInserted") return text("cashInserted");
  if (option === "DisplayBalance") return text("showOnScreen");
  if (option === "PrintReceipt") return text("printReceipt");
  return option;
}

async function handleAction(action) {
  if (!action || action === "none") return;
  if (action === "reset" || action === "finish") return reset();
  if (action === "cardless") return startSession({ customerType: "TOUCH" });
  if (action === "language") return toggleLanguage();
  if (action === "accessibility") return toggleAccessibility();
  if (action === "print") {
    state.receiptPrinted = true;
    return render();
  }
  if (action.startsWith("answer:")) return answer(action.slice("answer:".length));
  if (action.startsWith("pin:")) return handlePin(action.slice(4));
  if (action.startsWith("amount:")) return handleAmount(action.slice(7));
}

function handlePin(key) {
  if (key === "Clear") {
    state.pin = "";
    return render();
  }
  if (key === "Enter") {
    if (state.pin.length === 4) void answer(state.pin);
    return;
  }
  if (/^\d$/.test(key) && state.pin.length < 4) state.pin += key;
  render();
}

function handleAmount(key) {
  if (key === "Clear") {
    state.amount = "";
    return render();
  }
  if (key === "Enter") {
    if (Number(state.amount) > 0) void answer(state.amount);
    return;
  }
  if (/^\d$/.test(key) && state.amount.length < 5) state.amount += key;
  render();
}

function toggleLanguage() {
  state.locale = state.locale === "es" ? "en" : "es";
  localStorage.setItem("cashblocks.locale", state.locale);
  render();
}

function toggleAccessibility() {
  state.highLegibility = !state.highLegibility;
  localStorage.setItem("cashblocks.highLegibility", String(state.highLegibility));
  render();
}

function applyPreferences() {
  document.documentElement.lang = state.locale;
  document.documentElement.dataset.legibility = state.highLegibility ? "high" : "standard";
  if (skipLink) skipLink.textContent = text("skip");
}

function reset() {
  state.stage = "idle";
  state.sessionId = "";
  state.prompt = null;
  state.result = null;
  state.pin = "";
  state.amount = "";
  state.receiptPrinted = false;
  state.currentAccount = "";
  state.currentAmount = 0;
  state.errorMessage = "";
  render();
}

function showError(message) {
  stopCampaignRotation();
  state.errorMessage = localizedError(message);
  state.stage = "error";
  render();
}

function currentCampaign() {
  if (state.campaigns.length === 0) return null;
  return state.campaigns[state.campaignIndex % state.campaigns.length] || null;
}

function campaignIndicators() {
  if (state.campaigns.length < 2) return "";
  return `<div class="campaign-indicators" aria-hidden="true">${state.campaigns
    .map(
      (_campaign, index) =>
        `<span class="${index === state.campaignIndex ? "is-active" : ""}"></span>`
    )
    .join("")}</div>`;
}

function scheduleCampaignRotation() {
  stopCampaignRotation();
  const campaign = currentCampaign();
  if (!campaign || state.campaigns.length < 2) return;
  campaignTimer = window.setTimeout(() => {
    state.campaignIndex = (state.campaignIndex + 1) % state.campaigns.length;
    preloadNextCampaign();
    render();
  }, campaign.durationMs);
}

function stopCampaignRotation() {
  if (campaignTimer) window.clearTimeout(campaignTimer);
  campaignTimer = undefined;
}

function preloadNextCampaign() {
  if (state.campaigns.length < 2) return;
  const next =
    state.campaigns[(state.campaignIndex + 1) % state.campaigns.length];
  if (!next) return;
  const image = new Image();
  image.decoding = "async";
  image.src = next.image;
}

function text(key) {
  return copy[state.locale][key] || copy.es[key] || key;
}

function transactionLabel(transaction) {
  return transactionLabels[state.locale][transaction] || transaction;
}

function accountLabel(account) {
  return accountLabels[state.locale][account] || account;
}

function localizedResult(summary) {
  if (state.locale === "en") {
    return {
      title:
        summary.screenTitle ||
        (summary.failed ? text("unableEyebrow") : text("completeEyebrow")),
      message: summary.screenMessage || ""
    };
  }

  if (summary.status === "cancelled") {
    return {
      title: "Operación cancelada",
      message: cancellationMessage(summary.cancellationReason)
    };
  }

  if (summary.failed) {
    return failureMessage(summary.failureCode);
  }

  const transaction = summary.selectedTransaction
    ? transactionLabel(summary.selectedTransaction)
    : "La operación";
  const account = summary.selectedAccount
    ? ` en ${accountLabel(summary.selectedAccount)}`
    : "";
  const amount = summary.selectedAmount
    ? ` por ${money(summary.selectedAmount)}`
    : "";
  const balance =
    summary.balanceAfter != null
      ? ` Su saldo actual es ${money(summary.balanceAfter)}.`
      : "";
  return {
    title: "Operación completada",
    message: `${transaction}${amount}${account} finalizó correctamente.${balance}`
  };
}

function failureMessage(code) {
  const messages = {
    HOST_DECLINED: {
      title: "Operación rechazada",
      message: "El banco no autorizó esta operación."
    },
    DISPENSER_OFFLINE: {
      title: "Efectivo no disponible",
      message: "Este terminal no puede entregar efectivo en este momento."
    },
    ACCEPTOR_OFFLINE: {
      title: "Depósito no disponible",
      message: "Este terminal no puede recibir efectivo en este momento."
    },
    CARD_READER_OFFLINE: {
      title: "Lector no disponible",
      message: "Este terminal no puede leer tarjetas en este momento."
    },
    ADAPTER_OUTCOME_UNKNOWN: {
      title: "Necesitamos revisar la operación",
      message: "No pudimos confirmar el resultado. Solicite asistencia."
    }
  };
  return (
    messages[code] || {
      title: "No pudimos completar la operación",
      message: "Inténtelo nuevamente o solicite asistencia."
    }
  );
}

function cancellationMessage(reason) {
  if (reason === "receipt_unavailable") {
    return "El comprobante no estaba disponible y eligió no continuar.";
  }
  if (reason === "deposit_cash_not_inserted") {
    return "El depósito se canceló antes de ingresar el efectivo.";
  }
  if (reason === "cardless_access_cancelled") {
    return "El acceso sin tarjeta fue cancelado.";
  }
  return "La operación finalizó sin realizar movimientos.";
}

function localizedError(message) {
  if (state.locale === "en") {
    return typeof message === "string" && message.trim()
      ? message
      : text("connectionMessage");
  }
  if (message === "The terminal already has an active customer session.") {
    return "Ya hay una sesión activa en este terminal.";
  }
  return text("connectionMessage");
}

function transactionIcon(transaction) {
  if (transaction === "CashWithdrawal") return "withdraw";
  if (transaction === "BalanceInquiry") return "balance";
  if (transaction === "CashDeposit") return "deposit";
  return "more";
}

function localizedPrompt(prompt) {
  if (state.locale === "en") return prompt;
  if (/withdrawal amount/i.test(prompt)) return text("amountTitle");
  if (/deposit amount/i.test(prompt)) return text("amountTitle");
  return text("amountTitle");
}

function money(amount) {
  return `$${Number(amount || 0).toLocaleString(state.locale === "es" ? "es-AR" : "en-US")}`;
}

function formatAccounts(accounts) {
  return Object.entries(accounts)
    .map(([account, balance]) => `${accountLabel(account)} ${money(balance)}`)
    .join(" · ");
}

function formatAdminOperation(operation) {
  return String(operation).replaceAll("_", " ");
}

function icon(name, className = "") {
  const paths = {
    accessibility:
      '<circle cx="12" cy="4" r="2"></circle><path d="M5 8h14M12 6v14M8 21l4-8 4 8"></path>',
    account:
      '<circle cx="12" cy="8" r="4"></circle><path d="M4 21c.8-4.2 3.5-6 8-6s7.2 1.8 8 6"></path>',
    arrow: '<path d="m9 5 7 7-7 7"></path>',
    back: '<path d="m15 18-6-6 6-6"></path>',
    balance:
      '<rect x="5" y="3" width="14" height="18" rx="2"></rect><path d="M8 8h8M8 12h8M8 16h5"></path>',
    bank:
      '<path d="m3 10 9-6 9 6M5 10h14M6 10v8M10 10v8M14 10v8M18 10v8M4 20h16"></path>',
    card:
      '<rect x="2.5" y="5" width="19" height="14" rx="2"></rect><path d="M2.5 9h19M6 15h4"></path>',
    cardless:
      '<circle cx="8" cy="8" r="3"></circle><path d="M3 20c.6-4 2.2-6 5-6s4.4 2 5 6M16 7c1.3 1.3 1.3 3.7 0 5M19 4c3 3 3 8 0 11"></path>',
    cash:
      '<rect x="3" y="6" width="18" height="12" rx="2"></rect><circle cx="12" cy="12" r="3"></circle><path d="M6 9h.01M18 15h.01"></path>',
    confirm: '<path d="m4 12 5 5L20 6"></path>',
    contactless:
      '<path d="M7 8c2.2 2.2 2.2 5.8 0 8M11 5c4 4 4 10 0 14M15 2c6 6 6 14 0 20"></path>',
    deposit:
      '<path d="M12 3v11M8 10l4 4 4-4"></path><path d="M4 16v4h16v-4"></path>',
    lock:
      '<rect x="5" y="10" width="14" height="11" rx="2"></rect><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"></path>',
    more: '<circle cx="5" cy="12" r="1"></circle><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle>',
    processing:
      '<circle cx="12" cy="12" r="9" opacity=".25"></circle><path d="M12 3a9 9 0 0 1 9 9"></path>',
    receipt:
      '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z"></path><path d="M9 8h6M9 12h6M9 16h4"></path>',
    withdraw:
      '<path d="M5 10h14v8H5zM8 6h8v4M8 14h8M12 14v5"></path>'
  };
  const path = paths[name] || paths.more;
  return `<svg
    class="icon ${escapeHtml(className)}"
    viewBox="0 0 24 24"
    aria-hidden="true"
    focusable="false"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
  >${path}</svg>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
