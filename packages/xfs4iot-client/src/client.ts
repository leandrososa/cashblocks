import {
  Xfs4IotClientError,
  classifyTransportFailure,
  type Xfs4IotFailureClassification
} from "./errors.js";
import {
  XFS4IOT_LIMITS,
  type Xfs4IotMessage
} from "./protocol-fixtures.js";
import {
  createXfs4IotCommand,
  expectedCompletionVersion,
  isStateChangingCommand,
  parseXfs4IotText,
  type Xfs4IotCommand,
  type Xfs4IotCompletion,
  type Xfs4IotEvent
} from "./protocol.js";
import {
  diagnosticHeader,
  type Xfs4IotDiagnosticEntry,
  type Xfs4IotDiagnosticLogger
} from "./diagnostics.js";

export type Xfs4IotWebSocket = {
  readonly readyState: number;
  readonly protocol: string;
  addEventListener(type: string, listener: (event: unknown) => void): void;
  removeEventListener(type: string, listener: (event: unknown) => void): void;
  send(data: string): void;
  close(code?: number, reason?: string): void;
};

export type RoutedXfs4IotEvent = {
  message: Xfs4IotEvent;
  correlation: "pending" | "orphan" | "unsolicited";
  commandName?: string;
};

export type Xfs4IotExecuteOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
  effect?: "read-only" | "state-changing";
  cancelOnAbort?: boolean;
};

export type Xfs4IotClientOptions = {
  url: string;
  protocols?: readonly string[];
  allowInsecureLoopback?: boolean;
  connectTimeoutMs?: number;
  maxMessageBytes?: number;
  maxPendingRequests?: number;
  maxEventBacklog?: number;
  maxReconnectAttempts?: number;
  reconnectBaseDelayMs?: number;
  reconnectMaxDelayMs?: number;
  reconnectWindowMs?: number;
  webSocketFactory?: (
    url: string,
    protocols: readonly string[],
    maxMessageBytes: number
  ) => Xfs4IotWebSocket;
  logger?: Xfs4IotDiagnosticLogger;
  nextRequestId?: () => number;
  now?: () => number;
  delay?: (milliseconds: number) => Promise<void>;
};

type PendingCommand = {
  requestId: number;
  name: string;
  expectedVersion: string;
  stateChanging: boolean;
  cancelOnAbort: boolean;
  signal?: AbortSignal;
  abortListener?: () => void;
  timer: ReturnType<typeof setTimeout>;
  sent: boolean;
  settled: boolean;
  resolve(value: Xfs4IotCompletion): void;
  reject(error: Xfs4IotClientError): void;
};

type SocketListeners = {
  open(event: unknown): void;
  message(event: unknown): void;
  error(event: unknown): void;
  close(event: unknown): void;
};

const OPEN = 1;
const CLOSING = 2;
const CLOSED = 3;
const protocolToken = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

export class Xfs4IotClient {
  readonly url: string;
  private readonly protocols: readonly string[];
  private readonly connectTimeoutMs: number;
  private readonly maxMessageBytes: number;
  private readonly maxPendingRequests: number;
  private readonly maxEventBacklog: number;
  private readonly maxReconnectAttempts: number;
  private readonly reconnectBaseDelayMs: number;
  private readonly reconnectMaxDelayMs: number;
  private readonly reconnectWindowMs: number;
  private readonly webSocketFactory: NonNullable<
    Xfs4IotClientOptions["webSocketFactory"]
  >;
  private readonly logger?: Xfs4IotDiagnosticLogger;
  private readonly nextRequestId: () => number;
  private readonly now: () => number;
  private readonly delay: (milliseconds: number) => Promise<void>;
  private readonly pending = new Map<number, PendingCommand>();
  private readonly listeners = new Set<(event: RoutedXfs4IotEvent) => void>();
  private readonly eventBacklog: RoutedXfs4IotEvent[] = [];
  private socket?: Xfs4IotWebSocket;
  private openingSocket?: Xfs4IotWebSocket;
  private detachSocket?: () => void;
  private connectPromise?: Promise<void>;
  private disposed = false;

