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
  screenTitle: string;
  screenMessage: string;
  operatorMessage: string;
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
  const selectedTransaction =
    typeof selected?.payload?.transaction === "string"
      ? selected.payload.transaction
      : undefined;
  const failureCode =
    typeof failed?.payload?.code === "string"
      ? failed.payload.code
      : !flowOk
        ? "FLOW_FAILED"
        : undefined;
  const status = failedState
    ? "failed"
    : completedState
      ? "completed"
      : cancelledState
        ? "cancelled"
        : "idle";
  const terminalScreen = createTerminalScreen({
    status,
    selectedTransaction,
    failureCode,
    warningOffered: Boolean(warning)
  });

  return {
    packageId: flowPackage.id,
    packageVersion: flowPackage.version,
    selectedTransaction,
    status,
    screenTitle: terminalScreen.title,
    screenMessage: terminalScreen.message,
    operatorMessage: terminalScreen.operatorMessage,
    completed: completedState,
    failed: failedState,
    failureCode,
    warningOffered: Boolean(warning),
    eventCount: events.length
  };
}

function createTerminalScreen(input: {
  status: SimulationSummary["status"];
  selectedTransaction?: string;
  failureCode?: string;
  warningOffered: boolean;
}): { title: string; message: string; operatorMessage: string } {
  if (input.status === "completed") {
    return {
      title: `${formatTransaction(input.selectedTransaction)} complete`,
      message: "Thank you. Your transaction has finished successfully.",
      operatorMessage: "Flow completed without simulated device or host faults."
    };
  }

  if (input.status === "cancelled") {
    return {
      title: "Transaction cancelled",
      message: input.warningOffered
        ? "Receipt printing is unavailable. The customer chose not to continue."
        : "The customer cancelled before a transaction was selected.",
      operatorMessage: "No transaction was selected after the warning path."
    };
  }

  if (input.status === "failed") {
    return failureScreen(input.failureCode);
  }

  return {
    title: "Waiting for customer",
    message: "Select a transaction to begin.",
    operatorMessage: "Runtime is idle."
  };
}

function failureScreen(code?: string): { title: string; message: string; operatorMessage: string } {
  if (code === "HOST_DECLINED") {
    return {
      title: "Transaction declined",
      message: "The authorization host declined this transaction.",
      operatorMessage: "Host authorization returned HOST_DECLINED."
    };
  }

  if (code === "DISPENSER_OFFLINE") {
    return {
      title: "Cash unavailable",
      message: "This terminal cannot dispense cash right now.",
      operatorMessage: "Cash dispenser adapter reported DISPENSER_OFFLINE."
    };
  }

  if (code === "ACCEPTOR_OFFLINE") {
    return {
      title: "Deposit unavailable",
      message: "This terminal cannot accept cash right now.",
      operatorMessage: "Cash acceptor adapter reported ACCEPTOR_OFFLINE."
    };
  }

  if (code === "CARD_READER_OFFLINE") {
    return {
      title: "Card reader unavailable",
      message: "This terminal cannot read cards right now.",
      operatorMessage: "Card reader adapter reported CARD_READER_OFFLINE."
    };
  }

  return {
    title: "Transaction failed",
    message: "The transaction could not be completed.",
    operatorMessage: code ? `Failure code: ${code}.` : "Runtime reported an unknown failure."
  };
}

function formatTransaction(transaction?: string): string {
  if (!transaction) {
    return "Transaction";
  }

  return transaction.replace(/([a-z])([A-Z])/g, "$1 $2");
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
