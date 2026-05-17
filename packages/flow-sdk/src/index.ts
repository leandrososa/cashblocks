import type { FlowPackage, RuntimeApi, ValidationIssue } from "../../runtime-contracts/src/index.js";
import { validateFlowPackage } from "../../runtime-contracts/src/index.js";
import { CashblocksRuntime, RuntimeSimulator, type RuntimeSimulatorOptions } from "../../runtime-core/src/index.js";
import { createAtmModules, type AtmModules } from "../../atm-modules/src/index.js";

export type FlowGlobals = AtmModules & {
  Cashblocks: RuntimeApi;
};

export type FlowModule = Partial<{
  OnStartOfDay(): void | Promise<void>;
  OnIdle(): void | Promise<void>;
}> & {
  readonly __cashblocksFlowFactory?: FlowFactory;
};

export type FlowFactory = (globals: FlowGlobals) => FlowModule;

export type FlowRunOptions = {
  simulator?: RuntimeSimulatorOptions;
  journalPath?: string;
  flowPackage?: FlowPackage;
  configure?(globals: FlowGlobals): void;
};

export type FlowRunResult = {
  runtime: CashblocksRuntime;
  globals: FlowGlobals;
};

export function defineFlow(factory: FlowFactory): FlowModule {
  return {
    __cashblocksFlowFactory: factory
  };
}

export function validateFlowManifest(flowPackage: FlowPackage): ValidationIssue[] {
  return validateFlowPackage(flowPackage);
}

export async function runFlow(flow: FlowModule, options: FlowRunOptions = {}): Promise<FlowRunResult> {
  const runtime = new CashblocksRuntime({
    simulator: new RuntimeSimulator(options.simulator),
    journalPath: options.journalPath
  });
  const modules = createAtmModules(runtime);
  const globals: FlowGlobals = {
    Cashblocks: runtime.Cashblocks,
    ...modules
  };

  options.configure?.(globals);
  const lifecycle = flow.__cashblocksFlowFactory ? flow.__cashblocksFlowFactory(globals) : flow;
  const manifestIssues = options.flowPackage ? validateFlowManifest(options.flowPackage) : [];

  if (manifestIssues.length > 0) {
    throw new Error(
      `Invalid flow package: ${manifestIssues
        .map((issue) => `${issue.field}: ${issue.message}`)
        .join("; ")}`
    );
  }

  runtime.Journal.append({
    type: "flow.loaded",
    source: "runtime",
    sessionId: runtime.SessionId,
    payload: options.flowPackage
      ? {
          id: options.flowPackage.id,
          version: options.flowPackage.version,
          entrypoint: options.flowPackage.entrypoint
        }
      : { entrypoint: "module" }
  });

  await lifecycle.OnStartOfDay?.();
  await lifecycle.OnIdle?.();

  return { runtime, globals };
}
