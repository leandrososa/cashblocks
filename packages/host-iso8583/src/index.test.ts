import assert from "node:assert/strict";
import test from "node:test";

import type { AdapterOperationContext } from "../../runtime-contracts/src/index.js";
import {
  Iso8583HostAuthorizationAdapter,
  decodeIso8583,
  encodeIso8583,
  type Iso8583Message,
  type Iso8583Transport
} from "./index.js";

test("ISO8583 codec round-trips supported fields and primary bitmap", () => {
  const message: Iso8583Message = {
    mti: "0100",
    fields: {
      2: "4111111111111111",
      3: "010000",
      4: "000000010000",
      7: "0727123456",
      11: "000123",
      41: "ATM00001",
      49: "036"
    }
  };

  const encoded = encodeIso8583(message);

  assert.equal(encoded.slice(0, 4), "0100");
  assert.equal(encoded.slice(4, 20).length, 16);
  assert.deepEqual(decodeIso8583(encoded), message);
});

test("ISO8583 codec rejects unsupported bitmap fields", () => {
  assert.throws(
    () => decodeIso8583("01000000000000000001X"),
    /field 64 is not supported/
  );
});

test("ISO8583 host adapter maps approved and declined responses", async () => {
  const requests: Iso8583Message[] = [];
  const responseCodes = ["00", "51"];
  const transport: Iso8583Transport = {
    async exchange(payload) {
      const request = decodeIso8583(payload);
      requests.push(request);
      return encodeIso8583({
        mti: "0110",
        fields: {
          11: request.fields[11],
          39: responseCodes.shift() ?? "96"
        }
      });
    }
  };
  const adapter = createAdapter(transport);

  const approved = await adapter.authorize(withdrawalRequest(), context());
  const declined = await adapter.authorize(withdrawalRequest(), context());

  assert.equal(approved.code, "HOST_APPROVED");
  assert.equal(declined.code, "HOST_DECLINED");
  assert.equal(declined.details?.responseCode, "51");
  assert.equal(requests[0]?.fields[3], "010000");
  assert.equal(requests[0]?.fields[4], "000000010000");
  assert.equal(requests[0]?.fields[41], "ATM00001");
  assert.equal(requests[0]?.fields[49], "036");
});

test("ISO8583 host adapter passes abortable context to transport", async () => {
  let receivedContext: AdapterOperationContext | undefined;
  const transport: Iso8583Transport = {
    async exchange(payload, operationContext) {
      receivedContext = operationContext;
      const request = decodeIso8583(payload);
      return encodeIso8583({
        mti: "0110",
        fields: { 11: request.fields[11], 39: "00" }
      });
    }
  };
  const operationContext = context();

  await createAdapter(transport).authorize(
    withdrawalRequest(),
    operationContext
  );

  assert.equal(receivedContext?.operationId, operationContext.operationId);
  assert.equal(receivedContext?.signal, operationContext.signal);
});

test("ISO8583 host adapter rejects malformed or mismatched responses", async () => {
  const malformed = createAdapter({
    async exchange() {
      return "not-iso8583";
    }
  });
  const mismatch = createAdapter({
    async exchange() {
      return encodeIso8583({
        mti: "0110",
        fields: { 11: "999999", 39: "00" }
      });
    }
  });

  assert.equal(
    (await malformed.authorize(withdrawalRequest(), context())).code,
    "HOST_PROTOCOL_ERROR"
  );
  assert.equal(
    (await mismatch.authorize(withdrawalRequest(), context())).code,
    "HOST_PROTOCOL_ERROR"
  );
});

