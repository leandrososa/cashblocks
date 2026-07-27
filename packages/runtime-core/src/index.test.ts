import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { DiagnosticLogEntry } from "../../runtime-contracts/src/index.js";

import {
  CashblocksRuntime,
  CompositeDiagnosticLogger,
  ConsoleDiagnosticLogger,
  HandlerRegistry,
  JsonlDiagnosticLogger,
  JsonlJournalPersistence,
  MemoryScratchPad,
  MemoryDiagnosticLogger,
  QueuedCustomerInteraction,
  RuntimeSimulator,
  createDiagnosticLogger,
  createSimulatedAdapters,
  defineSimulatorProfile,
  type SimulatorProfile
} from "./index.js";

test("scratchpad stores, reads, and removes values", () => {
  const scratchPad = new MemoryScratchPad();
  scratchPad.Set("DisplayBalance", true);

  assert.equal(scratchPad.Contains("DisplayBalance"), true);
  assert.equal(scratchPad.Get("DisplayBalance"), true);

  scratchPad.Remove("DisplayBalance");
  assert.equal(scratchPad.Contains("DisplayBalance"), false);
});

test("handler registry stops when a handler returns false", async () => {
  const registry = new HandlerRegistry();
  let secondHandlerRan = false;

  registry.add("OnStart", () => false);
  registry.add("OnStart", () => {
    secondHandlerRan = true;
  });

  assert.equal(await registry.emit("OnStart"), false);
  assert.equal(secondHandlerRan, false);
});

test("runtime creates journal entries for logs", () => {
  const runtime = new CashblocksRuntime({ sessionId: "s1" });
  runtime.Cashblocks.Log("hello");

  assert.equal(runtime.Journal.all().at(-1)?.payload?.message, "hello");
});

test("runtime works without an explicit diagnostic logger", () => {
  const runtime = new CashblocksRuntime({ sessionId: "default-logger" });

  assert.doesNotThrow(() => {
    runtime.logDiagnostic({
      level: "info",
      source: "runtime",
      message: "runtime booted"
    });
  });
});

test("memory diagnostic logger stores technical log entries", () => {
  const logger = new MemoryDiagnosticLogger();
  const runtime = new CashblocksRuntime({ sessionId: "diag", logger });

  runtime.logDiagnostic({
    level: "warn",
    source: "runtime",
    message: "simulated warning",
    metadata: { component: "test" }
  });

  assert.equal(logger.all().length, 1);
  assert.equal(logger.all()[0]?.sessionId, "diag");
  assert.equal(logger.all()[0]?.metadata?.component, "test");
});

test("memory diagnostic logger returns isolated snapshots", () => {
  const logger = new MemoryDiagnosticLogger();
  const runtime = new CashblocksRuntime({ logger });
  runtime.logDiagnostic({
    level: "info",
    source: "runtime",
    message: "original"
  });

  const returned = logger.all();
  if (returned[0]) {
    returned[0].message = "mutated";
  }

  assert.equal(logger.all()[0]?.message, "original");
});

test("configured diagnostic logger filters and isolates sinks", () => {
  const memory = new MemoryDiagnosticLogger();
  const mutatingSink = {
    log(entry: DiagnosticLogEntry) {
      entry.message = "mutated by sink";
      if (entry.correlation) {
        entry.correlation.transactionName = "MutatedTransaction";
      }
    }
  };
  const logger = createDiagnosticLogger({
    minimumLevel: "warn",
    sources: ["adapter"],
    sinks: [
      {
        log() {
          throw new Error("broken sink");
        }
      },
      mutatingSink,
      memory
    ]
  });
  const runtime = new CashblocksRuntime({ sessionId: "observed-session", logger });

  runtime.logDiagnostic({
    level: "info",
    source: "adapter",
    message: "filtered by level"
  });
  runtime.logDiagnostic({
    level: "error",
    source: "flow",
    message: "filtered by source"
  });
  runtime.logDiagnostic({
    level: "error",
    source: "adapter",
    message: "delivered",
    correlation: {
      transactionId: "txn-7",
      transactionName: "CashWithdrawal"
    }
  });

  assert.equal(memory.all().length, 1);
  assert.equal(memory.all()[0]?.message, "delivered");
  assert.deepEqual(memory.all()[0]?.correlation, {
    sessionId: "observed-session",
    transactionId: "txn-7",
    transactionName: "CashWithdrawal"
  });
});

