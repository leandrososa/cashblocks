import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

import type {
  AdapterResult,
  AdapterOperationContext,
  CashAcceptorAdapter,
  CashDispenserAdapter,
  CardReaderAdapter,
  DiagnosticCorrelation,
  DiagnosticLogEntry,
  DiagnosticLogLevel,
  DiagnosticLogger,
  CustomerInteraction,
  CustomerPrompt,
  CustomerPromptAnswer,
  HostAuthorizationAdapter,
  HostAuthorizationRequest,
  JsonValue,
  ModuleHandler,
  ReceiptPrinterAdapter,
  ReceiptPrinterStatus,
  RuntimeApi,
  RuntimeEvent,
  RuntimeEventDraft,
  ScratchPad,
  TerminalAdapters,
  TransactionResult
} from "../../runtime-contracts/src/index.js";
import { validateTerminalAdapters } from "../../runtime-contracts/src/index.js";

export class MemoryScratchPad implements ScratchPad {
  private readonly values = new Map<string, JsonValue>();

  Set(key: string, value: JsonValue): void {
    this.values.set(key, value);
  }

  Get<T extends JsonValue = JsonValue>(key: string): T | undefined {
    return this.values.get(key) as T | undefined;
  }

  Contains(key: string): boolean {
    return this.values.has(key);
  }

  Remove(key: string): void {
    this.values.delete(key);
  }

  Clear(): void {
    this.values.clear();
  }
}

export class PropertyStore {
  private readonly values = new Map<string, JsonValue>();

  Set(path: string, value: JsonValue): void {
    this.values.set(path, value);
  }

  Get<T extends JsonValue = JsonValue>(path: string): T | undefined {
    return this.values.get(path) as T | undefined;
  }
}

export class RuntimeJournal {
  private seq = 0;
  private readonly events: RuntimeEvent[] = [];
  private persistence?: JournalPersistence;
  private pendingPersistence: Promise<void> = Promise.resolve();

  constructor(options: { persistence?: JournalPersistence } = {}) {
    this.persistence = options.persistence;
  }

  append(draft: RuntimeEventDraft): RuntimeEvent {
    const event: RuntimeEvent = {
      ...draft,
      seq: ++this.seq,
      ts: draft.ts ?? new Date().toISOString()
    };
    this.events.push(event);
    if (this.persistence) {
      this.pendingPersistence = this.pendingPersistence.then(async () => {
        await this.persistence?.append(event);
      });
    }
    return event;
  }

  all(): RuntimeEvent[] {
    return [...this.events];
  }

  async flush(): Promise<void> {
    await this.pendingPersistence;
  }
}

export class NoopDiagnosticLogger implements DiagnosticLogger {
  log(_entry: DiagnosticLogEntry): void {
    // Intentionally empty.
  }
}

export class ConsoleDiagnosticLogger implements DiagnosticLogger {
  log(entry: DiagnosticLogEntry): void {
    const output = {
      ts: entry.ts,
      level: entry.level,
      source: entry.source,
      sessionId: entry.sessionId,
      correlation: entry.correlation,
      message: entry.message,
      metadata: entry.metadata,
      error: entry.error
    };
    if (entry.level === "error") {
      console.error(output);
      return;
    }
    if (entry.level === "warn") {
      console.warn(output);
      return;
    }
    if (entry.level === "debug") {
      console.debug(output);
      return;
    }
    console.info(output);
  }
}

export class MemoryDiagnosticLogger implements DiagnosticLogger {
  private readonly entries: DiagnosticLogEntry[] = [];

  log(entry: DiagnosticLogEntry): void {
    this.entries.push(snapshotDiagnosticEntry(entry));
  }

  all(): DiagnosticLogEntry[] {
    return this.entries.map(snapshotDiagnosticEntry);
  }
}

const diagnosticLevelRank: Record<DiagnosticLogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

export type DiagnosticLoggerConfiguration = {
  sinks: DiagnosticLogger[];
  minimumLevel?: DiagnosticLogLevel;
  sources?: DiagnosticLogEntry["source"][];
};

export class CompositeDiagnosticLogger implements DiagnosticLogger {
  constructor(private readonly sinks: DiagnosticLogger[]) {}

  log(entry: DiagnosticLogEntry): void {
    for (const sink of this.sinks) {
      try {
        const result = sink.log(snapshotDiagnosticEntry(entry)) as unknown;
        ignoreAsyncDiagnosticFailure(result);
      } catch {
        // One diagnostic sink must not prevent delivery to the remaining sinks.
      }
    }
  }
}

export class FilteredDiagnosticLogger implements DiagnosticLogger {
  private readonly sources?: Set<DiagnosticLogEntry["source"]>;

  constructor(
    private readonly sink: DiagnosticLogger,
    private readonly minimumLevel: DiagnosticLogLevel = "debug",
    sources?: DiagnosticLogEntry["source"][]
  ) {
    this.sources = sources ? new Set(sources) : undefined;
  }

