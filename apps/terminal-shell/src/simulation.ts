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
  terminalSteps: TerminalStep[];
  completed: boolean;
  failed: boolean;
  failureCode?: string;
  warningOffered: boolean;
  eventCount: number;
};

export type TerminalStep = {
  label: string;
  state: "done" | "active" | "failed" | "skipped";
  detail: string;
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
    warningOffered: Boolean(warning),
    events
  });

  return {
    packageId: flowPackage.id,
    packageVersion: flowPackage.version,
    selectedTransaction,
    status,
    screenTitle: terminalScreen.title,
    screenMessage: terminalScreen.message,
    operatorMessage: terminalScreen.operatorMessage,
    terminalSteps: terminalScreen.steps,
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
  events: RuntimeEvent[];
}): { title: string; message: string; operatorMessage: string; steps: TerminalStep[] } {
  const steps = createTerminalSteps(input);

  if (input.status === "completed") {
    return {
      title: `${formatTransaction(input.selectedTransaction)} complete`,
      message: "Thank you. Your transaction has finished successfully.",
      operatorMessage: "Flow completed without simulated device or host faults.",
      steps
    };
  }

  if (input.status === "cancelled") {
    return {
      title: "Transaction cancelled",
      message: input.warningOffered
        ? "Receipt printing is unavailable. The customer chose not to continue."
        : "The customer cancelled before a transaction was selected.",
      operatorMessage: "No transaction was selected after the warning path.",
      steps
    };
  }

  if (input.status === "failed") {
    return failureScreen(input.failureCode, steps);
  }

  return {
    title: "Waiting for customer",
    message: "Select a transaction to begin.",
    operatorMessage: "Runtime is idle.",
    steps
  };
}

function createTerminalSteps(input: {
  status: SimulationSummary["status"];
  selectedTransaction?: string;
  failureCode?: string;
  warningOffered: boolean;
  events: RuntimeEvent[];
}): TerminalStep[] {
  const hasPinPrompt = input.events.some(
    (event) => event.type === "ui.prompt" && event.payload?.prompt === "PIN"
  );
  const hasHostRequest = input.events.some((event) => event.type === "host.authorization_requested");
  const hasHostResult = input.events.some((event) => event.type === "host.authorization_result");
  const hasTransaction = Boolean(input.selectedTransaction);

  return [
    {
      label: "Insert or tap card",
      state: input.failureCode === "CARD_READER_OFFLINE" ? "failed" : hasPinPrompt ? "done" : "active",
      detail:
        input.failureCode === "CARD_READER_OFFLINE"
          ? "Card reader unavailable."
          : hasPinPrompt
            ? "Card accepted by the terminal."
            : "Waiting for customer credential."
    },
    {
      label: "Enter PIN",
      state: hasPinPrompt ? "done" : input.failureCode === "CARD_READER_OFFLINE" ? "skipped" : "active",
      detail: hasPinPrompt ? "PIN prompt displayed." : "PIN entry not reached."
    },
    {
      label: "Select transaction",
      state: hasTransaction ? "done" : input.status === "cancelled" ? "skipped" : "active",
      detail: hasTransaction
        ? `${formatTransaction(input.selectedTransaction)} selected.`
        : input.status === "cancelled"
          ? "Customer stopped before transaction selection."
          : "Waiting for selection."
    },
    {
      label: "Receipt availability",
      state: input.warningOffered
        ? input.status === "cancelled"
          ? "failed"
          : "done"
        : "done",
      detail: input.warningOffered
        ? input.status === "cancelled"
          ? "Printer unavailable; customer declined to continue."
          : "Printer unavailable; customer accepted warning."
        : "Receipt path healthy or warning not required."
    },
    {
      label: "Authorize and operate devices",
      state: input.status === "failed"
        ? "failed"
        : hasHostRequest || hasHostResult
          ? "done"
          : hasTransaction
            ? "done"
            : "skipped",
      detail: operationDetail(input)
    },
    {
      label: "Finish session",
      state: input.status === "completed"
        ? "done"
        : input.status === "failed"
          ? "failed"
          : input.status === "cancelled"
            ? "skipped"
            : "active",
      detail:
        input.status === "completed"
          ? "Terminal can return to idle."
          : input.status === "failed"
            ? "Operator attention may be required."
            : input.status === "cancelled"
              ? "Session ended without a transaction."
              : "Session still in progress."
    }
  ];
}

function operationDetail(input: {
  status: SimulationSummary["status"];
  selectedTransaction?: string;
  failureCode?: string;
}): string {
  if (input.failureCode === "HOST_DECLINED") return "Host declined authorization.";
  if (input.failureCode === "DISPENSER_OFFLINE") return "Cash dispenser could not operate.";
  if (input.failureCode === "ACCEPTOR_OFFLINE") return "Cash acceptor could not operate.";
  if (input.failureCode === "CARD_READER_OFFLINE") return "Operation skipped after card reader failure.";

  if (input.selectedTransaction === "BalanceInquiry") return "Balance lookup completed in simulator.";
  if (input.selectedTransaction === "CashWithdrawal") return "Authorization approved and cash dispensed.";
  if (input.selectedTransaction === "CashDeposit") return "Cash accepted by simulator.";
  if (input.selectedTransaction === "FastCash") return "Fast cash authorization and dispense completed.";
  if (input.selectedTransaction?.startsWith("Admin")) return "Administrative operation completed.";

  return input.status === "cancelled" ? "No device operation performed." : "No device action required.";
}

function failureScreen(
  code: string | undefined,
  steps: TerminalStep[]
): { title: string; message: string; operatorMessage: string; steps: TerminalStep[] } {
  if (code === "HOST_DECLINED") {
    return {
      title: "Transaction declined",
      message: "The authorization host declined this transaction.",
      operatorMessage: "Host authorization returned HOST_DECLINED.",
      steps
    };
  }

  if (code === "DISPENSER_OFFLINE") {
    return {
      title: "Cash unavailable",
      message: "This terminal cannot dispense cash right now.",
      operatorMessage: "Cash dispenser adapter reported DISPENSER_OFFLINE.",
      steps
    };
  }

  if (code === "ACCEPTOR_OFFLINE") {
    return {
      title: "Deposit unavailable",
      message: "This terminal cannot accept cash right now.",
      operatorMessage: "Cash acceptor adapter reported ACCEPTOR_OFFLINE.",
      steps
    };
  }

  if (code === "CARD_READER_OFFLINE") {
    return {
      title: "Card reader unavailable",
      message: "This terminal cannot read cards right now.",
      operatorMessage: "Card reader adapter reported CARD_READER_OFFLINE.",
      steps
    };
  }

  return {
    title: "Transaction failed",
    message: "The transaction could not be completed.",
    operatorMessage: code ? `Failure code: ${code}.` : "Runtime reported an unknown failure.",
    steps
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
