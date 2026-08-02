import assert from "node:assert/strict";
import test from "node:test";

import type { RuntimeEvent } from "../../runtime-contracts/src/index.js";
import { runAtmCertificationSuite } from "./atm-profile.js";
import {
  classifyRecovery,
  runCertificationSuite,
  type CertificationExecution
} from "./index.js";

test("ATM certification profile produces reproducible passing evidence", async () => {
  const dates = [
    new Date("2026-01-01T00:00:00.000Z"),
    new Date("2026-01-01T00:01:00.000Z")
  ];
  const first = await runAtmCertificationSuite({
    now: () => dates.shift()!
  });
  const secondDates = [
    new Date("2026-02-01T00:00:00.000Z"),
    new Date("2026-02-01T00:01:00.000Z")
  ];
  const second = await runAtmCertificationSuite({
    now: () => secondDates.shift()!
  });

  assert.equal(first.passed, true);
  assert.deepEqual(first.totals, { scenarios: 6, passed: 6, failed: 0 });
  assert.equal(first.reportId, second.reportId);
  assert.equal(first.startedAt, "2026-01-01T00:00:00.000Z");
  assert.equal(second.startedAt, "2026-02-01T00:00:00.000Z");
  assert.equal(
    first.cases.find((entry) => entry.scenarioId === "dispenser.offline-after-approval")
      ?.recovery,
    "reverse_authorization"
  );
  assert.ok(first.cases.every((entry) => entry.evidence.journalValid));
});

test("harness reports conformance failures without hiding valid journal evidence", async () => {
  const report = await runCertificationSuite({
    suiteId: "example.suite",
    profileId: "example.v1",
    scenarios: [
      {
        id: "unexpected.outcome",
        description: "Deliberately mismatched expectations.",
        request: { amount: 100 },
        expected: {
          status: "failed",
          recovery: "operator_review",
          forbiddenEvents: ["transaction.completed"],
          financial: { balanceDelta: -50 }
        }
      }
    ],
    execute: async () => completedExecution()
  });

  assert.equal(report.passed, false);
  assert.deepEqual(report.totals, { scenarios: 1, passed: 0, failed: 1 });
  assert.equal(report.cases[0]?.evidence.journalValid, true);
  assert.equal(
    report.cases[0]?.checks.find((entry) => entry.id === "outcome.status")?.passed,
    false
  );
  assert.equal(
    report.cases[0]?.checks.find(
      (entry) => entry.id === "event.forbidden.transaction.completed"
    )?.passed,
    false
  );
});

test("harness contains executor failures as auditable case results", async () => {
  const report = await runCertificationSuite({
    suiteId: "example.errors",
    profileId: "example.v1",
    scenarios: [
      {
        id: "executor.failure",
        description: "Executor throws before returning evidence.",
        request: null,
        expected: {
          status: "completed",
          recovery: "none"
        }
      }
    ],
    execute: async () => {
      throw new Error("transport unavailable");
    }
  });

  assert.equal(report.passed, false);
  assert.equal(report.cases[0]?.outcome, "execution_error");
  assert.equal(report.cases[0]?.recovery, "operator_review");
  assert.deepEqual(report.cases[0]?.evidence.journalIssueCodes, [
    "EXECUTION_ERROR"
  ]);

  const otherRequest = await runCertificationSuite({
    suiteId: "example.errors",
    profileId: "example.v1",
    scenarios: [
      {
        id: "executor.failure",
        description: "Same failure with a different request.",
        request: { amount: 200 },
        expected: {
          status: "completed",
          recovery: "none"
        }
      }
    ],
    execute: async () => {
      throw new Error("transport unavailable");
    }
  });
  assert.notEqual(
    report.cases[0]?.evidence.digest,
    otherRequest.cases[0]?.evidence.digest
  );
  assert.notEqual(report.reportId, otherRequest.reportId);

  const largeError = await runCertificationSuite({
    suiteId: "example.large-error",
    profileId: "example.v1",
    scenarios: [scenario("executor.large-error")],
    execute: async () => {
      throw new Error("x".repeat(70_000));
    }
  });
  assert.equal(largeError.cases[0]?.outcome, "execution_error");
  assert.match(
    largeError.cases[0]?.checks[0]?.message ?? "",
    /exceeded 4096 bytes \(sha256:[a-f0-9]{64}\)/
  );
});

