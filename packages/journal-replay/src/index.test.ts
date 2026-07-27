import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  inspectJournalFile,
  inspectJournalText,
  replaySession
} from "./index.js";
import type { RuntimeEvent } from "../../runtime-contracts/src/index.js";
import { runSimulation } from "../../../apps/terminal-shell/src/simulation.js";

test("journal replay groups sessions and projects deterministic state", () => {
  const report = inspectJournalText(
    [
      event({ seq: 1, type: "runtime.started" }),
      event({
        seq: 2,
        type: "flow.loaded",
        sessionId: "session-a",
        payload: { entrypoint: "flow.js" }
      }),
      event({
        seq: 3,
        type: "session.started",
        sessionId: "session-a"
      }),
      event({
        seq: 4,
        type: "transaction.selected",
        sessionId: "session-a",
        payload: { transaction: "CashWithdrawal" }
      }),
      event({
        seq: 5,
        type: "host.authorization_requested",
        sessionId: "session-a",
        payload: { transaction: "CashWithdrawal" }
      }),
      event({
        seq: 6,
        type: "host.authorization_result",
        sessionId: "session-a",
        payload: { transaction: "CashWithdrawal", ok: true }
      }),
      event({
        seq: 7,
        type: "transaction.completed",
        sessionId: "session-a",
        payload: {
          transaction: "CashWithdrawal",
          account: "Checking",
          amount: 40,
          currencyCode: "AUD",
          balanceAfter: 960,
          terminalCashAfter: 4_960
        }
      }),
      event({ seq: 1, type: "runtime.started" }),
      event({
        seq: 2,
        type: "flow.loaded",
        sessionId: "session-b",
        payload: { entrypoint: "flow.js" }
      }),
      event({
        seq: 3,
        type: "session.started",
        sessionId: "session-b"
      }),
      event({
        seq: 4,
        type: "transaction.cancelled",
        sessionId: "session-b",
        payload: {
          transaction: "CashDeposit",
          reason: "customer_cancelled"
        }
      })
    ].join("\n"),
    { includeFrames: true }
  );

  assert.equal(report.valid, true);
  assert.equal(report.unscopedEventCount, 2);
  assert.equal(report.sessions.length, 2);
  const withdrawal = report.sessions[0];
  assert.equal(withdrawal?.state.status, "completed");
  assert.equal(withdrawal?.state.accounts.Checking, 960);
  assert.equal(withdrawal?.state.terminalCash, 4_960);
  assert.equal(withdrawal?.state.hostRequests, 1);
  assert.equal(withdrawal?.frames.length, 6);
});

test("journal replay reports malformed lines and lifecycle violations", () => {
  const report = inspectJournalText(
    [
      "{bad-json",
      JSON.stringify({ seq: 0, type: "unknown", ts: "not-a-date" }),
      event({
        seq: 2,
        type: "flow.loaded",
        sessionId: "session-a",
        payload: { entrypoint: "flow.js" }
      }),
      event({
        seq: 4,
        type: "host.authorization_result",
        sessionId: "session-a",
        payload: { transaction: "CashWithdrawal" }
      }),
      event({
        seq: 5,
        type: "transaction.completed",
        sessionId: "session-a",
        payload: { transaction: "CashWithdrawal" }
      }),
      event({
        seq: 6,
        type: "transaction.failed",
        sessionId: "session-a",
        payload: { transaction: "CashWithdrawal" }
      })
    ].join("\n")
  );

  assert.equal(report.valid, false);
  assert.deepEqual(
    new Set(report.issues.map((issue) => issue.code)),
    new Set([
      "INVALID_JSON",
      "INVALID_SEQUENCE",
      "INVALID_EVENT_TYPE",
      "INVALID_EVENT_SOURCE",
      "INVALID_TIMESTAMP",
      "SEQUENCE_GAP",
      "HOST_RESULT_WITHOUT_REQUEST",
      "AMBIGUOUS_REPEATED_OUTCOME",
      "RUNTIME_SESSION_MISMATCH"
    ])
  );
});

test("strict replay rejects unanchored, malformed, and empty journals", () => {
  const malformed = inspectJournalText(
    JSON.stringify({
      seq: 99,
      type: "transaction.completed",
      ts: "0",
      source: "module",
      sessionId: "session-a",
      payload: { transaction: 123, amount: "forty" }
    })
  );
  const empty = inspectJournalText("");

  assert.equal(malformed.valid, false);
  assert.equal(empty.valid, false);
  assert.ok(
    malformed.issues.some((issue) => issue.code === "INVALID_TIMESTAMP")
  );
  assert.ok(
    malformed.issues.some((issue) => issue.code === "INVALID_PAYLOAD_FIELD")
  );
  assert.equal(empty.issues[0]?.code, "EMPTY_JOURNAL");
});