  constructor(options: Xfs4IotClientOptions) {
    this.url = validateUrl(options.url, options.allowInsecureLoopback ?? false);
    this.protocols = validateProtocols(options.protocols ?? []);
    this.connectTimeoutMs = boundedPositiveInteger(
      options.connectTimeoutMs ?? 5_000,
      XFS4IOT_LIMITS.reconnectWindowMs,
      "connectTimeoutMs"
    );
    this.maxMessageBytes = boundedPositiveInteger(
      options.maxMessageBytes ?? XFS4IOT_LIMITS.maxMessageBytes,
      XFS4IOT_LIMITS.maxMessageBytes,
      "maxMessageBytes"
    );
    this.maxPendingRequests = boundedPositiveInteger(
      options.maxPendingRequests ?? XFS4IOT_LIMITS.maxPendingRequests,
      XFS4IOT_LIMITS.maxPendingRequests,
      "maxPendingRequests"
    );
    this.maxEventBacklog = boundedPositiveInteger(
      options.maxEventBacklog ?? XFS4IOT_LIMITS.maxEventBacklog,
      XFS4IOT_LIMITS.maxEventBacklog,
      "maxEventBacklog"
    );
    this.maxReconnectAttempts = boundedPositiveInteger(
      options.maxReconnectAttempts ?? XFS4IOT_LIMITS.maxReconnectAttempts,
      XFS4IOT_LIMITS.maxReconnectAttempts,
      "maxReconnectAttempts"
    );
    this.reconnectBaseDelayMs = boundedPositiveInteger(
      options.reconnectBaseDelayMs ?? XFS4IOT_LIMITS.reconnectBaseDelayMs,
      XFS4IOT_LIMITS.reconnectMaxDelayMs,
      "reconnectBaseDelayMs"
    );
    this.reconnectMaxDelayMs = boundedPositiveInteger(
      options.reconnectMaxDelayMs ?? XFS4IOT_LIMITS.reconnectMaxDelayMs,
      XFS4IOT_LIMITS.reconnectWindowMs,
      "reconnectMaxDelayMs"
    );
    if (this.reconnectBaseDelayMs > this.reconnectMaxDelayMs) {
      throw new TypeError("reconnectBaseDelayMs cannot exceed reconnectMaxDelayMs.");
    }
    this.reconnectWindowMs = boundedPositiveInteger(
      options.reconnectWindowMs ?? XFS4IOT_LIMITS.reconnectWindowMs,
      XFS4IOT_LIMITS.reconnectWindowMs,
      "reconnectWindowMs"
    );
    this.webSocketFactory = options.webSocketFactory ?? defaultWebSocketFactory;
    this.logger = options.logger;
    this.nextRequestId = options.nextRequestId ?? sequentialRequestIds();
    this.now = options.now ?? Date.now;
    this.delay = options.delay ?? defaultDelay;
  }

  get connected(): boolean {
    return this.socket?.readyState === OPEN;
  }

  get pendingRequestCount(): number {
    return this.pending.size;
  }

  get queuedEventCount(): number {
    return this.eventBacklog.length;
  }

  async connect(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    await this.ensureConnected(this.now() + this.reconnectWindowMs, signal);
  }

  execute(
    command: Xfs4IotCommand,
    options: Xfs4IotExecuteOptions = {}
  ): Promise<Xfs4IotCompletion> {
    if (this.disposed) {
      return Promise.reject(
        new Xfs4IotClientError("XFS4IoT client is closed.", {
          code: "CLIENT_CLOSED",
          classification: "safe-to-retry",
          phase: "shutdown",
          requestSent: false
        })
      );
    }
    if (this.pending.size >= this.maxPendingRequests) {
      return Promise.reject(
        new Xfs4IotClientError("XFS4IoT pending request limit reached.", {
          code: "PENDING_LIMIT_EXCEEDED",
          classification: "safe-to-retry",
          phase: "send",
          commandName: command.name,
          requestSent: false
        })
      );
    }
    const requestId = this.allocateRequestId();
    const configuredDeadline =
      XFS4IOT_LIMITS.commandDeadlinesMs[
        command.name as keyof typeof XFS4IOT_LIMITS.commandDeadlinesMs
      ] ?? XFS4IOT_LIMITS.defaultCommandDeadlineMs;
    const timeoutMs = options.timeoutMs === undefined
      ? configuredDeadline
      : boundedPositiveInteger(options.timeoutMs, configuredDeadline, "timeoutMs");
    const deadlineAt = this.now() + timeoutMs;
    const message = createXfs4IotCommand(command, requestId, timeoutMs);
    const encoded = JSON.stringify(message);
    if (Buffer.byteLength(encoded, "utf8") > this.maxMessageBytes) {
      return Promise.reject(
        new Xfs4IotClientError(
          `XFS4IoT command exceeds ${this.maxMessageBytes} bytes.`,
          {
            code: "PROTOCOL_ERROR",
            classification: "safe-to-retry",
            phase: "send",
            requestId,
            commandName: command.name,
            requestSent: false
          }
        )
      );
    }

    return new Promise<Xfs4IotCompletion>((resolve, reject) => {
      const pending: PendingCommand = {
        requestId,
        name: command.name,
        expectedVersion: expectedCompletionVersion(command.name),
        stateChanging:
          options.effect === "state-changing" ||
          (options.effect === undefined && isStateChangingCommand(command.name)),
        cancelOnAbort: options.cancelOnAbort ?? true,
        signal: options.signal,
        timer: setTimeout(() => this.timeoutPending(requestId), timeoutMs),
        sent: false,
        settled: false,
        resolve,
        reject
      };
      if (options.signal) {
        pending.abortListener = () => this.abortPending(requestId, options.signal?.reason);
        options.signal.addEventListener("abort", pending.abortListener, { once: true });
      }
      this.pending.set(requestId, pending);
      if (options.signal?.aborted) {
        this.abortPending(requestId, options.signal.reason);
        return;
      }
      void this.sendWhenConnected(pending, encoded, deadlineAt);
    });
  }

