import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  parseNativeTerminalConfig,
  prepareNativeTerminal
} from "./config.js";

test("native terminal defaults to loopback and durable local journal", () => {
  const config = parseNativeTerminalConfig([], {}, "C:\\cashblocks");

  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.port, 4174);
  assert.equal(config.allowRemote, false);
  assert.equal(config.origin, "http://127.0.0.1:4174");
  assert.match(config.publicDir, /apps[\\/]customer-terminal[\\/]public$/);
  assert.match(config.journalPath, /data[\\/]native-terminal\.journal\.jsonl$/);
});

test("native terminal rejects remote binding without explicit opt-in", () => {
  assert.throws(
    () => parseNativeTerminalConfig(["--host", "0.0.0.0"], {}, "."),
    /Refusing non-loopback/
  );
  assert.throws(
    () =>
      parseNativeTerminalConfig(
        ["--host", "0.0.0.0", "--allow-remote"],
        {},
        "."
      ),
    /requires --origin/
  );
  assert.equal(
    parseNativeTerminalConfig(
      [
        "--host",
        "0.0.0.0",
        "--allow-remote",
        "--origin",
        "https://terminal.example"
      ],
      {},
      "."
    ).origin,
    "https://terminal.example"
  );
});

test("native terminal validates ports and command line options", () => {
  assert.throws(
    () => parseNativeTerminalConfig(["--port", "0"], {}, "."),
    /between 1 and 65535/
  );
  assert.throws(
    () => parseNativeTerminalConfig(["--unknown"], {}, "."),
    /Unknown/
  );
  assert.throws(
    () => parseNativeTerminalConfig(["--journal"], {}, "."),
    /requires a value/
  );
});

test("native terminal preflight requires assets and prepares journal directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "cashblocks-native-"));
  const publicDir = join(root, "public");
  const config = parseNativeTerminalConfig(
    [
      "--public-dir",
      publicDir,
      "--journal",
      join(root, "journal", "events.jsonl")
    ],
    {},
    root
  );

  await assert.rejects(() => prepareNativeTerminal(config));
  await mkdir(publicDir, { recursive: true });
  await Promise.all(
    ["index.html", "app.js", "style.css"].map((asset) =>
      writeFile(join(publicDir, asset), asset, "utf8")
    )
  );
  await prepareNativeTerminal(config);
  await rm(root, { recursive: true, force: true });
});

test("native terminal preflight rejects directories masquerading as assets", async () => {
  const root = await mkdtemp(join(tmpdir(), "cashblocks-native-"));
  const publicDir = join(root, "public");
  await mkdir(publicDir);
  await Promise.all(
    ["index.html", "app.js", "style.css"].map((asset) =>
      mkdir(join(publicDir, asset))
    )
  );
  const config = parseNativeTerminalConfig(
    ["--public-dir", publicDir, "--journal", join(root, "events.jsonl")],
    {},
    root
  );

  try {
    await assert.rejects(() => prepareNativeTerminal(config), /must be a file/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