test("composite diagnostic logger isolates asynchronous sink rejection", async () => {
  const memory = new MemoryDiagnosticLogger();
  const logger = new CompositeDiagnosticLogger([
    {
      async log() {
        throw new Error("asynchronous sink failure");
      }
    },
    memory
  ]);
  const runtime = new CashblocksRuntime({ sessionId: "async-sink", logger });

  runtime.logDiagnostic({
    level: "error",
    source: "runtime",
    message: "still delivered"
  });
  await Promise.resolve();

  assert.equal(memory.all()[0]?.message, "still delivered");
});

test("console diagnostic logger includes level and correlation", () => {
  const logger = new ConsoleDiagnosticLogger();
  const originalError = console.error;
  let captured: unknown;
  console.error = (output: unknown) => {
    captured = output;
  };

  try {
    logger.log({
      ts: "2026-07-27T00:00:00.000Z",
      level: "error",
      source: "adapter",
      sessionId: "console-session",
      correlation: {
        sessionId: "console-session",
        transactionName: "CashWithdrawal"
      },
      message: "adapter failed"
    });
  } finally {
    console.error = originalError;
  }

  assert.deepEqual(captured, {
    ts: "2026-07-27T00:00:00.000Z",
    level: "error",
    source: "adapter",
    sessionId: "console-session",
    correlation: {
      sessionId: "console-session",
      transactionName: "CashWithdrawal"
    },
    message: "adapter failed",
    metadata: undefined,
    error: undefined
  });
});

test("jsonl diagnostic logger persists structured correlated entries", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cashblocks-diagnostics-"));
  const path = join(dir, "diagnostics.jsonl");
  const logger = new JsonlDiagnosticLogger(path);
  const runtime = new CashblocksRuntime({ sessionId: "jsonl-session", logger });

  runtime.logDiagnostic({
    level: "warn",
    source: "runtime",
    message: "cash nearing threshold",
    metadata: { terminalCash: 100 }
  });
  await logger.flush();

  const entries = await logger.readAll();
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.sessionId, "jsonl-session");
  assert.equal(entries[0]?.correlation?.sessionId, "jsonl-session");
  assert.equal(entries[0]?.metadata?.terminalCash, 100);
});

test("jsonl diagnostic logger snapshots entries before queued writes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cashblocks-diagnostic-snapshot-"));
  const logger = new JsonlDiagnosticLogger(join(dir, "diagnostics.jsonl"));
  const entry: DiagnosticLogEntry = {
    ts: "2026-07-27T00:00:00.000Z",
    level: "info",
    source: "runtime",
    message: "original",
    metadata: { state: "original" }
  };

  logger.log(entry);
  entry.message = "changed after log";
  entry.metadata = { state: "changed after log" };

  const entries = await logger.readAll();
  assert.equal(entries[0]?.message, "original");
  assert.equal(entries[0]?.metadata?.state, "original");
});

test("jsonl diagnostic logger contains initialization failures until flush", async () => {
  const logger = new JsonlDiagnosticLogger("invalid\u0000directory/diagnostics.jsonl");

  await assert.rejects(() => logger.flush());
});

test("runtime can persist journal entries as jsonl", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cashblocks-journal-"));
  const journalPath = join(dir, "runtime.jsonl");
  const runtime = new CashblocksRuntime({ sessionId: "persisted", journalPath });

  runtime.Cashblocks.Log("persist me");
  await runtime.Journal.flush();

  const content = await readFile(journalPath, "utf8");
  const lines = content.trim().split("\n");
  const persisted = await new JsonlJournalPersistence(journalPath).readAll();

  assert.equal(lines.length, 2);
  assert.equal(persisted.at(-1)?.payload?.message, "persist me");
});

test("queued customer interaction waits for an external answer", async () => {
  const interaction = new QueuedCustomerInteraction();
  const answerPromise = interaction.request({
    kind: "transaction",
    prompt: "Select transaction",
    options: ["BalanceInquiry", "CashWithdrawal"]
  });
  const prompt = interaction.current();

  assert.equal(prompt?.prompt.kind, "transaction");
  assert.equal(prompt?.prompt.options.includes("CashWithdrawal"), true);
  assert.equal(interaction.answer(prompt?.id ?? "", "CashWithdrawal"), true);
  assert.deepEqual(await answerPromise, { value: "CashWithdrawal" });
});

