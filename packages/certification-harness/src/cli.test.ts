import assert from "node:assert/strict";
import test from "node:test";

import { runCertificationCli } from "./cli.js";

test("certification CLI exposes help and rejects unknown options", async () => {
  let output = "";
  let errors = "";
  assert.equal(
    await runCertificationCli(
      ["--help"],
      (text) => {
        output += text;
      },
      (text) => {
        errors += text;
      }
    ),
    0
  );
  assert.match(output, /Usage:/);
  assert.equal(errors, "");

  assert.equal(
    await runCertificationCli(
      ["--unknown"],
      (text) => {
        output += text;
      },
      (text) => {
        errors += text;
      }
    ),
    2
  );
  assert.match(errors, /Unknown option/);
});
