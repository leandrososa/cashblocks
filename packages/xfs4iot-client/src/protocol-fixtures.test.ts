import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import {
  XFS4IOT_LIMITS,
  XFS4IOT_SUPPORTED_MESSAGES,
  inspectFixtureCorpus,
  inspectFixtureMessage
} from "./protocol-fixtures.js";

const fixtureRoot = resolve("fixtures/xfs4iot/2024-03");

test("valid XFS4IoT fixtures cover every supported command and completion", async () => {
  const corpus = JSON.parse(
    await readFile(resolve(fixtureRoot, "valid-messages.json"), "utf8")
  ) as {
    fixtures: Array<{ message: { header: { name: string; type: string } } }>;
  };

  assert.deepEqual(inspectFixtureCorpus(corpus), []);
  const covered = new Set(
    corpus.fixtures.map(
      ({ message }) => `${message.header.type}:${message.header.name}`
    )
  );
  for (const [name, types] of Object.entries(XFS4IOT_SUPPORTED_MESSAGES)) {
    for (const type of Object.keys(types)) {
      assert.equal(
        covered.has(`${type}:${name}`),
        true,
        `Missing ${type} fixture for ${name}`
      );
    }
  }
});

test("adversarial fixture corpus covers required failure classes", async () => {
  const corpus = JSON.parse(
    await readFile(resolve(fixtureRoot, "adversarial.json"), "utf8")
  ) as {
    cases: Array<{ id: string; layer: string; expectedIssue?: string; message?: unknown }>;
  };
  const required = new Set([
    "malformed-message",
    "mismatched-request",
    "unsupported-command",
    "command-timeout",
    "pre-send-disconnect",
    "post-send-disconnect"
  ]);

  assert.deepEqual(new Set(corpus.cases.map(({ id }) => id)), required);
  const malformed = corpus.cases.find(({ id }) => id === "malformed-message");
  const unsupported = corpus.cases.find(({ id }) => id === "unsupported-command");
  const mismatched = corpus.cases.find(({ id }) => id === "mismatched-request") as
    | {
        sent?: { header?: { requestId?: number } };
        received?: { header?: { requestId?: number } };
      }
    | undefined;
  const preSend = corpus.cases.find(({ id }) => id === "pre-send-disconnect") as
    | { failurePoint?: string; expectedClassification?: string }
    | undefined;
  const postSend = corpus.cases.find(({ id }) => id === "post-send-disconnect") as
    | { failurePoint?: string; expectedClassification?: string }
    | undefined;
  assert.equal(
    inspectFixtureMessage(malformed?.message).some(
      ({ code }) => code === "ENVELOPE_INVALID"
    ),
    true
  );
  assert.notEqual(
    mismatched?.sent?.header?.requestId,
    mismatched?.received?.header?.requestId
  );
  assert.deepEqual(
    [preSend?.failurePoint, preSend?.expectedClassification],
    ["before-send", "safe-to-retry"]
  );
  assert.deepEqual(
    [postSend?.failurePoint, postSend?.expectedClassification],
    ["after-send-before-completion", "indeterminate"]
  );
  assert.equal(
    inspectFixtureMessage(unsupported?.message).some(
      ({ code }) => code === "UNSUPPORTED_MESSAGE"
    ),
    true
  );
});

test("fixture inspection rejects sensitive data and oversized messages", () => {
  const base = {
    header: {
      type: "command",
      name: "CardReader.ReadRawData",
      version: "2.0",
      requestId: 1
    }
  };

  assert.equal(
    inspectFixtureMessage({ ...base, payload: { pan: "synthetic" } }).some(
      ({ code }) => code === "SENSITIVE_TEST_DATA"
    ),
    true
  );
  assert.equal(
    inspectFixtureMessage({
      ...base,
      payload: { padding: "x".repeat(XFS4IOT_LIMITS.maxMessageBytes) }
    }).some(({ code }) => code === "MESSAGE_TOO_LARGE"),
    true
  );
});

test("protocol limits are finite, bounded, and shared with fixtures", async () => {
  const fixtureLimits = JSON.parse(
    await readFile(resolve(fixtureRoot, "limits.json"), "utf8")
  );

  assert.deepEqual(fixtureLimits, XFS4IOT_LIMITS);
  assert.equal(XFS4IOT_LIMITS.maxMessageBytes, 256 * 1024);
  assert.equal(XFS4IOT_LIMITS.maxPendingRequests <= 32, true);
  assert.equal(XFS4IOT_LIMITS.maxEventBacklog <= 256, true);
  assert.equal(XFS4IOT_LIMITS.maxReconnectAttempts <= 5, true);
  assert.equal(
    XFS4IOT_LIMITS.reconnectBaseDelayMs <= XFS4IOT_LIMITS.reconnectMaxDelayMs,
    true
  );
  assert.equal(
    Math.max(...Object.values(XFS4IOT_LIMITS.commandDeadlinesMs)) <=
      XFS4IOT_LIMITS.reconnectWindowMs,
    true
  );
});