test("recovery classification prioritizes uncertain effects and approvals", () => {
  const base = completedExecution();
  assert.equal(classifyRecovery(base), "none");
  assert.equal(
    classifyRecovery({
      summary: { status: "failed", failureCode: "HOST_DECLINED" },
      events: [
        event(1, "transaction.failed", {
          transaction: "CashWithdrawal",
          code: "HOST_DECLINED"
        })
      ]
    }),
    "none"
  );
  assert.equal(
    classifyRecovery({
      summary: { status: "failed", failureCode: "CARD_READER_OFFLINE" },
      events: [
        event(1, "transaction.failed", {
          transaction: "CustomerIdentification",
          code: "CARD_READER_OFFLINE"
        })
      ]
    }),
    "safe_retry"
  );
  assert.equal(
    classifyRecovery({
      summary: { status: "failed", failureCode: "HOST_UNAVAILABLE" },
      events: [
        event(1, "host.authorization_requested", {
          transaction: "CashWithdrawal"
        })
      ]
    }),
    "manual_reconciliation"
  );
  assert.equal(
    classifyRecovery({
      summary: { status: "failed", failureCode: "DISPENSER_OFFLINE" },
      events: [
        event(1, "host.authorization_requested", {
          transaction: "TransactionA"
        }),
        event(2, "host.authorization_result", {
          transaction: "TransactionB",
          ok: true
        }),
        event(3, "transaction.failed", {
          transaction: "TransactionA",
          code: "DISPENSER_OFFLINE"
        })
      ]
    }),
    "manual_reconciliation"
  );
  assert.equal(
    classifyRecovery({
      summary: { status: "failed", failureCode: "DISPENSER_OFFLINE" },
      events: [
        event(1, "host.authorization_requested", {
          transaction: "CashWithdrawal"
        }),
        event(2, "host.authorization_result", {
          transaction: "CashWithdrawal",
          ok: true
        }),
        event(3, "transaction.failed", {
          transaction: "CashWithdrawal",
          code: "DISPENSER_OFFLINE"
        })
      ]
    }),
    "reverse_authorization"
  );
  assert.equal(
    classifyRecovery({
      summary: { status: "failed", failureCode: "ADAPTER_OUTCOME_UNKNOWN" },
      events: [
        event(1, "transaction.reconciliation_required", {
          transaction: "CashWithdrawal"
        })
      ]
    }),
    "manual_reconciliation"
  );
});

