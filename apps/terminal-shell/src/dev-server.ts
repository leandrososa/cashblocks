import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

import { runFlow } from "../../../packages/flow-sdk/src/index.js";
import {
  CashblocksRuntime,
  QueuedCustomerInteraction,
  RuntimeSimulator,
  type PendingCustomerPrompt,
  type RuntimeSimulatorOptions
} from "../../../packages/runtime-core/src/index.js";
import {
  getFlowManifest,
  readJournalHistory,
  runSimulation,
  summarizeEvents,
  type SimulationRequest
} from "./simulation.js";
import flow from "../../../examples/atm-basic/src/flow.js";
import manifest from "../../../examples/atm-basic/cashblocks.flow.json" with { type: "json" };

const port = Number(process.env.PORT ?? 4173);
const publicDir = join(process.cwd(), "apps/terminal-shell/public");
const interactiveSessions = new Map<string, InteractiveSession>();

type InteractiveSession = {
  id: string;
  runtime: CashblocksRuntime;
  interaction: QueuedCustomerInteraction;
  result?: Awaited<ReturnType<typeof runFlow>>;
  resultPromise: Promise<Awaited<ReturnType<typeof runFlow>>>;
};

const server = createServer(async (request, response) => {
  try {
    await route(request, response);
  } catch (error) {
    writeJson(response, 500, {
      error: error instanceof Error ? error.message : "Unexpected server error"
    });
  }
});

server.listen(port, () => {
  console.log(`Cashblocks terminal shell listening on http://localhost:${port}`);
});

async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (method === "GET" && url.pathname === "/") {
    await writeStaticFile(response, "index.html");
    return;
  }

  if (method === "GET" && url.pathname === "/api/manifest") {
    writeJson(response, 200, getFlowManifest());
    return;
  }

  if (method === "GET" && url.pathname === "/api/journal") {
    writeJson(response, 200, await readJournalHistory(process.env.CASHBLOCKS_JOURNAL_PATH));
    return;
  }

  if (method === "POST" && url.pathname === "/api/run") {
    const body = await readJson<SimulationRequest>(request);
    const result = await runSimulation({
      ...body,
      journalPath: process.env.CASHBLOCKS_JOURNAL_PATH
    });
    writeJson(response, 200, result);
    return;
  }

  if (method === "POST" && url.pathname === "/api/session/start") {
    const body = await readJson<SimulationRequest>(request);
    const session = startInteractiveSession({
      ...body,
      journalPath: process.env.CASHBLOCKS_JOURNAL_PATH
    });
    writeJson(response, 200, await interactiveSessionState(session));
    return;
  }

  if (method === "POST" && url.pathname === "/api/session/answer") {
    const body = await readJson<{ sessionId: string; promptId: string; value: string }>(request);
    const session = interactiveSessions.get(body.sessionId);
    if (!session) {
      writeJson(response, 404, { error: "Interactive session not found." });
      return;
    }
    if (!session.interaction.answer(body.promptId, body.value)) {
      writeJson(response, 409, { error: "Prompt is no longer pending." });
      return;
    }
    writeJson(response, 200, await interactiveSessionState(session));
    return;
  }

  if (method === "GET" && !url.pathname.startsWith("/api/")) {
    await writeStaticFile(response, url.pathname.slice(1));
    return;
  }

  writeJson(response, 404, { error: "Not found" });
}

async function writeStaticFile(response: ServerResponse, requestPath: string): Promise<void> {
  const safePath = normalize(requestPath).replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = join(publicDir, safePath || "index.html");

  try {
    const content = await readFile(filePath);
    response.writeHead(200, { "content-type": contentType(filePath) });
    response.end(content);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      writeJson(response, 404, { error: "Static asset not found." });
      return;
    }
    throw error;
  }
}

function contentType(filePath: string): string {
  if (extname(filePath) === ".html") return "text/html; charset=utf-8";
  if (extname(filePath) === ".css") return "text/css; charset=utf-8";
  if (extname(filePath) === ".js") return "text/javascript; charset=utf-8";
  return "application/octet-stream";
}

function startInteractiveSession(request: SimulationRequest): InteractiveSession {
  const interaction = new QueuedCustomerInteraction();
  const runtime = new CashblocksRuntime({
    interaction,
    simulator: new RuntimeSimulator(buildSimulatorOptions(request)),
    journalPath: request.journalPath
  });
  const id = runtime.SessionId;
  const session: InteractiveSession = {
    id,
    runtime,
    interaction,
    resultPromise: Promise.resolve(undefined as never)
  };

  session.resultPromise = runFlow(flow, {
    runtime,
    flowPackage: manifest
  }).then(async (result) => {
    await result.runtime.Journal.flush();
    session.result = result;
    return result;
  });
  session.resultPromise.catch(() => undefined);
  interactiveSessions.set(id, session);
  return session;
}

function buildSimulatorOptions(request: SimulationRequest): RuntimeSimulatorOptions {
  return {
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
}

async function interactiveSessionState(session: InteractiveSession): Promise<Record<string, unknown>> {
  await waitForPromptOrResult(session);
  const events = session.runtime.Journal.all();
  const ok = session.result?.ok ?? !events.some((event) => event.type === "flow.failed");

  return {
    sessionId: session.id,
    prompt: serializePrompt(session.interaction.current()),
    completed: Boolean(session.result),
    manifest,
    summary: summarizeEvents(events, ok),
    events
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

function writeJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload, null, 2));
}

async function readJson<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {} as T;
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}
