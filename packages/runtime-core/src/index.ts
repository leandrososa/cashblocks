import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

import type {
  AdapterResult,
  CashAcceptorAdapter,
  CashDispenserAdapter,
  CardReaderAdapter,
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

export type RuntimeSimulatorOptions = {
  customerSelections?: string[];
  optionSelections?: string[];
  receiptPrinter?: Partial<ReceiptPrinterStatus>;
  hostApproved?: boolean;
  dispenserOnline?: boolean;
  acceptorOnline?: boolean;
  cardReaderOnline?: boolean;
};

export class RuntimeSimulator {
  private customerSelections: string[];
  private optionSelections: string[];
  receiptPrinter: ReceiptPrinterStatus;
  hostApproved: boolean;
  dispenserOnline: boolean;
  acceptorOnline: boolean;
  cardReaderOnline: boolean;

  constructor(options: RuntimeSimulatorOptions = {}) {
    this.customerSelections = [...(options.customerSelections ?? ["BalanceInquiry"])];
    this.optionSelections = [...(options.optionSelections ?? ["YES"])];
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
}

function adapterResult(ok: boolean, code: string, message: string): AdapterResult {
  return { ok, code, message };
}

export class SimulatedReceiptPrinterAdapter implements ReceiptPrinterAdapter {
  readonly id = "simulated-receipt-printer";

  constructor(private readonly simulator: RuntimeSimulator) {}

  async getStatus(): Promise<ReceiptPrinterStatus> {
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

  constructor(private readonly simulator: RuntimeSimulator) {}

  async dispense(input: { amount: number; currencyCode: string }): Promise<AdapterResult> {
    if (!this.simulator.dispenserOnline) {
      return adapterResult(false, "DISPENSER_OFFLINE", "Cash dispenser is offline.");
    }
    return {
      ok: true,
      code: "DISPENSED",
      message: "Cash dispensed.",
      details: { amount: input.amount, currencyCode: input.currencyCode }
    };
  }
}

export class SimulatedCashAcceptorAdapter implements CashAcceptorAdapter {
  readonly id = "simulated-cash-acceptor";

  constructor(private readonly simulator: RuntimeSimulator) {}

  async accept(input: { expectedAmount?: number; currencyCode: string }): Promise<AdapterResult> {
    if (!this.simulator.acceptorOnline) {
      return adapterResult(false, "ACCEPTOR_OFFLINE", "Cash acceptor is offline.");
    }
    return {
      ok: true,
      code: "ACCEPTED",
      message: "Cash accepted.",
      details: {
        expectedAmount: input.expectedAmount ?? null,
        currencyCode: input.currencyCode
      }
    };
  }
}

export class SimulatedCardReaderAdapter implements CardReaderAdapter {
  readonly id = "simulated-card-reader";

  constructor(private readonly simulator: RuntimeSimulator) {}

  async readCard(): Promise<AdapterResult> {
    if (!this.simulator.cardReaderOnline) {
      return adapterResult(false, "CARD_READER_OFFLINE", "Card reader is offline.");
    }
    return adapterResult(true, "CARD_READ", "Card read.");
  }
}

export class SimulatedHostAuthorizationAdapter implements HostAuthorizationAdapter {
  readonly id = "simulated-host-authorization";

  constructor(private readonly simulator: RuntimeSimulator) {}

  async authorize(request: HostAuthorizationRequest): Promise<AdapterResult> {
    if (!this.simulator.hostApproved) {
      return {
        ok: false,
        code: "HOST_DECLINED",
        message: "Host declined transaction.",
        details: { transaction: request.transaction, host: request.host }
      };
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
  journalPath?: string;
  sessionId?: string;
};

export class CashblocksRuntime {
  readonly ScratchPad = new MemoryScratchPad();
  readonly Properties = new PropertyStore();
  readonly Journal: RuntimeJournal;
  readonly Simulator: RuntimeSimulator;
  readonly Adapters: TerminalAdapters;
  readonly SessionId: string;
  readonly Cashblocks: RuntimeApi;

  constructor(options: CashblocksRuntimeOptions = {}) {
    this.Simulator = options.simulator ?? new RuntimeSimulator();
    this.Adapters = options.adapters ?? createSimulatedAdapters(this.Simulator);
    this.Journal = new RuntimeJournal({
      persistence: options.journalPath
        ? new JsonlJournalPersistence(options.journalPath)
        : undefined
    });
    this.SessionId = options.sessionId ?? `session-${Date.now()}`;

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

    this.Properties.Set("Devices.ReceiptPrinter.StDeviceStatus", this.Simulator.receiptPrinter.health);
    this.Properties.Set("Devices.ReceiptPrinter.StPaperStatus", this.Simulator.receiptPrinter.paper);
    this.Journal.append({ type: "runtime.started", source: "runtime" });
  }

  result(ok: boolean, code: string, message: string): TransactionResult {
    return { ok, code, message };
  }
}
