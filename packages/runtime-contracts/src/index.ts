export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type DeviceHealth = "HEALTHY" | "DEGRADED" | "FATAL" | "MISSING";
export type PaperStatus = "OK" | "LOW" | "OUT";
export type CustomerType = "OnUs" | "Local" | "TOUCH" | "OperatorAdmin" | "Unknown";

export type RuntimeEventType =
  | "runtime.started"
  | "flow.loaded"
  | "flow.failed"
  | "session.started"
  | "transaction.selected"
  | "transaction.started"
  | "transaction.completed"
  | "transaction.cancelled"
  | "transaction.failed"
  | "transaction.reconciliation_required"
  | "device.status_changed"
  | "host.authorization_requested"
  | "host.authorization_result"
  | "journal.line_logged"
  | "transaction.detail_recorded"
  | "ui.input_received"
  | "ui.prompt";

export type RuntimeEvent = {
  seq: number;
  type: RuntimeEventType;
  ts: string;
  source: "runtime" | "flow" | "module" | "simulator" | "ui";
  sessionId?: string;
  payload?: Record<string, JsonValue>;
};

export type RuntimeEventDraft = Omit<RuntimeEvent, "seq" | "ts"> & {
  ts?: string;
};

export type DiagnosticLogLevel = "debug" | "info" | "warn" | "error";

export type DiagnosticCorrelation = {
  sessionId: string;
  transactionId?: string;
  transactionName?: string;
};

export type DiagnosticLogEntry = {
  level: DiagnosticLogLevel;
  ts: string;
  source: "runtime" | "flow" | "module" | "adapter" | "simulator" | "ui";
  message: string;
  sessionId?: string;
  correlation?: DiagnosticCorrelation;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
  metadata?: Record<string, JsonValue>;
};

export type DiagnosticLogger = {
  log(entry: DiagnosticLogEntry): void;
};

export type AuthorizationConfig = {
  PinlessAuthorizationEnabled: boolean;
  ChipAuthorizationRequired: boolean;
  TransactionHost: string;
  PinEntryOption: "Always" | "Never" | "ExceptFirst";
};

export type TransactionResult = {
  ok: boolean;
  code: string;
  message: string;
  details?: Record<string, JsonValue>;
};

export type AdapterResult = {
  ok: boolean;
  code: string;
  message: string;
  details?: Record<string, JsonValue>;
};

export type ReceiptPrinterStatus = {
  health: DeviceHealth;
  paper: PaperStatus;
};

export type AdapterKind =
  | "receipt-printer"
  | "cash-dispenser"
  | "cash-acceptor"
  | "card-reader"
  | "host-authorization";

export type AdapterOperationContext = {
  operationId: string;
  sessionId: string;
  adapterId: string;
  operation: string;
  transactionName?: string;
  timeoutMs: number;
  startedAt: string;
  deadlineAt: string;
  signal: AbortSignal;
};

export type TerminalAdapter = {
  readonly id: string;
  readonly kind: AdapterKind;
  readonly capabilities: readonly string[];
};

export type ReceiptPrinterAdapter = TerminalAdapter & {
  readonly kind: "receipt-printer";
  getStatus(context?: AdapterOperationContext): Promise<ReceiptPrinterStatus>;
  printReceipt(
    lines: string[],
    context?: AdapterOperationContext
  ): Promise<AdapterResult>;
};

export type CashDispenserAdapter = TerminalAdapter & {
  readonly kind: "cash-dispenser";
  dispense(
    input: { amount: number; currencyCode: string },
    context?: AdapterOperationContext
  ): Promise<AdapterResult>;
};

export type CashAcceptorAdapter = TerminalAdapter & {
  readonly kind: "cash-acceptor";
  accept(
    input: { expectedAmount?: number; currencyCode: string },
    context?: AdapterOperationContext
  ): Promise<AdapterResult>;
};