  log(entry: DiagnosticLogEntry): void {
    if (diagnosticLevelRank[entry.level] < diagnosticLevelRank[this.minimumLevel]) {
      return;
    }
    if (this.sources && !this.sources.has(entry.source)) {
      return;
    }
    this.sink.log(snapshotDiagnosticEntry(entry));
  }
}

export function createDiagnosticLogger(
  configuration: DiagnosticLoggerConfiguration
): DiagnosticLogger {
  const composite = new CompositeDiagnosticLogger([...configuration.sinks]);
  return new FilteredDiagnosticLogger(
    composite,
    configuration.minimumLevel,
    configuration.sources
  );
}

export class JsonlDiagnosticLogger implements DiagnosticLogger {
  private readonly ready: Promise<void>;
  private pending = Promise.resolve();
  private writeError?: unknown;

  constructor(private readonly filePath: string) {
    this.ready = mkdir(dirname(filePath), { recursive: true }).then(
      () => undefined,
      (error: unknown) => {
        this.writeError ??= error;
      }
    );
  }

  log(entry: DiagnosticLogEntry): void {
    const snapshot = snapshotDiagnosticEntry(entry);
    this.pending = this.pending.then(async () => {
      try {
        await this.ready;
        if (this.writeError) {
          return;
        }
        await appendFile(this.filePath, `${JSON.stringify(snapshot)}\n`, "utf8");
      } catch (error) {
        this.writeError ??= error;
      }
    });
  }

  async flush(): Promise<void> {
    await this.ready;
    await this.pending;
    if (this.writeError) {
      throw this.writeError;
    }
  }

  async readAll(): Promise<DiagnosticLogEntry[]> {
    await this.flush();
    try {
      const content = await readFile(this.filePath, "utf8");
      return content
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as DiagnosticLogEntry);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }
}

function snapshotDiagnosticEntry(entry: DiagnosticLogEntry): DiagnosticLogEntry {
  return structuredClone(entry);
}

function ignoreAsyncDiagnosticFailure(result: unknown): void {
  if (
    result !== null &&
    (typeof result === "object" || typeof result === "function") &&
    "then" in result &&
    typeof result.then === "function"
  ) {
    void Promise.resolve(result as PromiseLike<unknown>).catch(() => undefined);
  }
}

export class JsonlJournalPersistence {
  private ready: Promise<void>;

  constructor(private readonly filePath: string) {
    this.ready = mkdir(dirname(filePath), { recursive: true }).then(() => undefined);
  }

  async append(event: RuntimeEvent): Promise<void> {
    await this.ready;
    await appendFile(this.filePath, `${JSON.stringify(event)}\n`, "utf8");
  }

  async readAll(): Promise<RuntimeEvent[]> {
    try {
      const content = await readFile(this.filePath, "utf8");
      return content
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as RuntimeEvent);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }
}

export type JournalPersistence = {
  append(event: RuntimeEvent): Promise<void>;
};

export class HandlerRegistry {
  private readonly handlers = new Map<string, ModuleHandler[]>();

  add(eventName: string, handler: ModuleHandler): void {
    const handlers = this.handlers.get(eventName) ?? [];
    handlers.push(handler);
    this.handlers.set(eventName, handlers);
  }

  async emit(eventName: string): Promise<boolean> {
    const handlers = this.handlers.get(eventName) ?? [];

    for (const handler of handlers) {
      const result = await handler();
      if (result === false) {
        return false;
      }
    }

    return true;
  }
}

export type SimulatorCashManagement = {
  dispenseDenominations: number[];
  acceptDenominations: number[];
  initialInventory: Record<string, number>;
  maxDispenseAmount: number;
  maxDepositAmount: number;
  recycleDeposits: boolean;
};

export type SimulatorProfile = {
  id: string;
  currencyCode: string;
  capabilities: {
    receiptPrinter: boolean;
    cashDispenser: boolean;
    cashAcceptor: boolean;
    cardReader: boolean;
    hostAuthorization: boolean;
  };
  cashManagement: SimulatorCashManagement;
};

export const MAX_SIMULATOR_TRANSACTION_AMOUNT = 100_000;
export const MAX_SIMULATOR_CASH_UNIT_COUNT = 10_000;
export const MAX_SIMULATOR_DENOMINATION_COUNT = 32;

export const DEFAULT_SIMULATOR_PROFILE: SimulatorProfile = {
  id: "cashblocks.default",
  currencyCode: "AUD",
  capabilities: {
    receiptPrinter: true,
    cashDispenser: true,
    cashAcceptor: true,
    cardReader: true,
    hostAuthorization: true
  },
  cashManagement: {
    dispenseDenominations: [10, 20, 50, 100],
    acceptDenominations: [10, 20, 50, 100],
    initialInventory: {
      "10": 10,
      "20": 20,
      "50": 10,
      "100": 40
    },
    maxDispenseAmount: 1000,
    maxDepositAmount: 5000,
    recycleDeposits: true
  }
};

