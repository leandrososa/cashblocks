import { runFlow, type FlowGlobals, type FlowModule } from "../../flow-sdk/src/index.js";
import type {
  CustomerType,
  FlowPackage,
  RuntimeEvent
} from "../../runtime-contracts/src/index.js";
import {
  CashblocksRuntime,
  QueuedCustomerInteraction,
  RuntimeSimulator,
  type PendingCustomerPrompt,
  type RuntimeSimulatorOptions
} from "../../runtime-core/src/index.js";

export type TerminalSessionRequest = {
  transaction?: string;
  customerType?: CustomerType;
  account?: string;
  amount?: number;
  receiptPrinterOut?: boolean;
  hostDeclined?: boolean;
  dispenserOffline?: boolean;
  acceptorOffline?: boolean;
  cardReaderOffline?: boolean;
  receiptWarningAnswer?: "YES" | "NO";
  journalPath?: string;
};

export type InteractiveSession = {
  id: string;
  runtime: CashblocksRuntime;
  interaction: QueuedCustomerInteraction;
  result?: Awaited<ReturnType<typeof runFlow>>;
  resultPromise: Promise<Awaited<ReturnType<typeof runFlow>>>;
};

export type TerminalSessionManagerOptions<Summary> = {
  flow: FlowModule;
  flowPackage: FlowPackage;
  summarizeEvents(events: RuntimeEvent[], flowOk: boolean): Summary;
  includeEvents?: boolean;
  defaultTransaction?: string;
  configure?(globals: FlowGlobals, request: TerminalSessionRequest): void;
};

export class TerminalSessionManager<Summary> {
  private readonly sessions = new Map<string, InteractiveSession>();

  constructor(private readonly options: TerminalSessionManagerOptions<Summary>) {}

  start(request: TerminalSessionRequest): InteractiveSession {
    const interaction = new QueuedCustomerInteraction();
    const runtime = new CashblocksRuntime({
      interaction,
      simulator: new RuntimeSimulator(
        buildSimulatorOptions(request, this.options.defaultTransaction ?? "BalanceInquiry")
      ),
      journalPath: request.journalPath
    });
    const id = runtime.SessionId;
    const session: InteractiveSession = {
      id,
      runtime,
      interaction,
      resultPromise: Promise.resolve(undefined as never)
    };

    session.resultPromise = runFlow(this.options.flow, {
      runtime,
      flowPackage: this.options.flowPackage,
      configure: (globals) => {
        if (request.customerType) {
          globals.Customer.CustomerType = request.customerType;
        }
        this.options.configure?.(globals, request);
      }
    }).then(async (result) => {
      await result.runtime.Journal.flush();
      session.result = result;
      return result;
    });
    session.resultPromise.catch(() => undefined);
    this.sessions.set(id, session);
    return session;
  }

  answer(input: { sessionId: string; promptId: string; value: string }): boolean {
    const session = this.sessions.get(input.sessionId);
    if (!session) {
      return false;
    }
    return session.interaction.answer(input.promptId, input.value);
  }

  get(sessionId: string): InteractiveSession | undefined {
    return this.sessions.get(sessionId);
  }

  async state(session: InteractiveSession): Promise<Record<string, unknown>> {
    await waitForPromptOrResult(session);
    const events = session.runtime.Journal.all();
    const ok = session.result?.ok ?? !events.some((event) => event.type === "flow.failed");

    return {
      sessionId: session.id,
      prompt: serializePrompt(session.interaction.current()),
      completed: Boolean(session.result),
      manifest: this.options.flowPackage,
      summary: this.options.summarizeEvents(events, ok),
      ...(this.options.includeEvents ? { events } : {})
    };
  }
}

export function buildSimulatorOptions(
  request: TerminalSessionRequest,
  defaultTransaction = "BalanceInquiry"
): RuntimeSimulatorOptions {
  return {
    customerSelections: [request.transaction ?? defaultTransaction],
    accountSelections: [request.account ?? "Checking"],
    amountSelections: [request.amount ?? 100],
    optionSelections: [request.receiptWarningAnswer ?? "YES"],
    receiptPrinter: request.receiptPrinterOut
      ? { health: "DEGRADED", paper: "OUT" }
      : { health: "HEALTHY", paper: "OK" },
    hostApproved: !request.hostDeclined,
    dispenserOnline: !request.dispenserOffline,
    acceptorOnline: !request.acceptorOffline,
    cardReaderOnline: !request.cardReaderOffline
  };
}

async function waitForPromptOrResult(session: InteractiveSession): Promise<void> {
  if (session.interaction.current() || session.result) {
    return;
  }

  await Promise.race([
    new Promise<void>((resolve) => {
      const unsubscribe = session.interaction.onPrompt(() => {
        unsubscribe();
        resolve();
      });
    }),
    session.resultPromise.then(() => undefined)
  ]);
}

function serializePrompt(prompt?: PendingCustomerPrompt): Record<string, unknown> | undefined {
  if (!prompt) {
    return undefined;
  }

  return {
    id: prompt.id,
    ...prompt.prompt
  };
}