  cancel(
    requestIds: readonly number[],
    options: Omit<Xfs4IotExecuteOptions, "effect" | "cancelOnAbort"> = {}
  ): Promise<Xfs4IotCompletion> {
    const uniqueIds = [...new Set(requestIds)];
    if (
      uniqueIds.length === 0 ||
      uniqueIds.some((id) => !Number.isSafeInteger(id) || id < 1)
    ) {
      return Promise.reject(new TypeError("Cancellation requires positive request ids."));
    }
    return this.execute(
      { name: "Common.Cancel", payload: { requestIds: uniqueIds } },
      { ...options, effect: "read-only", cancelOnAbort: false }
    );
  }

  onEvent(listener: (event: RoutedXfs4IotEvent) => void): () => void {
    if (typeof listener !== "function") {
      throw new TypeError("XFS4IoT event listener must be a function.");
    }
    if (this.listeners.size >= 32) {
      throw new RangeError("XFS4IoT event listener limit reached.");
    }
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  drainEvents(): RoutedXfs4IotEvent[] {
    return this.eventBacklog.splice(0, this.eventBacklog.length);
  }

  close(): void {
    if (this.disposed) return;
    this.disposed = true;
    const opening = this.openingSocket;
    this.openingSocket = undefined;
    this.detachCurrentSocket();
    const socket = this.socket;
    this.socket = undefined;
    safeClose(opening, 1000, "cashblocks client closed");
    if (socket !== opening) safeClose(socket, 1000, "cashblocks client closed");
    for (const pending of [...this.pending.values()]) {
      this.rejectPending(
        pending,
        failure(
          "CLIENT_CLOSED",
          "XFS4IoT client closed before command completion.",
          "shutdown",
          pending
        )
      );
    }
    this.listeners.clear();
    this.eventBacklog.splice(0);
  }

  private async sendWhenConnected(
    pending: PendingCommand,
    encoded: string,
    deadlineAt: number
  ): Promise<void> {
    try {
      await this.ensureConnected(deadlineAt, pending.signal);
    } catch (cause) {
      if (!this.pending.has(pending.requestId)) return;
      const error = cause instanceof Xfs4IotClientError
        ? new Xfs4IotClientError(cause.message, {
            code: cause.code,
            classification: "safe-to-retry",
            phase: "connect",
            requestId: pending.requestId,
            commandName: pending.name,
            requestSent: false,
            cause
          })
        : failure(
            "CONNECTION_FAILED",
            "XFS4IoT connection failed before command send.",
            "connect",
            pending,
            cause
          );
      this.rejectPending(pending, error);
      return;
    }
    if (!this.pending.has(pending.requestId)) return;
    if (pending.signal?.aborted) {
      this.abortPending(pending.requestId, pending.signal.reason);
      return;
    }
    if (this.now() >= deadlineAt) {
      this.timeoutPending(pending.requestId);
      return;
    }
    const socket = this.socket;
    if (!socket || socket.readyState !== OPEN) {
      this.rejectPending(
        pending,
        failure(
          "CONNECTION_FAILED",
          "XFS4IoT connection was unavailable before command send.",
          "connect",
          pending
        )
      );
      return;
    }
    try {
      socket.send(encoded);
      pending.sent = true;
      this.log({
        level: "debug",
        event: "command.sent",
        message: "XFS4IoT command sent.",
        metadata: {
          requestId: pending.requestId,
          commandName: pending.name,
          requestSent: true
        }
      });
    } catch (cause) {
      this.rejectPending(
        pending,
        failure(
          "SEND_FAILED",
          "XFS4IoT command could not be sent.",
          "send",
          pending,
          cause
        )
      );
    }
  }

  private async ensureConnected(
    deadlineAt: number,
    signal?: AbortSignal
  ): Promise<void> {
    if (this.disposed) {
      throw new Xfs4IotClientError("XFS4IoT client is closed.", {
        code: "CLIENT_CLOSED",
        classification: "safe-to-retry",
        phase: "shutdown",
        requestSent: false
      });
    }
    if (this.socket?.readyState === OPEN) return;
    if (!this.connectPromise) {
      this.connectPromise = this.connectWithRetry(deadlineAt);
    }
    const promise = this.connectPromise;
    try {
      await waitForPromise(promise, signal);
    } finally {
      if (this.connectPromise === promise && this.socket?.readyState === OPEN) {
        this.connectPromise = undefined;
      } else if (this.connectPromise === promise) {
        void promise.catch(() => undefined).finally(() => {
          if (this.connectPromise === promise) this.connectPromise = undefined;
        });
      }
    }
  }

  private async connectWithRetry(deadlineAt: number): Promise<void> {
    const reconnectDeadline = Math.min(
      deadlineAt,
      this.now() + this.reconnectWindowMs
    );
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxReconnectAttempts; attempt += 1) {
      if (this.disposed) {
        throw new Xfs4IotClientError("XFS4IoT client is closed.", {
          code: "CLIENT_CLOSED",
          classification: "safe-to-retry",
          phase: "shutdown",
          requestSent: false
        });
      }
      const remaining = reconnectDeadline - this.now();
      if (remaining <= 0) break;
      try {
        await this.openSocket(Math.min(this.connectTimeoutMs, remaining));
        return;
      } catch (error) {
        lastError = error;
        this.log({
          level: "warn",
          event: "connection.attempt_failed",
          message: "XFS4IoT connection attempt failed.",
          metadata: { attempt, maxAttempts: this.maxReconnectAttempts }
        });
      }
      if (attempt >= this.maxReconnectAttempts) break;
      const delayMs = Math.min(
        this.reconnectBaseDelayMs * 2 ** (attempt - 1),
        this.reconnectMaxDelayMs,
        Math.max(0, reconnectDeadline - this.now())
      );
      if (delayMs > 0) await this.delay(delayMs);
    }
    throw new Xfs4IotClientError("Unable to connect to the XFS4IoT service.", {
      code: "CONNECTION_FAILED",
      classification: "safe-to-retry",
      phase: "connect",
      requestSent: false,
      cause: lastError
    });
  }

