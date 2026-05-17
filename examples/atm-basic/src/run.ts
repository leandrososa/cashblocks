import { runFlow } from "../../../packages/flow-sdk/src/index.js";
import type { FlowPackage } from "../../../packages/runtime-contracts/src/index.js";
import flow from "./flow.js";
import manifest from "../cashblocks.flow.json" with { type: "json" };

const result = await runFlow(flow, {
  flowPackage: manifest as FlowPackage,
  journalPath: process.env.CASHBLOCKS_JOURNAL_PATH,
  simulator: {
    customerSelections: [process.argv[2] ?? "BalanceInquiry"],
    optionSelections: ["YES"]
  }
});

await result.runtime.Journal.flush();
console.log(JSON.stringify(result.runtime.Journal.all(), null, 2));