export function defineSimulatorProfile(profile: SimulatorProfile): SimulatorProfile {
  if (!profile.id.trim()) {
    throw new Error("Simulator profile id is required.");
  }
  if (!profile.currencyCode.trim()) {
    throw new Error("Simulator profile currencyCode is required.");
  }

  validateDenominations(
    profile.cashManagement.dispenseDenominations,
    "dispenseDenominations"
  );
  validateDenominations(
    profile.cashManagement.acceptDenominations,
    "acceptDenominations"
  );
  validatePositiveAmount(profile.cashManagement.maxDispenseAmount, "maxDispenseAmount");
  validatePositiveAmount(profile.cashManagement.maxDepositAmount, "maxDepositAmount");

  const dispenseDenominations = new Set(profile.cashManagement.dispenseDenominations);
  for (const [rawDenomination, count] of Object.entries(
    profile.cashManagement.initialInventory
  )) {
    const denomination = Number(rawDenomination);
    if (rawDenomination !== String(denomination)) {
      throw new Error(
        `Simulator profile inventory key ${rawDenomination} must be canonical.`
      );
    }
    if (!dispenseDenominations.has(denomination)) {
      throw new Error(
        `Simulator profile inventory denomination ${rawDenomination} is not dispensable.`
      );
    }
    if (
      !Number.isSafeInteger(count) ||
      count < 0 ||
      count > MAX_SIMULATOR_CASH_UNIT_COUNT
    ) {
      throw new Error(
        `Simulator profile inventory count for ${rawDenomination} must be between 0 and ${MAX_SIMULATOR_CASH_UNIT_COUNT}.`
      );
    }
  }
  for (const denomination of dispenseDenominations) {
    if (!(String(denomination) in profile.cashManagement.initialInventory)) {
      throw new Error(
        `Simulator profile inventory must include denomination ${denomination}.`
      );
    }
  }
  if (
    profile.cashManagement.recycleDeposits &&
    profile.cashManagement.acceptDenominations.some(
      (denomination) => !dispenseDenominations.has(denomination)
    )
  ) {
    throw new Error(
      "Simulator profile recycled accept denominations must also be dispensable."
    );
  }

  inventoryTotal(profile.cashManagement.initialInventory);

  return {
    id: profile.id,
    currencyCode: profile.currencyCode,
    capabilities: { ...profile.capabilities },
    cashManagement: {
      dispenseDenominations: [...profile.cashManagement.dispenseDenominations],
      acceptDenominations: [...profile.cashManagement.acceptDenominations],
      initialInventory: { ...profile.cashManagement.initialInventory },
      maxDispenseAmount: profile.cashManagement.maxDispenseAmount,
      maxDepositAmount: profile.cashManagement.maxDepositAmount,
      recycleDeposits: profile.cashManagement.recycleDeposits
    }
  };
}

function validateDenominations(denominations: number[], field: string): void {
  if (denominations.length === 0) {
    throw new Error(`Simulator profile ${field} must not be empty.`);
  }
  if (denominations.length > MAX_SIMULATOR_DENOMINATION_COUNT) {
    throw new Error(
      `Simulator profile ${field} must contain at most ${MAX_SIMULATOR_DENOMINATION_COUNT} values.`
    );
  }
  if (
    denominations.some(
      (denomination) => !Number.isSafeInteger(denomination) || denomination <= 0
    )
  ) {
    throw new Error(
      `Simulator profile ${field} values must be positive safe integers.`
    );
  }
  if (new Set(denominations).size !== denominations.length) {
    throw new Error(`Simulator profile ${field} values must be unique.`);
  }
}

function validatePositiveAmount(amount: number, field: string): void {
  if (
    !Number.isSafeInteger(amount) ||
    amount <= 0 ||
    amount > MAX_SIMULATOR_TRANSACTION_AMOUNT
  ) {
    throw new Error(
      `Simulator profile ${field} must be between 1 and ${MAX_SIMULATOR_TRANSACTION_AMOUNT}.`
    );
  }
}

function inventoryTotal(inventory: Record<string, number>): number {
  const total = Object.entries(inventory).reduce(
    (total, [denomination, count]) => total + Number(denomination) * count,
    0
  );
  if (!Number.isSafeInteger(total)) {
    throw new Error("Simulator profile inventory total must be a safe integer.");
  }
  return total;
}