test("journal replay models repeated transaction occurrences", () => {
  const report = inspectJournalText(
    [
      event({ seq: 1, type: "runtime.started" }),
      event({
        seq: 2,
        type: "flow.loaded",
        sessionId: "session-a",
        payload: { entrypoint: "flow.js" }
      }),
      event({
        seq: 3,
        type: "transaction.started",
        sessionId: "session-a",
        payload: { transaction: "BalanceInquiry" }
      }),
      event({
        seq: 4,
        type: "transaction.completed",
        sessionId: "session-a",
        payload: { transaction: "BalanceInquiry" }
      }),
      event({
        seq: 5,
        type: "transaction.started",
        sessionId: "session-a",
        payload: { transaction: "BalanceInquiry" }
      }),
      event({
        seq: 6,
        type: "transaction.completed",
        sessionId: "session-a",
        payload: { transaction: "BalanceInquiry" }
      })
    ].join("\n")
  );

  assert.equal(report.valid, true);
  assert.deepEqual(
    report.sessions[0]?.state.transactions.map((item) => item.occurrence),
    [1, 2]
  );
});

test("strict replay requires complete runtime and session anchors", () => {
  const badSequence = inspectJournalText(
    [
      event({ seq: 1, type: "runtime.started" }),
      event({
        seq: 99,
        type: "flow.loaded",
        sessionId: "session-a",
        payload: { entrypoint: "flow.js" }
      }),
      event({
        seq: 100,
        type: "transaction.completed",
        sessionId: "session-a",
        payload: { transaction: "BalanceInquiry" }
      })
    ].join("\n")
  );
  const runtimeOnly = inspectJournalText(
    event({ seq: 1, type: "runtime.started" })
  );

  assert.equal(badSequence.valid, false);
  assert.ok(
    badSequence.issues.some(
      (issue) => issue.code === "SESSION_SEQUENCE_START"
    )
  );
  assert.equal(runtimeOnly.valid, false);
  assert.ok(
    runtimeOnly.issues.some((issue) => issue.code === "NO_SESSIONS")
  );
});

test("strict replay rejects physically reordered anchors", () => {
  const report = inspectJournalText(
    [
      event({
        seq: 2,
        type: "flow.loaded",
        sessionId: "session-a",
        payload: { entrypoint: "flow.js" }
      }),
      event({
        seq: 3,
        type: "transaction.completed",
        sessionId: "session-a",
        payload: { transaction: "BalanceInquiry" }
      }),
      event({ seq: 1, type: "runtime.started" })
    ].join("\n")
  );

  assert.equal(report.valid, false);
  assert.ok(
    report.issues.some((issue) => issue.code === "ANCHOR_ORDER_INVALID")
  );
});

test("journal replay detects open transactions and mismatched host pairs", () => {
  const openTransaction = inspectJournalText(
    [
      event({ seq: 1, type: "runtime.started" }),
      event({
        seq: 2,
        type: "flow.loaded",
        sessionId: "session-a",
        payload: { entrypoint: "flow.js" }
      }),
      event({
        seq: 3,
        type: "transaction.started",
        sessionId: "session-a",
        payload: { transaction: "TransactionA" }
      }),
      event({
        seq: 4,
        type: "transaction.completed",
        sessionId: "session-a",
        payload: { transaction: "TransactionB" }
      })
    ].join("\n")
  );
  const hostMismatch = inspectJournalText(
    [
      event({ seq: 1, type: "runtime.started" }),
      event({
        seq: 2,
        type: "flow.loaded",
        sessionId: "session-a",
        payload: { entrypoint: "flow.js" }
      }),
      event({
        seq: 3,
        type: "host.authorization_requested",
        sessionId: "session-a",
        payload: { transaction: "TransactionA" }
      }),
      event({
        seq: 4,
        type: "host.authorization_result",
        sessionId: "session-a",
        payload: { transaction: "TransactionB", ok: true }
      }),
      event({
        seq: 5,
        type: "transaction.completed",
        sessionId: "session-a",
        payload: { transaction: "TransactionB" }
      })
    ].join("\n")
  );

  assert.equal(openTransaction.valid, false);
  assert.ok(
    openTransaction.issues.some((issue) => issue.code === "OPEN_TRANSACTION")
  );
  assert.equal(hostMismatch.valid, false);
  assert.ok(
    hostMismatch.issues.some(
      (issue) => issue.code === "HOST_RESULT_WITHOUT_REQUEST"
    )
  );
  assert.ok(
    hostMismatch.issues.some(
      (issue) => issue.code === "HOST_REQUEST_UNRESOLVED"
    )
  );
});

