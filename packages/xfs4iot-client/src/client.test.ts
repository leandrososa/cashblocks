import assert from "node:assert/strict";
import test from "node:test";

import {
  Xfs4IotClient,
  type Xfs4IotWebSocket
} from "./client.js";
import {
  diagnosticHeader,
  redactXfs4IotDiagnostic,
  type Xfs4IotDiagnosticEntry
} from "./diagnostics.js";
import { Xfs4IotClientError } from "./errors.js";
import {
  classifyXfs4IotCompletion,
  createXfs4IotCommand,
  parseXfs4IotMessage,
  Xfs4IotProtocolError
} from "./protocol.js";

test("client requires TLS except explicit IP-loopback development", () => {
  assert.throws(
    () => new Xfs4IotClient({ url: "ws://devices.example.test" }),
    /requires wss/
  );
  assert.throws(
    () =>
      new Xfs4IotClient({
        url: "ws://localhost:5846",
        allowInsecureLoopback: true
      }),
    /requires wss/
  );
  assert.doesNotThrow(
    () =>
      new Xfs4IotClient({
        url: "ws://127.0.0.1:5846",
        allowInsecureLoopback: true
      })
  );
  assert.doesNotThrow(
    () =>
      new Xfs4IotClient({
        url: "ws://[::1]:5846",
        allowInsecureLoopback: true
      })
  );
  assert.throws(
    () => new Xfs4IotClient({ url: "wss://user:secret@devices.example.test" }),
    /credentials/
  );
  assert.throws(
    () =>
      new Xfs4IotClient({
        url: "wss://devices.example.test",
        protocols: ["xfs4iot", "xfs4iot"]
      }),
    /unique valid tokens/
  );
});

test("configured WebSocket subprotocol must be negotiated before send", async () => {
  const harness = socketHarness("");
  const client = createClient(harness, {
    protocols: ["xfs4iot.cashblocks.v1"],
    maxReconnectAttempts: 1
  });
  const status = client.execute({ name: "Common.Status" });
  harness.sockets[0]!.open();

  await assert.rejects(status, (error: unknown) => {
    assertFailure(error, "CONNECTION_FAILED", "safe-to-retry", false);
    return true;
  });
  assert.equal(harness.sockets[0]!.sent.length, 0);
  client.close();
});

test("one persistent connection correlates concurrent completions", async () => {
  const harness = socketHarness();
  const client = createClient(harness);
  const status = client.execute({ name: "Common.Status" });
  const capabilities = client.execute({ name: "Common.Capabilities" });

  assert.equal(harness.sockets.length, 1);
  harness.sockets[0]!.open();
  await until(() => harness.sockets[0]!.sent.length === 2);
  const [statusRequest, capabilitiesRequest] = harness.sockets[0]!.sentMessages();
  assert.equal(statusRequest.header.name, "Common.Status");
  assert.equal(capabilitiesRequest.header.name, "Common.Capabilities");

  harness.sockets[0]!.message(
    completion("Common.Capabilities", "3.0", capabilitiesRequest.header.requestId, {
      interfaces: [],
      common: { serviceVersion: "0.2.0", deviceInformation: [] }
    })
  );
  harness.sockets[0]!.message(
    completion("Common.Status", "3.0", statusRequest.header.requestId, {
      common: { device: "online" }
    })
  );

  assert.equal((await status).header.requestId, statusRequest.header.requestId);
  assert.equal(
    (await capabilities).header.requestId,
    capabilitiesRequest.header.requestId
  );
  assert.equal(client.pendingRequestCount, 0);
  assert.equal(client.connected, true);
  assert.equal(harness.sockets.length, 1);
  client.close();
});

