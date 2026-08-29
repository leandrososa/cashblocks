import {
  XFS4IOT_LIMITS,
  XFS4IOT_SUPPORTED_MESSAGES,
  type Xfs4IotMessage
} from "./protocol-fixtures.js";

export type Xfs4IotCommandName = {
  [Name in keyof typeof XFS4IOT_SUPPORTED_MESSAGES]: "command" extends keyof (typeof XFS4IOT_SUPPORTED_MESSAGES)[Name]
    ? Name
    : never;
}[keyof typeof XFS4IOT_SUPPORTED_MESSAGES];

export type Xfs4IotCommand = {
  name: Xfs4IotCommandName;
  payload?: Record<string, unknown> | null;
};

export type Xfs4IotCompletion = Xfs4IotMessage & {
  header: Xfs4IotMessage["header"] & { type: "completion"; requestId: number };
};

export type Xfs4IotEvent = Xfs4IotMessage & {
  header: Xfs4IotMessage["header"] & {
    type: "event" | "unsolicited";
    requestId?: number;
  };
};

export type Xfs4IotCompletionClassification = "success" | "known";

export class Xfs4IotProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Xfs4IotProtocolError";
  }
}

const messageTypes = new Set([
  "command",
  "acknowledge",
  "event",
  "completion",
  "unsolicited"
]);
const allowedHeaderKeys = new Set([
  "type",
  "name",
  "version",
  "requestId",
  "timeout",
  "status",
  "completionCode",
  "errorDescription"
]);
const completionCodes = new Set([
  "commandErrorCode",
  "canceled",
  "deviceNotReady",
  "hardwareError",
  "internalError",
  "invalidCommand",
  "invalidRequestID",
  "timeOut",
  "unsupportedCommand",
  "invalidData",
  "userError",
  "unsupportedData",
  "fraudAttempt",
  "sequenceError",
  "authorizationRequired",
  "noCommandNonce",
  "invalidToken",
  "invalidTokenNonce",
  "invalidTokenHMAC",
  "invalidTokenFormat",
  "invalidTokenKeyNoValue",
  "notEnoughSpace"
]);
const acknowledgeStatuses = new Set([
  "invalidMessage",
  "invalidRequestID",
  "tooManyRequests"
]);
const noPayloadMessages = new Set([
  "command:ServicePublisher.GetServices",
  "command:Common.Status",
  "command:Common.Capabilities",
  "completion:Common.SetVersions",
  "completion:Common.SetTransactionState",
  "event:CardReader.InsertCardEvent",
  "event:CardReader.MediaInsertedEvent",
  "event:CardReader.InvalidMediaEvent",
  "event:CardReader.MediaRemovedEvent",
  "event:CashDispenser.StartDispenseEvent"
]);
const deviceStates = new Set([
  "online",
  "offline",
  "powerOff",
  "noDevice",
  "hardwareError",
  "userError",
  "deviceBusy",
  "fraudAttempt",
  "potentialFraud",
  "starting"
]);
const outputPositions = new Set([
  "outDefault",
  "outLeft",
  "outRight",
  "outCenter",
  "outTop",
  "outBottom",
  "outFront",
  "outRear"
]);

export function createXfs4IotCommand(
  command: Xfs4IotCommand,
  requestId: number,
  timeout: number
): Xfs4IotMessage {
  const supported = XFS4IOT_SUPPORTED_MESSAGES[command.name];
  const version = (supported as { command: string }).command;
  const message: Xfs4IotMessage = {
    header: {
      type: "command",
      name: command.name,
      version,
      requestId,
      timeout
    },
    ...(command.payload === undefined ? {} : { payload: command.payload })
  };
  return parseXfs4IotMessage(message);
}

