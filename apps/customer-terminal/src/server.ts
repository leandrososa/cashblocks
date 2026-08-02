import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse
} from "node:http";
import { readFile } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";

import {
  TerminalSessionCapacityError,
  TerminalSessionManager,
  type TerminalSessionRequest,
  type TerminalSessionState
} from "../../../packages/terminal-session/src/index.js";
import {
  summarizeEvents,
  type SimulationSummary
} from "../../terminal-shell/src/simulation.js";
import flow from "../../../examples/atm-basic/src/flow.js";
import manifest from "../../../examples/atm-basic/cashblocks.flow.json" with {
  type: "json"
};

export type CustomerTerminalServerOptions = {
  publicDir: string;
  journalPath?: string;
  maxRequestBytes?: number;
  maxSessions?: number;
  sessionTtlMs?: number;
  allowedHosts: readonly string[];
  allowedOrigins: readonly string[];
  enableDevelopmentControls?: boolean;
};

export type CustomerTerminalState = TerminalSessionState<SimulationSummary>;

type CustomerTerminalDisplayEventPayload =
  | {
      type: "card-detected";
    }
  | {
      type: "session-started";
      state: CustomerTerminalState;
    }
  | {
      type: "activation-failed";
      message: string;
    };

export type CustomerTerminalDisplayEvent =
  CustomerTerminalDisplayEventPayload & {
    sequence: number;
    occurredAt: string;
  };

export type CustomerTerminalServer = Server & {
  presentCard(
    request?: Omit<TerminalSessionRequest, "customerType">
  ): Promise<CustomerTerminalState>;
};

export function createCustomerTerminalServer(
  options: CustomerTerminalServerOptions
): CustomerTerminalServer {
  const publicDir = resolve(options.publicDir);
  const maxRequestBytes = options.maxRequestBytes ?? 64 * 1024;
  if (!Number.isSafeInteger(maxRequestBytes) || maxRequestBytes <= 0) {
    throw new Error("maxRequestBytes must be a positive safe integer.");
  }
  const allowedHosts = normalizedSet(options.allowedHosts, "allowedHosts");
  const allowedOrigins = normalizedSet(
    options.allowedOrigins,
    "allowedOrigins"
  );
  const sessionManager = new TerminalSessionManager({
    flow,
    flowPackage: manifest,
    summarizeEvents,
    maxSessions: options.maxSessions ?? 32,
    sessionTtlMs: options.sessionTtlMs ?? 15 * 60 * 1000
  });
  const displayClients = new Set<ServerResponse>();
  const displayHistory: CustomerTerminalDisplayEvent[] = [];
  let displaySequence = 0;
  const publish = (event: CustomerTerminalDisplayEventPayload): void => {
    const payload: CustomerTerminalDisplayEvent = {
      ...event,
      sequence: ++displaySequence,
      occurredAt: new Date().toISOString()
    } as CustomerTerminalDisplayEvent;
    displayHistory.push(payload);
    if (displayHistory.length > 32) displayHistory.shift();
    const frame = formatDisplayEvent(payload);
    for (const client of displayClients) {
      client.write(frame);
    }
  };
  const pruningTimer = setInterval(() => sessionManager.pruneExpired(), 60_000);
  pruningTimer.unref();
  const keepaliveTimer = setInterval(() => {
    for (const client of displayClients) {
      client.write(": keepalive\n\n");
    }
  }, 15_000);
  keepaliveTimer.unref();

  const server = createServer(async (request, response) => {
    try {
      validateAuthority(request, allowedHosts, allowedOrigins);
      const method = request.method ?? "GET";
      const url = new URL(request.url ?? "/", "http://localhost");
      if (
        method === "POST" &&
        !/^application\/json(?:\s*;|$)/i.test(
          String(request.headers["content-type"] ?? "")
        )
      ) {
        throw new HttpError(415, "Content-Type must be application/json.");
      }

      if (method === "GET" && url.pathname === "/health") {
        writeJson(response, 200, {
          status: "ok",
          flow: manifest.id,
          version: manifest.version
        });
        return;
      }

      if (method === "GET" && url.pathname === "/") {
        await writeStaticFile(response, publicDir, "index.html");
        return;
      }

      if (method === "GET" && url.pathname === "/api/manifest") {
        writeJson(response, 200, manifest);
        return;
      }

      if (method === "GET" && url.pathname === "/api/display-events") {
        response.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-store",
          connection: "keep-alive",
          "x-accel-buffering": "no",
          "content-security-policy":
            "default-src 'none'; frame-ancestors 'none'"
        });
        response.write(
          `data: ${JSON.stringify({
            sequence: displaySequence,
            type: "display-ready",
            occurredAt: new Date().toISOString()
          })}\n\n`
        );
        const lastSequence = parseLastEventSequence(
          request.headers["last-event-id"]
        );
        if (lastSequence !== undefined) {
          for (const event of displayHistory) {
            if (event.sequence > lastSequence) {
              response.write(formatDisplayEvent(event));
            }
          }
        }
        displayClients.add(response);
        request.once("close", () => displayClients.delete(response));
        return;
      }

      if (
        method === "POST" &&
        url.pathname === "/api/development/card-presented"
      ) {
        if (!options.enableDevelopmentControls) {
          writeJson(response, 404, { error: "Not found" });
          return;
        }
        const body = await readJson<unknown>(request, maxRequestBytes);
        if (!isEmptyObject(body)) {
          throw new HttpError(
            400,
            "Development card presentation does not accept options."
          );
        }
        const state = await server.presentCard();
        writeJson(response, 200, {
          status: "accepted",
          sessionId: state.sessionId
        });
        return;
      }

      if (method === "POST" && url.pathname === "/api/session/start") {
        const body = await readJson<TerminalSessionRequest>(
          request,
          maxRequestBytes
        );
        const session = sessionManager.start({
          ...body,
          journalPath: options.journalPath
        });
        writeJson(response, 200, await sessionManager.state(session));
        return;
      }

      if (method === "POST" && url.pathname === "/api/session/answer") {
        const body = await readJson<{
          sessionId: string;
          promptId: string;
          value: string;
        }>(request, maxRequestBytes);
        const session = sessionManager.get(body.sessionId);
        if (!session) {
          writeJson(response, 404, {
            error: "Interactive session not found."
          });
          return;
        }
        if (!sessionManager.answer(body)) {
          writeJson(response, 409, { error: "Prompt is no longer pending." });
          return;
        }
        writeJson(response, 200, await sessionManager.state(session));
        return;
      }

      if (method === "GET" && !url.pathname.startsWith("/api/")) {
        await writeStaticFile(response, publicDir, url.pathname.slice(1));
        return;
      }

      writeJson(response, 404, { error: "Not found" });
    } catch (error) {
      if (error instanceof TerminalSessionCapacityError) {
        writeJson(response, 503, { error: error.message });
        return;
      }
      if (error instanceof TerminalDisplayBusyError) {
        writeJson(response, 409, { error: error.message });
        return;
      }
      if (error instanceof HttpError) {
        writeJson(response, error.status, { error: error.message });
        return;
      }
      writeJson(response, 500, {
        error:
          error instanceof Error ? error.message : "Unexpected server error"
      });
    }
  }) as CustomerTerminalServer;

  server.presentCard = async (request = {}) => {
    try {
      if (sessionManager.size > 0) {
        throw new TerminalDisplayBusyError();
      }
      const session = sessionManager.start({
        ...request,
        journalPath: options.journalPath
      });
      publish({ type: "card-detected" });
      const state = await sessionManager.state(session);
      publish({ type: "session-started", state });
      return state;
    } catch (error) {
      publish({
        type: "activation-failed",
        message:
          error instanceof Error
            ? error.message
            : "The terminal could not start a session."
      });
      throw error;
    }
  };
  server.once("close", () => {
    clearInterval(pruningTimer);
    clearInterval(keepaliveTimer);
    for (const client of displayClients) {
      client.end();
    }
    displayClients.clear();
  });
  return server;
}

