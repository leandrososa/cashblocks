# Flow Development

Flow packages define customer-specific ATM behavior without changing the runtime
or reusable transaction modules.

## Flow Shape

```ts
import { defineFlow } from "../../../packages/flow-sdk/src/index.js";

export default defineFlow(
  ({ Cashblocks, Idle, Customer, CoreSession, CashWithdrawal }) => {
    function OnStartOfDay(): void {
      Cashblocks.SetCurrencyDetails("AUD", "$", true);
    }

    async function OnIdle(): Promise<void> {
      await Idle.Execute();
      await Customer.PinEntry();
      const transaction = await Customer.SelectTransaction();
      if (transaction !== "CashWithdrawal") {
        CoreSession.CancelTransaction("unsupported_transaction", transaction);
        return;
      }
      Customer.TransactionSelected = transaction;
      await CashWithdrawal.Execute();
    }

    return { OnStartOfDay, OnIdle };
  }
);
```

`OnStartOfDay` is for startup configuration. `OnIdle` represents the customer
session path from idle through transaction completion or cancellation.

## Controlled Globals

The flow receives:

- `Cashblocks`: scratchpad, properties, currency, language, and logging helpers.
- `Customer`: customer prompts such as PIN, transaction selection, and options.
- `CoreSession`: session setup and transaction lifecycle helpers.
- transaction modules such as `CashWithdrawal`, `BalanceInquiry`, and
  `CashDeposit`.

Globals are fresh for each run. Do not store cross-run state in module-level
variables.

## Handlers

Flows can register module handlers to customize policy:

```ts
BalanceInquiry.AddHandler("OnEndReceiptOption", () => {
  BalanceInquiry.DisplayBalanceOnScreen = true;
});
```

Use handlers for project-specific rules around reusable module behavior.

## Prompts

Customer-facing methods can pause through the runtime interaction layer:

- `Customer.PinEntry()`
- `Customer.SelectTransaction()`
- `Customer.SelectOption(screen, options)`

In simulator mode, answers come from configured simulator values. In the browser
shell, the session endpoints expose prompts and resume the same running flow.

## Testing Flows

Use `runFlow` with simulator options:

```ts
await runFlow(flow, {
  simulator: {
    customerSelections: ["CashWithdrawal"],
    hostApproved: false
  }
});
```

Assert both the returned result and journal events. For software failures, attach
a diagnostic logger and assert the technical log entry separately from
`flow.failed`.

Browser-session simulations can queue answers for transaction-specific option
prompts:

```ts
await runSimulation({
  transaction: "CashWithdrawal",
  transactionOptionAnswers: ["CANCEL"]
});
```

When a flow exits because of a customer decision, call
`CoreSession.CancelTransaction(reason, transaction)`. This appends a
`transaction.cancelled` event so journal consumers can distinguish cancellation
from an idle or incomplete session.

## Flow Boundary Rules

- Flow code decides ordering and customer-specific policy.
- Modules execute reusable transaction behavior.
- Adapters isolate device and host integrations.
- ISO8583 belongs behind host adapters.
- XFS, J/XFS, and XFS4IoT belong behind device adapters.