test("late and duplicate completions are ignored without double settlement", async () => {
  const harness = socketHarness();
  const logs: Xfs4IotDiagnosticEntry[] = [];
  const client = createClient(harness, { logger: { log: (entry) => logs.push(entry) } });
  const result = client.execute({ name: "Common.Status" });
  harness.sockets[0]!.open();
  await until(() => harness.sockets[0]!.sent.length === 1);
  const request = harness.sockets[0]!.sentMessages()[0]!;
  const response = completion("Common.Status", "3.0", request.header.requestId, {
    common: { device: "online" }
  });

  harness.sockets[0]!.message(
    completion("Common.Status", "3.0", request.header.requestId + 100, {
      common: { device: "offline" }
    })
  );
  assert.equal(client.pendingRequestCount, 1);
  harness.sockets[0]!.message(response);
  assert.equal(
    ((await result).payload as { common: { device: string } }).common.device,
    "online"
  );
  harness.sockets[0]!.message(response);

  assert.equal(
    logs.filter(({ event }) => event === "message.late_or_duplicate").length,
    2
  );
  client.close();
});

test("solicited and unsolicited events route through a bounded backlog", async () => {
  const harness = socketHarness();
  const logs: Xfs4IotDiagnosticEntry[] = [];
  const routed: string[] = [];
  const client = createClient(harness, {
    maxEventBacklog: 2,
    logger: { log: (entry) => logs.push(entry) }
  });
  client.onEvent((event) => routed.push(event.correlation));
  client.onEvent(() => {
    throw new Error("listener failure");
  });
  const read = client.execute({
    name: "CardReader.ReadRawData",
    payload: { chip: true }
  });
  harness.sockets[0]!.open();
  await until(() => harness.sockets[0]!.sent.length === 1);
  const requestId = harness.sockets[0]!.sentMessages()[0]!.header.requestId;

  harness.sockets[0]!.message(event("CardReader.MediaInsertedEvent", "2.0", requestId));
  harness.sockets[0]!.message({
    header: {
      type: "unsolicited",
      name: "Common.StatusChangedEvent",
      version: "3.0"
    },
    payload: { common: { device: "offline" } }
  });
  harness.sockets[0]!.message(event("CardReader.InvalidMediaEvent", "2.0", 999));

  assert.deepEqual(routed, ["pending", "unsolicited", "orphan"]);
  assert.equal(client.queuedEventCount, 2);
  assert.deepEqual(
    client.drainEvents().map(({ correlation }) => correlation),
    ["unsolicited", "orphan"]
  );
  assert.equal(
    logs.some(({ event: logEvent }) => logEvent === "event.backlog_overflow"),
    true
  );
  assert.equal(
    logs.some(({ event: logEvent }) => logEvent === "event.listener_failed"),
    true
  );

  harness.sockets[0]!.message(
    completion("CardReader.ReadRawData", "3.0", requestId, {
      chip: [{ data: "AQID" }]
    })
  );
  await read;
  client.close();
});

test("connection retries are bounded and never send before open", async () => {
  const retrying = socketHarness();
  const delays: number[] = [];
  const client = createClient(retrying, {
    maxReconnectAttempts: 3,
    reconnectBaseDelayMs: 1,
    reconnectMaxDelayMs: 4,
    delay: async (milliseconds) => {
      delays.push(milliseconds);
    }
  });
  const response = client.execute({ name: "Common.Status" });
  retrying.sockets[0]!.error();
  await until(() => retrying.sockets.length === 2);
  assert.equal(retrying.sockets[0]!.sent.length, 0);
  retrying.sockets[1]!.open();
  await until(() => retrying.sockets[1]!.sent.length === 1);
  const request = retrying.sockets[1]!.sentMessages()[0]!;
  retrying.sockets[1]!.message(
    completion("Common.Status", "3.0", request.header.requestId, {
      common: { device: "online" }
    })
  );
  assert.equal((await response).header.requestId, request.header.requestId);
  assert.deepEqual(delays, [1]);
  client.close();

  const exhausted = socketHarness();
  const unavailable = createClient(exhausted, {
    maxReconnectAttempts: 2,
    reconnectBaseDelayMs: 1,
    delay: async () => undefined
  });
  const failed = unavailable.execute({ name: "Common.Status" });
  exhausted.sockets[0]!.error();
  await until(() => exhausted.sockets.length === 2);
  exhausted.sockets[1]!.closeFromPeer();
  await assert.rejects(failed, (error: unknown) => {
    assertFailure(error, "CONNECTION_FAILED", "safe-to-retry", false);
    return true;
  });
  assert.equal(exhausted.sockets.length, 2);
  unavailable.close();
});

