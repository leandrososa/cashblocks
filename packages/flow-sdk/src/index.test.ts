import assert from "node:assert/strict";
import test from "node:test";

import { defineFlow, runFlow, validateFlowManifest } from "./index.js";

test("defineFlow receives fresh globals for each run", async () => {
  const sessionIds: string[] = [];
  const flow = defineFlow(({ Cashblocks }) => ({
    OnStartOfDay() {
      Cashblocks.SetProperty("Test.Value", sessionIds.length);
    },
    OnIdle() {
      const value = Cashblocks.GetProperty<number>("Test.Value");
      sessionIds.push(String(value));
    }
  }));

  await runFlow(flow);
  await runFlow(flow);

  assert.deepEqual(sessionIds, ["0", "1"]);
});

test("runFlow journals lifecycle failures instead of throwing", async () => {
  const flow = defineFlow(() => ({
    OnIdle() {
      throw new Error("screen renderer exploded");
    }
  }));

  const result = await runFlow(flow);
  const failure = result.runtime.Journal.all().find((event) => event.type === "flow.failed");

  assert.equal(result.ok, false);
  assert.equal(result.error?.phase, "OnIdle");
  assert.equal(failure?.payload?.message, "screen renderer exploded");
});

test("runFlow journals factory failures instead of throwing", async () => {
  const flow = defineFlow(() => {
    throw new Error("bad flow factory");
  });

  const result = await runFlow(flow);

  assert.equal(result.ok, false);
  assert.equal(result.error?.phase, "factory");
  assert.equal(
    result.runtime.Journal.all().some((event) => event.type === "flow.failed"),
    true
  );
});

test("validateFlowManifest rejects unknown capabilities and modules", () => {
  const issues = validateFlowManifest({
    id: "bad.flow",
    version: "0.1.0",
    entrypoint: "src/flow.ts",
    capabilities: ["teleport-cash"],
    modules: ["ImaginaryModule"]
  });

  assert.deepEqual(
    issues.map((issue) => issue.message),
    ["Unknown capability: teleport-cash.", "Unknown module: ImaginaryModule."]
  );
});
