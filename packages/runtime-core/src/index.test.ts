import assert from "node:assert/strict";
import test from "node:test";

import { CashblocksRuntime, HandlerRegistry, MemoryScratchPad } from "./index.js";

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
  runtime.K3A.Log("hello");

  assert.equal(runtime.Journal.all().at(-1)?.payload?.message, "hello");
});
