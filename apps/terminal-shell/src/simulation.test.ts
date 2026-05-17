import assert from "node:assert/strict";
import test from "node:test";

import { getFlowManifest, runSimulation } from "./simulation.js";

test("returns the active flow manifest", () => {
  assert.equal(getFlowManifest().id, "cashblocks.example.atm-basic");
});

test("runs a successful cash withdrawal simulation", async () => {
  const result = await runSimulation({ transaction: "CashWithdrawal" });

  assert.equal(result.summary.selectedTransaction, "CashWithdrawal");
  assert.equal(result.summary.completed, true);
  assert.equal(result.summary.failed, false);
});

test("surfaces declined host simulations", async () => {
  const result = await runSimulation({
    transaction: "CashWithdrawal",
    hostDeclined: true
  });

  assert.equal(result.summary.failed, true);
  assert.equal(result.summary.failureCode, "HOST_DECLINED");
});