test("partial replay treats in-flight work as warnings", () => {
  const report = inspectJournalText(
    [
      event({ seq: 1, type: "runtime.started" }),
      event({
        seq: 2,
        type: "flow.loaded",
        sessionId: "session-a",
        payload: { entrypoint: "flow.js" }
      }),
      event({
        seq: 3,
        type: "transaction.started",
        sessionId: "session-a",
        payload: { transaction: "CashWithdrawal" }
      }),
      event({
        seq: 4,
        type: "host.authorization_requested",
        sessionId: "session-a",
        payload: { transaction: "CashWithdrawal" }
      })
    ].join("\n"),
    { mode: "partial" }
  );

  assert.equal(report.valid, true);
  assert.deepEqual(
    new Set(report.issues.map((issue) => issue.code)),
    new Set([
      "SESSION_INCOMPLETE",
      "OPEN_TRANSACTION",
      "HOST_REQUEST_UNRESOLVED"
    ])
  );
  assert.ok(report.issues.every((issue) => issue.severity === "warning"));
});

test("journal replay keeps hostile projection keys as own data", () => {
  const report = inspectJournalText(
    [
      event({ seq: 1, type: "runtime.started" }),
      event({
        seq: 2,
        type: "flow.loaded",
        sessionId: "session-a",
        payload: { entrypoint: "flow.js" }
      }),
      event({
        seq: 3,
        type: "device.status_changed",
        sessionId: "session-a",
        payload: { device: "__proto__", health: "DEGRADED" }
      }),
      event({
        seq: 4,
        type: "transaction.completed",
        sessionId: "session-a",
        payload: { transaction: "BalanceInquiry" }
      })
    ].join("\n")
  );
  const devices = report.sessions[0]?.state.devices;

  assert.equal(Object.getPrototypeOf(devices), null);
  assert.equal(devices?.["__proto__"], "DEGRADED");
  assert.deepEqual(Object.keys(devices ?? {}), ["__proto__"]);
});

test("journal replay bounds frame expansion and in-memory text", () => {
  const text = [
    event({ seq: 1, type: "runtime.started" }),
    event({
      seq: 2,
      type: "flow.loaded",
      sessionId: "session-a",
      payload: { entrypoint: "flow.js" }
    }),
    event({
      seq: 3,
      type: "session.started",
      sessionId: "session-a"
    }),
    event({
      seq: 4,
      type: "transaction.completed",
      sessionId: "session-a",
      payload: { transaction: "BalanceInquiry" }
    })
  ].join("\n");

  const report = inspectJournalText(text, {
    includeFrames: true,
    maxFrames: 2
  });
  assert.equal(report.valid, false);
  assert.equal(report.sessions[0]?.frames.length, 0);
  assert.ok(
    report.issues.some((issue) => issue.code === "FRAME_LIMIT_EXCEEDED")
  );
  assert.throws(
    () => inspectJournalText(text, { maxFileBytes: 10 }),
    /exceeds/
  );
});

test("journal replay applies global frame, line, and issue budgets", () => {
  const text = [
    event({ seq: 1, type: "runtime.started" }),
    event({
      seq: 2,
      type: "flow.loaded",
      sessionId: "session-a",
      payload: { entrypoint: "flow.js" }
    }),
    event({
      seq: 3,
      type: "transaction.completed",
      sessionId: "session-a",
      payload: { transaction: "BalanceInquiry" }
    }),
    event({ seq: 1, type: "runtime.started" }),
    event({
      seq: 2,
      type: "flow.loaded",
      sessionId: "session-b",
      payload: { entrypoint: "flow.js" }
    }),
    event({
      seq: 3,
      type: "transaction.completed",
      sessionId: "session-b",
      payload: { transaction: "BalanceInquiry" }
    })
  ].join("\n");
  const frames = inspectJournalText(text, {
    includeFrames: true,
    maxFrames: 3
  });
  const lines = inspectJournalText("\n\n\n\n", {
    mode: "partial",
    maxLines: 2,
    maxIssues: 10
  });
  const issueCap = inspectJournalText("\n\n\n\n", {
    mode: "partial",
    maxLines: 10,
    maxIssues: 2
  });

  assert.equal(
    frames.sessions.reduce(
      (count, session) => count + session.frames.length,
      0
    ),
    2
  );
  assert.ok(
    frames.issues.some((issue) => issue.code === "FRAME_LIMIT_EXCEEDED")
  );
  assert.ok(
    lines.issues.some((issue) => issue.code === "LINE_LIMIT_EXCEEDED")
  );
  assert.equal(issueCap.issues.length, 2);
  assert.equal(issueCap.issues.at(-1)?.code, "ISSUE_LIMIT_EXCEEDED");
});

