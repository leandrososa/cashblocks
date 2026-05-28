import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  CashblocksRuntime,
  HandlerRegistry,
  JsonlJournalPersistence,
  MemoryScratchPad,
  MemoryDiagnosticLogger,
  QueuedCustomerInteraction
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
