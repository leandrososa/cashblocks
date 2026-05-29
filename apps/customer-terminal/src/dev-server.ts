import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

import {
  TerminalSessionManager,
  type TerminalSessionRequest
} from "../../../packages/terminal-session/src/index.js";
import { summarizeEvents } from "../../terminal-shell/src/simulation.js";
import flow from "../../../examples/atm-basic/src/flow.js";
import manifest from "../../../examples/atm-basic/cashblocks.flow.json" with { type: "json" };

const port = Number(process.env.PORT ?? 4174);
const publicDir = join(process.cwd(), "apps/customer-terminal/public");
const sessionManager = new TerminalSessionManager({
  flow,
  flowPackage: manifest,
  summarizeEvents
});

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
  console.log(`Cashblocks customer terminal listening on http://localhost:${port}`);
});

async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (method === "GET" && url.pathname === "/") {
    await writeStaticFile(response, "index.html");
    return;
  }

  if (method === "GET" && url.pathname === "/api/manifest") {
    writeJson(response, 200, manifest);
    return;
  }

  if (method === "POST" && url.pathname === "/api/session/start") {
    const body = await readJson<TerminalSessionRequest>(request);
    const session = sessionManager.start({
      ...body,
      journalPath: process.env.CASHBLOCKS_JOURNAL_PATH
    });
    writeJson(response, 200, await sessionManager.state(session));
    return;
  }

  if (method === "POST" && url.pathname === "/api/session/answer") {
    const body = await readJson<{ sessionId: string; promptId: string; value: string }>(request);
    const session = sessionManager.get(body.sessionId);
    if (!session) {
      writeJson(response, 404, { error: "Interactive session not found." });
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