test("ISO8583 host adapter converts decimal amounts to exact minor units", async () => {
  let amountField: string | undefined;
  const adapter = createAdapter({
    async exchange(payload) {
      const request = decodeIso8583(payload);
      amountField = request.fields[4];
      return encodeIso8583({
        mti: "0110",
        fields: { 11: request.fields[11], 39: "00" }
      });
    }
  });

  await adapter.authorize(
    { ...withdrawalRequest(), amount: 0.29 },
    context()
  );

  assert.equal(amountField, "000000000029");
  await adapter.authorize(
    { ...withdrawalRequest(), amount: 0.1 + 0.2 },
    context()
  );
  assert.equal(amountField, "000000000030");
  await assert.rejects(
    () =>
      adapter.authorize(
        { ...withdrawalRequest(), amount: 0.291 },
        context()
      ),
    /more than 2 decimal places/
  );
  await assert.rejects(
    () =>
      adapter.authorize(
        { ...withdrawalRequest(), amount: 9_999_999_999.990005 },
        context()
      ),
    /more than 2 decimal places/
  );
});

test("ISO8583 host adapter applies minor-unit scales per currency", async () => {
  let requestMessage: Iso8583Message | undefined;
  const adapter = new Iso8583HostAuthorizationAdapter({
    terminalId: "ATM00001",
    transport: {
      async exchange(payload) {
        requestMessage = decodeIso8583(payload);
        return encodeIso8583({
          mti: "0110",
          fields: { 11: requestMessage.fields[11], 39: "00" }
        });
      }
    },
    currencyNumericCodes: { AUD: "036", JPY: "392" },
    minorUnitScales: { AUD: 100, JPY: 1 },
    now: () => new Date("2026-07-27T12:34:56.000Z"),
    nextTrace: () => 123
  });

  await adapter.authorize(
    { ...withdrawalRequest(), amount: 100, currencyCode: "JPY" },
    context()
  );

  assert.equal(requestMessage?.fields[4], "000000000100");
  assert.equal(requestMessage?.fields[49], "392");
});

test("ISO8583 host adapter fails closed for unknown transactions", async () => {
  const adapter = createAdapter({
    async exchange() {
      throw new Error("transport must not be called");
    }
  });

  await assert.rejects(
    () =>
      adapter.authorize(
        { ...withdrawalRequest(), transaction: "CashWithdrawl" },
        context()
      ),
    /No ISO8583 processing code configured/
  );
});

test("ISO8583 host adapter separates declines from retryable and unknown responses", async () => {
  const responseCodes = ["51", "91", "97"];
  const adapter = createAdapter({
    async exchange(payload) {
      const request = decodeIso8583(payload);
      return encodeIso8583({
        mti: "0110",
        fields: {
          11: request.fields[11],
          39: responseCodes.shift() ?? "97"
        }
      });
    }
  });

  const declined = await adapter.authorize(withdrawalRequest(), context());
  const retryable = await adapter.authorize(withdrawalRequest(), context());
  const unknown = await adapter.authorize(withdrawalRequest(), context());

  assert.equal(declined.code, "HOST_DECLINED");
  assert.equal(retryable.code, "HOST_UNAVAILABLE");
  assert.equal(retryable.details?.retryable, true);
  assert.equal(unknown.code, "HOST_RESPONSE_ERROR");
  assert.equal(unknown.details?.category, "error");
});

function createAdapter(
  transport: Iso8583Transport
): Iso8583HostAuthorizationAdapter {
  let trace = 122;
  return new Iso8583HostAuthorizationAdapter({
    terminalId: "ATM00001",
    transport,
    currencyNumericCodes: { AUD: "036" },
    minorUnitScales: { AUD: 100 },
    now: () => new Date("2026-07-27T12:34:56.000Z"),
    nextTrace: () => {
      trace += 1;
      return trace;
    }
  });
}

function withdrawalRequest() {
  return {
    transaction: "CashWithdrawal",
    host: "CoreHost",
    account: "Checking",
    amount: 100,
    currencyCode: "AUD",
    pinless: false,
    chipRequired: true
  };
}

function context(): AdapterOperationContext {
  const controller = new AbortController();
  return {
    operationId: "operation-1",
    sessionId: "session-1",
    adapterId: "iso8583-host",
    operation: "authorize",
    transactionName: "CashWithdrawal",
    timeoutMs: 30_000,
    startedAt: "2026-07-27T12:34:56.000Z",
    deadlineAt: "2026-07-27T12:35:26.000Z",
    signal: controller.signal
  };
}
