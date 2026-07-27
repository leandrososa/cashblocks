import type { AdapterOperationContext } from "../../runtime-contracts/src/index.js";
import type {
  DeviceGatewayRequest,
  DeviceGatewayTransport
} from "./index.js";

export type DeviceRecoveryAction =
  | "safe_retry"
  | "manual_reconciliation"
  | "operator_review";

export type DeviceWebSocket = {
  readonly readyState: number;
  readonly protocol: string;
  addEventListener(type: string, listener: (event: unknown) => void): void;
  removeEventListener(type: string, listener: (event: unknown) => void): void;
  send(data: string): void;
  close(code?: number, reason?: string): void;
};

export type WebSocketDeviceGatewayOptions = {
  url: string;
  protocols?: readonly string[];
  allowInsecureLoopback?: boolean;
  connectTimeoutMs?: number;
  responseTimeoutMs?: number;
  maxRequestBytes?: number;
  maxResponseBytes?: number;
  indeterminateCommands?: readonly string[];
  nonIdempotentCommands?: readonly string[];
  webSocketFactory?: (
    url: string,
    protocols: readonly string[],
    maxResponseBytes: number
  ) => DeviceWebSocket;
  now?: () => number;
};

type RecoveryPolicy = {
  indeterminateCommands: ReadonlySet<string>;
  nonIdempotentCommands: ReadonlySet<string>;
};

const OPEN = 1;
const CLOSING = 2;
const CLOSED = 3;
const protocolToken = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

export class WebSocketDeviceGatewayTransport implements DeviceGatewayTransport {
  readonly url: string;
  private readonly protocols: readonly string[];
  private readonly connectTimeoutMs: number;
  private readonly responseTimeoutMs: number;
  private readonly maxRequestBytes: number;
  private readonly maxResponseBytes: number;
  private readonly policy: RecoveryPolicy;
  private readonly webSocketFactory: NonNullable<
    WebSocketDeviceGatewayOptions["webSocketFactory"]
  >;
  private readonly now: () => number;

  constructor(options: WebSocketDeviceGatewayOptions) {
    this.url = validateGatewayUrl(
      options.url,
      options.allowInsecureLoopback ?? false
    );
    this.protocols = validateProtocols(
      options.protocols ?? ["cashblocks.device.v1"]
    );
    this.connectTimeoutMs = positiveInteger(
      options.connectTimeoutMs ?? 5_000,
      "connectTimeoutMs"
    );
    this.responseTimeoutMs = positiveInteger(
      options.responseTimeoutMs ?? 30_000,
      "responseTimeoutMs"
    );
    this.maxRequestBytes = positiveInteger(
      options.maxRequestBytes ?? 1024 * 1024,
      "maxRequestBytes"
    );
    this.maxResponseBytes = positiveInteger(
      options.maxResponseBytes ?? 1024 * 1024,
      "maxResponseBytes"
    );
    this.policy = {
      indeterminateCommands: commandSet(
        ["dispense", "accept", ...(options.indeterminateCommands ?? [])],
        "indeterminateCommands"
      ),
      nonIdempotentCommands: commandSet(
        ["print", ...(options.nonIdempotentCommands ?? [])],
        "nonIdempotentCommands"
      )
    };
    this.webSocketFactory =
      options.webSocketFactory ?? defaultWebSocketFactory;
    this.now = options.now ?? Date.now;
  }

