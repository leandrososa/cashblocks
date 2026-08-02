import assert from "node:assert/strict";
import test from "node:test";

import { defineFlow, type FlowModule } from "../../flow-sdk/src/index.js";
import type { FlowPackage, RuntimeEvent } from "../../runtime-contracts/src/index.js";
import {
  TerminalSessionManager,
  type InteractiveSession
} from "./index.js";

const flowPackage: FlowPackage = {
  id: "test.interactive-session",
  version: "1.0.0",
  entrypoint: "src/flow.ts",
  capabilities: []
};

test("validates PIN answers and keeps the prompt pending after invalid input", async () => {
  const manager = createManager(
    defineFlow(({ Customer }) => ({
      async OnIdle() {
        await Customer.PinEntry();
      }
    }))
  );
  const session = manager.start({});
  const prompt = await currentPrompt(manager, session);

  assert.equal(prompt.kind, "pin");
  assert.equal(manager.answer(answerFor(session.id, prompt.id, "123")), "invalid");
  assert.equal(manager.answer(answerFor(session.id, prompt.id, "12a4")), "invalid");
  assert.equal(session.interaction.current()?.id, prompt.id);
  assert.equal(manager.answer(answerFor(session.id, prompt.id, "1234")), "accepted");
  assert.equal(manager.answer(answerFor(session.id, prompt.id, "1234")), "stale");
  assert.equal((await session.resultPromise).ok, true);
});

test("accepts only values offered by selection prompts", async () => {
  const manager = createManager(
    defineFlow(({ Customer }) => ({
      async OnIdle() {
        await Customer.SelectTransaction();
        await Customer.SelectAccount(["Checking", "Savings"]);
        await Customer.SelectOption("Confirmation", "YES,NO");
      }
    }))
  );
  const session = manager.start({});
  let prompt = await currentPrompt(manager, session);

  assert.equal(prompt.kind, "transaction");
  assert.equal(manager.answer(answerFor(session.id, prompt.id, "Unknown")), "invalid");
  assert.equal(
    manager.answer(answerFor(session.id, prompt.id, "BalanceInquiry")),
    "accepted"
  );

  prompt = await currentPrompt(manager, session);
  assert.equal(prompt.kind, "account");
  assert.equal(manager.answer(answerFor(session.id, prompt.id, "Credit")), "invalid");
  assert.equal(manager.answer(answerFor(session.id, prompt.id, "Savings")), "accepted");

  prompt = await currentPrompt(manager, session);
  assert.equal(prompt.kind, "option");
  assert.equal(manager.answer(answerFor(session.id, prompt.id, "yes")), "invalid");
  assert.equal(manager.answer(answerFor(session.id, prompt.id, "MAYBE")), "invalid");
  assert.equal(manager.answer(answerFor(session.id, prompt.id, "YES")), "accepted");
  assert.equal((await session.resultPromise).ok, true);
});

test("validates preset amounts as positive safe integers", async () => {
  const manager = createManager(
    defineFlow(({ Customer }) => ({
      async OnIdle() {
        await Customer.SelectAmount({
          prompt: "Select amount",
          currencyCode: "AUD",
          presets: [20, 50],
          allowCustom: false
        });
      }
    }))
  );
  const session = manager.start({});
  const prompt = await currentPrompt(manager, session);

  assert.equal(prompt.kind, "amount");
  for (const invalid of ["0", "20.5", "30", "9007199254740992"]) {
    assert.equal(manager.answer(answerFor(session.id, prompt.id, invalid)), "invalid");
  }
  assert.equal(manager.answer(answerFor(session.id, prompt.id, "50")), "accepted");
  assert.equal((await session.resultPromise).ok, true);
});

test("allows a positive safe custom amount when the prompt opts in", async () => {
  const manager = createManager(
    defineFlow(({ Customer }) => ({
      async OnIdle() {
        await Customer.SelectAmount({
          prompt: "Enter amount",
          currencyCode: "AUD",
          presets: [20, 50],
          allowCustom: true
        });
      }
    }))
  );
  const session = manager.start({});
  const prompt = await currentPrompt(manager, session);

  assert.equal(manager.answer(answerFor(session.id, prompt.id, "30")), "accepted");
  assert.equal((await session.resultPromise).ok, true);
});

test("reports missing sessions and mismatched prompt ids as stale", async () => {
  const manager = createManager(
    defineFlow(({ Customer }) => ({
      async OnIdle() {
        await Customer.SelectTransaction();
      }
    }))
  );
  const session = manager.start({});
  const prompt = await currentPrompt(manager, session);

  assert.equal(manager.answer(answerFor("missing", prompt.id, "BalanceInquiry")), "stale");
  assert.equal(manager.answer(answerFor(session.id, "old-prompt", "BalanceInquiry")), "stale");
  assert.equal(
    manager.answer(answerFor(session.id, prompt.id, "BalanceInquiry")),
    "accepted"
  );
  assert.equal((await session.resultPromise).ok, true);
});

test("expiring a session rejects its pending prompt and settles the flow", { timeout: 1_000 }, async () => {
  let now = 0;
  const manager = createManager(
    defineFlow(({ Customer }) => ({
      async OnIdle() {
        await Customer.SelectTransaction();
      }
    })),
    { now: () => now, sessionTtlMs: 10 }
  );
  const session = manager.start({});
  const prompt = await currentPrompt(manager, session);

  now = 10;
  assert.equal(manager.pruneExpired(), 1);
  assert.equal(session.interaction.current(), undefined);
  assert.equal(manager.answer(answerFor(session.id, prompt.id, "BalanceInquiry")), "stale");

  const result = await session.resultPromise;
  assert.equal(result.ok, false);
  assert.equal(result.error?.phase, "OnIdle");
  assert.match(result.error?.message ?? "", /has expired/);
});

function createManager(
  flow: FlowModule,
  options: { now?: () => number; sessionTtlMs?: number } = {}
): TerminalSessionManager<{ ok: boolean }> {
  return new TerminalSessionManager({
    flow,
    flowPackage,
    summarizeEvents: (_events: RuntimeEvent[], ok: boolean) => ({ ok }),
    ...options
  });
}

async function currentPrompt(
  manager: TerminalSessionManager<{ ok: boolean }>,
  session: InteractiveSession
) {
  const state = await manager.state(session);
  assert.ok(state.prompt);
  return state.prompt;
}

function answerFor(sessionId: string, promptId: string, value: string) {
  return { sessionId, promptId, value };
}