  private openSocket(timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let socket: Xfs4IotWebSocket;
      let opened = false;
      let settled = false;
      let disconnected = false;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const detach = () => {
        if (timer) clearTimeout(timer);
        socket.removeEventListener("open", listeners.open);
        socket.removeEventListener("message", listeners.message);
        socket.removeEventListener("error", listeners.error);
        socket.removeEventListener("close", listeners.close);
      };
      const failBeforeOpen = (message: string, cause?: unknown) => {
        if (settled) return;
        settled = true;
        detach();
        if (this.openingSocket === socket) this.openingSocket = undefined;
        safeClose(socket, 1000, "connection failed");
        reject(new Error(message, { cause }));
      };
      const disconnect = (message: string) => {
        if (disconnected) return;
        disconnected = true;
        detach();
        if (this.socket === socket) {
          this.socket = undefined;
          this.detachSocket = undefined;
        }
        safeClose(socket, 1001, "connection lost");
        this.rejectAllForDisconnect(message);
      };
      const listeners: SocketListeners = {
        open: () => {
          if (opened || settled) return;
          if (this.disposed) {
            failBeforeOpen("Client closed during connection.");
            return;
          }
          if (
            this.protocols.length > 0 &&
            !this.protocols.includes(socket.protocol)
          ) {
            failBeforeOpen("Service did not negotiate an allowed subprotocol.");
            return;
          }
          opened = true;
          settled = true;
          if (timer) clearTimeout(timer);
          if (this.openingSocket === socket) this.openingSocket = undefined;
          this.socket = socket;
          this.detachSocket = detach;
          this.log({
            level: "info",
            event: "connection.opened",
            message: "XFS4IoT connection opened.",
            metadata: { protocol: socket.protocol || null }
          });
          resolve();
        },
        message: (event) => {
          if (!opened || disconnected) return;
          this.handleMessage(event);
        },
        error: (event) => {
          if (!opened) {
            failBeforeOpen("XFS4IoT WebSocket failed before open.", event);
            return;
          }
          disconnect("XFS4IoT connection failed after command send.");
        },
        close: () => {
          if (!opened) {
            failBeforeOpen("XFS4IoT WebSocket closed before open.");
            return;
          }
          disconnect("XFS4IoT connection closed before command completion.");
        }
      };

      try {
        socket = this.webSocketFactory(
          this.url,
          this.protocols,
          this.maxMessageBytes
        );
      } catch (cause) {
        reject(new Error("XFS4IoT WebSocket could not be created.", { cause }));
        return;
      }
      this.openingSocket = socket;
      socket.addEventListener("open", listeners.open);
      socket.addEventListener("message", listeners.message);
      socket.addEventListener("error", listeners.error);
      socket.addEventListener("close", listeners.close);
      timer = setTimeout(
        () => failBeforeOpen("XFS4IoT connection timed out."),
        Math.max(1, timeoutMs)
      );
      if (socket.readyState === OPEN) queueMicrotask(() => listeners.open({}));
      else if (socket.readyState === CLOSING || socket.readyState === CLOSED) {
        queueMicrotask(() => listeners.close({}));
      }
    });
  }

  private handleMessage(event: unknown): void {
    const text = messageText(event);
    if (text === undefined) {
      this.failProtocol("XFS4IoT service returned a non-text message.");
      return;
    }
    let message: Xfs4IotMessage;
    try {
      if (Buffer.byteLength(text, "utf8") > this.maxMessageBytes) {
        throw new Error(`Message exceeds ${this.maxMessageBytes} bytes.`);
      }
      message = parseXfs4IotText(text);
    } catch (cause) {
      this.failProtocol("XFS4IoT service returned an invalid message.", cause);
      return;
    }

    if (message.header.type === "acknowledge") {
      this.handleAcknowledge(message);
      return;
    }
    if (message.header.type === "completion") {
      this.handleCompletion(message as Xfs4IotCompletion);
      return;
    }
    if (
      message.header.type === "event" ||
      message.header.type === "unsolicited"
    ) {
      this.routeEvent(message as Xfs4IotEvent);
      return;
    }
    this.failProtocol("XFS4IoT service sent a client-only command message.");
  }

  private handleAcknowledge(message: Xfs4IotMessage): void {
    const requestId = message.header.requestId;
    const pending = requestId === undefined ? undefined : this.pending.get(requestId);
    if (!pending) {
      this.logLateMessage(message);
      return;
    }
    if (message.header.name !== pending.name) {
      this.rejectPending(
        pending,
        failure(
          "PROTOCOL_ERROR",
          "XFS4IoT acknowledgement name did not match the request.",
          "protocol",
          pending
        )
      );
      return;
    }
    if (message.header.status !== undefined) {
      this.rejectPending(
        pending,
        new Xfs4IotClientError(
          `XFS4IoT service rejected ${pending.name}: ${message.header.status}.`,
          {
            code: "ACKNOWLEDGE_REJECTED",
            classification: "known",
            phase: "response",
            requestId: pending.requestId,
            commandName: pending.name,
            requestSent: true
          }
        )
      );
    }
  }

  private handleCompletion(message: Xfs4IotCompletion): void {
    const pending = this.pending.get(message.header.requestId);
    if (!pending) {
      this.logLateMessage(message);
      return;
    }
    if (
      message.header.name !== pending.name ||
      message.header.version !== pending.expectedVersion
    ) {
      this.rejectPending(
        pending,
        failure(
          "PROTOCOL_ERROR",
          "XFS4IoT completion did not match the pending command.",
          "protocol",
          pending
        )
      );
      return;
    }
    this.resolvePending(pending, message);
  }

  private routeEvent(message: Xfs4IotEvent): void {
    const requestId = message.header.requestId;
    const pending = requestId === undefined ? undefined : this.pending.get(requestId);
    const routed: RoutedXfs4IotEvent = {
      message,
      correlation:
        message.header.type === "unsolicited"
          ? "unsolicited"
          : pending
            ? "pending"
            : "orphan",
      commandName: pending?.name
    };
    if (this.eventBacklog.length >= this.maxEventBacklog) {
      this.eventBacklog.shift();
      this.log({
        level: "warn",
        event: "event.backlog_overflow",
        message: "Oldest XFS4IoT event was dropped from the bounded backlog.",
        metadata: { maxEventBacklog: this.maxEventBacklog }
      });
    }
    this.eventBacklog.push(routed);
    if (routed.correlation === "orphan") {
      this.log({
        level: "warn",
        event: "event.orphaned",
        message: "XFS4IoT event did not match a pending request.",
        metadata: diagnosticHeader(message)
      });
    }
    for (const listener of [...this.listeners]) {
      try {
        listener(routed);
      } catch {
        this.log({
          level: "warn",
          event: "event.listener_failed",
          message: "XFS4IoT event listener threw an exception."
        });
      }
    }
  }

  private failProtocol(message: string, cause?: unknown): void {
    this.log({
      level: "error",
      event: "protocol.invalid_message",
      message
    });
    const socket = this.socket;
    this.detachCurrentSocket();
    this.socket = undefined;
    safeClose(socket, 1002, "protocol error");
    for (const pending of [...this.pending.values()]) {
      this.rejectPending(
        pending,
        failure("PROTOCOL_ERROR", message, "protocol", pending, cause)
      );
    }
  }

  private rejectAllForDisconnect(message: string): void {
    for (const pending of [...this.pending.values()]) {
      this.rejectPending(
        pending,
        failure("CONNECTION_LOST", message, "response", pending)
      );
    }
  }

  private timeoutPending(requestId: number): void {
    const pending = this.pending.get(requestId);
    if (!pending) return;
    const shouldCancel = pending.sent && pending.cancelOnAbort;
    this.rejectPending(
      pending,
      failure(
        "DEADLINE_EXCEEDED",
        "XFS4IoT command deadline exceeded.",
        pending.sent ? "response" : "connect",
        pending
      )
    );
    if (shouldCancel) this.cancelBestEffort(requestId);
  }

  private abortPending(requestId: number, reason: unknown): void {
    const pending = this.pending.get(requestId);
    if (!pending) return;
    const shouldCancel = pending.sent && pending.cancelOnAbort;
    this.rejectPending(
      pending,
      failure(
        "ABORTED",
        reason instanceof Error ? reason.message : "XFS4IoT command was aborted.",
        pending.sent ? "response" : "connect",
        pending,
        reason
      )
    );
    if (shouldCancel) this.cancelBestEffort(requestId);
  }

  private cancelBestEffort(requestId: number): void {
    void this.cancel([requestId], { timeoutMs: 5_000 }).catch((error: unknown) => {
      this.log({
        level: "warn",
        event: "cancel.failed",
        message: "Best-effort XFS4IoT cancellation did not complete.",
        metadata: {
          requestId,
          failurePhase:
            error instanceof Xfs4IotClientError ? error.phase : "cancel"
        }
      });
    });
  }

  private resolvePending(
    pending: PendingCommand,
    completion: Xfs4IotCompletion
  ): void {
    if (!this.removePending(pending)) return;
    pending.resolve(completion);
  }

  private rejectPending(
    pending: PendingCommand,
    error: Xfs4IotClientError
  ): void {
    if (!this.removePending(pending)) return;
    pending.reject(error);
  }

  private removePending(pending: PendingCommand): boolean {
    if (pending.settled || this.pending.get(pending.requestId) !== pending) {
      return false;
    }
    pending.settled = true;
    this.pending.delete(pending.requestId);
    clearTimeout(pending.timer);
    if (pending.signal && pending.abortListener) {
      pending.signal.removeEventListener("abort", pending.abortListener);
    }
    return true;
  }

  private allocateRequestId(): number {
    const requestId = this.nextRequestId();
    if (
      !Number.isSafeInteger(requestId) ||
      requestId < 1 ||
      this.pending.has(requestId)
    ) {
      throw new RangeError("XFS4IoT request id must be a unique positive integer.");
    }
    return requestId;
  }

  private detachCurrentSocket(): void {
    this.detachSocket?.();
    this.detachSocket = undefined;
  }

  private logLateMessage(message: Xfs4IotMessage): void {
    this.log({
      level: "warn",
      event: "message.late_or_duplicate",
      message: "Late, duplicate, or uncorrelated XFS4IoT message was ignored.",
      metadata: diagnosticHeader(message)
    });
  }

  private log(entry: Xfs4IotDiagnosticEntry): void {
    try {
      this.logger?.log(entry);
    } catch {
      // Diagnostics must never affect protocol state.
    }
  }
}