  async exchange(
    request: DeviceGatewayRequest,
    context?: AdapterOperationContext
  ): Promise<unknown> {
    context?.signal.throwIfAborted();
    const encoded = boundedJsonStringify(request, this.maxRequestBytes);
    if (context && deadlineElapsed(context, this.now)) {
      return recoveryResponse(request, this.policy, {
        phase: "connect",
        requestSent: false,
        message: "Device operation deadline elapsed before connection."
      });
    }

    return new Promise<unknown>((resolve, reject) => {
      let socket: DeviceWebSocket | undefined;
      let sent = false;
      let settled = false;
      let connectTimer: ReturnType<typeof setTimeout> | undefined;
      let responseTimer: ReturnType<typeof setTimeout> | undefined;

      const cleanup = () => {
        if (connectTimer) clearTimeout(connectTimer);
        if (responseTimer) clearTimeout(responseTimer);
        context?.signal.removeEventListener("abort", onAbort);
        if (socket) {
          socket.removeEventListener("open", onOpen);
          socket.removeEventListener("message", onMessage);
          socket.removeEventListener("error", onError);
          socket.removeEventListener("close", onClose);
        }
      };
      const close = () => {
        if (
          socket &&
          socket.readyState !== CLOSING &&
          socket.readyState !== CLOSED
        ) {
          try {
            socket.close(1000, "cashblocks complete");
          } catch {
            // The result is already settled; close failures are not actionable.
          }
        }
      };
      const finish = (result: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        close();
        resolve(result);
      };
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        close();
        reject(error);
      };
      const recover = (
        phase: "connect" | "response" | "protocol",
        message: string
      ) => {
        finish(
          recoveryResponse(request, this.policy, {
            phase,
            requestSent: sent,
            message
          })
        );
      };
      const onAbort = () => {
        if (
          sent &&
          recoveryFor(
            request.command,
            true,
            "response",
            this.policy
          ) !== "safe_retry"
        ) {
          recover("response", "Device operation was aborted after send.");
          return;
        }
        fail(
          context?.signal.reason instanceof Error
            ? context.signal.reason
            : new Error("Device operation was aborted.")
        );
      };
      const onOpen = () => {
        if (settled || sent) return;
        if (connectTimer) clearTimeout(connectTimer);
        if (context?.signal.aborted) {
          onAbort();
          return;
        }
        if (context && deadlineElapsed(context, this.now)) {
          recover("connect", "Device operation deadline elapsed before send.");
          return;
        }
        if (!this.protocols.includes(socket!.protocol)) {
          recover(
            "protocol",
            "Device gateway did not negotiate an allowed WebSocket subprotocol."
          );
          return;
        }
        try {
          socket!.send(encoded);
          sent = true;
        } catch {
          recover("connect", "Device request could not be sent.");
          return;
        }
        responseTimer = setTimeout(
          () => recover("response", "Device response timed out."),
          effectiveTimeout(this.responseTimeoutMs, context, this.now)
        );
      };
      const onMessage = (event: unknown) => {
        if (settled || !sent) return;
        if (context && deadlineElapsed(context, this.now)) {
          recover(
            "response",
            "Device response arrived after the operation deadline."
          );
          return;
        }
        const data = messageText(event);
        if (data === undefined) {
          recover("protocol", "Device gateway returned a non-text response.");
          return;
        }
        if (Buffer.byteLength(data, "utf8") > this.maxResponseBytes) {
          recover(
            "protocol",
            `Device response exceeds the ${this.maxResponseBytes}-byte limit.`
          );
          return;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(data) as unknown;
        } catch {
          recover("protocol", "Device gateway returned invalid JSON.");
          return;
        }
        if (!isGatewayResponse(parsed, request.requestId)) {
          recover(
            "protocol",
            "Device gateway returned an invalid response schema."
          );
          return;
        }
        finish(parsed);
      };
      const onError = () => {
        recover(
          sent ? "response" : "connect",
          sent
            ? "Device connection failed after the request was sent."
            : "Device connection failed before the request was sent."
        );
      };
      const onClose = () => {
        recover(
          sent ? "response" : "connect",
          sent
            ? "Device connection closed before a response was received."
            : "Device connection closed before the request was sent."
        );
      };

      context?.signal.addEventListener("abort", onAbort, { once: true });
      try {
        socket = this.webSocketFactory(
          this.url,
          this.protocols,
          this.maxResponseBytes
        );
        socket.addEventListener("open", onOpen);
        socket.addEventListener("message", onMessage);
        socket.addEventListener("error", onError);
        socket.addEventListener("close", onClose);
      } catch {
        recover("connect", "Device WebSocket could not be created.");
        return;
      }
      connectTimer = setTimeout(
        () => recover("connect", "Device connection timed out."),
        effectiveTimeout(this.connectTimeoutMs, context, this.now)
      );
      if (socket.readyState === OPEN) queueMicrotask(onOpen);
    });
  }
}

