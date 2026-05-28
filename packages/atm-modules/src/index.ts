import type {
  AuthorizationConfig,
  CustomerType,
  JsonValue,
  TransactionResult
} from "../../runtime-contracts/src/index.js";
import { CashblocksRuntime, HandlerRegistry } from "../../runtime-core/src/index.js";

export abstract class AtmModule {
  protected readonly handlers = new HandlerRegistry();

  constructor(
    protected readonly runtime: CashblocksRuntime,
    readonly Name: string
  ) {}

  AddHandler(eventName: string, handler: () => void | boolean | Promise<void | boolean>): void {
    this.handlers.add(eventName, handler);
  }

  Log(message: string): void {
    this.runtime.Journal.append({
      type: "journal.line_logged",
      source: "module",
      sessionId: this.runtime.SessionId,
      payload: { module: this.Name, message }
    });
  }

  abstract Execute(): Promise<TransactionResult>;
}

export class IdleModule extends AtmModule {
  TouchActivationParameter = "CardlessWithdrawal";

  constructor(runtime: CashblocksRuntime) {
    super(runtime, "Idle");
  }

  async Execute(): Promise<TransactionResult> {
    this.runtime.Journal.append({
      type: "session.started",
      source: "module",
      sessionId: this.runtime.SessionId
    });
    return this.runtime.result(true, "IDLE_READY", "Idle session started.");
  }
}

export class CustomerModule extends AtmModule {
  CustomerType: CustomerType = "OnUs";
  LanguageSelected = "English";
  PinCheckEnabled = false;
  PinCheckChipProcessing = false;
  TransactionSelected = "";

  constructor(runtime: CashblocksRuntime) {
    super(runtime, "Customer");
  }

  async Execute(): Promise<TransactionResult> {
    return this.runtime.result(true, "CUSTOMER_READY", "Customer module ready.");
  }

  async PinEntry(): Promise<void> {
    const cardRead = await callAdapter(
      this.runtime,
      "cardReader",
      "readCard",
      () => this.runtime.Adapters.cardReader.readCard()
    );

    if (!cardRead.ok) {
      this.runtime.Journal.append({
        type: "transaction.failed",
        source: "module",
        sessionId: this.runtime.SessionId,
        payload: {
          transaction: "CustomerIdentification",
          code: cardRead.code,
          message: cardRead.message
        }
      });
      throw new Error(cardRead.message);
    }

    this.runtime.Journal.append({
      type: "ui.prompt",
      source: "module",
      sessionId: this.runtime.SessionId,
      payload: { prompt: "PIN" }
    });

    const pin = await this.runtime.Interaction.request({
      kind: "pin",
      prompt: "Enter PIN"
    });

    this.runtime.Journal.append({
      type: "ui.input_received",
      source: "ui",
      sessionId: this.runtime.SessionId,
      payload: {
        prompt: "PIN",
        length: pin.value.length
      }
    });
  }

  async SelectTransaction(): Promise<string> {
    const answer = await this.runtime.Interaction.request({
      kind: "transaction",
      prompt: "Select transaction",
      options: [
        "BalanceInquiry",
        "CashWithdrawal",
        "CashDeposit",
        "FastCash",
        "CardlessWithdrawal",
        "AdminBalanceTerminal",
        "AdminCashAdjustment",
        "AdminPrintTotals"
      ]
    });
    const transaction = answer.value;
    this.TransactionSelected = transaction;
    this.runtime.Journal.append({
      type: "transaction.selected",
      source: "ui",
      sessionId: this.runtime.SessionId,
      payload: { transaction }
    });
    return transaction;
  }

  async SelectOption(screen: string, optionCsv: string): Promise<string> {
    const options = optionCsv.split(",").map((option) => option.trim()).filter(Boolean);
    const answer = await this.runtime.Interaction.request({
      kind: "option",
      screen,
      prompt: screen,
      options
    });
    const selected = options.includes(answer.value) ? answer.value : options[0] ?? "";
    this.runtime.Journal.append({
      type: "ui.prompt",
      source: "ui",
      sessionId: this.runtime.SessionId,
      payload: { screen, selected }
    });
    return selected;
  }
}

