import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { CashblocksRuntime, HandlerRegistry, JsonlJournalPersistence, MemoryScratchPad } from "./index.js";

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