export function classifyDeviceRecovery(
  command: string,
  requestSent: boolean,
  options: {
    indeterminateCommands?: readonly string[];
    nonIdempotentCommands?: readonly string[];
  } = {}
): DeviceRecoveryAction {
  if (!requestSent) return "safe_retry";
  if (
    commandSet(
      ["dispense", "accept", ...(options.indeterminateCommands ?? [])],
      "indeterminateCommands"
    ).has(command)
  ) {
    return "manual_reconciliation";
  }
  if (
    commandSet(
      ["print", ...(options.nonIdempotentCommands ?? [])],
      "nonIdempotentCommands"
    ).has(command)
  ) {
    return "operator_review";
  }
  return "safe_retry";
}

function recoveryResponse(
  request: DeviceGatewayRequest,
  policy: RecoveryPolicy,
  failure: {
    phase: "connect" | "response" | "protocol";
    requestSent: boolean;
    message: string;
  }
) {
  const recovery = recoveryFor(
    request.command,
    failure.requestSent,
    failure.phase,
    policy
  );
  return {
    requestId: request.requestId,
    ok: false,
    code:
      recovery === "manual_reconciliation"
        ? "ADAPTER_OUTCOME_UNKNOWN"
        : recovery === "operator_review"
          ? "DEVICE_OUTCOME_UNKNOWN"
          : "DEVICE_GATEWAY_UNAVAILABLE",
    message: failure.message,
    details: {
      phase: failure.phase,
      requestSent: failure.requestSent,
      recovery,
      requiresReconciliation: recovery === "manual_reconciliation"
    }
  };
}

function recoveryFor(
  command: string,
  requestSent: boolean,
  phase: "connect" | "response" | "protocol",
  policy: RecoveryPolicy
): DeviceRecoveryAction {
  if (!requestSent) return "safe_retry";
  if (policy.indeterminateCommands.has(command)) {
    return "manual_reconciliation";
  }
  if (phase === "protocol") return "operator_review";
  if (policy.nonIdempotentCommands.has(command)) {
    return "operator_review";
  }
  return "safe_retry";
}

function deadlineElapsed(
  context: AdapterOperationContext,
  now: () => number
): boolean {
  const deadline = Date.parse(context.deadlineAt);
  return Number.isFinite(deadline) && deadline <= now();
}

function effectiveTimeout(
  configuredMs: number,
  context: AdapterOperationContext | undefined,
  now: () => number
): number {
  if (!context) return configuredMs;
  const deadline = Date.parse(context.deadlineAt);
  if (!Number.isFinite(deadline)) return configuredMs;
  return Math.max(1, Math.min(configuredMs, deadline - now()));
}

function validateGatewayUrl(
  input: string,
  allowInsecureLoopback: boolean
): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Device gateway URL must be an absolute WebSocket URL.");
  }
  if (url.username || url.password) {
    throw new Error("Device gateway URL cannot contain embedded credentials.");
  }
  if (url.hash) {
    throw new Error("Device gateway URL cannot contain a fragment.");
  }
  if (url.protocol === "wss:") return url.toString();
  if (
    url.protocol === "ws:" &&
    allowInsecureLoopback &&
    isLoopback(url.hostname)
  ) {
    return url.toString();
  }
  throw new Error(
    "Device gateway requires wss://; ws:// is limited to opted-in loopback development."
  );
}

function isLoopback(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]"
  );
}

function validateProtocols(protocols: readonly string[]): readonly string[] {
  if (
    protocols.length === 0 ||
    protocols.length > 10 ||
    protocols.some(
      (protocol) =>
        !protocolToken.test(protocol) ||
        Buffer.byteLength(protocol, "utf8") > 128
    ) ||
    new Set(protocols).size !== protocols.length
  ) {
    throw new Error("WebSocket protocols must be unique, bounded token values.");
  }
  return [...protocols];
}

