import assert from "node:assert/strict";
import test from "node:test";

import { runFlow, validateFlowManifest } from "../../../packages/flow-sdk/src/index.js";
import type { FlowPackage } from "../../../packages/runtime-contracts/src/index.js";
import flow from "./flow.js";
import manifest from "../cashblocks.flow.json" with { type: "json" };

test("flow manifest is valid", () => {
  assert.deepEqual(validateFlowManifest(manifest as FlowPackage), []);
});

test("printer healthy balance inquiry does not force screen display", async () => {
  const result = await runFlow(flow, {
    flowPackage: manifest as FlowPackage,
    simulator: { customerSelections: ["BalanceInquiry"] }
  });

  assert.equal(result.globals.BalanceInquiry.DisplayBalanceOnScreen, false);
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
