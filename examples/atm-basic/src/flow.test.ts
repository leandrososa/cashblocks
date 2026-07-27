import assert from "node:assert/strict";
import test from "node:test";

import {
  runFlow,
  validateFlowManifest,
  type FlowRunResult
} from "../../../packages/flow-sdk/src/index.js";
import type { FlowPackage } from "../../../packages/runtime-contracts/src/index.js";
import type { RuntimeSimulatorOptions } from "../../../packages/runtime-core/src/index.js";
import flow from "./flow.js";
import manifest from "../cashblocks.flow.json" with { type: "json" };

test("flow manifest is valid", () => {
  assert.deepEqual(validateFlowManifest(manifest as FlowPackage), []);
});

test("printer healthy balance inquiry does not force screen display", async () => {
  const result = await runFlow(flow, {
    flowPackage: manifest as FlowPackage,
    simulator: { customerSelections: ["BalanceInquiry"], optionSelections: ["PrintReceipt"] }
  });

  assert.equal(result.globals.BalanceInquiry.DisplayBalanceOnScreen, false);
});

test("balance inquiry can show balance on screen by customer choice", async () => {
  const result = await runFlow(flow, {
    flowPackage: manifest as FlowPackage,
    simulator: { customerSelections: ["BalanceInquiry"], optionSelections: ["DisplayBalance"] }
  });

  assert.equal(result.globals.BalanceInquiry.DisplayBalanceOnScreen, true);
});

test("printer out balance inquiry forces screen display", async () => {
  const result = await runFlow(flow, {
    flowPackage: manifest as FlowPackage,
    simulator: { customerSelections: ["BalanceInquiry"], optionSelections: ["YES"] },
    configure(globals) {
      globals.Cashblocks.SetProperty("Devices.ReceiptPrinter.StPaperStatus", "OUT");
    }
  });

  assert.equal(result.globals.BalanceInquiry.DisplayBalanceOnScreen, true);
});

test("cash withdrawal configures host authorization", async () => {
  const result = await runFlow(flow, {
    flowPackage: manifest as FlowPackage,
    simulator: { customerSelections: ["CashWithdrawal"] }
  });

  assert.equal(result.globals.CashWithdrawal.Authorization.TransactionHost, "CoreHost");
  assert.equal(result.globals.CashWithdrawal.Authorization.ChipAuthorizationRequired, true);
  assert.equal(result.globals.CashWithdrawal.Authorization.PinEntryOption, "ExceptFirst");
});

test("continues after a receipt warning and records the warning decision", async () => {
  const result = await runExampleFlow({
    customerSelections: ["CashWithdrawal"],
    optionSelections: ["YES", "Confirm"],
    receiptPrinter: { health: "DEGRADED", paper: "OUT" }
  });
  const events = result.runtime.Journal.all();

  assert.equal(result.ok, true);
  assert.equal(
    events.filter(
      (event) =>
        event.type === "ui.prompt" &&
        event.payload?.screen === "PrinterDown" &&
        event.payload?.selected === "YES"
    ).length,
    1
  );
  assert.equal(
    events.some((event) => event.type === "transaction.completed"),
    true
  );
  assert.equal(
    events.some(
      (event) =>
        event.type === "transaction.cancelled" ||
        event.type === "transaction.failed" ||
        event.type === "flow.failed"
    ),
    false
  );
});

test("records receipt-warning cancellation before transaction selection", async () => {
  const result = await runExampleFlow({
    customerSelections: ["CashWithdrawal"],
    optionSelections: ["NO"],
    receiptPrinter: { health: "DEGRADED", paper: "OUT" }
  });
  const events = result.runtime.Journal.all();

  assert.equal(result.ok, true);
  assert.equal(
    events.some(
      (event) =>
        event.type === "transaction.cancelled" &&
        event.payload?.reason === "receipt_unavailable"
    ),
    true
  );
  assert.equal(
    events.some((event) => event.type === "transaction.selected"),
    false
  );
  assert.equal(
    events.some((event) => event.type === "host.authorization_requested"),
    false
  );
  assert.equal(
    events.some(
      (event) =>
        event.type === "transaction.failed" ||
        event.type === "transaction.completed" ||
        event.type === "flow.failed"
    ),
    false
  );
  assertFinancialStateUnchanged(result);
});

