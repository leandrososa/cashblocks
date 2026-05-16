import type {
  JsonValue,
  ModuleHandler,
  RuntimeApi,
  RuntimeEvent,
  RuntimeEventDraft,
  ScratchPad,
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

  append(draft: RuntimeEventDraft): RuntimeEvent {
    const event: RuntimeEvent = {
      ...draft,
      seq: ++this.seq,
      ts: draft.ts ?? new Date().toISOString()
    };
    this.events.push(event);
    return event;
  }

  all(): RuntimeEvent[] {
    return [...this.events];
  }
}

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
};

export class RuntimeSimulator {
  private customerSelections: string[];
  private optionSelections: string[];

  constructor(options: RuntimeSimulatorOptions = {}) {
    this.customerSelections = [...(options.customerSelections ?? ["BalanceInquiry"])];
    this.optionSelections = [...(options.optionSelections ?? ["YES"])];
  }

  nextTransaction(): string {
    return this.customerSelections.shift() ?? "BalanceInquiry";
  }

  nextOption(_screen: string, options: string[]): string {
    const selected = this.optionSelections.shift();
    return selected && options.includes(selected) ? selected : options[0] ?? "";
  }
}

export type CashblocksRuntimeOptions = {
  simulator?: RuntimeSimulator;
  sessionId?: string;
};

export class CashblocksRuntime {
  readonly ScratchPad = new MemoryScratchPad();
  readonly Properties = new PropertyStore();
  readonly Journal = new RuntimeJournal();
  readonly Simulator: RuntimeSimulator;
  readonly SessionId: string;
  readonly K3A: RuntimeApi;

  constructor(options: CashblocksRuntimeOptions = {}) {
    this.Simulator = options.simulator ?? new RuntimeSimulator();
    this.SessionId = options.sessionId ?? `session-${Date.now()}`;

    this.K3A = {
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

    this.Properties.Set("Devices.ReceiptPrinter.StDeviceStatus", "HEALTHY");
    this.Properties.Set("Devices.ReceiptPrinter.StPaperStatus", "OK");
    this.Journal.append({ type: "runtime.started", source: "runtime" });
  }

  result(ok: boolean, code: string, message: string): TransactionResult {
    return { ok, code, message };
  }
}