export function parseXfs4IotText(text: string): Xfs4IotMessage {
  if (Buffer.byteLength(text, "utf8") > XFS4IOT_LIMITS.maxMessageBytes) {
    throw new Xfs4IotProtocolError(
      `XFS4IoT message exceeds ${XFS4IOT_LIMITS.maxMessageBytes} bytes.`
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new Xfs4IotProtocolError("XFS4IoT message is not valid JSON.");
  }
  return parseXfs4IotMessage(value);
}

export function parseXfs4IotMessage(value: unknown): Xfs4IotMessage {
  if (!isRecord(value) || !isRecord(value.header)) {
    throw new Xfs4IotProtocolError("XFS4IoT message requires a header object.");
  }
  assertJsonValue(value, 0);
  const header = value.header;
  for (const key of Object.keys(header)) {
    if (!allowedHeaderKeys.has(key)) {
      throw new Xfs4IotProtocolError(`Unsupported XFS4IoT header field: ${key}.`);
    }
  }
  const type = requiredString(header.type, "header.type");
  const name = requiredString(header.name, "header.name");
  const version = requiredString(header.version, "header.version");
  if (!messageTypes.has(type)) {
    throw new Xfs4IotProtocolError(`Unsupported XFS4IoT message type: ${type}.`);
  }
  if (!/^[1-9]\d*\.(?:0|[1-9]\d*)$/.test(version)) {
    throw new Xfs4IotProtocolError("XFS4IoT header.version is malformed.");
  }
  if (type === "unsolicited") {
    if (header.requestId !== undefined) {
      throw new Xfs4IotProtocolError("Unsolicited messages cannot carry requestId.");
    }
  } else {
    nonNegativeInteger(header.requestId, "header.requestId");
  }
  if (header.timeout !== undefined) {
    nonNegativeInteger(header.timeout, "header.timeout");
    if (type !== "command") {
      throw new Xfs4IotProtocolError("Only commands may carry header.timeout.");
    }
  }
  if (header.status !== undefined) {
    if (type !== "acknowledge" || !acknowledgeStatuses.has(String(header.status))) {
      throw new Xfs4IotProtocolError("Invalid acknowledge status.");
    }
  }
  if (header.completionCode !== undefined) {
    if (type !== "completion" || !completionCodes.has(String(header.completionCode))) {
      throw new Xfs4IotProtocolError("Invalid completion code.");
    }
  }

  if (type === "acknowledge") {
    if (version !== "2.0" || !isSupportedCommandName(name)) {
      throw new Xfs4IotProtocolError("Unsupported XFS4IoT acknowledgement.");
    }
  } else {
    const supported = XFS4IOT_SUPPORTED_MESSAGES[
      name as keyof typeof XFS4IOT_SUPPORTED_MESSAGES
    ];
    if (!supported || !(type in supported)) {
      throw new Xfs4IotProtocolError(`${type} ${name} is outside the supported subset.`);
    }
    if ((supported as Record<string, string>)[type] !== version) {
      throw new Xfs4IotProtocolError(`${type} ${name} ${version} is unsupported.`);
    }
  }

  validatePayload(type, name, value.payload, header.completionCode);
  return value as Xfs4IotMessage;
}

export function classifyXfs4IotCompletion(
  completion: Xfs4IotCompletion
): Xfs4IotCompletionClassification {
  return completion.header.completionCode === undefined ? "success" : "known";
}

export function expectedCompletionVersion(commandName: string): string {
  const supported = XFS4IOT_SUPPORTED_MESSAGES[
    commandName as keyof typeof XFS4IOT_SUPPORTED_MESSAGES
  ];
  if (!supported || !("completion" in supported)) {
    throw new Xfs4IotProtocolError(`No supported completion for ${commandName}.`);
  }
  return (supported as { completion: string }).completion;
}

export function isStateChangingCommand(name: string): boolean {
  return (
    name === "CardReader.Move" ||
    name === "CashDispenser.Dispense" ||
    name === "CashDispenser.Present" ||
    name === "CashManagement.Retract"
  );
}

function validatePayload(
  type: string,
  name: string,
  payload: unknown,
  completionCode: unknown
): void {
  if (payload !== undefined && payload !== null && !isRecord(payload)) {
    throw new Xfs4IotProtocolError("XFS4IoT payload must be an object or null.");
  }
  const key = `${type}:${name}`;
  if (noPayloadMessages.has(key)) {
    if (payload !== undefined && payload !== null) {
      throw new Xfs4IotProtocolError(`${key} does not use a payload.`);
    }
    return;
  }
  if (type === "acknowledge") {
    if (payload !== undefined && payload !== null) {
      throw new Xfs4IotProtocolError("Acknowledgements do not use a payload.");
    }
    return;
  }
  if (
    type === "completion" &&
    completionCode !== undefined &&
    completionCode !== "commandErrorCode" &&
    (payload === undefined || payload === null)
  ) {
    return;
  }
  const object = payload === null || payload === undefined ? undefined : payload;

  switch (key) {
    case "completion:ServicePublisher.GetServices":
    case "event:ServicePublisher.ServiceDetailEvent":
      requireRecord(object, key);
      requiredString(object.vendorName, "payload.vendorName");
      if (object.services !== undefined && object.services !== null) {
        if (!Array.isArray(object.services)) invalid("payload.services must be an array.");
        for (const service of object.services) {
          requireRecord(service, "payload.services[]");
          const uri = requiredString(service.serviceURI, "payload.services[].serviceURI");
          try {
            new URL(uri);
          } catch {
            invalid("payload.services[].serviceURI must be a URI.");
          }
        }
      }
      return;
    case "completion:Common.Status":
    case "unsolicited:Common.StatusChangedEvent":
      requireRecord(object, key);
      requireRecord(object.common, "payload.common");
      if (!deviceStates.has(String(object.common.device))) {
        invalid("payload.common.device is invalid.");
      }
      return;
    case "completion:Common.Capabilities":
      requireRecord(object, key);
      if (!Array.isArray(object.interfaces)) invalid("payload.interfaces must be an array.");
      requireRecord(object.common, "payload.common");
      requiredString(object.common.serviceVersion, "payload.common.serviceVersion");
      if (!Array.isArray(object.common.deviceInformation)) {
        invalid("payload.common.deviceInformation must be an array.");
      }
      return;
    case "command:Common.SetVersions":
      requireRecord(object, key);
      validateVersionSelection(object.commands, "payload.commands");
      validateVersionSelection(object.events, "payload.events");
      if (object.commands == null && object.events == null) {
        invalid("SetVersions requires commands or events.");
      }
      return;
    case "command:Common.SetTransactionState":
      requireRecord(object, key);
      if (object.state !== "active" && object.state !== "inactive") {
        invalid("payload.state must be active or inactive.");
      }
      return;
    case "command:Common.Cancel":
      requireRecord(object, key);
      if (
        object.requestIds !== undefined &&
        object.requestIds !== null &&
        (!Array.isArray(object.requestIds) ||
          object.requestIds.length === 0 ||
          object.requestIds.some((id) => !Number.isSafeInteger(id) || Number(id) < 1))
      ) {
        invalid("payload.requestIds must contain positive integer ids.");
      }
      return;
    case "event:Common.ErrorEvent":
    case "unsolicited:Common.ErrorEvent":
      requireRecord(object, key);
      if (!["hardware", "software", "user", "fraudAttempt"].includes(String(object.eventId))) {
        invalid("payload.eventId is invalid.");
      }
      return;
    case "command:CardReader.ReadRawData":
      requireRecord(object, key);
      if (
        Object.keys(object).length === 0 ||
        Object.values(object).some((value) => typeof value !== "boolean")
      ) {
        invalid("ReadRawData requires boolean data-source flags.");
      }
      return;
    case "completion:CardReader.ReadRawData":
      if (object !== undefined) requireRecord(object, key);
      return;
    case "event:CardReader.TrackDetectedEvent":
      requireRecord(object, key);
      if (Object.values(object).some((value) => typeof value !== "boolean")) {
        invalid("TrackDetectedEvent flags must be boolean.");
      }
      return;
    case "command:CardReader.Move":
      requireRecord(object, key);
      for (const field of ["from", "to"] as const) {
        if (
          object[field] !== undefined &&
          (typeof object[field] !== "string" ||
            !/^(?:exit|transport|unit[0-9A-Za-z]+)$/.test(object[field]))
        ) {
          invalid(`payload.${field} is invalid.`);
        }
      }
      return;
    case "command:CashDispenser.Dispense":
      requireRecord(object, key);
      requireRecord(object.denomination, "payload.denomination");
      return;
    case "completion:CashDispenser.Dispense":
      if (object !== undefined && object.denomination !== undefined) {
        validateDenomination(object.denomination);
      }
      return;
    case "command:CashDispenser.Present":
    case "command:CashDispenser.GetPresentStatus":
      requireRecord(object, key);
      if (object.position !== undefined && !outputPositions.has(String(object.position))) {
        invalid("payload.position is invalid.");
      }
      return;
    case "completion:CashDispenser.Present":
      if (object?.position !== undefined) validatePositionInfo(object.position);
      return;
    case "completion:CashDispenser.GetPresentStatus":
      requireRecord(object, key);
      if (!["presented", "notPresented", "unknown"].includes(String(object.presentState))) {
        invalid("payload.presentState is invalid.");
      }
      if (object.denomination !== undefined) validateDenomination(object.denomination);
      return;
    case "event:CashDispenser.DelayedDispenseEvent":
      requireRecord(object, key);
      if (typeof object.delay !== "number" || !Number.isFinite(object.delay)) {
        invalid("payload.delay must be finite.");
      }
      return;
    case "event:CashDispenser.IncompleteDispenseEvent":
      validateDenomination(object);
      return;
    case "unsolicited:CashManagement.ItemsPresentedEvent":
    case "unsolicited:CashManagement.ItemsTakenEvent":
      validatePositionInfo(object);
      return;
    case "command:CashManagement.Retract":
      requireRecord(object, key);
      if (object.location !== undefined && object.location !== null) {
        requireRecord(object.location, "payload.location");
        if (!["retract", "transport", "stacker", "reject", "itemCassette", "cashIn"].includes(String(object.location.retractArea))) {
          invalid("payload.location.retractArea is invalid.");
        }
      }
      return;
    case "event:CashManagement.IncompleteRetractEvent":
      requireRecord(object, key);
      if (!["retractFailure", "retractAreaFull", "foreignItemsDetected", "invalidBunch"].includes(String(object.reason))) {
        invalid("payload.reason is invalid.");
      }
      return;
    default:
      if (object !== undefined) requireRecord(object, key);
  }
}

function validateVersionSelection(value: unknown, field: string): void {
  if (value === undefined || value === null) return;
  requireRecord(value, field);
  if (
    Object.keys(value).length === 0 ||
    Object.values(value).some((version) => !Number.isSafeInteger(version) || Number(version) < 1)
  ) {
    invalid(`${field} must map names to positive major versions.`);
  }
}

function validateDenomination(value: unknown): void {
  requireRecord(value, "payload.denomination");
  requireRecord(value.currencies, "payload.denomination.currencies");
  requireRecord(value.values, "payload.denomination.values");
}

function validatePositionInfo(value: unknown): void {
  requireRecord(value, "payload.position");
  if (!outputPositions.has(String(value.position))) {
    invalid("payload.position is invalid.");
  }
}

function assertJsonValue(value: unknown, depth: number): void {
  if (depth > 32) invalid("XFS4IoT message exceeds the JSON depth limit.");
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertJsonValue(item, depth + 1);
    return;
  }
  if (!isRecord(value)) invalid("XFS4IoT message must contain JSON values only.");
  for (const child of Object.values(value)) assertJsonValue(child, depth + 1);
}

function isSupportedCommandName(name: string): boolean {
  const supported = XFS4IOT_SUPPORTED_MESSAGES[
    name as keyof typeof XFS4IOT_SUPPORTED_MESSAGES
  ];
  return Boolean(supported && "command" in supported);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) invalid(`${field} is required.`);
  return value;
}

function nonNegativeInteger(value: unknown, field: string): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    invalid(`${field} must be a non-negative integer.`);
  }
}

function requireRecord(
  value: unknown,
  field: string
): asserts value is Record<string, unknown> {
  if (!isRecord(value)) invalid(`${field} must be an object.`);
}

function invalid(message: string): never {
  throw new Xfs4IotProtocolError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
