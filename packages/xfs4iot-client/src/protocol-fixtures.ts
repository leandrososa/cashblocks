export const XFS4IOT_PIN = Object.freeze({
  publication: "2024-03",
  commit: "263591f189c3045296396bafcc52425a867fae09",
  schemaUrl:
    "https://raw.githubusercontent.com/XFS4IoT/Specifications-Preview.github.io/263591f189c3045296396bafcc52425a867fae09/2024-03/Schema_2024-03.json",
  schemaBytes: 1_169_223,
  schemaSha256:
    "6f164b34e37c46a9890d4f4e9ea2fed3b3abb50999bb3a914a026a72df0cd952"
});

export const XFS4IOT_LIMITS = Object.freeze({
  maxMessageBytes: 256 * 1024,
  maxPendingRequests: 32,
  maxEventBacklog: 256,
  maxReconnectAttempts: 5,
  reconnectBaseDelayMs: 250,
  reconnectMaxDelayMs: 4_000,
  reconnectWindowMs: 30_000,
  defaultCommandDeadlineMs: 10_000,
  commandDeadlinesMs: Object.freeze({
    "ServicePublisher.GetServices": 5_000,
    "Common.Status": 5_000,
    "Common.Capabilities": 5_000,
    "Common.SetVersions": 5_000,
    "Common.SetTransactionState": 5_000,
    "Common.Cancel": 5_000,
    "CardReader.ReadRawData": 30_000,
    "CardReader.Move": 15_000,
    "CashDispenser.Dispense": 30_000,
    "CashDispenser.Present": 15_000,
    "CashDispenser.GetPresentStatus": 5_000,
    "CashManagement.Retract": 20_000
  })
});

export const XFS4IOT_SUPPORTED_MESSAGES = Object.freeze({
  "ServicePublisher.GetServices": Object.freeze({
    command: "2.0",
    completion: "2.0"
  }),
  "ServicePublisher.ServiceDetailEvent": Object.freeze({ event: "2.0" }),
  "Common.Status": Object.freeze({ command: "3.0", completion: "3.0" }),
  "Common.Capabilities": Object.freeze({ command: "3.0", completion: "3.0" }),
  "Common.SetVersions": Object.freeze({ command: "2.0", completion: "2.0" }),
  "Common.SetTransactionState": Object.freeze({
    command: "2.0",
    completion: "2.0"
  }),
  "Common.Cancel": Object.freeze({ command: "2.0", completion: "2.0" }),
  "Common.StatusChangedEvent": Object.freeze({ unsolicited: "3.0" }),
  "Common.ErrorEvent": Object.freeze({
    event: "2.0",
    unsolicited: "2.0"
  }),
  "CardReader.ReadRawData": Object.freeze({
    command: "2.0",
    completion: "3.0"
  }),
  "CardReader.InsertCardEvent": Object.freeze({ event: "2.0" }),
  "CardReader.MediaInsertedEvent": Object.freeze({ event: "2.0" }),
  "CardReader.InvalidMediaEvent": Object.freeze({ event: "2.0" }),
  "CardReader.TrackDetectedEvent": Object.freeze({ event: "2.0" }),
  "CardReader.Move": Object.freeze({ command: "2.0", completion: "2.0" }),
  "CardReader.MediaRemovedEvent": Object.freeze({ event: "2.0" }),
  "CashDispenser.Dispense": Object.freeze({
    command: "3.0",
    completion: "3.0"
  }),
  "CashDispenser.Present": Object.freeze({
    command: "2.0",
    completion: "2.0"
  }),
  "CashDispenser.GetPresentStatus": Object.freeze({
    command: "2.0",
    completion: "3.0"
  }),
  "CashDispenser.DelayedDispenseEvent": Object.freeze({ event: "2.0" }),
  "CashDispenser.StartDispenseEvent": Object.freeze({ event: "2.0" }),
  "CashDispenser.IncompleteDispenseEvent": Object.freeze({ event: "3.0" }),
  "CashManagement.ItemsPresentedEvent": Object.freeze({ unsolicited: "2.0" }),
  "CashManagement.ItemsTakenEvent": Object.freeze({ unsolicited: "2.0" }),
  "CashManagement.Retract": Object.freeze({
    command: "2.0",
    completion: "2.0"
  }),
  "CashManagement.IncompleteRetractEvent": Object.freeze({ event: "2.0" })
});

type MessageType =
  | "command"
  | "acknowledge"
  | "event"
  | "completion"
  | "unsolicited";

export type Xfs4IotMessage = {
  header: {
    type: MessageType;
    name: string;
    version: string;
    requestId?: number;
    timeout?: number;
    status?: string | null;
    completionCode?: string | null;
  };
  payload?: unknown;
};

export type FixtureEntry = {
  id: string;
  role: "command" | "acknowledge" | "completion" | "event" | "error";
  message: Xfs4IotMessage;
};

export type FixtureCorpus = {
  publication: string;
  fixtures: FixtureEntry[];
};

export type FixtureIssue = {
  code:
    | "CORPUS_INVALID"
    | "DUPLICATE_FIXTURE_ID"
    | "ENVELOPE_INVALID"
    | "MESSAGE_TOO_LARGE"
    | "SENSITIVE_TEST_DATA"
    | "UNSUPPORTED_MESSAGE"
    | "UNSUPPORTED_VERSION";
  fixtureId?: string;
  message: string;
};

const fixtureIdPattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const protocolVersionPattern = /^[1-9][0-9]*\.(?:[1-9][0-9]*|0)$/;
const forbiddenKeys = new Set([
  "accountnumber",
  "cardholdername",
  "credential",
  "cryptographickey",
  "hostendpoint",
  "pan",
  "pin",
  "pinblock",
  "trackdata",
  "vendorcredential"
]);
const possiblePanPattern = /(?:^|\D)\d{13,19}(?:\D|$)/;
const magneticStripePattern = /(?:^|[^A-Za-z0-9])[;%][A-Z0-9]{6,}[?=]/i;

export function inspectFixtureCorpus(value: unknown): FixtureIssue[] {
  if (!isRecord(value) || !Array.isArray(value.fixtures)) {
    return [
      {
        code: "CORPUS_INVALID",
        message: "Fixture corpus must be an object with a fixtures array."
      }
    ];
  }

  const issues: FixtureIssue[] = [];
  if (value.publication !== XFS4IOT_PIN.publication) {
    issues.push({
      code: "CORPUS_INVALID",
      message: `Fixture corpus must target ${XFS4IOT_PIN.publication}.`
    });
  }

  const ids = new Set<string>();
  for (const rawFixture of value.fixtures) {
    if (
      !isRecord(rawFixture) ||
      typeof rawFixture.id !== "string" ||
      !fixtureIdPattern.test(rawFixture.id) ||
      !isRecord(rawFixture.message)
    ) {
      issues.push({
        code: "CORPUS_INVALID",
        message: "Each fixture needs a stable lowercase id and a message object."
      });
      continue;
    }
    if (ids.has(rawFixture.id)) {
      issues.push({
        code: "DUPLICATE_FIXTURE_ID",
        fixtureId: rawFixture.id,
        message: `Fixture id ${rawFixture.id} is duplicated.`
      });
    }
    ids.add(rawFixture.id);
    issues.push(...inspectFixtureMessage(rawFixture.message, rawFixture.id));
  }
  return issues;
}

export function inspectFixtureMessage(
  value: unknown,
  fixtureId?: string
): FixtureIssue[] {
  const issues: FixtureIssue[] = [];
  if (!isRecord(value) || !isRecord(value.header)) {
    return [
      {
        code: "ENVELOPE_INVALID",
        fixtureId,
        message: "Message must contain a header object."
      }
    ];
  }

  const { header } = value;
  const type = header.type;
  const name = header.name;
  const version = header.version;
  if (
    !isMessageType(type) ||
    typeof name !== "string" ||
    typeof version !== "string" ||
    !protocolVersionPattern.test(version)
  ) {
    issues.push({
      code: "ENVELOPE_INVALID",
      fixtureId,
      message: "Header type, name, or version is invalid."
    });
    return issues;
  }
  if (
    type !== "unsolicited" &&
    (!Number.isSafeInteger(header.requestId) || Number(header.requestId) < 0)
  ) {
    issues.push({
      code: "ENVELOPE_INVALID",
      fixtureId,
      message: `${type} messages require a non-negative integer requestId.`
    });
  }

  if (type !== "acknowledge") {
    const supported =
      XFS4IOT_SUPPORTED_MESSAGES[
        name as keyof typeof XFS4IOT_SUPPORTED_MESSAGES
      ];
    if (!supported || !(type in supported)) {
      issues.push({
        code: "UNSUPPORTED_MESSAGE",
        fixtureId,
        message: `${type} ${name} is outside the Cashblocks 0.2 subset.`
      });
    } else if ((supported as Record<string, string>)[type] !== version) {
      issues.push({
        code: "UNSUPPORTED_VERSION",
        fixtureId,
        message: `${type} ${name} ${version} is not the pinned subset version.`
      });
    }
  }

  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, "utf8") > XFS4IOT_LIMITS.maxMessageBytes) {
    issues.push({
      code: "MESSAGE_TOO_LARGE",
      fixtureId,
      message: `Message exceeds ${XFS4IOT_LIMITS.maxMessageBytes} bytes.`
    });
  }
  if (containsSensitiveTestData(value)) {
    issues.push({
      code: "SENSITIVE_TEST_DATA",
      fixtureId,
      message: "Fixture contains a prohibited key or card-data pattern."
    });
  }
  return issues;
}

function containsSensitiveTestData(value: unknown, key = ""): boolean {
  if (typeof value === "string") {
    return (
      forbiddenKeys.has(key.toLowerCase()) ||
      possiblePanPattern.test(value) ||
      magneticStripePattern.test(value)
    );
  }
  if (Array.isArray(value)) {
    return value.some((item) => containsSensitiveTestData(item, key));
  }
  if (!isRecord(value)) {
    return false;
  }
  return Object.entries(value).some(
    ([childKey, child]) =>
      forbiddenKeys.has(childKey.toLowerCase()) ||
      containsSensitiveTestData(child, childKey)
  );
}

function isMessageType(value: unknown): value is MessageType {
  return (
    value === "command" ||
    value === "acknowledge" ||
    value === "event" ||
    value === "completion" ||
    value === "unsolicited"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