export class SessionModule {
  SupportedNotes = {
    Count: 4,
    Item(index: number): number | undefined {
      return [10, 20, 50, 100][index];
    }
  };

  constructor(private readonly runtime: CashblocksRuntime) {}

  SetupDefaultAccount(): void {
    this.runtime.Cashblocks.Log("Default account mapped.");
  }

  NewTransaction(): void {
    this.runtime.Cashblocks.Log("New transaction started.");
  }

  AnotherTransaction(): boolean {
    return false;
  }
}

export class AuthorizationModule {
  PinlessAuthorizationEnabled = false;
  ChipAuthorizationRequired = false;
  TransactionHost = "SimulatorHost";
  PinEntryOption: AuthorizationConfig["PinEntryOption"] = "Always";
}

export class BalanceInquiryModule extends AtmModule {
  DisplayBalanceOnScreen = false;

  constructor(runtime: CashblocksRuntime) {
    super(runtime, "BalanceInquiry");
  }

  async Execute(): Promise<TransactionResult> {
    this.runtime.Journal.append({
      type: "transaction.started",
      source: "module",
      sessionId: this.runtime.SessionId,
      payload: { transaction: this.Name }
    });

    await this.handlers.emit("OnEndReceiptOption");

    this.runtime.Journal.append({
      type: "transaction.completed",
      source: "module",
      sessionId: this.runtime.SessionId,
      payload: {
        transaction: this.Name,
        displayBalanceOnScreen: this.DisplayBalanceOnScreen
      }
    });

    return this.runtime.result(true, "BALANCE_OK", "Balance inquiry completed.");
  }
}

export class CashWithdrawalModule extends AtmModule {
  readonly Authorization = new AuthorizationModule();
  Amount = 100;

  constructor(runtime: CashblocksRuntime, name = "CashWithdrawal") {
    super(runtime, name);
  }

  async Execute(): Promise<TransactionResult> {
    this.runtime.Journal.append({
      type: "host.authorization_requested",
      source: "module",
      sessionId: this.runtime.SessionId,
      payload: {
        transaction: this.Name,
        host: this.Authorization.TransactionHost,
        pinless: this.Authorization.PinlessAuthorizationEnabled,
        chipRequired: this.Authorization.ChipAuthorizationRequired,
        pinEntryOption: this.Authorization.PinEntryOption
      }
    });

    const currencyCode = this.runtime.Cashblocks.GetProperty<string>("Currency.Code") ?? "AUD";
    const authorization = await callAdapter(
      this.runtime,
      "hostAuthorization",
      "authorize",
      () =>
        this.runtime.Adapters.hostAuthorization.authorize({
          transaction: this.Name,
          host: this.Authorization.TransactionHost,
          amount: this.Amount,
          currencyCode,
          pinless: this.Authorization.PinlessAuthorizationEnabled,
          chipRequired: this.Authorization.ChipAuthorizationRequired
        }),
      { transaction: this.Name }
    );

    this.runtime.Journal.append({
      type: "host.authorization_result",
      source: "module",
      sessionId: this.runtime.SessionId,
      payload: {
        transaction: this.Name,
        ok: authorization.ok,
        code: authorization.code,
        message: authorization.message
      }
    });

    if (!authorization.ok) {
      this.runtime.Journal.append({
        type: "transaction.failed",
        source: "module",
        sessionId: this.runtime.SessionId,
        payload: { transaction: this.Name, code: authorization.code }
      });
      return this.runtime.result(false, authorization.code, authorization.message);
    }

    const dispense = await callAdapter(
      this.runtime,
      "cashDispenser",
      "dispense",
      () =>
        this.runtime.Adapters.cashDispenser.dispense({
          amount: this.Amount,
          currencyCode
        }),
      { transaction: this.Name, amount: this.Amount, currencyCode }
    );

    if (!dispense.ok) {
      this.runtime.Journal.append({
        type: "transaction.failed",
        source: "module",
        sessionId: this.runtime.SessionId,
        payload: { transaction: this.Name, code: dispense.code }
      });
      return this.runtime.result(false, dispense.code, dispense.message);
    }

    await this.handlers.emit("OnEndReceiptOption");

    this.runtime.Journal.append({
      type: "transaction.completed",
      source: "module",
      sessionId: this.runtime.SessionId,
      payload: { transaction: this.Name }
    });
    return this.runtime.result(true, "WITHDRAWAL_OK", `${this.Name} completed.`);
  }
}

