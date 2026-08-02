import assert from "node:assert/strict";
import test from "node:test";

import type { AdapterOperationContext } from "../../runtime-contracts/src/index.js";
import {
  createDeviceGatewayAdapters,
  type DeviceGatewayRequest
} from "./index.js";
import {
  WebSocketDeviceGatewayTransport,
  classifyDeviceRecovery,
  type DeviceWebSocket
} from "./websocket.js";

test("WebSocket transport exchanges one correlated JSON response", async () => {
  const harness = socketHarness();
  const transport = createTransport(harness.factory);
  const exchange = transport.exchange(request("status"));

  harness.socket.open();
  assert.deepEqual(JSON.parse(harness.socket.sent[0]!), request("status"));
  harness.socket.message({
    requestId: "request-1",
    ok: true,
    code: "OK",
    message: "Healthy."
  });

  assert.deepEqual(await exchange, {
    requestId: "request-1",
    ok: true,
    code: "OK",
    message: "Healthy."
  });
  assert.equal(harness.socket.readyState, 3);

  const nativeEvent = socketHarness();
  const nativeTransport = createTransport(nativeEvent.factory);
  const nativeExchange = nativeTransport.exchange(request("status"));
  nativeEvent.socket.open();
  nativeEvent.socket.messageWithPrototype({
    requestId: "request-1",
    ok: true,
    code: "OK",
    message: "Healthy."
  });
  assert.equal(
    (await nativeExchange as { ok: boolean }).ok,
    true
  );
});

test("WebSocket transport requires TLS except opted-in loopback", () => {
  assert.throws(
    () =>
      new WebSocketDeviceGatewayTransport({
        url: "ws://devices.example.test"
      }),
    /requires wss/
  );
  assert.throws(
    () =>
      new WebSocketDeviceGatewayTransport({
        url: "ws://localhost:9000"
      }),
    /requires wss/
  );
  assert.doesNotThrow(
    () =>
      new WebSocketDeviceGatewayTransport({
        url: "ws://127.0.0.1:9000",
        allowInsecureLoopback: true
      })
  );
  assert.throws(
    () =>
      new WebSocketDeviceGatewayTransport({
        url: "wss://user:secret@devices.example.test"
      }),
    /embedded credentials/
  );
});

test("post-send cash movement failures require reconciliation", async () => {
  const harness = socketHarness();
  const transport = createTransport(harness.factory);
  const exchange = transport.exchange(request("dispense"));

  harness.socket.open();
  harness.socket.error();
  const response = await exchange;

  assert.deepEqual(response, {
    requestId: "request-1",
    ok: false,
    code: "ADAPTER_OUTCOME_UNKNOWN",
    message: "Device connection failed after the request was sent.",
    details: {
      phase: "response",
      requestSent: true,
      recovery: "manual_reconciliation",
      requiresReconciliation: true
    }
  });
});

test("pre-send failures are safe to retry and custom commands are configurable", async () => {
  const beforeSend = socketHarness();
  const unavailable = createTransport(beforeSend.factory);
  const unavailableExchange = unavailable.exchange(request("dispense"));
  beforeSend.socket.error();
  const unavailableResponse = await unavailableExchange;
  assert.equal(
    (unavailableResponse as { code: string }).code,
    "DEVICE_GATEWAY_UNAVAILABLE"
  );
  assert.equal(
    (unavailableResponse as { details: { recovery: string } }).details.recovery,
    "safe_retry"
  );

  const custom = socketHarness();
  const customTransport = createTransport(custom.factory, {
    indeterminateCommands: ["cash-out"]
  });
  const customExchange = customTransport.exchange(request("cash-out"));
  custom.socket.open();
  custom.socket.closeFromPeer();
  assert.equal(
    (await customExchange as { code: string }).code,
    "ADAPTER_OUTCOME_UNKNOWN"
  );

  const retainedDefault = socketHarness();
  const retainedTransport = createTransport(retainedDefault.factory, {
    indeterminateCommands: ["cash-out"]
  });
  const retainedExchange = retainedTransport.exchange(request("dispense"));
  retainedDefault.socket.open();
  retainedDefault.socket.error();
  assert.equal(
    (await retainedExchange as { code: string }).code,
    "ADAPTER_OUTCOME_UNKNOWN"
  );
});

