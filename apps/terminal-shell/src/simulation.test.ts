import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { getFlowManifest, readJournalHistory, runSimulation } from "./simulation.js";

test("returns the active flow manifest", () => {
  assert.equal(getFlowManifest().id, "cashblocks.example.atm-basic");
});

test("runs a successful cash withdrawal simulation", async () => {
  const result = await runSimulation({ transaction: "CashWithdrawal" });

  assert.equal(result.summary.selectedTransaction, "CashWithdrawal");
  assert.equal(result.summary.status, "completed");
  assert.equal(result.summary.screenTitle, "Cash Withdrawal complete");
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
  assert.equal(result.summary.screenTitle, "Transaction declined");
});

test("surfaces card reader failures before transaction selection", async () => {
  const result = await runSimulation({
    transaction: "CashWithdrawal",
    cardReaderOffline: true
  });

  assert.equal(result.summary.failed, true);
  assert.equal(result.summary.failureCode, "CARD_READER_OFFLINE");
  assert.equal(result.summary.screenTitle, "Card reader unavailable");
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
  assert.equal(result.summary.screenTitle, "Transaction cancelled");
  assert.equal(result.summary.warningOffered, true);
});

test("reads durable journal history grouped by session", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cashblocks-history-"));
  const journalPath = join(dir, "runtime.jsonl");

  await runSimulation({ transaction: "CashWithdrawal", journalPath });
  await runSimulation({ transaction: "CashWithdrawal", hostDeclined: true, journalPath });

  const history = await readJournalHistory(journalPath);

  assert.equal(history.configured, true);
  assert.equal(history.sessions.length, 2);
  assert.deepEqual(
    history.sessions.map((session) => session.summary.status).sort(),
    ["completed", "failed"]
  );
});

test("reports unconfigured journal history", async () => {
  const history = await readJournalHistory();

  assert.equal(history.configured, false);
  assert.deepEqual(history.sessions, []);
});