test("records confirmation cancellation without host or device effects", async () => {
  const result = await runExampleFlow({
    customerSelections: ["CashWithdrawal"],
    optionSelections: ["CANCEL"]
  });
  const events = result.runtime.Journal.all();

  assert.equal(result.ok, true);
  assert.equal(
    events.some(
      (event) =>
        event.type === "transaction.cancelled" &&
        event.payload?.reason === "withdrawal_confirmation_cancelled"
    ),
    true
  );
  assert.equal(
    events.some((event) => event.type === "host.authorization_requested"),
    false
  );
  assert.equal(
    events.some((event) => event.type === "transaction.completed"),
    false
  );
  assert.equal(
    events.some(
      (event) =>
        event.type === "transaction.failed" ||
        event.type === "flow.failed"
    ),
    false
  );
  assertFinancialStateUnchanged(result);
});

const deviceFaultScenarios: Array<{
  name: string;
  simulator: RuntimeSimulatorOptions;
  expectedCode: string;
}> = [
  {
    name: "card reader offline",
    simulator: {
      customerSelections: ["CashWithdrawal"],
      cardReaderOnline: false
    },
    expectedCode: "CARD_READER_OFFLINE"
  },
  {
    name: "host decline",
    simulator: {
      customerSelections: ["CashWithdrawal"],
      hostApproved: false
    },
    expectedCode: "HOST_DECLINED"
  },
  {
    name: "cash dispenser offline",
    simulator: {
      customerSelections: ["CashWithdrawal"],
      dispenserOnline: false
    },
    expectedCode: "DISPENSER_OFFLINE"
  },
  {
    name: "cash acceptor offline",
    simulator: {
      customerSelections: ["CashDeposit"],
      acceptorOnline: false
    },
    expectedCode: "ACCEPTOR_OFFLINE"
  }
];

for (const scenario of deviceFaultScenarios) {
  test(`journals ${scenario.name} without a completion event`, async () => {
    const result = await runExampleFlow(scenario.simulator);
    const events = result.runtime.Journal.all();

    assert.equal(
      events.filter(
        (event) =>
          event.type === "transaction.failed" &&
          event.payload?.code === scenario.expectedCode
      ).length,
      1
    );
    assert.equal(
      events.some((event) => event.type === "transaction.completed"),
      false
    );
    assert.equal(
      events.some((event) => event.type === "transaction.cancelled"),
      false
    );
    assertFinancialStateUnchanged(result);

    if (scenario.expectedCode === "CARD_READER_OFFLINE") {
      assert.equal(result.ok, false);
      assert.equal(
        events.some((event) => event.type === "flow.failed"),
        true
      );
      assert.equal(
        events.some((event) => event.type === "transaction.selected"),
        false
      );
      assert.equal(
        events.some((event) => event.type === "host.authorization_requested"),
        false
      );
    } else {
      assert.equal(result.ok, true);
      assert.equal(
        events.some((event) => event.type === "flow.failed"),
        false
      );
    }
  });
}

function runExampleFlow(simulator: RuntimeSimulatorOptions): Promise<FlowRunResult> {
  return runFlow(flow, {
    flowPackage: manifest as FlowPackage,
    simulator
  });
}

function assertFinancialStateUnchanged(result: FlowRunResult): void {
  assert.deepEqual(result.runtime.Simulator.accounts, {
    Checking: 1240,
    Savings: 3850,
    Credit: -320
  });
  assert.equal(result.runtime.Simulator.terminalCash, 5000);
}
