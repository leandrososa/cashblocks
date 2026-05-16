import type { RuntimeApi } from "../../runtime-contracts/src/index.js";
import { CashblocksRuntime, RuntimeSimulator, type RuntimeSimulatorOptions } from "../../runtime-core/src/index.js";
import { createAtmModules, type AtmModules } from "../../atm-modules/src/index.js";

export type FlowGlobals = AtmModules & {
  K3A: RuntimeApi;
};

export type FlowModule = Partial<{
  OnStartOfDay(): void | Promise<void>;
  OnIdle(): void | Promise<void>;
}>;

export type FlowRunOptions = {
  simulator?: RuntimeSimulatorOptions;
  configure?(globals: FlowGlobals): void;
};

export type FlowRunResult = {
  runtime: CashblocksRuntime;
  globals: FlowGlobals;
};

export async function runFlow(flow: FlowModule, options: FlowRunOptions = {}): Promise<FlowRunResult> {
  const runtime = new CashblocksRuntime({
    simulator: new RuntimeSimulator(options.simulator)
  });
  const modules = createAtmModules(runtime);
  const globals: FlowGlobals = {
    K3A: runtime.K3A,
    ...modules
  };

  options.configure?.(globals);

  runtime.Journal.append({
    type: "flow.loaded",
    source: "runtime",
    sessionId: runtime.SessionId,
    payload: { entrypoint: "module" }
  });

  await flow.OnStartOfDay?.();
  await flow.OnIdle?.();

  return { runtime, globals };
}
