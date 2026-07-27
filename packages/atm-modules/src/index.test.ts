import assert from "node:assert/strict";
import test from "node:test";

import type { AdapterOperationContext } from "../../runtime-contracts/src/index.js";
import { CashblocksRuntime, MemoryDiagnosticLogger } from "../../runtime-core/src/index.js";
import { createAtmModules } from "./index.js";

test("balance inquiry handler can force balance display", async () => {
  const runtime = new CashblocksRuntime();
  const modules = createAtmModules(runtime);

  modules.BalanceInquiry.AddHandler("OnEndReceiptOption", () => {
    modules.BalanceInquiry.DisplayBalanceOnScreen = true;
  });

  await modules.BalanceInquiry.Execute();

  assert.equal(modules.BalanceInquiry.DisplayBalanceOnScreen, true);
});

test("cash withdrawal journals authorization configuration", async () => {
  const runtime = new CashblocksRuntime();
  const modules = createAtmModules(runtime);

  modules.CashWithdrawal.Authorization.TransactionHost = "CoreHost";
  modules.CashWithdrawal.Authorization.ChipAuthorizationRequired = true;
  await modules.CashWithdrawal.Execute();

  const authorizationEvent = runtime.Journal.all().find(
    (event) => event.type === "host.authorization_requested"
  );
  assert.equal(authorizationEvent?.payload?.host, "CoreHost");
  assert.equal(authorizationEvent?.payload?.chipRequired, true);
});

test("cash withdrawal fails when host adapter declines", async () => {
  const runtime = new CashblocksRuntime({
    simulator: undefined
  });
  const modules = createAtmModules(runtime);

  runtime.Simulator.hostApproved = false;
  const result = await modules.CashWithdrawal.Execute();

  assert.equal(result.ok, false);
  assert.equal(result.code, "HOST_DECLINED");
  assert.equal(
    runtime.Journal.all().some((event) => event.type === "transaction.failed"),
    true
  );
});

test("cash withdrawal logs diagnostic entries when an adapter throws", async () => {
  const logger = new MemoryDiagnosticLogger();
  const runtime = new CashblocksRuntime({ logger });
  const modules = createAtmModules(runtime);
  let receivedContext: AdapterOperationContext | undefined;

  runtime.Adapters.cashDispenser = {
    id: "throwing-dispenser",
    kind: "cash-dispenser",
    capabilities: ["dispense"],
    async dispense(_input, context) {
      receivedContext = context;
      throw new Error("vendor service crashed");
    }
  };

  await assert.rejects(
    () => modules.CashWithdrawal.Execute(),
    /vendor service crashed/
  );

  const entry = logger.all().find((log) => log.source === "adapter");
  assert.equal(entry?.level, "error");
  assert.equal(entry?.metadata?.adapter, "cashDispenser");
  assert.equal(entry?.error?.message, "vendor service crashed");
  assert.equal(entry?.correlation?.sessionId, runtime.SessionId);
  assert.equal(entry?.correlation?.transactionName, "CashWithdrawal");
  assert.equal(receivedContext?.sessionId, runtime.SessionId);
  assert.equal(receivedContext?.adapterId, "throwing-dispenser");
  assert.equal(receivedContext?.operation, "dispense");
  assert.equal(receivedContext?.transactionName, "CashWithdrawal");
  assert.equal(entry?.metadata?.operationId, receivedContext?.operationId);
});

test("customer pin entry fails when card reader is offline", async () => {
  const runtime = new CashblocksRuntime();
  const modules = createAtmModules(runtime);
  runtime.Simulator.cardReaderOnline = false;

  await assert.rejects(
    () => modules.Customer.PinEntry(),
    /Card reader is offline/
  );

  assert.equal(
    runtime.Journal.all().some(
      (event) =>
        event.type === "transaction.failed" &&
        event.payload?.code === "CARD_READER_OFFLINE"
    ),
    true
  );
});

test("card reader exceptions include customer identification correlation", async () => {
  const logger = new MemoryDiagnosticLogger();
  const runtime = new CashblocksRuntime({ logger });
  const modules = createAtmModules(runtime);
  runtime.Adapters.cardReader = {
    id: "throwing-card-reader",
    kind: "card-reader",
    capabilities: ["read"],
    async readCard() {
      throw new Error("reader service crashed");
    }
  };

  await assert.rejects(
    () => modules.Customer.PinEntry(),
    /reader service crashed/
  );

  const entry = logger.all().find(
    (log) => log.metadata?.adapter === "cardReader"
  );
  assert.equal(
    entry?.correlation?.transactionName,
    "CustomerIdentification"
  );
});

test("session and receipt modules use the configured printer adapter", async () => {
  const runtime = new CashblocksRuntime();
  const modules = createAtmModules(runtime);
  let statusContext: AdapterOperationContext | undefined;
  let printContext: AdapterOperationContext | undefined;
  runtime.Adapters.receiptPrinter = {
    id: "configured-printer",
    kind: "receipt-printer",
    capabilities: ["status", "print"],
    async getStatus(context) {
      statusContext = context;
      return { health: "DEGRADED", paper: "OUT" };
    },
    async printReceipt(_lines, context) {
      printContext = context;
      return {
        ok: false,
        code: "PRINTER_UNAVAILABLE",
        message: "Printer is unavailable."
      };
    }
  };

  await modules.CoreSession.RefreshReceiptPrinterStatus();
  await modules.BalanceInquiry.Execute();

  assert.equal(
    runtime.Cashblocks.GetProperty("Devices.ReceiptPrinter.StDeviceStatus"),
    "DEGRADED"
  );
  assert.equal(statusContext?.adapterId, "configured-printer");
  assert.equal(printContext?.adapterId, "configured-printer");
  assert.equal(printContext?.transactionName, "BalanceInquiry");
  assert.equal(modules.BalanceInquiry.DisplayBalanceOnScreen, true);
  assert.equal(
    runtime.Journal.all().some(
      (event) =>
        event.type === "device.status_changed" &&
        event.payload?.code === "PRINTER_UNAVAILABLE"
    ),
    true
  );
});

