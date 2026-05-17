import type { FlowGlobals } from "../../../packages/flow-sdk/src/index.js";

let globals: FlowGlobals;

export function bindFlow(nextGlobals: FlowGlobals): void {
  globals = nextGlobals;
}

function g(): FlowGlobals {
  if (!globals) {
    throw new Error("ATM flow was not bound to runtime globals.");
  }
  return globals;
}

export function OnStartOfDay(): void {
  const {
    Cashblocks,
    BalanceInquiry,
    PCCUCashWithdrawal,
    FastCash,
    Idle,
    Customer
  } = g();

  Cashblocks.SetCurrencyDetails("AUD", "$", true);
  BalanceInquiry.AddHandler("OnEndReceiptOption", OnEndReceiptOption);
  PCCUCashWithdrawal.AddHandler("OnEndReceiptOption", OnEndCWReceiptOption);
  FastCash.AddHandler("OnEndReceiptOption", OnEndCWReceiptOption);
  Idle.AddHandler("OnStartReInsertCard", OnStartReinsertCard);
  Idle.AddHandler("OnEndReInsertCard", ReEnableMoreTime);
  Customer.AddHandler("OnStartSelectChipApplication", ReEnableMoreTime);
}

export function OnEndReceiptOption(): void {
  const { Cashblocks, BalanceInquiry } = g();

  if (
    Cashblocks.GetProperty("Devices.ReceiptPrinter.StDeviceStatus") !== "HEALTHY" ||
    Cashblocks.GetProperty("Devices.ReceiptPrinter.StPaperStatus") === "OUT"
  ) {
    BalanceInquiry.DisplayBalanceOnScreen = true;
  } else if (
    Cashblocks.ScratchPad.Contains("DisplayBalance") &&
    Cashblocks.ScratchPad.Get("DisplayBalance") === true
  ) {
    Cashblocks.ScratchPad.Remove("DisplayBalance");
    BalanceInquiry.DisplayBalanceOnScreen = true;
  } else {
    BalanceInquiry.DisplayBalanceOnScreen = false;
  }
}

export function OnEndCWReceiptOption(): void {
  const { Cashblocks } = g();

  if (
    Cashblocks.GetProperty("Devices.ReceiptPrinter.StDeviceStatus") !== "HEALTHY" ||
    Cashblocks.GetProperty("Devices.ReceiptPrinter.StPaperStatus") === "OUT"
  ) {
    Cashblocks.ScratchPad.Set("DisplayBalance", true);
  }
}

export function OnStartReinsertCard(): void {
  g().Cashblocks.SetProperty("CustomerApp.Customer.MoreTimeEnabled", false);
}

export function ReEnableMoreTime(): void {
  g().Cashblocks.SetProperty("CustomerApp.Customer.MoreTimeEnabled", true);
}