test("protocol failures after a state-changing send remain indeterminate", async () => {
  const harness = socketHarness();
  const transport = createTransport(harness.factory, {
    maxResponseBytes: 50
  });
  const exchange = transport.exchange(request("accept"));

  harness.socket.open();
  harness.socket.message({
    requestId: "wrong-id",
    padding: "x".repeat(100)
  });
  const response = await exchange as {
    code: string;
    details: { phase: string; recovery: string };
  };

  assert.equal(response.code, "ADAPTER_OUTCOME_UNKNOWN");
  assert.equal(response.details.phase, "protocol");
  assert.equal(response.details.recovery, "manual_reconciliation");

  const statusHarness = socketHarness();
  const statusTransport = createTransport(statusHarness.factory);
  const statusExchange = statusTransport.exchange(request("status"));
  statusHarness.socket.open();
  statusHarness.socket.message({ requestId: "wrong-id" });
  assert.equal(
    (await statusExchange as { details: { recovery: string } }).details.recovery,
    "operator_review"
  );

  const malformed = socketHarness();
  const malformedTransport = createTransport(malformed.factory);
  const malformedExchange = malformedTransport.exchange(request("dispense"));
  malformed.socket.open();
  malformed.socket.message({ requestId: "request-1" });
  const malformedResponse = await malformedExchange as {
    code: string;
    details: { recovery: string };
  };
  assert.equal(malformedResponse.code, "ADAPTER_OUTCOME_UNKNOWN");
  assert.equal(malformedResponse.details.recovery, "manual_reconciliation");
});

test("transport enforces negotiated protocol and rechecks deadlines", async () => {
  const missingProtocol = socketHarness("");
  const protocolTransport = createTransport(missingProtocol.factory);
  const protocolExchange = protocolTransport.exchange(request("status"));
  missingProtocol.socket.open();
  const protocolResponse = await protocolExchange as {
    code: string;
    details: { phase: string; requestSent: boolean };
  };
  assert.equal(protocolResponse.code, "DEVICE_GATEWAY_UNAVAILABLE");
  assert.equal(protocolResponse.details.phase, "protocol");
  assert.equal(protocolResponse.details.requestSent, false);
  assert.equal(missingProtocol.socket.sent.length, 0);

  let clock = Date.parse("2026-07-27T12:00:01.000Z");
  const expiredBeforeOpen = socketHarness();
  const deadlineTransport = createTransport(expiredBeforeOpen.factory, {
    now: () => clock
  });
  const deadlineExchange = deadlineTransport.exchange(
    request("dispense"),
    context(new AbortController().signal)
  );
  clock = Date.parse("2026-07-27T12:00:31.000Z");
  expiredBeforeOpen.socket.open();
  const deadlineResponse = await deadlineExchange as {
    code: string;
    details: { requestSent: boolean };
  };
  assert.equal(deadlineResponse.code, "DEVICE_GATEWAY_UNAVAILABLE");
  assert.equal(deadlineResponse.details.requestSent, false);

  clock = Date.parse("2026-07-27T12:00:01.000Z");
  const expiredResponse = socketHarness();
  const lateTransport = createTransport(expiredResponse.factory, {
    now: () => clock
  });
  const lateExchange = lateTransport.exchange(
    request("dispense"),
    context(new AbortController().signal)
  );
  expiredResponse.socket.open();
  clock = Date.parse("2026-07-27T12:00:31.000Z");
  expiredResponse.socket.message({
    requestId: "request-1",
    ok: true,
    code: "OK",
    message: "Late."
  });
  assert.equal(
    (await lateExchange as { code: string }).code,
    "ADAPTER_OUTCOME_UNKNOWN"
  );
});