test("printer status exception degrades the device without aborting the session", async () => {
  const logger = new MemoryDiagnosticLogger();
  const runtime = new CashblocksRuntime({ logger });
  const modules = createAtmModules(runtime);
  runtime.Adapters.receiptPrinter = {
    id: "status-error-printer",
    kind: "receipt-printer",
    capabilities: ["status", "print"],
    async getStatus() {
      throw new Error("status crashed");
    },
    async printReceipt() {
      return { ok: true, code: "PRINTED", message: "Receipt printed." };
    }
  };

  const status = await modules.CoreSession.RefreshReceiptPrinterStatus();

  assert.deepEqual(status, { health: "MISSING", paper: "OUT" });
  assert.equal(
    runtime.Cashblocks.GetProperty("Devices.ReceiptPrinter.StDeviceStatus"),
    "MISSING"
  );
  assert.equal(
    runtime.Journal.all().some(
      (event) =>
        event.type === "device.status_changed" &&
        event.payload?.code === "PRINTER_STATUS_ERROR"
    ),
    true
  );
  assert.equal(
    logger.all().some(
      (entry) =>
        entry.source === "adapter" &&
        entry.error?.message === "status crashed"
    ),
    true
  );
});

test("adapter timeout aborts the operation and returns a structured failure", async () => {
  const logger = new MemoryDiagnosticLogger();
  const runtime = new CashblocksRuntime({
    adapterTimeoutMs: 5,
    logger
  });
  const modules = createAtmModules(runtime);
  let operationSignal: AbortSignal | undefined;
  runtime.Adapters.hostAuthorization = {
    id: "hanging-host",
    kind: "host-authorization",
    capabilities: ["authorize"],
    authorize(_request, context) {
      operationSignal = context?.signal;
      return new Promise((_resolve, reject) => {
        context?.signal.addEventListener("abort", () => {
          reject(new Error("driver aborted"));
        });
      });
    }
  };

  const result = await modules.CashWithdrawal.Execute();

  assert.equal(result.ok, false);
  assert.equal(result.code, "ADAPTER_TIMEOUT");
  assert.equal(operationSignal?.aborted, true);
  assert.equal(
    logger.all().some(
      (entry) =>
        entry.level === "warn" &&
        entry.metadata?.adapterId === "hanging-host"
    ),
    true
  );
});

test("receipt exception after dispense remains a completed withdrawal", async () => {
  const logger = new MemoryDiagnosticLogger();
  const runtime = new CashblocksRuntime({ logger });
  const modules = createAtmModules(runtime);
  runtime.Adapters.receiptPrinter = {
    id: "throwing-printer",
    kind: "receipt-printer",
    capabilities: ["status", "print"],
    async getStatus() {
      return { health: "HEALTHY", paper: "OK" };
    },
    async printReceipt() {
      throw new Error("printer crashed");
    }
  };

  const result = await modules.CashWithdrawal.Execute();

  assert.equal(result.ok, true);
  assert.equal(runtime.Simulator.accounts.Checking, 1140);
  assert.equal(runtime.Simulator.terminalCash, 4900);
  assert.equal(
    runtime.Journal.all().some(
      (event) => event.type === "transaction.completed"
    ),
    true
  );
  assert.equal(
    runtime.Journal.all().some(
      (event) =>
        event.type === "device.status_changed" &&
        event.payload?.code === "RECEIPT_ERROR"
    ),
    true
  );
});

test("cash movement timeout requires reconciliation instead of declaring failure", async () => {
  const runtime = new CashblocksRuntime({ adapterTimeoutMs: 5 });
  const modules = createAtmModules(runtime);
  let operationSignal: AbortSignal | undefined;
  runtime.Adapters.cashDispenser = {
    id: "hanging-dispenser",
    kind: "cash-dispenser",
    capabilities: ["dispense"],
    dispense(_input, context) {
      operationSignal = context?.signal;
      return new Promise((_resolve, reject) => {
        context?.signal.addEventListener("abort", () => {
          reject(new Error("dispense abort acknowledged"));
        });
      });
    }
  };

  const result = await modules.CashWithdrawal.Execute();
  const events = runtime.Journal.all();

  assert.equal(result.ok, false);
  assert.equal(result.code, "ADAPTER_OUTCOME_UNKNOWN");
  assert.equal(operationSignal?.aborted, true);
  assert.equal(
    events.some(
      (event) =>
        event.type === "transaction.reconciliation_required" &&
        event.payload?.code === "ADAPTER_OUTCOME_UNKNOWN"
    ),
    true
  );
  assert.equal(
    events.some(
      (event) =>
        event.type === "transaction.failed" ||
        event.type === "transaction.completed"
    ),
    false
  );
  assert.equal(runtime.Simulator.accounts.Checking, 1240);
  assert.equal(runtime.Simulator.terminalCash, 5000);
});
