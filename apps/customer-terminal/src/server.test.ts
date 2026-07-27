import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createCustomerTerminalServer } from "./server.js";

test("customer terminal rejects untrusted hosts, origins, and content types", async () => {
  const fixture = await createFixture();
  const server = createCustomerTerminalServer({
    publicDir: fixture.publicDir,
    allowedHosts: ["terminal.local"],
    allowedOrigins: ["http://terminal.local"]
  });
  await listen(server);
  const port = addressPort(server);

  try {
    assert.equal(
      (
        await send(port, {
          host: "attacker.example",
          origin: "https://attacker.example",
          contentType: "text/plain"
        })
      ).status,
      421
    );
    assert.equal(
      (
        await send(port, {
          host: "terminal.local",
          origin: "https://attacker.example",
          contentType: "application/json"
        })
      ).status,
      403
    );
    assert.equal(
      (
        await send(port, {
          host: "terminal.local",
          origin: "http://terminal.local",
          contentType: "text/plain"
        })
      ).status,
      415
    );
    assert.equal(
      (
        await send(port, {
          host: "terminal.local",
          origin: "http://terminal.local",
          contentType: "application/json; charset=utf-8"
        })
      ).status,
      200
    );
  } finally {
    await close(server);
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("customer terminal caps sessions and releases expired sessions", async () => {
  const fixture = await createFixture();
  const server = createCustomerTerminalServer({
    publicDir: fixture.publicDir,
    allowedHosts: ["terminal.local"],
    allowedOrigins: ["http://terminal.local"],
    maxSessions: 1,
    sessionTtlMs: 20
  });
  await listen(server);
  const port = addressPort(server);
  const options = {
    host: "terminal.local",
    origin: "http://terminal.local",
    contentType: "application/json"
  };

  try {
    assert.equal((await send(port, options)).status, 200);
    assert.equal((await send(port, options)).status, 503);
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal((await send(port, options)).status, 200);
  } finally {
    await close(server);
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("customer terminal creates collision-resistant concurrent session ids", async () => {
  const fixture = await createFixture();
  const server = createCustomerTerminalServer({
    publicDir: fixture.publicDir,
    allowedHosts: ["terminal.local"],
    allowedOrigins: ["http://terminal.local"]
  });
  await listen(server);
  const port = addressPort(server);
  const options = {
    host: "terminal.local",
    origin: "http://terminal.local",
    contentType: "application/json"
  };

  try {
    const responses = await Promise.all([
      send(port, options),
      send(port, options)
    ]);
    const sessionIds = responses.map(
      (response) =>
        (JSON.parse(response.body) as { sessionId: string }).sessionId
    );
    assert.notEqual(sessionIds[0], sessionIds[1]);
    assert.match(sessionIds[0] ?? "", /^session-[0-9a-f-]{36}$/);
  } finally {
    await close(server);
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("customer terminal releases completed sessions before enforcing capacity", async () => {
  const fixture = await createFixture();
  const server = createCustomerTerminalServer({
    publicDir: fixture.publicDir,
    allowedHosts: ["terminal.local"],
    allowedOrigins: ["http://terminal.local"],
    maxSessions: 1
  });
  await listen(server);
  const port = addressPort(server);
  const headers = {
    host: "terminal.local",
    origin: "http://terminal.local",
    contentType: "application/json"
  };

  try {
    let state = JSON.parse(
      (await send(port, headers)).body
    ) as SessionState;
    while (!state.completed) {
      const value = answerFor(state);
      state = JSON.parse(
        (
          await send(
            port,
            headers,
            "/api/session/answer",
            JSON.stringify({
              sessionId: state.sessionId,
              promptId: state.prompt?.id,
              value
            })
          )
        ).body
      ) as SessionState;
    }
    assert.equal((await send(port, headers)).status, 200);
  } finally {
    await close(server);
    await rm(fixture.root, { recursive: true, force: true });
  }
});

type SessionState = {
  sessionId: string;
  completed: boolean;
  prompt?: {
    id: string;
    kind: "pin" | "transaction" | "account" | "amount" | "option";
    options?: string[];
  };
};

function answerFor(state: SessionState): string {
  const prompt = state.prompt;
  if (!prompt) {
    throw new Error("Session did not expose a prompt.");
  }
  if (prompt.kind === "pin") return "1234";
  if (prompt.kind === "transaction") return "BalanceInquiry";
  if (prompt.kind === "account") return "Checking";
  if (prompt.kind === "amount") return "100";
  return prompt.options?.[0] ?? "NO";
}

async function createFixture(): Promise<{ root: string; publicDir: string }> {
  const root = await mkdtemp(join(tmpdir(), "cashblocks-server-"));
  const publicDir = join(root, "public");
  await mkdir(publicDir);
  await Promise.all(
    ["index.html", "app.js", "style.css"].map((file) =>
      writeFile(join(publicDir, file), file, "utf8")
    )
  );
  return { root, publicDir };
}

function listen(server: ReturnType<typeof createCustomerTerminalServer>) {
  return new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function close(server: ReturnType<typeof createCustomerTerminalServer>) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function addressPort(
  server: ReturnType<typeof createCustomerTerminalServer>
): number {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server did not bind a TCP port.");
  }
  return address.port;
}

function send(
  port: number,
  headers: { host: string; origin: string; contentType: string },
  path = "/api/session/start",
  body = "{}"
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const outgoing = request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method: "POST",
        headers: {
          host: headers.host,
          origin: headers.origin,
          "content-type": headers.contentType
        }
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8")
          })
        );
      }
    );
    outgoing.once("error", reject);
    outgoing.end(body);
  });
}