test("transport enforces request limits, deadlines, and cancellation", async () => {
  let factoryCalled = false;
  const bounded = new WebSocketDeviceGatewayTransport({
    url: "wss://devices.example.test",
    maxRequestBytes: 100,
    webSocketFactory() {
      factoryCalled = true;
      return new FakeSocket();
    }
  });
  await assert.rejects(
    () =>
      bounded.exchange({
        ...request("print"),
        payload: { lines: ["x".repeat(200)] }
      }),
    /100-byte limit/
  );
  assert.equal(factoryCalled, false);

  const timed = socketHarness();
  const timeoutTransport = createTransport(timed.factory, {
    connectTimeoutMs: 1
  });
  const timeoutResponse = await timeoutTransport.exchange(request("status")) as {
    code: string;
  };
  assert.equal(timeoutResponse.code, "DEVICE_GATEWAY_UNAVAILABLE");

  const aborted = socketHarness();
  const abortTransport = createTransport(aborted.factory, {
    now: () => Date.parse("2026-07-27T12:00:01.000Z")
  });
  const controller = new AbortController();
  const exchange = abortTransport.exchange(
    request("read"),
    context(controller.signal)
  );
  controller.abort(new Error("cancelled"));
  await assert.rejects(() => exchange, /cancelled/);
  assert.equal(aborted.socket.readyState, 3);

  const postSendAbort = socketHarness();
  const postSendTransport = createTransport(postSendAbort.factory, {
    now: () => Date.parse("2026-07-27T12:00:01.000Z")
  });
  const postSendController = new AbortController();
  const postSendExchange = postSendTransport.exchange(
    request("dispense"),
    context(postSendController.signal)
  );
  postSendAbort.socket.open();
  postSendController.abort(new Error("cancelled"));
  const postSendResponse = await postSendExchange as {
    code: string;
    details: { recovery: string };
  };
  assert.equal(postSendResponse.code, "ADAPTER_OUTCOME_UNKNOWN");
  assert.equal(postSendResponse.details.recovery, "manual_reconciliation");

  const expired = socketHarness();
  const expiredTransport = createTransport(expired.factory, {
    now: () => Date.parse("2026-07-27T12:00:31.000Z")
  });
  const expiredResponse = await expiredTransport.exchange(
    request("dispense"),
    context(new AbortController().signal)
  ) as { code: string; details: { requestSent: boolean } };
  assert.equal(expiredResponse.code, "DEVICE_GATEWAY_UNAVAILABLE");
  assert.equal(expiredResponse.details.requestSent, false);
  assert.equal(expired.socket.sent.length, 0);
});

test("gateway client preserves indeterminate post-send abort results", async () => {
  const harness = socketHarness();
  const transport = createTransport(harness.factory, {
    now: () => Date.parse("2026-07-27T12:00:01.000Z")
  });
  const adapters = createDeviceGatewayAdapters({
    transport,
    nextRequestId: () => "request-1",
    bindings: {
      receiptPrinter: {
        adapterId: "printer",
        serviceId: "printer-1"
      },
      cashDispenser: {
        adapterId: "dispenser",
        serviceId: "device-1"
      },
      cashAcceptor: {
        adapterId: "acceptor",
        serviceId: "acceptor-1"
      },
      cardReader: {
        adapterId: "reader",
        serviceId: "reader-1"
      }
    }
  });
  const controller = new AbortController();
  const resultPromise = adapters.cashDispenser.dispense(
    { amount: 20, currencyCode: "AUD" },
    context(controller.signal)
  );
  harness.socket.open();
  controller.abort(new Error("cancelled"));
  const result = await resultPromise;

  assert.equal(result.code, "ADAPTER_OUTCOME_UNKNOWN");
  assert.equal(result.details?.recovery, "manual_reconciliation");
  assert.equal(result.details?.requestSent, true);
});

