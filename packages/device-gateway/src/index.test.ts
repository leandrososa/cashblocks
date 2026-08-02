import assert from "node:assert/strict";
import test from "node:test";

import type { AdapterOperationContext } from "../../runtime-contracts/src/index.js";
import {
  DeviceGatewayProtocolError,
  createDeviceGatewayAdapters,
  type DeviceGatewayRequest,
  type DeviceGatewayTransport
} from "./index.js";

test("device gateway adapters map commands, payloads, and correlation", async () => {
  const requests: DeviceGatewayRequest[] = [];
  let receivedContext: AdapterOperationContext | undefined;
  const adapters = createAdapters({
    async exchange(request, operationContext) {
      requests.push(request);
      receivedContext = operationContext;
      return success(request, { amount: 40, currencyCode: "AUD" });
    }
  });
  const operationContext = context("dispense");

  const result = await adapters.cashDispenser.dispense(
    { amount: 40, currencyCode: "AUD" },
    operationContext
  );

  assert.equal(result.code, "OK");
  assert.deepEqual(requests[0], {
    requestId: "request-1",
    serviceId: "cash-dispenser-1",
    command: "cash-out",
    payload: { amount: 40, currencyCode: "AUD" },
    correlation: {
      operationId: "operation-1",
      sessionId: "session-1",
      transactionName: "CashWithdrawal",
      deadlineAt: "2026-07-27T12:35:26.000Z"
    }
  });
  assert.equal(receivedContext, operationContext);
});