function commandSet(commands: readonly string[], label: string): ReadonlySet<string> {
  if (
    commands.length > 100 ||
    commands.some(
      (command) =>
        !command.trim() ||
        command.length > 128 ||
        /[\u0000-\u001F\u007F-\u009F]/.test(command)
    )
  ) {
    throw new Error(`${label} must contain bounded command names.`);
  }
  return new Set(commands);
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function messageText(event: unknown): string | undefined {
  if (
    (typeof event !== "object" && typeof event !== "function") ||
    event === null
  ) {
    return undefined;
  }
  const data = (event as { data?: unknown }).data;
  return typeof data === "string" ? data : undefined;
}

function isGatewayResponse(
  value: unknown,
  expectedRequestId: string
): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    value.requestId === expectedRequestId &&
    typeof value.ok === "boolean" &&
    typeof value.code === "string" &&
    Boolean(value.code.trim()) &&
    typeof value.message === "string" &&
    Boolean(value.message.trim()) &&
    (value.details === undefined || isJsonRecord(value.details))
  );
}

function isJsonRecord(value: unknown): boolean {
  return isRecord(value) && isJsonValue(value);
}

function isJsonValue(
  value: unknown,
  depth = 0,
  seen = new Set<object>()
): boolean {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || depth >= 20 || seen.has(value)) return false;
  seen.add(value);
  const valid = Array.isArray(value)
    ? value.every((entry) => isJsonValue(entry, depth + 1, seen))
    : isRecord(value) &&
      Object.values(value).every((entry) =>
        isJsonValue(entry, depth + 1, seen)
      );
  seen.delete(value);
  return valid;
}

function boundedJsonStringify(value: unknown, maxBytes: number): string {
  const parts: string[] = [];
  const seen = new Set<object>();
  let remaining = maxBytes;
  const append = (text: string) => {
    const bytes = Buffer.byteLength(text, "utf8");
    if (bytes > remaining) {
      throw new Error(
        `Device gateway request exceeds the ${maxBytes}-byte limit.`
      );
    }
    remaining -= bytes;
    parts.push(text);
  };
  const appendString = (text: string) => {
    if (Buffer.byteLength(text, "utf8") > remaining) {
      throw new Error(
        `Device gateway request exceeds the ${maxBytes}-byte limit.`
      );
    }
    append(JSON.stringify(text));
  };
  const encode = (input: unknown): void => {
    if (input === null) {
      append("null");
      return;
    }
    if (typeof input === "string") {
      appendString(input);
      return;
    }
    if (typeof input === "boolean") {
      append(input ? "true" : "false");
      return;
    }
    if (typeof input === "number" && Number.isFinite(input)) {
      append(String(input));
      return;
    }
    if (Array.isArray(input)) {
      if (seen.has(input)) throw new Error("Device request cannot be circular.");
      seen.add(input);
      append("[");
      for (let index = 0; index < input.length; index += 1) {
        if (index > 0) append(",");
        if (!(index in input) || input[index] === undefined) {
          throw new Error("Device request arrays must contain JSON values.");
        }
        encode(input[index]);
      }
      append("]");
      seen.delete(input);
      return;
    }
    if (isRecord(input)) {
      if (seen.has(input)) throw new Error("Device request cannot be circular.");
      seen.add(input);
      append("{");
      let emitted = 0;
      for (const key of Object.keys(input)) {
        const entry = input[key];
        if (entry === undefined) continue;
        if (emitted > 0) append(",");
        appendString(key);
        append(":");
        encode(entry);
        emitted += 1;
      }
      append("}");
      seen.delete(input);
      return;
    }
    throw new Error("Device request must contain only finite JSON values.");
  };
  encode(value);
  return parts.join("");
}

function defaultWebSocketFactory(
  url: string,
  protocols: readonly string[],
  _maxResponseBytes: number
): DeviceWebSocket {
  if (typeof globalThis.WebSocket !== "function") {
    throw new Error("This runtime does not provide a WebSocket client.");
  }
  return new globalThis.WebSocket(url, [...protocols]) as unknown as DeviceWebSocket;
}