export type CardReaderAdapter = TerminalAdapter & {
  readonly kind: "card-reader";
  readCard(context?: AdapterOperationContext): Promise<AdapterResult>;
};

export type HostAuthorizationRequest = {
  transaction: string;
  host: string;
  account?: string;
  amount?: number;
  currencyCode: string;
  pinless: boolean;
  chipRequired: boolean;
};

export type HostAuthorizationAdapter = TerminalAdapter & {
  readonly kind: "host-authorization";
  authorize(
    request: HostAuthorizationRequest,
    context?: AdapterOperationContext
  ): Promise<AdapterResult>;
};

export type TerminalAdapters = {
  receiptPrinter: ReceiptPrinterAdapter;
  cashDispenser: CashDispenserAdapter;
  cashAcceptor: CashAcceptorAdapter;
  cardReader: CardReaderAdapter;
  hostAuthorization: HostAuthorizationAdapter;
};

export function validateTerminalAdapters(adapters: TerminalAdapters): ValidationIssue[] {
  const expectedKinds: Record<keyof TerminalAdapters, AdapterKind> = {
    receiptPrinter: "receipt-printer",
    cashDispenser: "cash-dispenser",
    cashAcceptor: "cash-acceptor",
    cardReader: "card-reader",
    hostAuthorization: "host-authorization"
  };
  const issues: ValidationIssue[] = [];
  const ids = new Set<string>();
  const allowedCapabilities: Record<AdapterKind, readonly string[]> = {
    "receipt-printer": ["status", "print"],
    "cash-dispenser": ["dispense", "finite-inventory"],
    "cash-acceptor": ["accept", "amount-confirmation", "recycling"],
    "card-reader": ["read", "contact", "contactless", "chip", "magstripe"],
    "host-authorization": ["authorize", "reversal", "advice"]
  };
  const requiredOperations: Record<keyof TerminalAdapters, readonly string[]> = {
    receiptPrinter: ["getStatus", "printReceipt"],
    cashDispenser: ["dispense"],
    cashAcceptor: ["accept"],
    cardReader: ["readCard"],
    hostAuthorization: ["authorize"]
  };
  const requiredCapabilities: Record<keyof TerminalAdapters, readonly string[]> = {
    receiptPrinter: ["status", "print"],
    cashDispenser: ["dispense"],
    cashAcceptor: ["accept"],
    cardReader: ["read"],
    hostAuthorization: ["authorize"]
  };

  for (const [slot, expectedKind] of Object.entries(expectedKinds) as Array<
    [keyof TerminalAdapters, AdapterKind]
  >) {
    const adapter = adapters[slot];
    if (!adapter.id.trim()) {
      issues.push({ field: slot, message: "Adapter id is required." });
    } else if (ids.has(adapter.id)) {
      issues.push({ field: slot, message: `Duplicate adapter id: ${adapter.id}.` });
    } else {
      ids.add(adapter.id);
    }
    if (adapter.kind !== expectedKind) {
      issues.push({
        field: slot,
        message: `Expected adapter kind ${expectedKind}, received ${adapter.kind}.`
      });
    }
    const capabilities = adapter.capabilities;
    if (
      capabilities.some((capability) => !capability.trim()) ||
      new Set(capabilities).size !== capabilities.length
    ) {
      issues.push({
        field: slot,
        message: "Adapter capabilities must be non-empty and unique."
      });
    }
    const allowed = allowedCapabilities[expectedKind];
    for (const capability of capabilities) {
      if (!allowed.includes(capability)) {
        issues.push({
          field: slot,
          message: `Unsupported ${expectedKind} capability: ${capability}.`
        });
      }
    }
    for (const capability of requiredCapabilities[slot]) {
      if (!capabilities.includes(capability)) {
        issues.push({
          field: slot,
          message: `Required capability missing: ${capability}.`
        });
      }
    }
    const adapterRecord = adapter as unknown as Record<string, unknown>;
    for (const operation of requiredOperations[slot]) {
      if (typeof adapterRecord[operation] !== "function") {
        issues.push({
          field: slot,
          message: `Required adapter operation missing: ${operation}.`
        });
      }
    }
  }

  return issues;
}