test("recovery ignores summary claims and approvals from prior occurrences", async () => {
  const events = [
    event(1, "transaction.started", {
      transaction: "CashWithdrawal"
    }),
    event(2, "host.authorization_requested", {
      transaction: "CashWithdrawal"
    }),
    event(3, "host.authorization_result", {
      transaction: "CashWithdrawal",
      ok: true,
      code: "HOST_APPROVED"
    }),
    event(4, "transaction.completed", {
      transaction: "CashWithdrawal"
    }),
    event(5, "transaction.started", {
      transaction: "CashWithdrawal"
    }),
    event(6, "transaction.failed", {
      transaction: "CashWithdrawal",
      code: "CARD_READER_OFFLINE"
    })
  ];
  const execution = {
    summary: {
      status: "failed" as const,
      failureCode: "HOST_DECLINED"
    },
    events
  };

  assert.equal(classifyRecovery(execution), "safe_retry");

  const anchoredEvents = [
    event(1, "runtime.started", undefined, "", "runtime"),
    event(2, "flow.loaded", { entrypoint: "flow.ts" }),
    event(3, "session.started"),
    ...events.map((entry, index) => ({
      ...entry,
      seq: index + 4,
      ts: new Date(Date.UTC(2026, 0, 1, 0, 0, index + 4)).toISOString()
    }))
  ];
  const report = await runCertificationSuite({
    suiteId: "example.recovery",
    profileId: "example.v1",
    scenarios: [
      {
        id: "summary.tampered",
        description: "Recovery follows the latest journal occurrence.",
        request: null,
        expected: {
          status: "failed",
          recovery: "safe_retry"
        }
      }
    ],
    execute: async () => ({ ...execution, events: anchoredEvents })
  });

  assert.equal(report.passed, false);
  assert.equal(
    report.cases[0]?.checks.find(
      (entry) => entry.id === "outcome.failure_summary_matches_journal"
    )?.passed,
    false
  );

  const unknownFailureEvents = [
    event(1, "runtime.started", undefined, "", "runtime"),
    event(2, "flow.loaded", { entrypoint: "flow.ts" }),
    event(3, "session.started"),
    event(4, "transaction.started", { transaction: "CashWithdrawal" }),
    event(5, "transaction.failed", {
      transaction: "CashWithdrawal",
      code: "HOST_DECLINED"
    }),
    event(6, "transaction.started", { transaction: "CashWithdrawal" }),
    event(7, "transaction.failed", { transaction: "CashWithdrawal" })
  ];
  const unknownReport = await runCertificationSuite({
    suiteId: "example.unknown-failure",
    profileId: "example.v1",
    scenarios: [
      {
        id: "failure.without-code",
        description: "A current unknown failure cannot inherit an old code.",
        request: null,
        expected: {
          status: "failed",
          recovery: "none"
        }
      }
    ],
    execute: async () => ({
      summary: { status: "failed", failureCode: "HOST_DECLINED" },
      events: unknownFailureEvents
    })
  });

  assert.equal(unknownReport.cases[0]?.evidence.journalValid, true);
  assert.equal(unknownReport.cases[0]?.recovery, "operator_review");
  assert.equal(unknownReport.passed, false);
  assert.deepEqual(
    unknownReport.cases[0]?.checks.find(
      (entry) => entry.id === "outcome.failure_summary_matches_journal"
    ),
    {
      id: "outcome.failure_summary_matches_journal",
      passed: false,
      expected: null,
      actual: "HOST_DECLINED",
      message: "Summary and journal agree on the failure code."
    }
  );

  const consecutiveFlowFailures = [
    event(1, "runtime.started", undefined, "", "runtime"),
    event(2, "flow.loaded", { entrypoint: "flow.ts" }),
    event(3, "session.started"),
    event(4, "flow.failed", { code: "HOST_DECLINED" }, "cert-session", "flow"),
    event(5, "flow.failed", { message: "latest failure" }, "cert-session", "flow")
  ];
  const flowFailureReport = await runCertificationSuite({
    suiteId: "example.flow-failure",
    profileId: "example.v1",
    scenarios: [
      {
        id: "flow.without-code",
        description: "A flow failure cannot inherit an older flow code.",
        request: null,
        expected: { status: "failed", recovery: "none" }
      }
    ],
    execute: async () => ({
      summary: { status: "failed", failureCode: "HOST_DECLINED" },
      events: consecutiveFlowFailures
    })
  });
  assert.equal(flowFailureReport.cases[0]?.evidence.journalValid, true);
  assert.equal(flowFailureReport.cases[0]?.recovery, "operator_review");
  assert.equal(flowFailureReport.passed, false);

  const completedThenFlowFailed = [
    event(1, "runtime.started", undefined, "", "runtime"),
    event(2, "flow.loaded", { entrypoint: "flow.ts" }),
    event(3, "session.started"),
    event(4, "transaction.started", { transaction: "CashWithdrawal" }),
    event(5, "host.authorization_requested", {
      transaction: "CashWithdrawal"
    }),
    event(6, "host.authorization_result", {
      transaction: "CashWithdrawal",
      ok: true
    }),
    event(7, "transaction.completed", { transaction: "CashWithdrawal" }),
    event(8, "flow.failed", { message: "post-completion" }, "cert-session", "flow")
  ];
  const postCompletionReport = await runCertificationSuite({
    suiteId: "example.post-completion",
    profileId: "example.v1",
    scenarios: [
      {
        id: "completed.then-flow-failed",
        description: "A later flow failure does not reverse completed work.",
        request: null,
        expected: { status: "failed", recovery: "operator_review" }
      }
    ],
    execute: async () => ({
      summary: { status: "failed" },
      events: completedThenFlowFailed
    })
  });
  assert.equal(postCompletionReport.cases[0]?.evidence.journalValid, true);
  assert.equal(postCompletionReport.cases[0]?.recovery, "operator_review");
  assert.equal(postCompletionReport.passed, true);
});

