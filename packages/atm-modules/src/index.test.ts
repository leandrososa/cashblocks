import assert from "node:assert/strict";
import test from "node:test";

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

  runtime.Adapters.cashDispenser = {
    id: "throwing-dispenser",
    async dispense() {
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
