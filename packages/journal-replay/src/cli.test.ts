import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

test("journal replay CLI filters sessions and reports validation exit status", async () => {
  const root = await mkdtemp(join(tmpdir(), "cashblocks-replay-cli-"));
  const validPath = join(root, "valid.jsonl");
  const invalidPath = join(root, "invalid.jsonl");
  await writeFile(
    validPath,
    [
      JSON.stringify({
        seq: 1,
        type: "runtime.started",
        ts: "2026-07-27T12:34:54.000Z",
        source: "runtime"
      }),
      JSON.stringify({
        seq: 2,
        type: "flow.loaded",
        ts: "2026-07-27T12:34:55.000Z",
        source: "runtime",
        sessionId: "session-a",
        payload: { entrypoint: "flow.js" }
      }),
      JSON.stringify({
        seq: 3,
        type: "session.started",
        ts: "2026-07-27T12:34:56.000Z",
        source: "module",
        sessionId: "session-a"
      }),
      JSON.stringify({
        seq: 4,
        type: "transaction.completed",
        ts: "2026-07-27T12:34:57.000Z",
        source: "module",
        sessionId: "session-a",
        payload: { transaction: "BalanceInquiry" }
      })
    ].join("\n"),
    "utf8"
  );
  await writeFile(invalidPath, "{bad-json\n", "utf8");

  try {
    const valid = runCli(validPath, "--session", "session-a", "--frames");
    assert.equal(valid.status, 0, valid.stderr);
    const output = JSON.parse(valid.stdout) as {
      sessions: Array<{ sessionId: string; frames: unknown[] }>;
    };
    assert.equal(output.sessions[0]?.sessionId, "session-a");
    assert.equal(output.sessions[0]?.frames.length, 3);

    const invalid = runCli(invalidPath);
    assert.equal(invalid.status, 2, invalid.stderr);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function runCli(...arguments_: string[]) {
  return spawnSync(
    process.execPath,
    [resolve("packages/journal-replay/src/cli.ts"), ...arguments_],
    {
      cwd: process.cwd(),
      encoding: "utf8"
    }
  );
}
