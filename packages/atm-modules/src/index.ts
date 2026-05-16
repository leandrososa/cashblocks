import type { AuthorizationConfig, CustomerType, TransactionResult } from "../../runtime-contracts/src/index.js";
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

  PinEntry(): void {
    this.runtime.Journal.append({
      type: "ui.prompt",
      source: "module",
      sessionId: this.runtime.SessionId,
      payload: { prompt: "PIN" }
    });
  }

  SelectTransaction(): string {
    const transaction = this.runtime.Simulator.nextTransaction();
    this.TransactionSelected = transaction;
    this.runtime.Journal.append({
      type: "transaction.selected",
      source: "ui",
      sessionId: this.runtime.SessionId,
      payload: { transaction }
    });
    return transaction;
  }

  SelectOption(screen: string, optionCsv: string): string {
    const options = optionCsv.split(",").map((option) => option.trim()).filter(Boolean);
    const selected = this.runtime.Simulator.nextOption(screen, options);
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
    this.runtime.K3A.Log("Default account mapped.");
  }

  NewTransaction(): void {
    this.runtime.K3A.Log("New transaction started.");
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

  constructor(runtime: CashblocksRuntime, name = "PCCUCashWithdrawal") {
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

  constructor(runtime: CashblocksRuntime) {
    super(runtime, "PCCUCashDeposit");
  }

  async Execute(): Promise<TransactionResult> {
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
    super(runtime, "ProsegurNDCAdmin");
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
  PCCUSession: SessionModule;
  BalanceInquiry: BalanceInquiryModule;
  PCCUCashWithdrawal: CashWithdrawalModule;
  PCCUCardlessCashWithdrawal: CashWithdrawalModule;
  PCCUCashDeposit: CashDepositModule;
  FastCash: FastCashModule;
  ProsegurNDCAdmin: AdminModule;
};

export function createAtmModules(runtime: CashblocksRuntime): AtmModules {
  return {
    Idle: new IdleModule(runtime),
    Customer: new CustomerModule(runtime),
    PCCUSession: new SessionModule(runtime),
    BalanceInquiry: new BalanceInquiryModule(runtime),
    PCCUCashWithdrawal: new CashWithdrawalModule(runtime),
    PCCUCardlessCashWithdrawal: new CashWithdrawalModule(runtime, "PCCUCardlessCashWithdrawal"),
    PCCUCashDeposit: new CashDepositModule(runtime),
    FastCash: new FastCashModule(runtime),
    ProsegurNDCAdmin: new AdminModule(runtime)
  };
}
