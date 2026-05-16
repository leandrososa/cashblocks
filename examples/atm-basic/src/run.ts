import { runFlow } from "../../../packages/flow-sdk/src/index.js";
import * as flow from "./flow.js";

const result = await runFlow(flow, {
  simulator: {
    customerSelections: [process.argv[2] ?? "BalanceInquiry"],
    optionSelections: ["YES"]
  },
  configure(globals) {
    flow.bindFlow(globals);
  }
});

console.log(JSON.stringify(result.runtime.Journal.all(), null, 2));
