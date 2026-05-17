import { runFlow } from "../../../packages/flow-sdk/src/index.js";
import type { FlowPackage, RuntimeEvent } from "../../../packages/runtime-contracts/src/index.js";
import { JsonlJournalPersistence, type RuntimeSimulatorOptions } from "../../../packages/runtime-core/src/index.js";
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
  status: "completed" | "failed" | "cancelled" | "idle";
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

export type JournalSession = {
  sessionId: string;
  summary: SimulationSummary;
  events: RuntimeEvent[];
};

export type JournalHistory = {
  configured: boolean;
  journalPath?: string;
  sessions: JournalSession[];
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
    summary: summarizeEvents(events, result.ok),
    events
  };
}

export function summarizeEvents(events: RuntimeEvent[], flowOk = true): SimulationSummary {
  const selected = events.find((event) => event.type === "transaction.selected");
  const failed = events.find((event) => event.type === "transaction.failed");
  const completed = events.find((event) => event.type === "transaction.completed");
  const warning = events.find(
    (event) => event.type === "ui.prompt" && event.payload?.screen === "PrinterDown"
  );
  const failedState = !flowOk || Boolean(failed);
  const completedState = Boolean(completed);
  const cancelledState = Boolean(warning) && !selected && !failedState && !completedState;

  return {
    packageId: flowPackage.id,
    packageVersion: flowPackage.version,
    selectedTransaction:
      typeof selected?.payload?.transaction === "string"
        ? selected.payload.transaction
        : undefined,
    status: failedState
      ? "failed"
      : completedState
        ? "completed"
        : cancelledState
          ? "cancelled"
          : "idle",
    completed: completedState,
    failed: failedState,
    failureCode:
      typeof failed?.payload?.code === "string"
        ? failed.payload.code
        : !flowOk
          ? "FLOW_FAILED"
          : undefined,
    warningOffered: Boolean(warning),
    eventCount: events.length
  };
}

export async function readJournalHistory(journalPath?: string): Promise<JournalHistory> {
  if (!journalPath) {
    return {
      configured: false,
      sessions: []
    };
  }

  const events = await new JsonlJournalPersistence(journalPath).readAll();
  const grouped = new Map<string, RuntimeEvent[]>();

  for (const event of events) {
    if (!event.sessionId) {
      continue;
    }
    const sessionId = event.sessionId;
    grouped.set(sessionId, [...(grouped.get(sessionId) ?? []), event]);
  }

  const sessions = [...grouped.entries()]
    .map(([sessionId, sessionEvents]) => ({
      sessionId,
      summary: summarizeEvents(sessionEvents, !sessionEvents.some((event) => event.type === "flow.failed")),
      events: sessionEvents
    }))
    .sort((left, right) => {
      const leftTs = left.events.at(-1)?.ts ?? "";
      const rightTs = right.events.at(-1)?.ts ?? "";
      return rightTs.localeCompare(leftTs);
    });

  return {
    configured: true,
    journalPath,
    sessions
  };
}
