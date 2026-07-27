import assert from "node:assert/strict";
import test from "node:test";
import {
  appendFile,
  mkdtemp,
  readFile,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { AdapterOperationContext } from "../../runtime-contracts/src/index.js";
import {
  JsonlReversalStore,
  ReversalProcessor,
  type ReversalIntent
} from "./reversal-store.js";

test("reversal store persists idempotent intents and lifecycle", async () => {
  const path = await storePath();
  const store = createStore(path);
  const queued = await store.enqueue(intent("reversal-1"));
  assert.equal(queued.attempts, 0);
  assert.deepEqual(await store.enqueue(intent("reversal-1")), queued);
  await assert.rejects(
    () =>
      store.enqueue({
        ...intent("reversal-1"),
        amountMinor: 200
      }),
    /different data/
  );

  await store.beginAttempt("reversal-1");
  await store.markFailed(
    "reversal-1",
    "host unavailable for 4111111111111111"
  );
  const restarted = createStore(path);
  const pending = await restarted.pending();
  assert.equal(pending[0]?.attempts, 1);
  assert.equal(pending[0]?.lastError, "host unavailable for [redacted]");
  await restarted.markCompleted("reversal-1");
  assert.deepEqual(await restarted.pending(), []);
  await restarted.markCompleted("reversal-1");
  await assert.rejects(
    () => restarted.markFailed("reversal-1", "late"),
    /already completed/
  );
});

test("reversal store coordinates instances, repairs crash tails, and rejects extras", async () => {
  const path = await storePath();
  const first = createStore(path);
  const second = createStore(path);
  await Promise.all([
    first.enqueue(intent("shared")),
    second.enqueue(intent("shared"))
  ]);
  assert.equal((await first.pending()).length, 1);
  await appendFile(path, '{"type":"partial"', "utf8");
  assert.equal((await second.pending()).length, 1);
  assert.throws(
    () =>
      first.enqueue({
        ...intent("sensitive"),
        pan: "4111111111111111"
      } as ReversalIntent),
    /invalid/
  );
});

test("reversal store creates its parent directory on first use", async () => {
  const root = dirname(await storePath());
  const path = join(root, "nested", "reversals.jsonl");
  const store = createStore(path);
  await store.enqueue(intent("nested"));
  assert.equal((await store.pending())[0]?.id, "nested");
});

test("reversal store preserves a complete final event without a newline", async () => {
  const path = await storePath();
  const store = createStore(path);
  await store.enqueue(intent("complete-tail"));
  const text = await readFile(path, "utf8");
  await writeFile(path, text.trimEnd(), "utf8");

  assert.equal((await store.pending())[0]?.id, "complete-tail");
  assert.equal((await readFile(path, "utf8")).endsWith("\n"), true);
});

test("reversal tail repair rejects symlinks without modifying their target", async () => {
  const directory = dirname(await storePath());
  const target = join(directory, "target.txt");
  const path = join(directory, "reversals.jsonl");
  await writeFile(target, "do-not-change", "utf8");
  try {
    await symlink(target, path, "file");
  } catch (error) {
    if (hasCode(error, "EPERM")) {
      assert.equal(await readFile(target, "utf8"), "do-not-change");
      return;
    }
    throw error;
  }

  await assert.rejects(() => createStore(path).pending(), /regular file/);
  assert.equal(await readFile(target, "utf8"), "do-not-change");
});

test("reversal processor records success and retryable failure", async () => {
  const path = await storePath();
  const store = createStore(path);
  await store.enqueue(intent("ok"));
  await store.enqueue(intent("fail"));
  const sent: string[] = [];
  const processor = new ReversalProcessor({
    store,
    transport: {
      async exchange(message) {
        sent.push(message);
        if (message.includes("fail")) throw new Error("network down");
        return "ACK";
      }
    },
    buildMessage: (entry) => `REVERSAL:${entry.id}`,
    acceptResponse: (_entry, response) => response === "ACK"
  });

  assert.deepEqual(await processor.process(), {
    attempted: 2,
    completed: 1,
    failed: 1
  });
  assert.deepEqual(sent, ["REVERSAL:ok", "REVERSAL:fail"]);
  const remaining = await store.pending();
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0]?.id, "fail");
  assert.equal(remaining[0]?.attempts, 1);
  assert.equal(remaining[0]?.lastError, "network down");
});

test("concurrent reversal processors do not double-send", async () => {
  const path = await storePath();
  const store = createStore(path);
  await store.enqueue(intent("once"));
  let sends = 0;
  const processor = new ReversalProcessor({
    store,
    transport: {
      async exchange() {
        sends += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return "ACK";
      }
    },
    buildMessage: () => "REVERSAL",
    acceptResponse: () => true
  });
  await Promise.all([processor.process(), processor.process()]);
  assert.equal(sends, 1);
});

test("reversal processor records an aborted attempt and propagates cancellation", async () => {
  const path = await storePath();
  const store = createStore(path);
  await store.enqueue(intent("aborted"));
  const controller = new AbortController();
  const processor = new ReversalProcessor({
    store,
    transport: {
      async exchange() {
        controller.abort(new Error("operator cancelled"));
        throw controller.signal.reason;
      }
    },
    buildMessage: () => "REVERSAL",
    acceptResponse: () => true
  });

  await assert.rejects(
    () => processor.process(operationContext(controller.signal)),
    /operator cancelled/
  );
  const [remaining] = await store.pending();
  assert.equal(remaining?.attempts, 1);
  assert.equal(remaining?.lastError, "operator cancelled");
});

test("reversal processor rejects a pre-aborted empty batch", async () => {
  const store = createStore(await storePath());
  const controller = new AbortController();
  controller.abort(new Error("already cancelled"));
  const processor = new ReversalProcessor({
    store,
    transport: { async exchange() { return "ACK"; } },
    buildMessage: () => "REVERSAL",
    acceptResponse: () => true
  });

  await assert.rejects(
    () => processor.process(operationContext(controller.signal)),
    /already cancelled/
  );
});

function intent(id: string): ReversalIntent {
  return {
    id,
    transaction: "CashWithdrawal",
    originalTrace: "000123",
    amountMinor: 100,
    currencyNumericCode: "036",
    terminalId: "ATM00001",
    transmissionDateTime: "0727123456",
    reason: "cash_dispense_outcome_unknown"
  };
}

async function storePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "cashblocks-reversal-"));
  return join(directory, "reversals.jsonl");
}

function createStore(path: string): JsonlReversalStore {
  let tick = 0;
  return new JsonlReversalStore({
    path,
    now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++))
  });
}

function operationContext(signal: AbortSignal): AdapterOperationContext {
  return {
    operationId: "operation-1",
    sessionId: "session-1",
    adapterId: "iso-host",
    operation: "reverse",
    transactionName: "CashWithdrawal",
    timeoutMs: 30_000,
    startedAt: "2026-07-27T12:00:00.000Z",
    deadlineAt: "2026-07-27T12:00:30.000Z",
    signal
  };
}

function hasCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}