test("journal replay indexes large projections and caps derived issues", () => {
  const largeEvents = [
    event({ seq: 1, type: "runtime.started" }),
    event({
      seq: 2,
      type: "flow.loaded",
      sessionId: "session-a",
      payload: { entrypoint: "flow.js" }
    })
  ];
  for (let index = 0; index < 5_000; index += 1) {
    largeEvents.push(
      event({
        seq: index + 3,
        type: "transaction.completed",
        sessionId: "session-a",
        payload: { transaction: `Transaction${index}` }
      })
    );
  }
  const large = inspectJournalText(largeEvents.join("\n"));

  const noisyEvents = [
    event({ seq: 1, type: "runtime.started" }),
    event({
      seq: 2,
      type: "flow.loaded",
      sessionId: "session-a",
      payload: { entrypoint: "flow.js" }
    })
  ];
  for (let index = 0; index < 100; index += 1) {
    noisyEvents.push(
      event({
        seq: 4 + index * 2,
        type: "transaction.completed",
        sessionId: "session-a",
        payload: { transaction: `Noisy${index}` }
      })
    );
  }
  const noisy = inspectJournalText(noisyEvents.join("\n"), {
    maxIssues: 10
  });

  assert.equal(large.valid, true);
  assert.equal(large.sessions[0]?.state.transactions.length, 5_000);
  assert.equal(noisy.issues.length, 10);
  assert.ok(noisy.sessions[0]!.issues.length <= 10);
  assert.equal(noisy.issues.at(-1)?.code, "ISSUE_LIMIT_EXCEEDED");
});

test("journal replay projects real cardless and balance inquiry journals", async () => {
  const cardless = await runSimulation({
    customerType: "TOUCH",
    transactionOptionAnswers: ["Continue", "Confirm"]
  });
  const balance = await runSimulation({
    transaction: "BalanceInquiry",
    account: "Savings"
  });
  const cardlessReport = inspectJournalText(
    cardless.events.map((item) => JSON.stringify(item)).join("\n")
  );
  const balanceReport = inspectJournalText(
    balance.events.map((item) => JSON.stringify(item)).join("\n")
  );

  assert.equal(cardlessReport.valid, true);
  assert.equal(
    cardlessReport.sessions[0]?.state.selectedTransaction,
    "CardlessCashWithdrawal"
  );
  assert.equal(balanceReport.valid, true);
  assert.equal(
    balanceReport.sessions[0]?.state.accounts.Savings,
    balance.summary.balanceAfter
  );
});

test("session replay returns isolated frame snapshots", () => {
  const events: RuntimeEvent[] = [
    parsedEvent({
      seq: 2,
      type: "session.started",
      sessionId: "session-a"
    }),
    parsedEvent({
      seq: 3,
      type: "transaction.completed",
      sessionId: "session-a",
      payload: {
        transaction: "CashDeposit",
        account: "Savings",
        balanceAfter: 1_250
      }
    })
  ];

  const replay = replaySession("session-a", events);
  replay.frames[1]!.state.accounts.Savings = 0;

  assert.deepEqual(replay.frames[0]?.state.accounts, {});
  assert.equal(replay.state.accounts.Savings, 1_250);
});

test("journal replay enforces file and line size limits", async () => {
  const root = await mkdtemp(join(tmpdir(), "cashblocks-replay-"));
  const filePath = join(root, "journal.jsonl");
  await writeFile(
    filePath,
    `${event({
      seq: 1,
      type: "runtime.started",
      payload: { message: "x".repeat(100) }
    })}\n`,
    "utf8"
  );

  try {
    await assert.rejects(
      () => inspectJournalFile(filePath, { maxFileBytes: 10 }),
      /exceeds/
    );
    const report = await inspectJournalFile(filePath, { maxLineBytes: 20 });
    assert.equal(report.valid, false);
    assert.equal(report.issues[0]?.code, "LINE_TOO_LARGE");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function event(
  input: Pick<RuntimeEvent, "seq" | "type"> &
    Partial<Omit<RuntimeEvent, "seq" | "type">>
): string {
  return JSON.stringify(parsedEvent(input));
}

function parsedEvent(
  input: Pick<RuntimeEvent, "seq" | "type"> &
    Partial<Omit<RuntimeEvent, "seq" | "type">>
): RuntimeEvent {
  return {
    ts: "2026-07-27T12:34:56.000Z",
    source: "runtime",
    ...input
  };
}