function allocateCash(
  amount: number,
  denominations: number[],
  inventory?: Record<string, number>
): Record<string, number> | undefined {
  if (
    !Number.isSafeInteger(amount) ||
    amount <= 0 ||
    amount > MAX_SIMULATOR_TRANSACTION_AMOUNT
  ) {
    return undefined;
  }

  const bundles: Array<{
    denomination: number;
    count: number;
    value: number;
  }> = [];

  for (const denomination of denominations) {
    let remainingCount = Math.min(
      Math.floor(amount / denomination),
      inventory?.[String(denomination)] ?? MAX_SIMULATOR_CASH_UNIT_COUNT
    );
    let bundleSize = 1;
    while (remainingCount > 0) {
      const count = Math.min(bundleSize, remainingCount);
      bundles.push({
        denomination,
        count,
        value: denomination * count
      });
      remainingCount -= count;
      bundleSize *= 2;
    }
  }

  const previousAmount = new Int32Array(amount + 1);
  const selectedBundle = new Int32Array(amount + 1);
  previousAmount.fill(-1);
  selectedBundle.fill(-1);
  previousAmount[0] = 0;

  for (let bundleIndex = 0; bundleIndex < bundles.length; bundleIndex += 1) {
    const bundle = bundles[bundleIndex];
    if (!bundle) {
      continue;
    }
    for (let current = amount; current >= bundle.value; current -= 1) {
      if (
        previousAmount[current] === -1 &&
        previousAmount[current - bundle.value] !== -1
      ) {
        previousAmount[current] = current - bundle.value;
        selectedBundle[current] = bundleIndex;
      }
    }
  }

  if (previousAmount[amount] === -1) {
    return undefined;
  }

  const allocation: Record<string, number> = {};
  let current = amount;
  while (current > 0) {
    const bundle = bundles[selectedBundle[current] ?? -1];
    if (!bundle) {
      return undefined;
    }
    const denomination = String(bundle.denomination);
    allocation[denomination] = (allocation[denomination] ?? 0) + bundle.count;
    current = previousAmount[current] ?? -1;
  }
  return allocation;
}

export type RuntimeSimulatorOptions = {
  profile?: SimulatorProfile;
  customerSelections?: string[];
  optionSelections?: string[];
  accountSelections?: string[];
  amountSelections?: number[];
  pinEntries?: string[];
  accounts?: Record<string, number>;
  terminalCash?: number;
  receiptPrinter?: Partial<ReceiptPrinterStatus>;
  hostApproved?: boolean;
  dispenserOnline?: boolean;
  acceptorOnline?: boolean;
  cardReaderOnline?: boolean;
};

export class RuntimeSimulator {
  private customerSelections: string[];
  private optionSelections: string[];
  private accountSelections: string[];
  private amountSelections: number[];
  private pinEntries: string[];
  private readonly cashInventory: Record<string, number>;
  private readonly finiteCashInventory: boolean;
  readonly usesLegacyScalarCash: boolean;
  readonly profile: SimulatorProfile;
  accounts: Record<string, number>;
  terminalCash: number;
  receiptPrinter: ReceiptPrinterStatus;
  hostApproved: boolean;
  dispenserOnline: boolean;
  acceptorOnline: boolean;
  cardReaderOnline: boolean;

  constructor(options: RuntimeSimulatorOptions = {}) {
    if (options.profile && options.terminalCash !== undefined) {
      throw new Error(
        "RuntimeSimulator options cannot combine profile with terminalCash."
      );
    }
    this.profile = defineSimulatorProfile(options.profile ?? DEFAULT_SIMULATOR_PROFILE);
    this.customerSelections = [...(options.customerSelections ?? ["BalanceInquiry"])];
    this.optionSelections = [...(options.optionSelections ?? ["YES"])];
    this.accountSelections = [...(options.accountSelections ?? ["Checking"])];
    this.amountSelections = [...(options.amountSelections ?? [100])];
    this.pinEntries = [...(options.pinEntries ?? ["1234"])];
    this.accounts = {
      Checking: 1240,
      Savings: 3850,
      Credit: -320,
      ...(options.accounts ?? {})
    };
    this.usesLegacyScalarCash = options.terminalCash !== undefined;
    this.finiteCashInventory = !this.usesLegacyScalarCash;
    this.cashInventory = this.finiteCashInventory
      ? { ...this.profile.cashManagement.initialInventory }
      : {};
    this.terminalCash =
      options.terminalCash ?? inventoryTotal(this.cashInventory);
    if (!Number.isSafeInteger(this.terminalCash) || this.terminalCash < 0) {
      throw new Error("RuntimeSimulator terminalCash must be a non-negative safe integer.");
    }
    this.receiptPrinter = {
      health: options.receiptPrinter?.health ?? "HEALTHY",
      paper: options.receiptPrinter?.paper ?? "OK"
    };
    this.hostApproved = options.hostApproved ?? true;
    this.dispenserOnline = options.dispenserOnline ?? true;
    this.acceptorOnline = options.acceptorOnline ?? true;
    this.cardReaderOnline = options.cardReaderOnline ?? true;
  }

  nextTransaction(): string {
    return this.customerSelections.shift() ?? "BalanceInquiry";
  }

  nextOption(_screen: string, options: string[]): string {
    const selected = this.optionSelections.shift();
    return selected && options.includes(selected) ? selected : options[0] ?? "";
  }

