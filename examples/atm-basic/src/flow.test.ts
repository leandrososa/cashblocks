import assert from "node:assert/strict";
import test from "node:test";

import { runFlow } from "../../../packages/flow-sdk/src/index.js";
import * as flow from "./flow.js";

test("printer healthy balance inquiry does not force screen display", async () => {
  const result = await runFlow(flow, {
    simulator: { customerSelections: ["BalanceInquiry"] },
    configure(globals) {
      flow.bindFlow(globals);
    }
  });

  assert.equal(result.globals.BalanceInquiry.DisplayBalanceOnScreen, false);
});

test("printer out balance inquiry forces screen display", async () => {
  const result = await runFlow(flow, {
    simulator: { customerSelections: ["BalanceInquiry"], optionSelections: ["YES"] },
    configure(globals) {
      globals.K3A.SetProperty("Devices.ReceiptPrinter.StPaperStatus", "OUT");
      flow.bindFlow(globals);
    }
  });

  assert.equal(result.globals.BalanceInquiry.DisplayBalanceOnScreen, true);
});

test("cash withdrawal configures host authorization", async () => {
  const result = await runFlow(flow, {
    simulator: { customerSelections: ["PCCUCashWithdrawal"] },
    configure(globals) {
      flow.bindFlow(globals);
    }
  });

  assert.equal(result.globals.PCCUCashWithdrawal.Authorization.TransactionHost, "PCCUNDCHost");
  assert.equal(result.globals.PCCUCashWithdrawal.Authorization.ChipAuthorizationRequired, true);
  assert.equal(result.globals.PCCUCashWithdrawal.Authorization.PinEntryOption, "ExceptFirst");
});