test("post-send disconnect distinguishes read-only and cash movement risk", async () => {
  const harness = socketHarness();
  const client = createClient(harness);
  const dispense = client.execute(dispenseCommand());
  const status = client.execute({ name: "Common.Status" });
  harness.sockets[0]!.open();
  await until(() => harness.sockets[0]!.sent.length === 2);
  assert.equal(harness.sockets[0]!.sent.length, 2);
  harness.sockets[0]!.closeFromPeer();

  await assert.rejects(dispense, (error: unknown) => {
    assertFailure(error, "CONNECTION_LOST", "indeterminate", true);
    return true;
  });
  await assert.rejects(status, (error: unknown) => {
    assertFailure(error, "CONNECTION_LOST", "safe-to-retry", true);
    return true;
  });
  client.close();
});

test("invalid acknowledgements are known failures even for dispense", async () => {
  const harness = socketHarness();
  const client = createClient(harness);
  const dispense = client.execute(dispenseCommand());
  harness.sockets[0]!.open();
  await until(() => harness.sockets[0]!.sent.length === 1);
  const request = harness.sockets[0]!.sentMessages()[0]!;
  harness.sockets[0]!.message({
    header: {
      type: "acknowledge",
      name: "CashDispenser.Dispense",
      version: "2.0",
      requestId: request.header.requestId,
      status: "invalidMessage"
    }
  });

  await assert.rejects(dispense, (error: unknown) => {
    assertFailure(error, "ACKNOWLEDGE_REJECTED", "known", true);
    return true;
  });
  client.close();
});

test("malformed protocol after dispense remains indeterminate", async () => {
  const harness = socketHarness();
  const client = createClient(harness);
  const dispense = client.execute(dispenseCommand());
  harness.sockets[0]!.open();
  await until(() => harness.sockets[0]!.sent.length === 1);
  harness.sockets[0]!.messageText("{not-json");

  await assert.rejects(dispense, (error: unknown) => {
    assertFailure(error, "PROTOCOL_ERROR", "indeterminate", true);
    return true;
  });
  assert.equal(harness.sockets[0]!.readyState, 3);
  client.close();
});

test("abort and timeout issue best-effort cancellation without false success", async () => {
  const abortedHarness = socketHarness();
  const abortedClient = createClient(abortedHarness);
  const controller = new AbortController();
  const read = abortedClient.execute(
    { name: "CardReader.ReadRawData", payload: { chip: true } },
    { signal: controller.signal }
  );
  abortedHarness.sockets[0]!.open();
  await until(() => abortedHarness.sockets[0]!.sent.length === 1);
  const originalId = abortedHarness.sockets[0]!.sentMessages()[0]!.header.requestId;
  controller.abort(new Error("customer cancelled"));
  await assert.rejects(read, (error: unknown) => {
    assertFailure(error, "ABORTED", "safe-to-retry", true);
    return true;
  });
  await until(() => abortedHarness.sockets[0]!.sent.length === 2);
  const cancelRequest = abortedHarness.sockets[0]!.sentMessages()[1]!;
  assert.equal(cancelRequest.header.name, "Common.Cancel");
  assert.deepEqual(cancelRequest.payload, { requestIds: [originalId] });
  abortedHarness.sockets[0]!.message(
    completion("Common.Cancel", "2.0", cancelRequest.header.requestId)
  );
  await until(() => abortedClient.pendingRequestCount === 0);
  abortedClient.close();

  const timeoutHarness = socketHarness();
  const timeoutClient = createClient(timeoutHarness);
  const dispense = timeoutClient.execute(dispenseCommand(), { timeoutMs: 5 });
  timeoutHarness.sockets[0]!.open();
  await until(() => timeoutHarness.sockets[0]!.sent.length === 1);
  await assert.rejects(dispense, (error: unknown) => {
    assertFailure(error, "DEADLINE_EXCEEDED", "indeterminate", true);
    return true;
  });
  await until(() => timeoutHarness.sockets[0]!.sent.length === 2);
  const timeoutCancel = timeoutHarness.sockets[0]!.sentMessages()[1]!;
  timeoutHarness.sockets[0]!.message(
    completion("Common.Cancel", "2.0", timeoutCancel.header.requestId)
  );
  await until(() => timeoutClient.pendingRequestCount === 0);
  timeoutClient.close();
});