  nextAccount(options: string[]): string {
    const selected = this.accountSelections.shift();
    return selected && options.includes(selected) ? selected : options[0] ?? "";
  }

  nextAmount(presets: number[]): number {
    const selected = this.amountSelections.shift();
    return selected ?? presets[0] ?? 0;
  }

  nextPin(): string {
    return this.pinEntries.shift() ?? "1234";
  }

  balance(account: string): number {
    return this.accounts[account] ?? 0;
  }

  debit(account: string, amount: number): { before: number; after: number } {
    const before = this.balance(account);
    const after = before - amount;
    this.accounts[account] = after;
    return { before, after };
  }

  credit(account: string, amount: number): { before: number; after: number } {
    const before = this.balance(account);
    const after = before + amount;
    this.accounts[account] = after;
    return { before, after };
  }

  removeTerminalCash(amount: number): { before: number; after: number } {
    const allocation = this.planDispense(amount);
    if (!allocation) {
      throw new Error(`Simulator cannot dispense ${amount} ${this.profile.currencyCode}.`);
    }
    const before = this.terminalCash;
    const after = before - amount;
    if (this.finiteCashInventory) {
      for (const [denomination, count] of Object.entries(allocation)) {
        this.cashInventory[denomination] =
          (this.cashInventory[denomination] ?? 0) - count;
      }
    }
    this.terminalCash = after;
    return { before, after };
  }

  addTerminalCash(amount: number): { before: number; after: number } {
    if (!this.canAddTerminalCash(amount)) {
      throw new Error(
        `Simulator cannot add ${amount} ${this.profile.currencyCode} without exceeding safe cash capacity.`
      );
    }
    const before = this.terminalCash;
    const after = before + amount;
    if (
      this.finiteCashInventory &&
      this.profile.cashManagement.recycleDeposits
    ) {
      const allocation = allocateCash(
        amount,
        this.profile.cashManagement.acceptDenominations
      );
      if (allocation) {
        for (const [denomination, count] of Object.entries(allocation)) {
          this.cashInventory[denomination] =
            (this.cashInventory[denomination] ?? 0) + count;
        }
      }
    }
    this.terminalCash = after;
    return { before, after };
  }

  planDispense(amount: number): Record<string, number> | undefined {
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      return undefined;
    }
    if (!this.finiteCashInventory) {
      return amount <= this.terminalCash ? {} : undefined;
    }
    return allocateCash(
      amount,
      this.profile.cashManagement.dispenseDenominations,
      this.cashInventory
    );
  }

  canAccept(amount: number): boolean {
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      return false;
    }
    return Boolean(
      allocateCash(amount, this.profile.cashManagement.acceptDenominations)
    );
  }

  canAddTerminalCash(amount: number): boolean {
    if (!Number.isSafeInteger(amount) || amount < 0) {
      return false;
    }
    if (!Number.isSafeInteger(this.terminalCash + amount)) {
      return false;
    }
    if (
      !this.finiteCashInventory ||
      !this.profile.cashManagement.recycleDeposits ||
      amount === 0
    ) {
      return true;
    }

    const allocation = allocateCash(
      amount,
      this.profile.cashManagement.acceptDenominations
    );
    if (!allocation) {
      return false;
    }
    return Object.entries(allocation).every(([denomination, count]) => {
      const nextCount = (this.cashInventory[denomination] ?? 0) + count;
      return (
        Number.isSafeInteger(nextCount) &&
        nextCount <= MAX_SIMULATOR_CASH_UNIT_COUNT
      );
    });
  }

  cashInventorySnapshot(): Record<string, number> {
    return { ...this.cashInventory };
  }
}

export class SimulatorCustomerInteraction implements CustomerInteraction {
  constructor(private readonly simulator: RuntimeSimulator) {}

  async request(prompt: CustomerPrompt): Promise<CustomerPromptAnswer> {
    if (prompt.kind === "pin") {
      return { value: this.simulator.nextPin() };
    }

    if (prompt.kind === "transaction") {
      const selected = this.simulator.nextTransaction();
      return {
        value: prompt.options.includes(selected) ? selected : prompt.options[0] ?? ""
      };
    }

    if (prompt.kind === "account") {
      return { value: this.simulator.nextAccount(prompt.options) };
    }

    if (prompt.kind === "amount") {
      return { value: String(this.simulator.nextAmount(prompt.presets)) };
    }

    return { value: this.simulator.nextOption(prompt.screen, prompt.options) };
  }
}

export class PendingCustomerPrompt {
  readonly id: string;
  private resolveAnswer?: (answer: CustomerPromptAnswer) => void;
  private rejectAnswer?: (reason: Error) => void;
  readonly answer: Promise<CustomerPromptAnswer>;