test("financial conformance derives from and agrees with journal evidence", async () => {
  const execution = completedExecution();
  execution.events = execution.events.map((entry) =>
    entry.type === "transaction.completed"
      ? {
          ...entry,
          payload: {
            ...entry.payload,
            balanceAfter: 99
          }
        }
      : entry
  );
  const report = await runCertificationSuite({
    suiteId: "example.financial",
    profileId: "example.v1",
    scenarios: [
      {
        id: "tampered.summary",
        description: "Summary disagrees with journal evidence.",
        request: null,
        expected: {
          status: "completed",
          recovery: "none",
          financial: { balanceDelta: -50 }
        }
      }
    ],
    execute: async () => execution
  });

  assert.equal(report.cases[0]?.evidence.journalValid, true);
  assert.equal(report.passed, false);
  assert.equal(
    report.cases[0]?.checks.find(
      (entry) => entry.id === "financial.balance_delta"
    )?.actual,
    -1
  );
  assert.equal(
    report.cases[0]?.checks.find(
      (entry) => entry.id === "financial.balance_summary_matches_journal"
    )?.passed,
    false
  );
});

test("suite bounds serialized bytes and rejects non-JSON evidence", async () => {
  const oversized = await runCertificationSuite({
    suiteId: "example.bytes",
    profileId: "example.v1",
    scenarios: [scenario("bounded.bytes")],
    maxJournalBytes: 100,
    execute: async () => completedExecution()
  });
  assert.equal(oversized.cases[0]?.outcome, "execution_error");
  assert.match(oversized.cases[0]?.checks[0]?.message ?? "", /byte limit/);

  await assert.rejects(
    runCertificationSuite({
      suiteId: "example.json",
      profileId: "example.v1",
      scenarios: [
        {
          ...scenario("invalid.date"),
          request: { when: new Date("2026-01-01T00:00:00.000Z") }
        }
      ],
      execute: async () => completedExecution()
    }),
    /plain JSON objects/
  );

  const hidden = Object.create(null) as Record<string, unknown>;
  Object.defineProperty(hidden, "secret", {
    enumerable: false,
    value: undefined
  });
  await assert.rejects(
    runCertificationSuite({
      suiteId: "example.hidden",
      profileId: "example.v1",
      scenarios: [
        {
          ...scenario("invalid.hidden"),
          request: hidden
        }
      ],
      execute: async () => completedExecution()
    }),
    /non-enumerable/
  );
});

test("suite rejects duplicate ids and bounded execution overflow", async () => {
  await assert.rejects(
    runCertificationSuite({
      suiteId: "example.duplicates",
      profileId: "example.v1",
      scenarios: [
        scenario("same.id"),
        scenario("same.id")
      ],
      execute: async () => completedExecution()
    }),
    /Duplicate scenario id/
  );

  const report = await runCertificationSuite({
    suiteId: "example.bounds",
    profileId: "example.v1",
    scenarios: [scenario("bounded.events")],
    maxEventsPerScenario: 2,
    execute: async () => completedExecution()
  });
  assert.equal(report.cases[0]?.outcome, "execution_error");
  assert.match(
    String(report.cases[0]?.checks[0]?.message),
    /2-event scenario limit/
  );
});

function scenario(id: string) {
  return {
    id,
    description: "A bounded example scenario.",
    request: null,
    expected: {
      status: "completed" as const,
      recovery: "none" as const
    }
  };
}

function completedExecution(): CertificationExecution {
  return {
    summary: {
      status: "completed",
      balanceBefore: 100,
      balanceAfter: 50,
      terminalCashBefore: 500,
      terminalCashAfter: 450
    },
    events: [
      event(1, "runtime.started", undefined, "", "runtime"),
      event(2, "flow.loaded", { entrypoint: "flow.ts" }),
      event(3, "session.started"),
      event(4, "transaction.selected", { transaction: "CashWithdrawal" }),
      event(5, "transaction.started", { transaction: "CashWithdrawal" }),
      event(6, "transaction.completed", {
        transaction: "CashWithdrawal",
        balanceBefore: 100,
        balanceAfter: 50,
        terminalCashBefore: 500,
        terminalCashAfter: 450
      })
    ]
  };
}

function event(
  seq: number,
  type: RuntimeEvent["type"],
  payload?: RuntimeEvent["payload"],
  sessionId: string | undefined = "cert-session",
  source: RuntimeEvent["source"] = "module"
): RuntimeEvent {
  return {
    seq,
    type,
    ts: new Date(Date.UTC(2026, 0, 1, 0, 0, seq)).toISOString(),
    source,
    ...(sessionId ? { sessionId } : {}),
    ...(payload ? { payload } : {})
  };
}