test("simulator profile validates cash management configuration", () => {
  assert.throws(
    () =>
      defineSimulatorProfile({
        ...cashProfile(),
        cashManagement: {
          ...cashProfile().cashManagement,
          initialInventory: { "20": 1, "25": 1 }
        }
      }),
    /inventory denomination 25 is not dispensable/
  );
  assert.throws(
    () =>
      defineSimulatorProfile({
        ...cashProfile(),
        cashManagement: {
          ...cashProfile().cashManagement,
          initialInventory: { "50": 1 }
        }
      }),
    /inventory must include denomination 20/
  );
  assert.throws(
    () =>
      defineSimulatorProfile({
        ...cashProfile(),
        cashManagement: {
          ...cashProfile().cashManagement,
          initialInventory: { "020": 1, "50": 1 }
        }
      }),
    /inventory key 020 must be canonical/
  );
  assert.throws(
    () =>
      defineSimulatorProfile({
        ...cashProfile(),
        cashManagement: {
          ...cashProfile().cashManagement,
          initialInventory: {
            "20": Number.MAX_SAFE_INTEGER + 1,
            "50": 1
          }
        }
      }),
    /must be between 0 and 10000/
  );
  assert.throws(
    () =>
      defineSimulatorProfile({
        ...cashProfile(),
        cashManagement: {
          ...cashProfile().cashManagement,
          acceptDenominations: [10, 20, 50]
        }
      }),
    /recycled accept denominations must also be dispensable/
  );
  assert.throws(
    () =>
      new RuntimeSimulator({
        profile: cashProfile(),
        terminalCash: 1000
    }),
    /cannot combine profile with terminalCash/
  );
  const tooManyDenominations = Array.from({ length: 33 }, (_, index) => index + 1);
  assert.throws(
    () =>
      defineSimulatorProfile({
        ...cashProfile(),
        cashManagement: {
          ...cashProfile().cashManagement,
          dispenseDenominations: tooManyDenominations,
          initialInventory: Object.fromEntries(
            tooManyDenominations.map((denomination) => [String(denomination), 0])
          )
        }
      }),
    /must contain at most 32 values/
  );
});

test("simulator profile dispenses from finite denomination inventory", async () => {
  const simulator = new RuntimeSimulator({ profile: cashProfile() });
  const dispenser = createSimulatedAdapters(simulator).cashDispenser;

  assert.equal(simulator.terminalCash, 120);

  const dispensed = await dispenser.dispense({
    amount: 70,
    currencyCode: "AUD"
  });

  assert.equal(dispensed.ok, true);
  assert.equal(simulator.terminalCash, 50);
  assert.deepEqual(simulator.cashInventorySnapshot(), {
    "20": 0,
    "50": 1
  });

  const unavailable = await dispenser.dispense({
    amount: 20,
    currencyCode: "AUD"
  });

  assert.equal(unavailable.ok, false);
  assert.equal(unavailable.code, "DENOMINATION_UNAVAILABLE");
  assert.equal(simulator.terminalCash, 50);
});

test("simulator profile enforces transaction limits and accepted denominations", async () => {
  const simulator = new RuntimeSimulator({ profile: cashProfile() });
  const adapters = createSimulatedAdapters(simulator);

  const overLimit = await adapters.cashDispenser.dispense({
    amount: 120,
    currencyCode: "AUD"
  });
  const invalidDeposit = await adapters.cashAcceptor.accept({
    expectedAmount: 30,
    currencyCode: "AUD"
  });
  const accepted = await adapters.cashAcceptor.accept({
    expectedAmount: 70,
    currencyCode: "AUD"
  });

  assert.equal(overLimit.code, "DISPENSE_LIMIT_EXCEEDED");
  assert.equal(invalidDeposit.code, "DENOMINATION_UNAVAILABLE");
  assert.equal(accepted.ok, true);
  assert.equal(simulator.terminalCash, 190);
  assert.deepEqual(simulator.cashInventorySnapshot(), {
    "20": 2,
    "50": 3
  });
});

