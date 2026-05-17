import { runFlow } from "../../../packages/flow-sdk/src/index.js";
import type { FlowPackage, RuntimeEvent } from "../../../packages/runtime-contracts/src/index.js";
import type { RuntimeSimulatorOptions } from "../../../packages/runtime-core/src/index.js";
import flow from "../../../examples/atm-basic/src/flow.js";
import manifest from "../../../examples/atm-basic/cashblocks.flow.json" with { type: "json" };

export type SimulationRequest = {
  transaction?: string;
  receiptPrinterOut?: boolean;
  hostDeclined?: boolean;
  dispenserOffline?: boolean;
  acceptorOffline?: boolean;
  cardReaderOffline?: boolean;
  receiptWarningAnswer?: "YES" | "NO";
  journalPath?: string;
};

export type SimulationSummary = {
  packageId: string;
  packageVersion: string;
  selectedTransaction?: string;
  completed: boolean;
  failed: boolean;
  failureCode?: string;
  warningOffered: boolean;
  eventCount: number;
};

export type SimulationResult = {
  manifest: FlowPackage;
  summary: SimulationSummary;
  events: RuntimeEvent[];
};

const flowPackage = manifest as FlowPackage;

export function getFlowManifest(): FlowPackage {
  return flowPackage;
}

export async function runSimulation(request: SimulationRequest = {}): Promise<SimulationResult> {
  const simulator: RuntimeSimulatorOptions = {
    customerSelections: [request.transaction ?? "BalanceInquiry"],
    optionSelections: [request.receiptWarningAnswer ?? "YES"],
    receiptPrinter: request.receiptPrinterOut
      ? { health: "DEGRADED", paper: "OUT" }
      : { health: "HEALTHY", paper: "OK" },
    hostApproved: !request.hostDeclined,
    dispenserOnline: !request.dispenserOffline,
    acceptorOnline: !request.acceptorOffline,
    cardReaderOnline: !request.cardReaderOffline
  };

  const result = await runFlow(flow, {
    flowPackage,
    journalPath: request.journalPath,
    simulator
  });
  await result.runtime.Journal.flush();

  const events = result.runtime.Journal.all();
  return {
    manifest: flowPackage,
    summary: summarizeEvents(events),
    events
  };
}

export function summarizeEvents(events: RuntimeEvent[]): SimulationSummary {
  const selected = events.find((event) => event.type === "transaction.selected");
  const failed = events.find((event) => event.type === "transaction.failed");
  const completed = events.find((event) => event.type === "transaction.completed");
  const warning = events.find(
    (event) => event.type === "ui.prompt" && event.payload?.screen === "PrinterDown"
  );

  return {
    packageId: flowPackage.id,
    packageVersion: flowPackage.version,
    selectedTransaction:
      typeof selected?.payload?.transaction === "string"
        ? selected.payload.transaction
        : undefined,
    completed: Boolean(completed),
    failed: Boolean(failed),
    failureCode:
      typeof failed?.payload?.code === "string" ? failed.payload.code : undefined,
    warningOffered: Boolean(warning),
    eventCount: events.length
  };
}
