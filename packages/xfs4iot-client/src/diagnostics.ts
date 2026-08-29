export type Xfs4IotDiagnosticLevel = "debug" | "info" | "warn" | "error";

export type Xfs4IotDiagnosticEntry = {
  level: Xfs4IotDiagnosticLevel;
  event: string;
  message: string;
  metadata?: Record<string, unknown>;
};

export type Xfs4IotDiagnosticLogger = {
  log(entry: Xfs4IotDiagnosticEntry): void;
};

const sensitiveKeys = /(?:account|cardholder|credential|cryptogram|data|key|nonce|pan|pin|token|track)/i;
const safeKeys = new Set([
  "action",
  "additionalBunches",
  "bunches",
  "commandName",
  "completionCode",
  "device",
  "errorCode",
  "eventId",
  "failurePhase",
  "header",
  "name",
  "position",
  "presentState",
  "payload",
  "reason",
  "requestId",
  "requestSent",
  "serviceVersion",
  "state",
  "type",
  "version"
]);

export function redactXfs4IotDiagnostic(value: unknown): unknown {
  return redact(value, "", 0);
}

export function diagnosticHeader(value: unknown): Record<string, unknown> {
  if (!isRecord(value) || !isRecord(value.header)) return {};
  const header = value.header;
  return compact({
    type: safeScalar(header.type),
    name: safeScalar(header.name),
    version: safeScalar(header.version),
    requestId: safeScalar(header.requestId),
    completionCode: safeScalar(header.completionCode),
    status: safeScalar(header.status)
  });
}

function redact(value: unknown, key: string, depth: number): unknown {
  if (sensitiveKeys.test(key)) return "[REDACTED:sensitive]";
  if (depth > 6) return "[REDACTED:depth]";
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    return value.length <= 128 ? value : `${value.slice(0, 128)}…`;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 16).map((item) => redact(item, key, depth + 1));
  }
  if (!isRecord(value)) return "[REDACTED:non-json]";

  const result: Record<string, unknown> = {};
  for (const [childKey, child] of Object.entries(value).slice(0, 32)) {
    result[childKey] = safeKeys.has(childKey)
      ? redact(child, childKey, depth + 1)
      : sensitiveKeys.test(childKey)
        ? "[REDACTED:sensitive]"
        : "[REDACTED:unknown]";
  }
  return result;
}

function safeScalar(value: unknown): string | number | boolean | null | undefined {
  return value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
    ? value
    : undefined;
}

function compact(
  value: Record<string, string | number | boolean | null | undefined>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string | number | boolean | null] =>
      entry[1] !== undefined
    )
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