test("pending requests, messages, deadlines, and request ids are bounded", async () => {
  const harness = socketHarness();
  const client = createClient(harness, { maxPendingRequests: 2 });
  const status = client.execute({ name: "Common.Status" });
  const capabilities = client.execute({ name: "Common.Capabilities" });
  await assert.rejects(
    client.execute({ name: "Common.Status" }),
    (error: unknown) => {
      assertFailure(error, "PENDING_LIMIT_EXCEEDED", "safe-to-retry", false);
      return true;
    }
  );
  harness.sockets[0]!.open();
  await until(() => harness.sockets[0]!.sent.length === 2);
  const [statusRequest, capsRequest] = harness.sockets[0]!.sentMessages();
  harness.sockets[0]!.message(
    completion("Common.Status", "3.0", statusRequest.header.requestId, {
      common: { device: "online" }
    })
  );
  harness.sockets[0]!.message(
    completion("Common.Capabilities", "3.0", capsRequest.header.requestId, {
      interfaces: [],
      common: { serviceVersion: "0.2.0", deviceInformation: [] }
    })
  );
  await Promise.all([status, capabilities]);
  assert.throws(
    () => client.execute({ name: "Common.Status" }, { timeoutMs: 5_001 }),
    /timeoutMs/
  );
  client.close();

  const duplicateIds = socketHarness();
  const duplicateClient = createClient(duplicateIds, { nextRequestId: () => 7 });
  const first = duplicateClient.execute({ name: "Common.Status" });
  assert.throws(
    () => duplicateClient.execute({ name: "Common.Capabilities" }),
    /unique positive integer/
  );
  duplicateClient.close();
  await assert.rejects(first, /closed/);
});

test("runtime validation rejects malformed envelopes and payloads", () => {
  assert.throws(
    () =>
      parseXfs4IotMessage({
        header: {
          type: "completion",
          name: "Common.Status",
          version: "3.0"
        }
      }),
    Xfs4IotProtocolError
  );
  assert.throws(
    () =>
      parseXfs4IotMessage({
        header: {
          type: "command",
          name: "Printer.PrintForm",
          version: "2.0",
          requestId: 1
        }
      }),
    /outside the supported subset/
  );
  assert.throws(
    () =>
      parseXfs4IotMessage({
        header: {
          type: "command",
          name: "CardReader.ReadRawData",
          version: "2.0",
          requestId: 1,
          vendorField: true
        },
        payload: { chip: true }
      }),
    /Unsupported XFS4IoT header field/
  );
  assert.throws(
    () =>
      createXfs4IotCommand(
        { name: "Common.SetTransactionState", payload: { state: "broken" } },
        1,
        5_000
      ),
    /active or inactive/
  );
});

test("known completion failures resolve for adapter mapping", async () => {
  const harness = socketHarness();
  const client = createClient(harness);
  const status = client.execute({ name: "Common.Status" });
  harness.sockets[0]!.open();
  await until(() => harness.sockets[0]!.sent.length === 1);
  const requestId = harness.sockets[0]!.sentMessages()[0]!.header.requestId;
  harness.sockets[0]!.message({
    header: {
      type: "completion",
      name: "Common.Status",
      version: "3.0",
      requestId,
      completionCode: "deviceNotReady"
    }
  });
  assert.equal(classifyXfs4IotCompletion(await status), "known");
  client.close();
});

