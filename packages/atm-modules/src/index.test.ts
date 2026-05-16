import assert from "node:assert/strict";
import test from "node:test";

import { CashblocksRuntime } from "../../runtime-core/src/index.js";
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

  modules.PCCUCashWithdrawal.Authorization.TransactionHost = "PCCUNDCHost";
  modules.PCCUCashWithdrawal.Authorization.ChipAuthorizationRequired = true;
  await modules.PCCUCashWithdrawal.Execute();

  const authorizationEvent = runtime.Journal.all().find(
    (event) => event.type === "host.authorization_requested"
  );
  assert.equal(authorizationEvent?.payload?.host, "PCCUNDCHost");
  assert.equal(authorizationEvent?.payload?.chipRequired, true);
});
