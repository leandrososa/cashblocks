import assert from "node:assert/strict";
import test from "node:test";

import type { AdapterOperationContext } from "../../runtime-contracts/src/index.js";
import {
  FramedIso8583Transport,
  type HostSocket
} from "./framed-transport.js";

test("framed TLS transport writes and reads fragmented length-prefixed payloads", async () => {
  const socket = new FakeSocket();
  const transport = createTransport(socket);
  const exchange = transport.exchange("0100ABC");

  socket.emit("secureConnect");
  assert.equal(socket.writes.length, 1);
  assert.equal(socket.writes[0]?.readUInt16BE(0), 7);
  assert.equal(socket.writes[0]?.subarray(2).toString("ascii"), "0100ABC");
  const response = frame("0110XYZ");
  socket.emit("data", response.subarray(0, 1));
  socket.emit("data", response.subarray(1, 5));
  socket.emit("data", response.subarray(5));

  assert.equal(await exchange, "0110XYZ");
  assert.equal(socket.ended, true);
});

test("framed transport requires TLS except explicit loopback", () => {
  assert.throws(
    () =>
      new FramedIso8583Transport({
        host: "switch.example.test",
        port: 443
      }),
    /requires TLS/
  );
  assert.doesNotThrow(
    () =>
      new FramedIso8583Transport({
        host: "127.0.0.1",
        port: 9000,
        allowInsecureLoopback: true
      })
  );
  assert.throws(
    () =>
      new FramedIso8583Transport({
        host: "switch.example.test",
        port: 443,
        tls: {},
        maxFrameBytes: 70_000
      }),
    /length header/
  );
});

test("framed transport rejects TLS authorization and invalid host frames", async () => {
  const unauthorized = new FakeSocket();
  unauthorized.authorized = false;
  unauthorized.authorizationError = new Error("unknown CA");
  const unauthorizedExchange = createTransport(unauthorized).exchange("0100");
  unauthorized.emit("secureConnect");
  await assert.rejects(() => unauthorizedExchange, /unknown CA/);

  const unknownAuthorization = new FakeSocket();
  unknownAuthorization.authorized = undefined;
  const unknownAuthorizationExchange =
    createTransport(unknownAuthorization).exchange("0100");
  unknownAuthorization.emit("secureConnect");
  await assert.rejects(
    () => unknownAuthorizationExchange,
    /authorization failed/
  );

  const oversized = new FakeSocket();
  const oversizedExchange = createTransport(oversized, {
    maxFrameBytes: 10
  }).exchange("0100");
  oversized.emit("secureConnect");
  const header = Buffer.alloc(2);
  header.writeUInt16BE(11);
  oversized.emit("data", header);
  await assert.rejects(() => oversizedExchange, /frame length is invalid/);

  const trailing = new FakeSocket();
  const trailingExchange = createTransport(trailing).exchange("0100");
  trailing.emit("secureConnect");
  trailing.emit("data", Buffer.concat([frame("0110"), Buffer.from("X")]));
  await assert.rejects(() => trailingExchange, /trailing frame data/);

  const nonAscii = new FakeSocket();
  const nonAsciiExchange = createTransport(nonAscii).exchange("0100");
  nonAscii.emit("secureConnect");
  nonAscii.emit("data", Buffer.from([0, 1, 0xc1]));
  await assert.rejects(() => nonAsciiExchange, /printable ASCII/);
});

test("framed transport respects aborts and rechecks deadlines before send", async () => {
  const controller = new AbortController();
  const socket = new FakeSocket();
  const exchange = createTransport(socket, {
    now: () => Date.parse("2026-07-27T12:00:01.000Z")
  }).exchange("0100", context(controller.signal));
  controller.abort(new Error("cancelled"));
  await assert.rejects(() => exchange, /cancelled/);
  assert.equal(socket.destroyed, true);

  let clock = Date.parse("2026-07-27T12:00:01.000Z");
  const expired = new FakeSocket();
  const expiredExchange = createTransport(expired, {
    now: () => clock
  }).exchange("0100", context(new AbortController().signal));
  clock = Date.parse("2026-07-27T12:00:31.000Z");
  expired.emit("secureConnect");
  await assert.rejects(() => expiredExchange, /deadline elapsed before send/);
  assert.equal(expired.writes.length, 0);
});

function createTransport(
  socket: FakeSocket,
  options: Partial<ConstructorParameters<typeof FramedIso8583Transport>[0]> = {}
) {
  return new FramedIso8583Transport({
    host: "switch.example.test",
    port: 443,
    tls: {},
    socketFactory: () => socket,
    ...options
  });
}

function frame(payload: string): Buffer {
  const body = Buffer.from(payload, "ascii");
  const result = Buffer.alloc(2 + body.length);
  result.writeUInt16BE(body.length, 0);
  body.copy(result, 2);
  return result;
}

function context(signal: AbortSignal): AdapterOperationContext {
  return {
    operationId: "operation-1",
    sessionId: "session-1",
    adapterId: "iso-host",
    operation: "authorize",
    transactionName: "CashWithdrawal",
    timeoutMs: 30_000,
    startedAt: "2026-07-27T12:00:00.000Z",
    deadlineAt: "2026-07-27T12:00:30.000Z",
    signal
  };
}

class FakeSocket implements HostSocket {
  destroyed = false;
  authorized: boolean | undefined = true;
  authorizationError: Error | undefined;
  ended = false;
  readonly writes: Buffer[] = [];
  private readonly listeners = new Map<
    string,
    Set<(...args: unknown[]) => void>
  >();
  private readonly onceListeners = new Map<
    string,
    Set<(...args: unknown[]) => void>
  >();

  once(event: string, listener: (...args: unknown[]) => void): HostSocket {
    const listeners = this.onceListeners.get(event) ?? new Set();
    listeners.add(listener);
    this.onceListeners.set(event, listeners);
    return this;
  }

  on(event: string, listener: (...args: unknown[]) => void): HostSocket {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return this;
  }

  removeListener(
    event: string,
    listener: (...args: unknown[]) => void
  ): HostSocket {
    this.listeners.get(event)?.delete(listener);
    this.onceListeners.get(event)?.delete(listener);
    return this;
  }

  write(data: Uint8Array): boolean {
    this.writes.push(Buffer.from(data));
    return true;
  }

  end(): void {
    this.ended = true;
  }

  destroy(): void {
    this.destroyed = true;
  }

  emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args);
    const once = [...(this.onceListeners.get(event) ?? [])];
    this.onceListeners.delete(event);
    for (const listener of once) listener(...args);
  }
}
