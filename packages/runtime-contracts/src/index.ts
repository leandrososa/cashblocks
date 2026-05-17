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
  | "transaction.failed"
  | "device.status_changed"
  | "host.authorization_requested"
  | "host.authorization_result"
  | "journal.line_logged"
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

export type ReceiptPrinterAdapter = {
  readonly id: string;
  getStatus(): Promise<ReceiptPrinterStatus>;
  printReceipt(lines: string[]): Promise<AdapterResult>;
};

export type CashDispenserAdapter = {
  readonly id: string;
  dispense(input: { amount: number; currencyCode: string }): Promise<AdapterResult>;
};

export type CashAcceptorAdapter = {
  readonly id: string;
  accept(input: { expectedAmount?: number; currencyCode: string }): Promise<AdapterResult>;
};

export type CardReaderAdapter = {
  readonly id: string;
  readCard(): Promise<AdapterResult>;
};

export type HostAuthorizationRequest = {
  transaction: string;
  host: string;
  amount?: number;
  currencyCode: string;
  pinless: boolean;
  chipRequired: boolean;
};

export type HostAuthorizationAdapter = {
  readonly id: string;
  authorize(request: HostAuthorizationRequest): Promise<AdapterResult>;
};

export type TerminalAdapters = {
  receiptPrinter: ReceiptPrinterAdapter;
  cashDispenser: CashDispenserAdapter;
  cashAcceptor: CashAcceptorAdapter;
  cardReader: CardReaderAdapter;
  hostAuthorization: HostAuthorizationAdapter;
};

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
  }

  return issues;
}
