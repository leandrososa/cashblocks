import assert from "node:assert/strict";
import { createServer } from "node:http";
import { connect } from "node:net";
import test from "node:test";

import { superviseNativeServer } from "./shutdown.js";

test("native shutdown destroys a partial HTTP connection after grace", async () => {
  let markRequestSeen: (() => void) | undefined;
  const requestSeen = new Promise<void>((resolve) => {
    markRequestSeen = resolve;
  });
  const server = createServer(() => markRequestSeen?.());
  const supervisor = superviseNativeServer(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Shutdown test server did not bind.");
  }
  const socket = connect(address.port, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
  socket.write(
    "POST / HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 100\r\n\r\n{"
  );
  await requestSeen;
  assert.equal(supervisor.activeConnections, 1);
  const socketClosed = new Promise<void>((resolve) =>
    socket.once("close", () => resolve())
  );

  await Promise.race([
    supervisor.close(20),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Shutdown did not finish.")), 1_000)
    )
  ]);
  await socketClosed;

  assert.equal(supervisor.activeConnections, 0);
  assert.equal(socket.destroyed, true);
});

test("native shutdown catches a connection not yet emitted by Bun", async () => {
  const server = createServer();
  const supervisor = superviseNativeServer(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Shutdown race test server did not bind.");
  }
  const socket = connect(address.port, "127.0.0.1");
  const socketClosed = new Promise<void>((resolve) =>
    socket.once("close", () => resolve())
  );
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
  socket.write(
    "POST / HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 100\r\n\r\n{"
  );

  await Promise.race([
    supervisor.close(20),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Racing shutdown did not finish.")), 1_000)
    )
  ]);
  await socketClosed;

  assert.equal(supervisor.activeConnections, 0);
  assert.equal(socket.destroyed, true);
});
