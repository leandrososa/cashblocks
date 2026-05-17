import assert from "node:assert/strict";
import test from "node:test";

import { defineFlow, runFlow } from "./index.js";

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
