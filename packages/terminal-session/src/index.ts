import { runFlow, type FlowGlobals, type FlowModule } from "../../flow-sdk/src/index.js";
import type {
  CustomerPrompt,
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
  transactionOptionAnswers?: string[];
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
  maxSessions?: number;
  sessionTtlMs?: number;
  now?: () => number;
  configure?(globals: FlowGlobals, request: TerminalSessionRequest): void;
};

export type SerializedCustomerPrompt = CustomerPrompt & {
  id: string;
};

export type TerminalSessionState<Summary> = {
  sessionId: string;
  prompt?: SerializedCustomerPrompt;
  completed: boolean;
  manifest: FlowPackage;
  summary: Summary;
  events?: RuntimeEvent[];
};

export class TerminalSessionManager<Summary> {
  private readonly sessions = new Map<string, InteractiveSession>();
  private readonly lastAccess = new Map<string, number>();
  private readonly maxSessions: number;
  private readonly sessionTtlMs: number;
  private readonly now: () => number;

  constructor(private readonly options: TerminalSessionManagerOptions<Summary>) {
    this.maxSessions = options.maxSessions ?? Number.MAX_SAFE_INTEGER;
    this.sessionTtlMs = options.sessionTtlMs ?? Number.MAX_SAFE_INTEGER;
    this.now = options.now ?? Date.now;
    if (!Number.isSafeInteger(this.maxSessions) || this.maxSessions <= 0) {
      throw new Error("maxSessions must be a positive safe integer.");
    }
    if (!Number.isSafeInteger(this.sessionTtlMs) || this.sessionTtlMs <= 0) {
      throw new Error("sessionTtlMs must be a positive safe integer.");
    }
  }

  start(request: TerminalSessionRequest): InteractiveSession {
    this.pruneExpired();
    this.removeCompleted();
    if (this.sessions.size >= this.maxSessions) {
      throw new TerminalSessionCapacityError(this.maxSessions);
    }
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
    this.lastAccess.set(id, this.now());
    return session;
  }

  answer(input: { sessionId: string; promptId: string; value: string }): boolean {
    this.pruneExpired();
    const session = this.sessions.get(input.sessionId);
    if (!session) {
      return false;
    }
    this.lastAccess.set(input.sessionId, this.now());
    return session.interaction.answer(input.promptId, input.value);
  }

  get(sessionId: string): InteractiveSession | undefined {
    this.pruneExpired();
    const session = this.sessions.get(sessionId);
    if (session) {
      this.lastAccess.set(sessionId, this.now());
    }
    return session;
  }

  async state(session: InteractiveSession): Promise<TerminalSessionState<Summary>> {
    this.pruneExpired();
    if (!this.sessions.has(session.id)) {
      throw new Error("Interactive session has expired.");
    }
    this.lastAccess.set(session.id, this.now());
    await waitForPromptOrResult(session);
    const events = session.runtime.Journal.all();
    const ok = session.result?.ok ?? !events.some((event) => event.type === "flow.failed");

    const state: TerminalSessionState<Summary> = {
      sessionId: session.id,
      prompt: serializePrompt(session.interaction.current()),
      completed: Boolean(session.result),
      manifest: this.options.flowPackage,
      summary: this.options.summarizeEvents(events, ok),
      ...(this.options.includeEvents ? { events } : {})
    };
    if (state.completed) {
      this.remove(session.id);
    }
    return state;
  }

  pruneExpired(): number {
    const cutoff = this.now() - this.sessionTtlMs;
    let removed = 0;
    for (const [sessionId, accessedAt] of this.lastAccess) {
      if (accessedAt <= cutoff) {
        this.sessions.delete(sessionId);
        this.lastAccess.delete(sessionId);
        removed += 1;
      }
    }
    return removed;
  }

  get size(): number {
    this.pruneExpired();
    this.removeCompleted();
    return this.sessions.size;
  }

  private removeCompleted(): void {
    for (const [sessionId, session] of this.sessions) {
      if (session.result) {
        this.remove(sessionId);
      }
    }
  }

  private remove(sessionId: string): void {
    this.sessions.delete(sessionId);
    this.lastAccess.delete(sessionId);
  }
}

export class TerminalSessionCapacityError extends Error {
  constructor(readonly capacity: number) {
    super(`Terminal session capacity of ${capacity} has been reached.`);
    this.name = "TerminalSessionCapacityError";
  }
}

export function buildSimulatorOptions(
  request: TerminalSessionRequest,
  defaultTransaction = "BalanceInquiry"
): RuntimeSimulatorOptions {
  const optionSelections = [
    ...(request.receiptPrinterOut ? [request.receiptWarningAnswer ?? "YES"] : []),
    ...(request.transactionOptionAnswers ?? [])
  ];

  return {
    customerSelections: [request.transaction ?? defaultTransaction],
    accountSelections: [request.account ?? "Checking"],
    amountSelections: [request.amount ?? 100],
    optionSelections,
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

function serializePrompt(prompt?: PendingCustomerPrompt): SerializedCustomerPrompt | undefined {
  if (!prompt) {
    return undefined;
  }

  return {
    id: prompt.id,
    ...prompt.prompt
  };
}