export type ModuleHandler = () => void | boolean | Promise<void | boolean>;

export type TransactionModule = {
  readonly Name: string;
  AddHandler(eventName: string, handler: ModuleHandler): void;
  Execute(): Promise<TransactionResult>;
  Log(message: string): void;
};

export type ScratchPad = {
  Set(key: string, value: JsonValue): void;
  Get<T extends JsonValue = JsonValue>(key: string): T | undefined;
  Contains(key: string): boolean;
  Remove(key: string): void;
  Clear(): void;
};

export type RuntimeApi = {
  ScratchPad: ScratchPad;
  SetCurrencyDetails(currencyCode: string, symbol: string, symbolBeforeAmount: boolean): void;
  SetProperty(path: string, value: JsonValue): void;
  GetProperty<T extends JsonValue = JsonValue>(path: string): T | undefined;
  Log(message: string): void;
  LogJournalLine(message: string): void;
  LocalLanguage: {
    CurrentLanguage: string;
  };
};

export type CustomerPrompt =
  | {
      kind: "pin";
      prompt: string;
    }
  | {
      kind: "transaction";
      prompt: string;
      options: string[];
    }
  | {
      kind: "account";
      prompt: string;
      options: string[];
    }
  | {
      kind: "amount";
      prompt: string;
      currencyCode: string;
      presets: number[];
      allowCustom: boolean;
    }
  | {
      kind: "option";
      screen: string;
      prompt: string;
      options: string[];
    };

export type CustomerPromptAnswer = {
  value: string;
};

export type CustomerInteraction = {
  request(prompt: CustomerPrompt): Promise<CustomerPromptAnswer>;
};

export type FlowLifecycle = {
  OnStartOfDay?(): void | Promise<void>;
  OnIdle?(): void | Promise<void>;
};

export type ValidationIssue = {
  field: string;
  message: string;
};

export type FlowPackage = {
  id: string;
  version: string;
  description?: string;
  entrypoint: string;
  capabilities: string[];
  modules?: string[];
};

export const knownFlowCapabilities = [
  "receipt-printer",
  "cash-dispenser",
  "cash-acceptor",
  "card-reader",
  "host-authorization"
] as const;

export const knownAtmModules = [
  "Idle",
  "Customer",
  "CoreSession",
  "BalanceInquiry",
  "CashWithdrawal",
  "CardlessCashWithdrawal",
  "CashDeposit",
  "FastCash",
  "TerminalAdmin"
] as const;

export function validateFlowPackage(flowPackage: FlowPackage): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!flowPackage.id.trim()) {
    issues.push({ field: "id", message: "Flow package id is required." });
  }

  if (!flowPackage.version.trim()) {
    issues.push({ field: "version", message: "Flow package version is required." });
  }

  if (!flowPackage.entrypoint.trim()) {
    issues.push({ field: "entrypoint", message: "Flow package entrypoint is required." });
  }

  if (!Array.isArray(flowPackage.capabilities)) {
    issues.push({ field: "capabilities", message: "Capabilities must be an array." });
  } else {
    for (const capability of flowPackage.capabilities) {
      if (!(knownFlowCapabilities as readonly string[]).includes(capability)) {
        issues.push({
          field: "capabilities",
          message: `Unknown capability: ${capability}.`
        });
      }
    }
  }

  if (flowPackage.modules) {
    for (const moduleName of flowPackage.modules) {
      if (!(knownAtmModules as readonly string[]).includes(moduleName)) {
        issues.push({
          field: "modules",
          message: `Unknown module: ${moduleName}.`
        });
      }
    }
  }

  return issues;
}
