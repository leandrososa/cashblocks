import { defineFlow } from "../../../packages/flow-sdk/src/index.js";

export default defineFlow(
  ({
    Cashblocks,
    Idle,
    Customer,
    CoreSession,
    CardlessCashWithdrawal,
    CashWithdrawal,
    BalanceInquiry,
    CashDeposit,
    FastCash,
    TerminalAdmin
  }) => {
    function OnStartOfDay(): void {
      Cashblocks.SetCurrencyDetails("AUD", "$", true);
      BalanceInquiry.AddHandler("OnEndReceiptOption", OnEndReceiptOption);
      CashWithdrawal.AddHandler("OnEndReceiptOption", OnEndCWReceiptOption);
      FastCash.AddHandler("OnEndReceiptOption", OnEndCWReceiptOption);
      Idle.AddHandler("OnStartReInsertCard", OnStartReinsertCard);
      Idle.AddHandler("OnEndReInsertCard", ReEnableMoreTime);
      Customer.AddHandler("OnStartSelectChipApplication", ReEnableMoreTime);
    }

    function OnEndReceiptOption(): void {
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

    function OnEndCWReceiptOption(): void {
      if (
        Cashblocks.GetProperty("Devices.ReceiptPrinter.StDeviceStatus") !== "HEALTHY" ||
        Cashblocks.GetProperty("Devices.ReceiptPrinter.StPaperStatus") === "OUT"
      ) {
        Cashblocks.ScratchPad.Set("DisplayBalance", true);
      }
    }

    function OnStartReinsertCard(): void {
      Cashblocks.SetProperty("CustomerApp.Customer.MoreTimeEnabled", false);
    }

    function ReEnableMoreTime(): void {
      Cashblocks.SetProperty("CustomerApp.Customer.MoreTimeEnabled", true);
    }

    async function OnIdle(): Promise<void> {
      await Idle.Execute();
      ReEnableMoreTime();

      const cardless = Customer.CustomerType === "TOUCH";

      if (Customer.CustomerType === "OperatorAdmin") {
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
        CoreSession.SetupDefaultAccount();
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

        CoreSession.NewTransaction();
        SetCashAdjustmentOptions();

        const transaction = cardless ? Idle.TouchActivationParameter : Customer.SelectTransaction();
        Cashblocks.Log(`TRANSACTION SELECTED:${transaction}`);

        if (transaction === "CardlessWithdrawal") {
          Customer.TransactionSelected = "CardlessCashWithdrawal";
          CardlessCashWithdrawal.Authorization.PinlessAuthorizationEnabled = true;
          CardlessCashWithdrawal.Authorization.ChipAuthorizationRequired = false;
          CardlessCashWithdrawal.Authorization.TransactionHost = "CoreHost";
          CardlessCashWithdrawal.Authorization.PinEntryOption = "Never";
          await CardlessCashWithdrawal.Execute();
        } else if (transaction === "CashWithdrawal") {
          CashWithdrawal.Authorization.PinlessAuthorizationEnabled = false;
          CashWithdrawal.Authorization.ChipAuthorizationRequired = true;
          CashWithdrawal.Authorization.TransactionHost = "CoreHost";
          CashWithdrawal.Authorization.PinEntryOption = "ExceptFirst";
          await CashWithdrawal.Execute();
        } else if (transaction === "BalanceInquiry") {
          await BalanceInquiry.Execute();
        } else if (transaction === "CashDeposit") {
          CashDeposit.Authorization.PinlessAuthorizationEnabled = false;
          CashDeposit.Authorization.ChipAuthorizationRequired = false;
          CashDeposit.Authorization.TransactionHost = "CoreHost";
          await CashDeposit.Execute();
        } else if (transaction === "FastCash") {
          if (Cashblocks.ScratchPad.Contains("FastCashAmount")) {
            FastCash.AmountSelector.AmountPreset = Number(Cashblocks.ScratchPad.Get("FastCashAmount"));
          }
          await FastCash.Execute();
        } else if (transaction === "AdminBalanceTerminal") {
          TerminalAdmin.PrepareBalance();
          await TerminalAdmin.Execute();
        } else if (transaction === "AdminCashAdjustment") {
          TerminalAdmin.PrepareCashAdjustment();
          await TerminalAdmin.Execute();
        } else if (transaction === "AdminPrintTotals") {
          TerminalAdmin.PrepareSubtotals();
          await TerminalAdmin.Execute();
        } else {
          Customer.Log(`Unknown transaction:${transaction}`);
        }

        if (
          !cardless &&
          [
            "AdminPrintTotals",
            "AdminCashAdjustment",
            "BalanceInquiry",
            "CashDeposit",
            "CashWithdrawal"
          ].includes(transaction)
        ) {
          moreTransaction = CoreSession.AnotherTransaction();
        }
      }
    }

    function OfferReceiptWarning(): boolean {
      return Customer.SelectOption("PrinterDown", "YES,NO") !== "NO";
    }

    function SetCashAdjustmentOptions(): void {
      let isNote100Supported = false;
      const supportedNotes = CoreSession.SupportedNotes;

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

      Cashblocks.SetProperty("CustomerApp.TerminalAdmin.CashAdjustmentOptions", options);
    }

    function ResetDCCValues(): void {
      Cashblocks.ScratchPad.Set("DCCIniAmount", "");
      Cashblocks.ScratchPad.Set("DCCRate", "");
      Cashblocks.ScratchPad.Set("DCCFinAmount", "");
      Cashblocks.ScratchPad.Set("DCCSurcharge", "");
      Cashblocks.ScratchPad.Set("DCCChoice", "");
      Cashblocks.ScratchPad.Set("DCCConvertedAmount", "");
    }

    function isReceiptPrinterUnavailable(): boolean {
      return (
        Cashblocks.GetProperty("Devices.ReceiptPrinter.StDeviceStatus") !== "HEALTHY" ||
        Cashblocks.GetProperty("Devices.ReceiptPrinter.StPaperStatus") === "OUT"
      );
    }

    return {
      OnStartOfDay,
      OnIdle
    };
  }
);
