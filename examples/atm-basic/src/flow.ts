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

      if (Customer.CustomerType === "OperatorAdmin") {
        Customer.PinCheckEnabled = false;
        Customer.PinCheckChipProcessing = false;
      } else if (cardless) {
        Customer.PinCheckEnabled = false;
        Customer.PinCheckChipProcessing = false;
      } else {
        CoreSession.SetupDefaultAccount();
        await Customer.PinEntry();
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
          if (!(await OfferReceiptWarning())) {
            return;
          }
        }

        CoreSession.NewTransaction();
        SetCashAdjustmentOptions();

        const transaction = cardless ? Idle.TouchActivationParameter : await Customer.SelectTransaction();
        Cashblocks.Log(`TRANSACTION SELECTED:${transaction}`);

        if (transaction === "CardlessWithdrawal") {
          CoreSession.CurrentAccount = await Customer.SelectAccount(["Checking", "Savings"]);
          CardlessCashWithdrawal.Amount = await Customer.SelectAmount({
            prompt: "Select cardless withdrawal amount",
            currencyCode: Cashblocks.GetProperty<string>("Currency.Code") ?? "AUD",
            presets: [40, 80, 100, 200],
            allowCustom: true
          });
          CoreSession.LastTransactionAmount = CardlessCashWithdrawal.Amount;
          Customer.TransactionSelected = "CardlessCashWithdrawal";
          CardlessCashWithdrawal.Authorization.PinlessAuthorizationEnabled = true;
          CardlessCashWithdrawal.Authorization.ChipAuthorizationRequired = false;
          CardlessCashWithdrawal.Authorization.TransactionHost = "CoreHost";
          CardlessCashWithdrawal.Authorization.PinEntryOption = "Never";
          await CardlessCashWithdrawal.Execute();
        } else if (transaction === "CashWithdrawal") {
          CoreSession.CurrentAccount = await Customer.SelectAccount(["Checking", "Savings", "Credit"]);
          CashWithdrawal.Amount = await Customer.SelectAmount({
            prompt: "Select withdrawal amount",
            currencyCode: Cashblocks.GetProperty<string>("Currency.Code") ?? "AUD",
            presets: [20, 50, 100, 200, 500],
            allowCustom: true
          });
          CoreSession.LastTransactionAmount = CashWithdrawal.Amount;
          CashWithdrawal.Authorization.PinlessAuthorizationEnabled = false;
          CashWithdrawal.Authorization.ChipAuthorizationRequired = true;
          CashWithdrawal.Authorization.TransactionHost = "CoreHost";
          CashWithdrawal.Authorization.PinEntryOption = "ExceptFirst";
          await CashWithdrawal.Execute();
        } else if (transaction === "BalanceInquiry") {
          CoreSession.CurrentAccount = await Customer.SelectAccount(["Checking", "Savings", "Credit"]);
          await BalanceInquiry.Execute();
        } else if (transaction === "CashDeposit") {
          CoreSession.CurrentAccount = await Customer.SelectAccount(["Checking", "Savings"]);
          CashDeposit.ExpectedAmount = await Customer.SelectAmount({
            prompt: "Confirm deposit amount",
            currencyCode: Cashblocks.GetProperty<string>("Currency.Code") ?? "AUD",
            presets: [50, 100, 250, 500, 1000],
            allowCustom: true
          });
          CoreSession.LastTransactionAmount = CashDeposit.ExpectedAmount;
          CashDeposit.Authorization.PinlessAuthorizationEnabled = false;
          CashDeposit.Authorization.ChipAuthorizationRequired = false;
          CashDeposit.Authorization.TransactionHost = "CoreHost";
          await CashDeposit.Execute();
        } else if (transaction === "FastCash") {
          CoreSession.CurrentAccount = await Customer.SelectAccount(["Checking", "Savings"]);
          FastCash.AmountSelector.AmountPreset = 100;
          FastCash.Amount = FastCash.AmountSelector.AmountPreset;
          CoreSession.LastTransactionAmount = FastCash.Amount;
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

    async function OfferReceiptWarning(): Promise<boolean> {
      return (await Customer.SelectOption("PrinterDown", "YES,NO")) !== "NO";
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