test("gateway client rejects spoofed recovery tuples and idempotent aborts", async () => {
  const cashController = new AbortController();
  const spoofed = createDeviceGatewayAdapters({
    transport: {
      async exchange(request) {
        cashController.abort(new Error("cancelled"));
        return {
          requestId: request.requestId,
          ok: false,
          code: "DEVICE_OUTCOME_UNKNOWN",
          message: "Spoofed operator result.",
          details: {
            requestSent: true,
            recovery: "operator_review",
            requiresReconciliation: false
          }
        };
      }
    },
    nextRequestId: () => "request-1",
    bindings: gatewayBindings()
  });
  await assert.rejects(
    () =>
      spoofed.cashDispenser.dispense(
        { amount: 20, currencyCode: "AUD" },
        context(cashController.signal)
      ),
    /cancelled/
  );

  const statusController = new AbortController();
  const idempotent = createDeviceGatewayAdapters({
    transport: {
      async exchange(request) {
        statusController.abort(new Error("cancelled"));
        return {
          requestId: request.requestId,
          ok: false,
          code: "DEVICE_OUTCOME_UNKNOWN",
          message: "Unknown status.",
          details: {
            requestSent: true,
            recovery: "operator_review"
          }
        };
      }
    },
    nextRequestId: () => "request-1",
    bindings: gatewayBindings()
  });
  await assert.rejects(
    () => idempotent.receiptPrinter.getStatus(context(statusController.signal)),
    /cancelled/
  );
});

test("recovery classifier distinguishes effect risk", () => {
  assert.equal(classifyDeviceRecovery("dispense", false), "safe_retry");
  assert.equal(
    classifyDeviceRecovery("dispense", true),
    "manual_reconciliation"
  );
  assert.equal(classifyDeviceRecovery("print", true), "operator_review");
  assert.equal(classifyDeviceRecovery("status", true), "safe_retry");
});

function createTransport(
  factory: (url: string, protocols: readonly string[]) => DeviceWebSocket,
  options: Partial<ConstructorParameters<typeof WebSocketDeviceGatewayTransport>[0]> =
    {}
) {
  return new WebSocketDeviceGatewayTransport({
    url: "wss://devices.example.test/gateway",
    webSocketFactory: factory,
    ...options
  });
}

function request(command: string): DeviceGatewayRequest {
  return {
    requestId: "request-1",
    serviceId: "device-1",
    command,
    payload: {}
  };
}

function context(signal: AbortSignal): AdapterOperationContext {
  return {
    operationId: "operation-1",
    sessionId: "session-1",
    adapterId: "device-1",
    operation: "read",
    timeoutMs: 30_000,
    startedAt: "2026-07-27T12:00:00.000Z",
    deadlineAt: "2026-07-27T12:00:30.000Z",
    signal
  };
}

function gatewayBindings() {
  return {
    receiptPrinter: {
      adapterId: "printer",
      serviceId: "printer-1"
    },
    cashDispenser: {
      adapterId: "dispenser",
      serviceId: "device-1"
    },
    cashAcceptor: {
      adapterId: "acceptor",
      serviceId: "acceptor-1"
    },
    cardReader: {
      adapterId: "reader",
      serviceId: "reader-1"
    }
  };
}

function socketHarness(protocol = "cashblocks.device.v1") {
  const socket = new FakeSocket(protocol);
  return {
    socket,
    factory: () => socket
  };
}

class FakeSocket implements DeviceWebSocket {
  readyState = 0;
  readonly sent: string[] = [];
  private readonly listeners = new Map<
    string,
    Set<(event: unknown) => void>
  >();

  constructor(readonly protocol = "cashblocks.device.v1") {}

  addEventListener(type: string, listener: (event: unknown) => void): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  send(data: string): void {
    if (this.readyState !== 1) throw new Error("Socket is not open.");
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
  }

  open(): void {
    this.readyState = 1;
    this.emit("open", {});
  }

  message(value: unknown): void {
    this.emit("message", { data: JSON.stringify(value) });
  }

  messageWithPrototype(value: unknown): void {
    const event = Object.create({ nativeEvent: true }) as { data: string };
    event.data = JSON.stringify(value);
    this.emit("message", event);
  }

  error(): void {
    this.emit("error", {});
  }

  closeFromPeer(): void {
    this.readyState = 3;
    this.emit("close", {});
  }

  private emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}