  constructor(readonly prompt: CustomerPrompt) {
    this.id = `prompt-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    this.answer = new Promise((resolve, reject) => {
      this.resolveAnswer = resolve;
      this.rejectAnswer = reject;
    });
  }

  resolve(value: string): void {
    this.resolveAnswer?.({ value });
    this.clear();
  }

  reject(reason: Error): void {
    this.rejectAnswer?.(reason);
    this.clear();
  }

  private clear(): void {
    this.resolveAnswer = undefined;
    this.rejectAnswer = undefined;
  }
}

export class QueuedCustomerInteraction implements CustomerInteraction {
  private pendingPrompt?: PendingCustomerPrompt;
  private readonly listeners = new Set<(prompt: PendingCustomerPrompt) => void>();

  request(prompt: CustomerPrompt): Promise<CustomerPromptAnswer> {
    const pending = new PendingCustomerPrompt(prompt);
    this.pendingPrompt = pending;
    for (const listener of this.listeners) {
      listener(pending);
    }
    return pending.answer;
  }

  current(): PendingCustomerPrompt | undefined {
    return this.pendingPrompt;
  }

  answer(promptId: string, value: string): boolean {
    if (!this.pendingPrompt || this.pendingPrompt.id !== promptId) {
      return false;
    }
    this.pendingPrompt.resolve(value);
    this.pendingPrompt = undefined;
    return true;
  }

  cancelPending(reason: Error): boolean {
    if (!this.pendingPrompt) {
      return false;
    }
    this.pendingPrompt.reject(reason);
    this.pendingPrompt = undefined;
    return true;
  }

  onPrompt(listener: (prompt: PendingCustomerPrompt) => void): () => void {
    this.listeners.add(listener);
    if (this.pendingPrompt) {
      listener(this.pendingPrompt);
    }
    return () => this.listeners.delete(listener);
  }
}

function adapterResult(ok: boolean, code: string, message: string): AdapterResult {
  return { ok, code, message };
}

export class SimulatedReceiptPrinterAdapter implements ReceiptPrinterAdapter {
  readonly id = "simulated-receipt-printer";
  readonly kind = "receipt-printer" as const;
  readonly capabilities = ["status", "print"] as const;

  constructor(private readonly simulator: RuntimeSimulator) {}

  async getStatus(): Promise<ReceiptPrinterStatus> {
    if (!this.simulator.profile.capabilities.receiptPrinter) {
      return { health: "MISSING", paper: "OUT" };
    }
    return this.simulator.receiptPrinter;
  }

  async printReceipt(_lines: string[]): Promise<AdapterResult> {
    const status = await this.getStatus();
    if (status.health !== "HEALTHY" || status.paper === "OUT") {
      return adapterResult(false, "PRINTER_UNAVAILABLE", "Receipt printer is unavailable.");
    }
    return adapterResult(true, "PRINTED", "Receipt printed.");
  }
}

export class SimulatedCashDispenserAdapter implements CashDispenserAdapter {
  readonly id = "simulated-cash-dispenser";
  readonly kind = "cash-dispenser" as const;
  readonly capabilities = ["dispense", "finite-inventory"] as const;

  constructor(private readonly simulator: RuntimeSimulator) {}

  async dispense(input: { amount: number; currencyCode: string }): Promise<AdapterResult> {
    if (!this.simulator.profile.capabilities.cashDispenser) {
      return adapterResult(false, "DISPENSER_UNAVAILABLE", "Cash dispenser is not supported.");
    }
    if (!this.simulator.dispenserOnline) {
      return adapterResult(false, "DISPENSER_OFFLINE", "Cash dispenser is offline.");
    }
    if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
      return adapterResult(false, "INVALID_AMOUNT", "Dispense amount must be a positive safe integer.");
    }
    if (!this.simulator.usesLegacyScalarCash) {
      if (input.currencyCode !== this.simulator.profile.currencyCode) {
        return adapterResult(false, "UNSUPPORTED_CURRENCY", "Currency is not supported.");
      }
      if (input.amount > this.simulator.profile.cashManagement.maxDispenseAmount) {
        return adapterResult(false, "DISPENSE_LIMIT_EXCEEDED", "Dispense limit exceeded.");
      }
    }
    if (input.amount > this.simulator.terminalCash) {
      return adapterResult(false, "INSUFFICIENT_TERMINAL_CASH", "Terminal does not have enough cash.");
    }
    if (!this.simulator.planDispense(input.amount)) {
      return adapterResult(
        false,
        "DENOMINATION_UNAVAILABLE",
        "Requested amount cannot be dispensed from available cash units."
      );
    }
    const cash = this.simulator.removeTerminalCash(input.amount);
    return {
      ok: true,
      code: "DISPENSED",
      message: "Cash dispensed.",
      details: { amount: input.amount, currencyCode: input.currencyCode, terminalCashAfter: cash.after }
    };
  }
}

export class SimulatedCashAcceptorAdapter implements CashAcceptorAdapter {
  readonly id = "simulated-cash-acceptor";
  readonly kind = "cash-acceptor" as const;
  readonly capabilities = ["accept", "amount-confirmation"] as const;

  constructor(private readonly simulator: RuntimeSimulator) {}

  async accept(input: { expectedAmount?: number; currencyCode: string }): Promise<AdapterResult> {
    if (!this.simulator.profile.capabilities.cashAcceptor) {
      return adapterResult(false, "ACCEPTOR_UNAVAILABLE", "Cash acceptor is not supported.");
    }
    if (!this.simulator.acceptorOnline) {
      return adapterResult(false, "ACCEPTOR_OFFLINE", "Cash acceptor is offline.");
    }
    const amount = input.expectedAmount ?? 0;
    if (this.simulator.usesLegacyScalarCash) {
      if (!Number.isSafeInteger(amount) || amount < 0) {
        return adapterResult(false, "INVALID_AMOUNT", "Deposit amount must be a non-negative safe integer.");
      }
    } else {
      if (!Number.isSafeInteger(amount) || amount <= 0) {
        return adapterResult(false, "INVALID_AMOUNT", "Deposit amount must be a positive safe integer.");
      }
      if (input.currencyCode !== this.simulator.profile.currencyCode) {
        return adapterResult(false, "UNSUPPORTED_CURRENCY", "Currency is not supported.");
      }
      if (amount > this.simulator.profile.cashManagement.maxDepositAmount) {
        return adapterResult(false, "DEPOSIT_LIMIT_EXCEEDED", "Deposit limit exceeded.");
      }
      if (!this.simulator.canAccept(amount)) {
        return adapterResult(
          false,
          "DENOMINATION_UNAVAILABLE",
          "Deposit amount cannot be represented by accepted denominations."
        );
      }
    }
    if (!this.simulator.canAddTerminalCash(amount)) {
      return adapterResult(false, "CASH_CAPACITY_EXCEEDED", "Terminal cash capacity exceeded.");
    }
    const cash = this.simulator.addTerminalCash(amount);
    return {
      ok: true,
      code: "ACCEPTED",
      message: "Cash accepted.",
      details: {
        expectedAmount: input.expectedAmount ?? null,
        currencyCode: input.currencyCode,
        terminalCashAfter: cash.after
      }
    };
  }
}

export class SimulatedCardReaderAdapter implements CardReaderAdapter {
  readonly id = "simulated-card-reader";
  readonly kind = "card-reader" as const;
  readonly capabilities = ["read"] as const;

  constructor(private readonly simulator: RuntimeSimulator) {}

  async readCard(): Promise<AdapterResult> {
    if (!this.simulator.profile.capabilities.cardReader) {
      return adapterResult(false, "CARD_READER_UNAVAILABLE", "Card reader is not supported.");
    }
    if (!this.simulator.cardReaderOnline) {
      return adapterResult(false, "CARD_READER_OFFLINE", "Card reader is offline.");
    }
    return adapterResult(true, "CARD_READ", "Card read.");
  }
}

export class SimulatedHostAuthorizationAdapter implements HostAuthorizationAdapter {
  readonly id = "simulated-host-authorization";
  readonly kind = "host-authorization" as const;
  readonly capabilities = ["authorize"] as const;

  constructor(private readonly simulator: RuntimeSimulator) {}

  async authorize(request: HostAuthorizationRequest): Promise<AdapterResult> {
    if (!this.simulator.profile.capabilities.hostAuthorization) {
      return adapterResult(false, "HOST_UNAVAILABLE", "Host authorization is not supported.");
    }
    if (!this.simulator.hostApproved) {
      return {
        ok: false,
        code: "HOST_DECLINED",
        message: "Host declined transaction.",
        details: { transaction: request.transaction, host: request.host }
      };
    }
    if (request.amount && request.transaction.includes("Withdrawal")) {
      const account = request.account ?? "Checking";
      if (request.amount > this.simulator.balance(account)) {
        return {
          ok: false,
          code: "INSUFFICIENT_FUNDS",
          message: "Account has insufficient funds.",
          details: { transaction: request.transaction, host: request.host, account }
        };
      }
    }
    return {
      ok: true,
      code: "HOST_APPROVED",
      message: "Host approved transaction.",
      details: { transaction: request.transaction, host: request.host }
    };
  }
}

export function createSimulatedAdapters(simulator: RuntimeSimulator): TerminalAdapters {
  return {
    receiptPrinter: new SimulatedReceiptPrinterAdapter(simulator),
    cashDispenser: new SimulatedCashDispenserAdapter(simulator),
    cashAcceptor: new SimulatedCashAcceptorAdapter(simulator),
    cardReader: new SimulatedCardReaderAdapter(simulator),
    hostAuthorization: new SimulatedHostAuthorizationAdapter(simulator)
  };
}

export type CashblocksRuntimeOptions = {
  simulator?: RuntimeSimulator;
  adapters?: TerminalAdapters;
  interaction?: CustomerInteraction;
  logger?: DiagnosticLogger;
  journalPath?: string;
  sessionId?: string;
  adapterTimeoutMs?: number;
};

export type DiagnosticLogInput = Omit<
  DiagnosticLogEntry,
  "ts" | "sessionId" | "correlation"
> & {
  sessionId?: string;
  correlation?: Partial<DiagnosticCorrelation>;
};

export class CashblocksRuntime {
  readonly ScratchPad = new MemoryScratchPad();
  readonly Properties = new PropertyStore();
  readonly Journal: RuntimeJournal;
  readonly Simulator: RuntimeSimulator;
  readonly Adapters: TerminalAdapters;
  readonly Interaction: CustomerInteraction;
  readonly Logger: DiagnosticLogger;
  readonly SessionId: string;
  readonly AdapterTimeoutMs: number;
  readonly Cashblocks: RuntimeApi;
  private adapterOperationSequence = 0;

  constructor(options: CashblocksRuntimeOptions = {}) {
    this.Simulator = options.simulator ?? new RuntimeSimulator();
    this.Adapters = options.adapters ?? createSimulatedAdapters(this.Simulator);
    const adapterIssues = validateTerminalAdapters(this.Adapters);
    if (adapterIssues.length > 0) {
      throw new Error(
        `Invalid terminal adapters: ${adapterIssues
          .map((issue) => `${issue.field}: ${issue.message}`)
          .join("; ")}`
      );
    }
    this.Interaction = options.interaction ?? new SimulatorCustomerInteraction(this.Simulator);
    this.Logger = options.logger ?? new NoopDiagnosticLogger();
    this.Journal = new RuntimeJournal({
      persistence: options.journalPath
        ? new JsonlJournalPersistence(options.journalPath)
        : undefined
    });
    this.SessionId =
      options.sessionId ?? `session-${globalThis.crypto.randomUUID()}`;
    this.AdapterTimeoutMs = options.adapterTimeoutMs ?? 30_000;
    if (
      !Number.isSafeInteger(this.AdapterTimeoutMs) ||
      this.AdapterTimeoutMs <= 0 ||
      this.AdapterTimeoutMs > 300_000
    ) {
      throw new Error("adapterTimeoutMs must be an integer between 1 and 300000.");
    }

    this.Cashblocks = {
      ScratchPad: this.ScratchPad,
      LocalLanguage: {
        CurrentLanguage: "English"
      },
      SetCurrencyDetails: (currencyCode, symbol, symbolBeforeAmount) => {
        this.Properties.Set("Currency.Code", currencyCode);
        this.Properties.Set("Currency.Symbol", symbol);
        this.Properties.Set("Currency.SymbolBeforeAmount", symbolBeforeAmount);
      },
      SetProperty: (path, value) => {
        this.Properties.Set(path, value);
      },
      GetProperty: (path) => this.Properties.Get(path),
      Log: (message) => {
        this.Journal.append({
          type: "journal.line_logged",
          source: "flow",
          sessionId: this.SessionId,
          payload: { message }
        });
      },
      LogJournalLine: (message) => {
        this.Journal.append({
          type: "journal.line_logged",
          source: "runtime",
          sessionId: this.SessionId,
          payload: { message }
        });
      }
    };

    this.Properties.Set(
      "Devices.ReceiptPrinter.StDeviceStatus",
      this.Simulator.profile.capabilities.receiptPrinter
        ? this.Simulator.receiptPrinter.health
        : "MISSING"
    );
    this.Properties.Set(
      "Devices.ReceiptPrinter.StPaperStatus",
      this.Simulator.profile.capabilities.receiptPrinter
        ? this.Simulator.receiptPrinter.paper
        : "OUT"
    );
    this.Journal.append({ type: "runtime.started", source: "runtime" });
  }

  result(
    ok: boolean,
    code: string,
    message: string,
    details?: Record<string, JsonValue>
  ): TransactionResult {
    return details ? { ok, code, message, details } : { ok, code, message };
  }

  createAdapterOperationContext(
    adapterId: string,
    operation: string,
    transactionName?: string,
    signal: AbortSignal = new AbortController().signal
  ): AdapterOperationContext {
    this.adapterOperationSequence += 1;
    const startedAt = new Date();
    return {
      operationId: `${this.SessionId}:adapter:${this.adapterOperationSequence}`,
      sessionId: this.SessionId,
      adapterId,
      operation,
      ...(transactionName ? { transactionName } : {}),
      timeoutMs: this.AdapterTimeoutMs,
      startedAt: startedAt.toISOString(),
      deadlineAt: new Date(startedAt.getTime() + this.AdapterTimeoutMs).toISOString(),
      signal
    };
  }

  logDiagnostic(entry: DiagnosticLogInput): void {
    try {
      const sessionId =
        entry.correlation?.sessionId ?? entry.sessionId ?? this.SessionId;
      this.Logger.log({
        ...entry,
        ts: new Date().toISOString(),
        sessionId,
        correlation: {
          ...entry.correlation,
          sessionId
        }
      });
    } catch {
      // Diagnostic logging must never change runtime behavior.
    }
  }
}
