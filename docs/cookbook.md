# Cashblocks Cookbook

These recipes are small starting points for common flow, adapter, simulator, and
browser-session tasks.

## Create a flow package

Create `cashblocks.flow.json`:

```json
{
  "id": "example.cash-withdrawal",
  "version": "1.0.0",
  "entrypoint": "./src/flow.ts",
  "capabilities": ["card-reader", "cash-dispenser", "host-authorization"],
  "modules": ["Idle", "Customer", "CoreSession", "CashWithdrawal"]
}
```

Then define the lifecycle:

```ts
import { defineFlow } from "@cashblocks/flow-sdk";

export default defineFlow(
  ({ Cashblocks, Idle, Customer, CoreSession, CashWithdrawal }) => ({
    OnStartOfDay() {
      Cashblocks.SetCurrencyDetails("AUD", "$", true);
    },
    async OnIdle() {
      await Idle.Execute();
      await Customer.PinEntry();
      Customer.TransactionSelected = await Customer.SelectTransaction();
      CoreSession.CurrentAccount = await Customer.SelectAccount();
      CashWithdrawal.Account = CoreSession.CurrentAccount;
      CashWithdrawal.Amount = await Customer.SelectAmount({
        prompt: "Select amount",
        currencyCode: "AUD",
        presets: [20, 50, 100],
        allowCustom: true
      });
      await CashWithdrawal.Execute();
    }
  })
);
```

## Test a successful transaction

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { runFlow } from "@cashblocks/flow-sdk";
import flow from "./flow.js";

test("withdraws from savings", async () => {
  const result = await runFlow(flow, {
    simulator: {
      customerSelections: ["CashWithdrawal"],
      accountSelections: ["Savings"],
      amountSelections: [200]
    }
  });

  assert.equal(result.ok, true);
  assert.equal(
    result.runtime.Journal.all().some(
      (event) => event.type === "transaction.completed"
    ),
    true
  );
});
```

## Test a cancellation

Queue the option exactly as the flow presents it:

```ts
import assert from "node:assert/strict";
import { runSimulation } from "../apps/terminal-shell/src/simulation.js";

const result = await runSimulation({
  transaction: "CashWithdrawal",
  account: "Checking",
  amount: 100,
  transactionOptionAnswers: ["CANCEL"]
});

assert.equal(result.summary.status, "cancelled");
assert.equal(result.summary.cancellationReason, "withdrawal_confirmation_cancelled");
assert.equal(
  result.events.some((event) => event.type === "host.authorization_requested"),
  false
);
```

## Test a device or host fault

```ts
const result = await runFlow(flow, {
  simulator: {
    customerSelections: ["CashWithdrawal"],
    hostApproved: false,
    dispenserOnline: true
  }
});

const failure = result.runtime.Journal.all().find(
  (event) => event.type === "transaction.failed"
);
assert.equal(failure?.payload?.code, "HOST_DECLINED");
```

Available switches include `hostApproved`, `dispenserOnline`,
`acceptorOnline`, `cardReaderOnline`, and receipt printer health/paper status.

## Supply a custom adapter

```ts
import type { CashDispenserAdapter } from "@cashblocks/runtime-contracts";

const cashDispenser: CashDispenserAdapter = {
  id: "example.dispenser",
  kind: "cash-dispenser",
  capabilities: ["dispense"],
  async dispense({ amount, currencyCode }) {
    if (amount <= 0) {
      return { ok: false, code: "INVALID_AMOUNT", message: "Amount must be positive." };
    }

    return {
      ok: true,
      code: "DISPENSED",
      message: `${amount} ${currencyCode} dispensed.`
    };
  }
};
```

Pass a complete `TerminalAdapters` set to `CashblocksRuntime`. Keep protocol,
driver, retry, and vendor details inside adapters rather than flow code.

## Capture diagnostic logs

```ts
import {
  CashblocksRuntime,
  MemoryDiagnosticLogger
} from "@cashblocks/runtime-core";

const diagnosticLogger = new MemoryDiagnosticLogger();
const runtime = new CashblocksRuntime({ logger: diagnosticLogger });

// Run a flow with this runtime, then inspect technical failures.
console.log(diagnosticLogger.all());
```

Diagnostic logs hold exceptions and technical metadata. Use journal events for
stable transaction outcomes.

## Persist and read a journal

```ts
const result = await runFlow(flow, {
  journalPath: "./data/runtime.journal.jsonl"
});

await result.runtime.Journal.flush();

const persistence = new JsonlJournalPersistence(
  "./data/runtime.journal.jsonl"
);
const events = await persistence.readAll();
```

Always flush before process shutdown when durable audit history matters.

## Drive a paused browser session

```ts
import {
  TerminalSessionManager
} from "@cashblocks/terminal-session";
import type { RuntimeEvent } from "@cashblocks/runtime-contracts";
import flow from "../examples/atm-basic/src/flow.js";
import manifest from "../examples/atm-basic/cashblocks.flow.json" with { type: "json" };

const manager = new TerminalSessionManager({
  flow,
  flowPackage: manifest,
  summarizeEvents(events: RuntimeEvent[]) {
    return {
      eventCount: events.length,
      completed: events.some((event) => event.type === "transaction.completed")
    };
  }
});

const session = manager.start({});
const firstState = await manager.state(session);

if (firstState.prompt) {
  manager.answer({
    sessionId: session.id,
    promptId: firstState.prompt.id,
    value: "1234"
  });
}
```

Only answer the currently pending prompt. A stale or unknown prompt id returns
`false`.

## Add flow-specific policy

Handlers let a customer flow alter reusable module policy:

```ts
BalanceInquiry.AddHandler("OnEndReceiptOption", () => {
  BalanceInquiry.DisplayBalanceOnScreen = true;
});
```

Use a handler when the behavior is project policy. Change the module itself when
the behavior is transaction mechanics shared by all flows.
