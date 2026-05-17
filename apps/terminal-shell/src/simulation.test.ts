import assert from "node:assert/strict";
import test from "node:test";

import { getFlowManifest, runSimulation } from "./simulation.js";

test("returns the active flow manifest", () => {
  assert.equal(getFlowManifest().id, "cashblocks.example.atm-basic");
});

test("runs a successful cash withdrawal simulation", async () => {
  const result = await runSimulation({ transaction: "CashWithdrawal" });

  assert.equal(result.summary.selectedTransaction, "CashWithdrawal");
  assert.equal(result.summary.status, "completed");
  assert.equal(result.summary.completed, true);
  assert.equal(result.summary.failed, false);
});

test("surfaces declined host simulations", async () => {
  const result = await runSimulation({
    transaction: "CashWithdrawal",
    hostDeclined: true
  });

  assert.equal(result.summary.failed, true);
  assert.equal(result.summary.status, "failed");
  assert.equal(result.summary.failureCode, "HOST_DECLINED");
});

test("surfaces card reader failures before transaction selection", async () => {
  const result = await runSimulation({
    transaction: "CashWithdrawal",
    cardReaderOffline: true
  });

  assert.equal(result.summary.failed, true);
  assert.equal(result.summary.failureCode, "CARD_READER_OFFLINE");
});

test("surfaces dispenser failures for cash withdrawal", async () => {
  const result = await runSimulation({
    transaction: "CashWithdrawal",
    dispenserOffline: true
  });

  assert.equal(result.summary.selectedTransaction, "CashWithdrawal");
  assert.equal(result.summary.failed, true);
  assert.equal(result.summary.failureCode, "DISPENSER_OFFLINE");
});

test("surfaces acceptor failures for cash deposit", async () => {
  const result = await runSimulation({
    transaction: "CashDeposit",
    acceptorOffline: true
  });

  assert.equal(result.summary.selectedTransaction, "CashDeposit");
  assert.equal(result.summary.failed, true);
  assert.equal(result.summary.failureCode, "ACCEPTOR_OFFLINE");
});

test("surfaces receipt warning cancellation without selecting a transaction", async () => {
  const result = await runSimulation({
    transaction: "BalanceInquiry",
    receiptPrinterOut: true,
    receiptWarningAnswer: "NO"
  });

  assert.equal(result.summary.selectedTransaction, undefined);
  assert.equal(result.summary.completed, false);
  assert.equal(result.summary.failed, false);
  assert.equal(result.summary.status, "cancelled");
  assert.equal(result.summary.warningOffered, true);
});