function failure(
  code: Xfs4IotClientError["code"],
  message: string,
  phase: Xfs4IotClientError["phase"],
  pending: PendingCommand,
  cause?: unknown
): Xfs4IotClientError {
  return new Xfs4IotClientError(message, {
    code,
    classification: classifyTransportFailure(
      pending.sent,
      pending.stateChanging
    ),
    phase,
    requestId: pending.requestId,
    commandName: pending.name,
    requestSent: pending.sent,
    cause
  });
}

export function failureRequiresReconciliation(
  error: Xfs4IotClientError
): boolean {
  return error.classification === "indeterminate";
}

export function asFailureClassification(
  error: unknown
): Xfs4IotFailureClassification | undefined {
  return error instanceof Xfs4IotClientError ? error.classification : undefined;
}

function validateUrl(value: string, allowInsecureLoopback: boolean): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("XFS4IoT URL must be an absolute WebSocket URL.");
  }
  if (url.username || url.password) {
    throw new TypeError("XFS4IoT URL cannot contain embedded credentials.");
  }
  if (url.hash) throw new TypeError("XFS4IoT URL cannot contain a fragment.");
  if (url.protocol === "wss:") return url.toString();
  if (
    url.protocol === "ws:" &&
    allowInsecureLoopback &&
    (url.hostname === "127.0.0.1" || url.hostname === "[::1]")
  ) {
    return url.toString();
  }
  throw new TypeError(
    "XFS4IoT requires wss, except explicit plaintext IP-loopback development."
  );
}