async function writeStaticFile(
  response: Parameters<typeof writeJson>[0],
  publicDir: string,
  requestPath: string
): Promise<void> {
  const filePath = resolve(publicDir, requestPath || "index.html");
  const relativePath = relative(publicDir, filePath);
  if (
    relativePath.startsWith("..") ||
    isAbsolute(relativePath) ||
    relativePath === ""
  ) {
    writeJson(response, 404, { error: "Static asset not found." });
    return;
  }

  try {
    const content = await readFile(filePath);
    response.writeHead(200, {
      "content-type": contentType(filePath),
      "x-content-type-options": "nosniff",
      "cache-control": "no-store",
      "content-security-policy":
        "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
    });
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
  if (extname(filePath) === ".json") return "application/json; charset=utf-8";
  if (extname(filePath) === ".png") return "image/png";
  if (extname(filePath) === ".jpg" || extname(filePath) === ".jpeg") {
    return "image/jpeg";
  }
  return "application/octet-stream";
}

function writeJson(
  response: import("node:http").ServerResponse,
  status: number,
  payload: unknown
): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
    "cache-control": "no-store",
    "content-security-policy": "default-src 'none'; frame-ancestors 'none'"
  });
  response.end(JSON.stringify(payload, null, 2));
}

async function readJson<T>(
  request: IncomingMessage,
  maxRequestBytes: number
): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxRequestBytes) {
      throw new HttpError(413, "Request body is too large.");
    }
    chunks.push(buffer);
  }

  if (chunks.length === 0) {
    return {} as T;
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
  } catch {
    throw new HttpError(400, "Request body must be valid JSON.");
  }
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

class TerminalDisplayBusyError extends Error {
  constructor() {
    super("The terminal already has an active customer session.");
    this.name = "TerminalDisplayBusyError";
  }
}

function validateAuthority(
  request: IncomingMessage,
  allowedHosts: ReadonlySet<string>,
  allowedOrigins: ReadonlySet<string>
): void {
  const host = request.headers.host?.trim().toLowerCase();
  if (!host || !allowedHosts.has(host)) {
    throw new HttpError(421, "Request host is not allowed.");
  }
  const origin = request.headers.origin?.trim().toLowerCase();
  if (request.method === "POST" && (!origin || !allowedOrigins.has(origin))) {
    throw new HttpError(403, "Request origin is not allowed.");
  }
  if (origin && !allowedOrigins.has(origin)) {
    throw new HttpError(403, "Request origin is not allowed.");
  }
}

function normalizedSet(
  values: readonly string[],
  label: string
): ReadonlySet<string> {
  const normalized = values.map((value) => value.trim().toLowerCase());
  if (normalized.length === 0 || normalized.some((value) => !value)) {
    throw new Error(`${label} must contain at least one non-empty value.`);
  }
  return new Set(normalized);
}

function isEmptyObject(value: unknown): value is Record<string, never> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).length === 0
  );
}

function formatDisplayEvent(event: CustomerTerminalDisplayEvent): string {
  return `id: ${event.sequence}\ndata: ${JSON.stringify(event)}\n\n`;
}

function parseLastEventSequence(value: string | string[] | undefined):
  | number
  | undefined {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate || !/^\d{1,10}$/.test(candidate)) return undefined;
  const sequence = Number(candidate);
  return Number.isSafeInteger(sequence) ? sequence : undefined;
}