test("simulator profile disables unsupported capabilities", async () => {
  const base = cashProfile();
  const simulator = new RuntimeSimulator({
    profile: {
      ...base,
      capabilities: {
        ...base.capabilities,
        cashDispenser: false,
        cardReader: false,
        hostAuthorization: false
      }
    }
  });
  const adapters = createSimulatedAdapters(simulator);

  assert.equal(
    (await adapters.cashDispenser.dispense({ amount: 20, currencyCode: "AUD" })).code,
    "DISPENSER_UNAVAILABLE"
  );
  assert.equal((await adapters.cardReader.readCard()).code, "CARD_READER_UNAVAILABLE");
  assert.equal(
    (
      await adapters.hostAuthorization.authorize({
        transaction: "CashWithdrawal",
        host: "CoreHost",
        account: "Checking",
        amount: 20,
        currencyCode: "AUD",
        pinless: false,
        chipRequired: true
      })
    ).code,
    "HOST_UNAVAILABLE"
  );
});

test("legacy terminalCash option keeps scalar cash behavior", async () => {
  const simulator = new RuntimeSimulator({ terminalCash: 2000 });
  const adapters = createSimulatedAdapters(simulator);

  const dispensed = await adapters.cashDispenser.dispense({
    amount: 1500,
    currencyCode: "USD"
  });
  const unspecifiedDeposit = await adapters.cashAcceptor.accept({
    currencyCode: "USD"
  });
  const deposited = await adapters.cashAcceptor.accept({
    expectedAmount: 2500,
    currencyCode: "USD"
  });

  assert.equal(dispensed.ok, true);
  assert.equal(unspecifiedDeposit.ok, true);
  assert.equal(deposited.ok, true);
  assert.equal(simulator.terminalCash, 3000);
  assert.deepEqual(simulator.cashInventorySnapshot(), {});
});

test("simulator rejects deposits that exceed safe cash capacity", async () => {
  const simulator = new RuntimeSimulator({
    terminalCash: Number.MAX_SAFE_INTEGER - 5
  });
  const acceptor = createSimulatedAdapters(simulator).cashAcceptor;
  const beforeInventory = simulator.cashInventorySnapshot();

  const result = await acceptor.accept({
    expectedAmount: 10,
    currencyCode: "AUD"
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "CASH_CAPACITY_EXCEEDED");
  assert.equal(simulator.terminalCash, Number.MAX_SAFE_INTEGER - 5);
  assert.deepEqual(simulator.cashInventorySnapshot(), beforeInventory);
});

test("simulator rejects recycled cash above the unit-count limit", async () => {
  const profile = cashProfile();
  const simulator = new RuntimeSimulator({
    profile: {
      ...profile,
      cashManagement: {
        ...profile.cashManagement,
        dispenseDenominations: [1],
        acceptDenominations: [1],
        initialInventory: { "1": 10_000 }
      }
    }
  });
  const acceptor = createSimulatedAdapters(simulator).cashAcceptor;

  const result = await acceptor.accept({
    expectedAmount: 1,
    currencyCode: "AUD"
  });

  assert.equal(result.code, "CASH_CAPACITY_EXCEEDED");
  assert.equal(simulator.terminalCash, 10_000);
  assert.deepEqual(simulator.cashInventorySnapshot(), { "1": 10_000 });
});

test("simulator bounds large unrepresentable cash allocation", () => {
  const profile = cashProfile();
  const simulator = new RuntimeSimulator({
    profile: {
      ...profile,
      cashManagement: {
        ...profile.cashManagement,
        dispenseDenominations: [2],
        acceptDenominations: [2],
        initialInventory: { "2": 10_000 },
        maxDispenseAmount: 10_000,
        maxDepositAmount: 10_000
      }
    }
  });

  assert.equal(simulator.planDispense(9_999), undefined);
  assert.deepEqual(simulator.cashInventorySnapshot(), { "2": 10_000 });
});

function cashProfile(): SimulatorProfile {
  return {
    id: "test.compact-cash",
    currencyCode: "AUD",
    capabilities: {
      receiptPrinter: true,
      cashDispenser: true,
      cashAcceptor: true,
      cardReader: true,
      hostAuthorization: true
    },
    cashManagement: {
      dispenseDenominations: [20, 50],
      acceptDenominations: [20, 50],
      initialInventory: {
        "20": 1,
        "50": 2
      },
      maxDispenseAmount: 100,
      maxDepositAmount: 200,
      recycleDeposits: true
    }
  };
}