test("device gateway preserves structured device failures", async () => {
  const adapters = createAdapters({
    async exchange(request) {
      return {
        requestId: request.requestId,
        ok: false,
        code: "DISPENSER_JAMMED",
        message: "Cash path is blocked.",
        details: { retractPossible: true }
      };
    }
  });

  const result = await adapters.cashDispenser.dispense({
    amount: 20,
    currencyCode: "AUD"
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "DISPENSER_JAMMED");
  assert.equal(result.details?.retractPossible, true);
});

test("receipt printer validates status and sends bounded lines", async () => {
  const requests: DeviceGatewayRequest[] = [];
  const adapters = createAdapters({
    async exchange(request) {
      requests.push(request);
      if (request.command === "status") {
        return success(request, { health: "HEALTHY", paper: "LOW" });
      }
      return success(request);
    }
  });

  assert.deepEqual(await adapters.receiptPrinter.getStatus(), {
    health: "HEALTHY",
    paper: "LOW"
  });
  assert.equal(
    (await adapters.receiptPrinter.printReceipt(["Cashblocks", "Approved"]))
      .ok,
    true
  );
  assert.deepEqual(requests[1]?.payload, {
    lines: ["Cashblocks", "Approved"]
  });
  await assert.rejects(
    () => adapters.receiptPrinter.printReceipt(["line\nbreak"]),
    /control characters/
  );
  await assert.rejects(
    () => adapters.receiptPrinter.printReceipt(["safe\u001b@cut"]),
    /control characters/
  );
});

test("device gateway rejects mismatched and malformed responses", async () => {
  const mismatched = createAdapters({
    async exchange() {
      return {
        requestId: "another-request",
        ok: true,
        code: "OK",
        message: "Done."
      };
    }
  });
  const malformedStatus = createAdapters({
    async exchange(request) {
      return success(request, { health: "UNKNOWN", paper: "OK" });
    }
  });

  await assert.rejects(
    () => mismatched.cardReader.readCard(),
    DeviceGatewayProtocolError
  );
  await assert.rejects(
    () => malformedStatus.receiptPrinter.getStatus(),
    /valid health and paper/
  );
});

test("device gateway rejects non-JSON response objects", async () => {
  const adapters = createAdapters({
    async exchange(request) {
      return {
        requestId: request.requestId,
        ok: true,
        code: "OK",
        message: "Done.",
        details: { when: new Date() }
      };
    }
  });

  await assert.rejects(
    () => adapters.cardReader.readCard(),
    /details must contain JSON values/
  );
});

test("default request ids are unique across clients", async () => {
  const requestIds: string[] = [];
  const transport: DeviceGatewayTransport = {
    async exchange(request) {
      requestIds.push(request.requestId);
      return success(request);
    }
  };
  const first = createDeviceGatewayAdapters({
    transport,
    bindings: bindings()
  });
  const secondBindings = bindings();
  const second = createDeviceGatewayAdapters({
    transport,
    bindings: secondBindings
  });

  await Promise.all([
    first.cardReader.readCard(),
    second.cardReader.readCard()
  ]);

  assert.equal(requestIds.length, 2);
  assert.notEqual(requestIds[0], requestIds[1]);
  assert.match(requestIds[0] ?? "", /^device-[0-9a-f-]{36}$/);
});

test("device gateway stops aborted operations before transport", async () => {
  let called = false;
  const adapters = createAdapters({
    async exchange(request) {
      called = true;
      return success(request);
    }
  });
  const operationContext = context("readCard");
  const controller = new AbortController();
  controller.abort(new Error("cancelled"));

  await assert.rejects(() =>
    adapters.cardReader.readCard({
      ...operationContext,
      signal: controller.signal
    })
  );
  assert.equal(called, false);
});

test("device gateway validates inputs and binding identity", async () => {
  let called = false;
  const adapters = createAdapters({
    async exchange(request) {
      called = true;
      return success(request);
    }
  });

  await assert.rejects(
    () =>
      adapters.cashAcceptor.accept({
        expectedAmount: 0,
        currencyCode: "AUD"
      }),
    /positive safe integer/
  );
  await assert.rejects(
    () =>
      adapters.cashDispenser.dispense({
        amount: 20,
        currencyCode: "aud"
      }),
    /three uppercase/
  );
  assert.equal(called, false);
  assert.deepEqual(adapters.cardReader.capabilities, [
    "read",
    "chip",
    "contactless"
  ]);
  assert.throws(
    () =>
      createDeviceGatewayAdapters({
        transport: { async exchange() {} },
        bindings: {
          ...bindings(),
          cardReader: {
            adapterId: "printer",
            serviceId: "card-reader-1"
          }
        }
      }),
    /ids must be unique/
  );
});

function createAdapters(transport: DeviceGatewayTransport) {
  let request = 0;
  return createDeviceGatewayAdapters({
    transport,
    bindings: bindings(),
    nextRequestId: () => {
      request += 1;
      return `request-${request}`;
    }
  });
}

function bindings() {
  return {
    receiptPrinter: {
      adapterId: "printer",
      serviceId: "receipt-printer-1"
    },
    cashDispenser: {
      adapterId: "dispenser",
      serviceId: "cash-dispenser-1",
      capabilities: ["finite-inventory"],
      commands: { dispense: "cash-out" }
    },
    cashAcceptor: {
      adapterId: "acceptor",
      serviceId: "cash-acceptor-1",
      capabilities: ["amount-confirmation"]
    },
    cardReader: {
      adapterId: "reader",
      serviceId: "card-reader-1",
      capabilities: ["chip", "contactless"]
    }
  };
}

function success(
  request: DeviceGatewayRequest,
  details?: Record<string, string | number | boolean>
) {
  return {
    requestId: request.requestId,
    ok: true,
    code: "OK",
    message: "Command completed.",
    details
  };
}

function context(operation: string): AdapterOperationContext {
  const controller = new AbortController();
  return {
    operationId: "operation-1",
    sessionId: "session-1",
    adapterId: "dispenser",
    operation,
    transactionName: "CashWithdrawal",
    timeoutMs: 30_000,
    startedAt: "2026-07-27T12:34:56.000Z",
    deadlineAt: "2026-07-27T12:35:26.000Z",
    signal: controller.signal
  };
}