export class FastCashModule extends CashWithdrawalModule {
  readonly AmountSelector = {
    AmountPreset: 0
  };

  constructor(runtime: CashblocksRuntime) {
    super(runtime, "FastCash");
  }
}

export class CashDepositModule extends AtmModule {
  readonly Authorization = new AuthorizationModule();
  ExpectedAmount = 0;

  constructor(runtime: CashblocksRuntime) {
    super(runtime, "CashDeposit");
  }

  async Execute(): Promise<TransactionResult> {
    const currencyCode = this.runtime.Cashblocks.GetProperty<string>("Currency.Code") ?? "AUD";
    const accepted = await callAdapter(
      this.runtime,
      "cashAcceptor",
      "accept",
      () =>
        this.runtime.Adapters.cashAcceptor.accept({
          expectedAmount: this.ExpectedAmount || undefined,
          currencyCode
        }),
      { transaction: this.Name, expectedAmount: this.ExpectedAmount || null, currencyCode }
    );

    if (!accepted.ok) {
      this.runtime.Journal.append({
        type: "transaction.failed",
        source: "module",
        sessionId: this.runtime.SessionId,
        payload: { transaction: this.Name, code: accepted.code }
      });
      return this.runtime.result(false, accepted.code, accepted.message);
    }

    this.runtime.Journal.append({
      type: "transaction.completed",
      source: "module",
      sessionId: this.runtime.SessionId,
      payload: { transaction: this.Name }
    });
    return this.runtime.result(true, "DEPOSIT_OK", "Cash deposit completed.");
  }
}

export class AdminModule extends AtmModule {
  private operation = "none";

  constructor(runtime: CashblocksRuntime) {
    super(runtime, "TerminalAdmin");
  }

  PrepareBalance(): void {
    this.operation = "balance";
  }

  PrepareCashAdjustment(): void {
    this.operation = "cash_adjustment";
  }

  PrepareSubtotals(): void {
    this.operation = "subtotals";
  }

  async Execute(): Promise<TransactionResult> {
    this.runtime.Journal.append({
      type: "transaction.completed",
      source: "module",
      sessionId: this.runtime.SessionId,
      payload: { transaction: this.Name, operation: this.operation }
    });
    return this.runtime.result(true, "ADMIN_OK", `Admin ${this.operation} completed.`);
  }
}

export type AtmModules = {
  Idle: IdleModule;
  Customer: CustomerModule;
  CoreSession: SessionModule;
  BalanceInquiry: BalanceInquiryModule;
  CashWithdrawal: CashWithdrawalModule;
  CardlessCashWithdrawal: CashWithdrawalModule;
  CashDeposit: CashDepositModule;
  FastCash: FastCashModule;
  TerminalAdmin: AdminModule;
};

export function createAtmModules(runtime: CashblocksRuntime): AtmModules {
  return {
    Idle: new IdleModule(runtime),
    Customer: new CustomerModule(runtime),
    CoreSession: new SessionModule(runtime),
    BalanceInquiry: new BalanceInquiryModule(runtime),
    CashWithdrawal: new CashWithdrawalModule(runtime),
    CardlessCashWithdrawal: new CashWithdrawalModule(runtime, "CardlessCashWithdrawal"),
    CashDeposit: new CashDepositModule(runtime),
    FastCash: new FastCashModule(runtime),
    TerminalAdmin: new AdminModule(runtime)
  };
}

async function callAdapter<T>(
  runtime: CashblocksRuntime,
  adapter: string,
  operation: string,
  call: () => Promise<T>,
  metadata: Record<string, JsonValue> = {}
): Promise<T> {
  try {
    return await call();
  } catch (error) {
    runtime.logDiagnostic({
      level: "error",
      source: "adapter",
      message: `Adapter ${adapter}.${operation} threw an exception.`,
      error: diagnosticError(error),
      metadata: {
        adapter,
        operation,
        ...metadata
      }
    });
    throw error;
  }
}

function diagnosticError(error: unknown): { name: string; message: string; stack?: string } {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack
    };
  }

  return {
    name: "Error",
    message: String(error)
  };
}