test("diagnostics redact sensitive and vendor-specific fields", () => {
  const redacted = redactXfs4IotDiagnostic({
    header: {
      type: "completion",
      name: "CardReader.ReadRawData",
      version: "3.0",
      requestId: 1
    },
    payload: {
      track2: "synthetic-track-value",
      vendorExtension: "private vendor value",
      eventId: "hardware"
    }
  }) as {
    header: Record<string, unknown>;
    payload: Record<string, unknown>;
  };

  assert.equal(redacted.header.name, "CardReader.ReadRawData");
  assert.equal(redacted.payload.track2, "[REDACTED:sensitive]");
  assert.equal(redacted.payload.vendorExtension, "[REDACTED:unknown]");
  assert.equal(redacted.payload.eventId, "hardware");
  assert.deepEqual(
    diagnosticHeader({
      header: {
        type: "completion",
        name: "Common.Status",
        version: "3.0",
        requestId: 9
      },
      payload: { vendorSecret: "never logged" }
    }),
    {
      type: "completion",
      name: "Common.Status",
      version: "3.0",
      requestId: 9
    }
  );
});

function createClient(
  harness: ReturnType<typeof socketHarness>,
  overrides: Partial<ConstructorParameters<typeof Xfs4IotClient>[0]> = {}
): Xfs4IotClient {
  return new Xfs4IotClient({
    url: "wss://devices.example.test/xfs4iot",
    webSocketFactory: harness.factory,
    reconnectBaseDelayMs: 1,
    reconnectMaxDelayMs: 4,
    delay: async () => undefined,
    ...overrides
  });
}

function dispenseCommand() {
  return {
    name: "CashDispenser.Dispense" as const,
    payload: {
      denomination: {
        denomination: {
          app: {
            currencies: { USD: 40 },
            counts: { unitA: 2 }
          }
        }
      },
      position: "outFront"
    }
  };
}

function completion(
  name: string,
  version: string,
  requestId: number,
  payload?: Record<string, unknown>
) {
  return {
    header: { type: "completion", name, version, requestId },
    ...(payload === undefined ? {} : { payload })
  };
}

function event(name: string, version: string, requestId: number) {
  return { header: { type: "event", name, version, requestId } };
}

function assertFailure(
  error: unknown,
  code: Xfs4IotClientError["code"],
  classification: Xfs4IotClientError["classification"],
  requestSent: boolean
): asserts error is Xfs4IotClientError {
  assert.equal(error instanceof Xfs4IotClientError, true);
  assert.equal((error as Xfs4IotClientError).code, code);
  assert.equal((error as Xfs4IotClientError).classification, classification);
  assert.equal((error as Xfs4IotClientError).requestSent, requestSent);
}

function socketHarness(protocol = "") {
  const sockets: FakeSocket[] = [];
  return {
    sockets,
    factory: () => {
      const socket = new FakeSocket(protocol);
      sockets.push(socket);
      return socket;
    }
  };
}

class FakeSocket implements Xfs4IotWebSocket {
  readyState = 0;
  readonly sent: string[] = [];
  private readonly listeners = new Map<string, Set<(event: unknown) => void>>();

  constructor(readonly protocol = "") {}

  addEventListener(type: string, listener: (event: unknown) => void): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  send(data: string): void {
    if (this.readyState !== 1) throw new Error("socket is not open");
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
  }

  open(): void {
    this.readyState = 1;
    this.emit("open", {});
  }

  error(): void {
    this.emit("error", new Error("socket failure"));
  }

  closeFromPeer(): void {
    this.readyState = 3;
    this.emit("close", {});
  }

  message(value: unknown): void {
    this.messageText(JSON.stringify(value));
  }

  messageText(data: string): void {
    this.emit("message", { data });
  }

  sentMessages(): Array<{
    header: { name: string; requestId: number };
    payload?: Record<string, unknown>;
  }> {
    return this.sent.map((value) => JSON.parse(value));
  }

  private emit(type: string, event: unknown): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
  }
}

async function until(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("Timed out waiting for test condition.");
}
