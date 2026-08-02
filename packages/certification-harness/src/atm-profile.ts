import {
  runSimulation,
  type SimulationRequest
} from "../../../apps/terminal-shell/src/simulation.js";

import {
  runCertificationSuite,
  type CertificationReport,
  type CertificationScenario
} from "./index.js";

export const atmCertificationScenarios: readonly CertificationScenario<SimulationRequest>[] =
  [
    {
      id: "withdrawal.success",
      description: "Approved withdrawal conserves the account and terminal cash ledgers.",
      request: {
        transaction: "CashWithdrawal",
        account: "Savings",
        amount: 200
      },
      expected: {
        status: "completed",
        recovery: "none",
        requiredEvents: [
          "host.authorization_requested",
          "host.authorization_result",
          "transaction.completed"
        ],
        financial: {
          balanceDelta: -200,
          terminalCashDelta: -200
        }
      }
    },
    {
      id: "deposit.success",
      description: "Accepted deposit credits the account and terminal cash ledgers.",
      request: {
        transaction: "CashDeposit",
        account: "Checking",
        amount: 500
      },
      expected: {
        status: "completed",
        recovery: "none",
        requiredEvents: ["transaction.completed"],
        financial: {
          balanceDelta: 500,
          terminalCashDelta: 500
        }
      }
    },
    {
      id: "host.declined",
      description: "A definitive host decline fails without a retry or completion.",
      request: {
        transaction: "CashWithdrawal",
        hostDeclined: true
      },
      expected: {
        status: "failed",
        failureCode: "HOST_DECLINED",
        recovery: "none",
        requiredEvents: ["host.authorization_result", "transaction.failed"],
        forbiddenEvents: ["transaction.completed"]
      }
    },
    {
      id: "card-reader.offline",
      description: "A pre-authorization card reader failure is safe to retry.",
      request: {
        transaction: "CashWithdrawal",
        cardReaderOffline: true
      },
      expected: {
        status: "failed",
        failureCode: "CARD_READER_OFFLINE",
        recovery: "safe_retry",
        requiredEvents: ["transaction.failed"],
        forbiddenEvents: [
          "host.authorization_requested",
          "transaction.completed"
        ]
      }
    },
    {
      id: "dispenser.offline-after-approval",
      description: "A post-authorization dispenser failure requires a reversal.",
      request: {
        transaction: "CashWithdrawal",
        dispenserOffline: true
      },
      expected: {
        status: "failed",
        failureCode: "DISPENSER_OFFLINE",
        recovery: "reverse_authorization",
        requiredEvents: ["host.authorization_result", "transaction.failed"],
        forbiddenEvents: ["transaction.completed"]
      }
    },
    {
      id: "withdrawal.cancelled",
      description: "Customer cancellation before authorization has no financial side effects.",
      request: {
        transaction: "CashWithdrawal",
        transactionOptionAnswers: ["CANCEL"]
      },
      expected: {
        status: "cancelled",
        recovery: "none",
        requiredEvents: ["transaction.cancelled"],
        forbiddenEvents: [
          "host.authorization_requested",
          "transaction.completed"
        ]
      }
    }
  ];

export function runAtmCertificationSuite(options: {
  now?: () => Date;
} = {}): Promise<CertificationReport> {
  return runCertificationSuite({
    suiteId: "cashblocks.atm",
    profileId: "simulator.v1",
    scenarios: atmCertificationScenarios,
    execute: runSimulation,
    now: options.now
  });
}