function validateProtocols(protocols: readonly string[]): readonly string[] {
  if (
    new Set(protocols).size !== protocols.length ||
    protocols.some((protocol) => !protocolToken.test(protocol))
  ) {
    throw new TypeError("WebSocket subprotocols must be unique valid tokens.");
  }
  return Object.freeze([...protocols]);
}

function boundedPositiveInteger(
  value: number,
  maximum: number,
  field: string
): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new RangeError(`${field} must be an integer between 1 and ${maximum}.`);
  }
  return value;
}

function sequentialRequestIds(): () => number {
  let current = 0;
  return () => {
    current = current >= 2_147_483_647 ? 1 : current + 1;
    return current;
  };
}

function messageText(event: unknown): string | undefined {
  if (typeof event === "string") return event;
  if (
    typeof event === "object" &&
    event !== null &&
    "data" in event &&
    typeof (event as { data?: unknown }).data === "string"
  ) {
    return (event as { data: string }).data;
  }
  return undefined;
}

function safeClose(
  socket: Xfs4IotWebSocket | undefined,
  code: number,
  reason: string
): void {
  if (!socket || socket.readyState === CLOSING || socket.readyState === CLOSED) {
    return;
  }
  try {
    socket.close(code, reason);
  } catch {
    // Closing is best effort after protocol state is settled.
  }
}

function waitForPromise(promise: Promise<void>, signal?: AbortSignal): Promise<void> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(signal.reason);
    };
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      () => {
        cleanup();
        resolve();
      },
      (error) => {
        cleanup();
        reject(error);
      }
    );
  });
}

function defaultDelay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function defaultWebSocketFactory(
  url: string,
  protocols: readonly string[]
): Xfs4IotWebSocket {
  const Constructor = (globalThis as unknown as {
    WebSocket?: new (url: string, protocols?: string[]) => Xfs4IotWebSocket;
  }).WebSocket;
  if (!Constructor) {
    throw new Error("This runtime does not provide a WebSocket client.");
  }
  return protocols.length > 0
    ? new Constructor(url, [...protocols])
    : new Constructor(url);
}
