import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import Ajv2020 from "ajv/dist/2020.js";

import {
  XFS4IOT_PIN,
  inspectFixtureCorpus,
  type Xfs4IotMessage
} from "../packages/xfs4iot-client/src/protocol-fixtures.ts";

const fixtureRoot = resolve("fixtures/xfs4iot/2024-03");
const schemaFlag = process.argv.indexOf("--schema");
if (schemaFlag >= 0 && !process.argv[schemaFlag + 1]) {
  throw new Error("--schema requires a file path.");
}

const schemaBytes = schemaFlag >= 0
  ? await readFile(resolve(process.argv[schemaFlag + 1] ?? ""))
  : Buffer.from(await fetchSchema());
verifySchema(schemaBytes);

const schema = JSON.parse(schemaBytes.toString("utf8")) as Record<string, unknown>;
const ajv = new Ajv2020({ allErrors: true, strict: false });
ajv.addFormat("uri", {
  type: "string",
  validate(value: string) {
    try {
      return new URL(value).protocol.length > 1;
    } catch {
      return false;
    }
  }
});
ajv.addFormat("date", /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/);
// The pinned schema declares these XFS4IoT-specific formats without defining
// their lexical rules. They are outside the 0.2 subset and no fixture uses them.
ajv.addFormat("nonce", true);
ajv.addFormat("e2eToken", true);
const validate = ajv.compile(schema);

const validCorpus = JSON.parse(
  await readFile(resolve(fixtureRoot, "valid-messages.json"), "utf8")
) as { fixtures: Array<{ id: string; message: Xfs4IotMessage }> };
const localIssues = inspectFixtureCorpus(validCorpus);
if (localIssues.length > 0) {
  throw new Error(`Local fixture inspection failed:\n${JSON.stringify(localIssues, null, 2)}`);
}

const schemaFailures: string[] = [];
for (const fixture of validCorpus.fixtures) {
  if (!validate(fixture.message)) {
    schemaFailures.push(
      `${fixture.id}: ${ajv.errorsText(validate.errors, { separator: "; " })}`
    );
  }
}
if (schemaFailures.length > 0) {
  throw new Error(`Official schema rejected valid fixtures:\n${schemaFailures.join("\n")}`);
}

const adversarial = JSON.parse(
  await readFile(resolve(fixtureRoot, "adversarial.json"), "utf8")
) as { cases: Array<{ id: string; layer: string; message?: Xfs4IotMessage }> };
for (const fixture of adversarial.cases.filter(({ layer }) => layer === "schema")) {
  if (!fixture.message || validate(fixture.message)) {
    throw new Error(`Official schema unexpectedly accepted ${fixture.id}.`);
  }
}

console.log(
  `Validated ${validCorpus.fixtures.length} XFS4IoT ${XFS4IOT_PIN.publication} fixtures against ${XFS4IOT_PIN.schemaSha256}.`
);

async function fetchSchema(): Promise<ArrayBuffer> {
  const response = await fetch(XFS4IOT_PIN.schemaUrl, {
    headers: { "user-agent": "cashblocks-fixture-validator/0.2" },
    signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) {
    throw new Error(`Schema download failed with HTTP ${response.status}.`);
  }
  return response.arrayBuffer();
}

function verifySchema(bytes: Buffer): void {
  if (bytes.byteLength !== XFS4IOT_PIN.schemaBytes) {
    throw new Error(
      `Schema size mismatch: expected ${XFS4IOT_PIN.schemaBytes}, received ${bytes.byteLength}.`
    );
  }
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== XFS4IOT_PIN.schemaSha256) {
    throw new Error(`Schema SHA-256 mismatch: received ${digest}.`);
  }
}