export async function OnIdle(): Promise<void> {
  const {
    Cashblocks,
    Idle,
    Customer,
    PCCUSession,
    PCCUCardlessCashWithdrawal,
    PCCUCashWithdrawal,
    BalanceInquiry,
    PCCUCashDeposit,
    FastCash,
    ProsegurNDCAdmin
  } = g();

  await Idle.Execute();
  ReEnableMoreTime();

  const cardless = Customer.CustomerType === "TOUCH";

  if (Customer.CustomerType === "ProsegurAdmin") {
    Customer.LanguageSelected = "English";
  }

  if (Customer.CustomerType === "OnUs" && !cardless) {
    Customer.PinCheckEnabled = true;
    Customer.PinCheckChipProcessing = true;
  }

  if (cardless) {
    Customer.PinCheckEnabled = false;
    Customer.PinCheckChipProcessing = false;
  } else {
    PCCUSession.SetupDefaultAccount();
    Customer.PinEntry();
  }

  Cashblocks.LogJournalLine(`LanguageUsed: ${Cashblocks.LocalLanguage.CurrentLanguage}`);
  Cashblocks.ScratchPad.Set("ReceiptWarningOffered", false);

  let moreTransaction = true;
  while (moreTransaction) {
    moreTransaction = false;
    ResetDCCValues();

    const receiptWarningOffered = Cashblocks.ScratchPad.Get("ReceiptWarningOffered");
    if (!receiptWarningOffered && isReceiptPrinterUnavailable()) {
      Cashblocks.ScratchPad.Set("ReceiptWarningOffered", true);
      if (!OfferReceiptWarning()) {
        return;
      }
    }

    PCCUSession.NewTransaction();
    SetCashAdjustmentOptions();

    const transaction = cardless ? Idle.TouchActivationParameter : Customer.SelectTransaction();
    Cashblocks.Log(`TRANSACTION SELECTED:${transaction}`);

    if (transaction === "CardlessWithdrawal") {
      Customer.TransactionSelected = "PCCUCardlessCashWithdrawal";
      PCCUCardlessCashWithdrawal.Authorization.PinlessAuthorizationEnabled = true;
      PCCUCardlessCashWithdrawal.Authorization.ChipAuthorizationRequired = false;
      PCCUCardlessCashWithdrawal.Authorization.TransactionHost = "PCCUNDCHost";
      PCCUCardlessCashWithdrawal.Authorization.PinEntryOption = "Never";
      await PCCUCardlessCashWithdrawal.Execute();
    } else if (transaction === "PCCUCashWithdrawal") {
      PCCUCashWithdrawal.Authorization.PinlessAuthorizationEnabled = false;
      PCCUCashWithdrawal.Authorization.ChipAuthorizationRequired = true;
      PCCUCashWithdrawal.Authorization.TransactionHost = "PCCUNDCHost";
      PCCUCashWithdrawal.Authorization.PinEntryOption = "ExceptFirst";
      await PCCUCashWithdrawal.Execute();
    } else if (transaction === "BalanceInquiry") {
      await BalanceInquiry.Execute();
    } else if (transaction === "PCCUCashDeposit") {
      PCCUCashDeposit.Authorization.PinlessAuthorizationEnabled = false;
      PCCUCashDeposit.Authorization.ChipAuthorizationRequired = false;
      PCCUCashDeposit.Authorization.TransactionHost = "PCCUNDCHost";
      await PCCUCashDeposit.Execute();
    } else if (transaction === "FastCash") {
      if (Cashblocks.ScratchPad.Contains("FastCashAmount")) {
        FastCash.AmountSelector.AmountPreset = Number(Cashblocks.ScratchPad.Get("FastCashAmount"));
      }
      await FastCash.Execute();
    } else if (transaction === "AdminBalanceTerminal") {
      ProsegurNDCAdmin.PrepareBalance();
      await ProsegurNDCAdmin.Execute();
    } else if (transaction === "AdminCashAdjustment") {
      ProsegurNDCAdmin.PrepareCashAdjustment();
      await ProsegurNDCAdmin.Execute();
    } else if (transaction === "AdminPrintTotals") {
      ProsegurNDCAdmin.PrepareSubtotals();
      await ProsegurNDCAdmin.Execute();
    } else {
      Customer.Log(`Unknown transaction:${transaction}`);
    }

    if (
      !cardless &&
      [
        "AdminPrintTotals",
        "AdminCashAdjustment",
        "BalanceInquiry",
        "PCCUCashDeposit",
        "PCCUCashWithdrawal"
      ].includes(transaction)
    ) {
      moreTransaction = PCCUSession.AnotherTransaction();
    }
  }
}

function OfferReceiptWarning(): boolean {
  return g().Customer.SelectOption("PrinterDown", "YES,NO") !== "NO";
}

function SetCashAdjustmentOptions(): void {
  const { Cashblocks, PCCUSession } = g();
  let isNote100Supported = false;
  const supportedNotes = PCCUSession.SupportedNotes;

  if (supportedNotes != null) {
    for (let index = 0; index < supportedNotes.Count; ++index) {
      if (supportedNotes.Item(index) === 100) {
        isNote100Supported = true;
        break;
      }
    }
  }

  const options = isNote100Supported
    ? ["Add10", "Add20", "Add50", "Add100", "Remove10", "Remove20", "Remove50", "Remove100"]
    : ["Add10", "Add20", "Add50", "Remove10", "Remove20", "Remove50"];

  Cashblocks.SetProperty("CustomerApp.ProsegurNDCAdmin.CashAdjustmentOptions", options);
}

function ResetDCCValues(): void {
  const { Cashblocks } = g();
  Cashblocks.ScratchPad.Set("DCCIniAmount", "");
  Cashblocks.ScratchPad.Set("DCCRate", "");
  Cashblocks.ScratchPad.Set("DCCFinAmount", "");
  Cashblocks.ScratchPad.Set("DCCSurcharge", "");
  Cashblocks.ScratchPad.Set("DCCChoice", "");
  Cashblocks.ScratchPad.Set("DCCConvertedAmount", "");
}

function isReceiptPrinterUnavailable(): boolean {
  const { Cashblocks } = g();
  return (
    Cashblocks.GetProperty("Devices.ReceiptPrinter.StDeviceStatus") !== "HEALTHY" ||
    Cashblocks.GetProperty("Devices.ReceiptPrinter.StPaperStatus") === "OUT"
  );
}
