import { connect as connectTcp } from "node:net";
import { connect as connectTls } from "node:tls";
import type { ConnectionOptions } from "node:tls";

import type { AdapterOperationContext } from "../../runtime-contracts/src/index.js";
import type { Iso8583Transport } from "./index.js";

export type HostSocket = {
  readonly destroyed: boolean;
  readonly authorized?: boolean;
  readonly authorizationError?: unknown;
  once(event: string, listener: (...args: unknown[]) => void): HostSocket;
  on(event: string, listener: (...args: unknown[]) => void): HostSocket;
  removeListener(event: string, listener: (...args: unknown[]) => void): HostSocket;
  write(data: Uint8Array): boolean;
  end(): void;
  destroy(error?: Error): void;
};

export type FramedIso8583TransportOptions = {
  host: string;
  port: number;
  tls?: {
    servername?: string;
    ca?: string | Buffer | readonly (string | Buffer)[];
    cert?: string | Buffer;
    key?: string | Buffer;
    minVersion?: "TLSv1.2" | "TLSv1.3";
  };
  allowInsecureLoopback?: boolean;
  lengthBytes?: 2 | 4;
  connectTimeoutMs?: number;
  responseTimeoutMs?: number;
  maxFrameBytes?: number;
  socketFactory?: (
    options: FramedIso8583TransportOptions,
    secure: boolean
  ) => HostSocket;
  now?: () => number;
};

export class FramedIso8583Transport implements Iso8583Transport {
  private readonly options: FramedIso8583TransportOptions;
  private readonly secure: boolean;
  private readonly lengthBytes: 2 | 4;
  private readonly connectTimeoutMs: number;
  private readonly responseTimeoutMs: number;
  private readonly maxFrameBytes: number;
  private readonly socketFactory: NonNullable<
    FramedIso8583TransportOptions["socketFactory"]
  >;
  private readonly now: () => number;

  constructor(options: FramedIso8583TransportOptions) {
    if (!options.host.trim() || options.host.length > 253) {
      throw new Error("ISO8583 host must be a bounded non-empty hostname.");
    }
    if (!Number.isSafeInteger(options.port) || options.port < 1 || options.port > 65_535) {
      throw new Error("ISO8583 host port must be between 1 and 65535.");
    }
    this.secure = Boolean(options.tls);
    if (!this.secure) {
      if (!options.allowInsecureLoopback || !isLoopback(options.host)) {
        throw new Error(
          "ISO8583 transport requires TLS; plaintext is limited to opted-in loopback."
        );
      }
    }
    this.lengthBytes = options.lengthBytes ?? 2;
    this.connectTimeoutMs = positiveInteger(
      options.connectTimeoutMs ?? 5_000,
      "connectTimeoutMs"
    );
    this.responseTimeoutMs = positiveInteger(
      options.responseTimeoutMs ?? 30_000,
      "responseTimeoutMs"
    );
    this.maxFrameBytes = positiveInteger(
      options.maxFrameBytes ?? 0xffff,
      "maxFrameBytes"
    );
    const representable = this.lengthBytes === 2 ? 0xffff : 0xffffffff;
    if (this.maxFrameBytes > representable) {
      throw new Error("maxFrameBytes exceeds the selected length header.");
    }
    this.options = options;
    this.socketFactory = options.socketFactory ?? defaultSocketFactory;
    this.now = options.now ?? Date.now;
  }

  async exchange(
    message: string,
    context?: AdapterOperationContext
  ): Promise<string> {
    context?.signal.throwIfAborted();
    if (!/^[\x20-\x7E]+$/.test(message)) {
      throw new Error("ISO8583 framed payload must contain printable ASCII.");
    }
    const payload = Buffer.from(message, "ascii");
    if (payload.byteLength > this.maxFrameBytes) {
      throw new Error(`ISO8583 request exceeds ${this.maxFrameBytes} bytes.`);
    }
    if (context && deadlineElapsed(context, this.now)) {
      throw new Error("ISO8583 operation deadline elapsed before connect.");
    }
    const frame = Buffer.allocUnsafe(this.lengthBytes + payload.byteLength);
    if (this.lengthBytes === 2) frame.writeUInt16BE(payload.byteLength, 0);
    else frame.writeUInt32BE(payload.byteLength, 0);
    payload.copy(frame, this.lengthBytes);

    return new Promise<string>((resolve, reject) => {
      let socket: HostSocket;
      let settled = false;
      let connected = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let expectedLength: number | undefined;
      let received = 0;
      const chunks: Buffer[] = [];

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        context?.signal.removeEventListener("abort", onAbort);
        socket.removeListener("secureConnect", onConnect);
        socket.removeListener("connect", onConnect);
        socket.removeListener("data", onData);
        socket.removeListener("error", onError);
        socket.removeListener("close", onClose);
      };
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        socket.destroy();
        reject(error);
      };
      const succeed = (response: string) => {
        if (settled) return;
        settled = true;
        cleanup();
        socket.end();
        resolve(response);
      };
      const armTimer = (duration: number, message: string) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => fail(new Error(message)), duration);
      };
      const onAbort = () =>
        fail(
          context?.signal.reason instanceof Error
            ? context.signal.reason
            : new Error("ISO8583 operation aborted.")
        );
      const onConnect = () => {
        if (settled || connected) return;
        if (this.secure && socket.authorized !== true) {
          fail(
            new Error(
              `ISO8583 TLS authorization failed: ${errorMessage(socket.authorizationError)}.`
            )
          );
          return;
        }
        if (context && deadlineElapsed(context, this.now)) {
          fail(new Error("ISO8583 operation deadline elapsed before send."));
          return;
        }
        connected = true;
        socket.write(frame);
        armTimer(
          effectiveTimeout(this.responseTimeoutMs, context, this.now),
          "ISO8583 host response timed out."
        );
      };
      const onData = (...args: unknown[]) => {
        if (settled || !connected) return;
        const chunk = args[0];
        if (!Buffer.isBuffer(chunk)) {
          fail(new Error("ISO8583 host returned a non-buffer frame."));
          return;
        }
        chunks.push(chunk);
        received += chunk.byteLength;
        if (received > this.lengthBytes + this.maxFrameBytes) {
          fail(new Error("ISO8583 host frame exceeds the configured maximum."));
          return;
        }
        if (expectedLength === undefined && received >= this.lengthBytes) {
          const prefix = Buffer.concat(chunks, received);
          expectedLength =
            this.lengthBytes === 2
              ? prefix.readUInt16BE(0)
              : prefix.readUInt32BE(0);
          chunks.length = 0;
          chunks.push(prefix);
          if (expectedLength < 1 || expectedLength > this.maxFrameBytes) {
            fail(new Error("ISO8583 host frame length is invalid."));
            return;
          }
        }
        if (
          received >
          this.lengthBytes + (expectedLength ?? this.maxFrameBytes)
        ) {
          fail(new Error("ISO8583 host returned trailing frame data."));
          return;
        }
        if (
          expectedLength !== undefined &&
          received === this.lengthBytes + expectedLength
        ) {
          if (context && deadlineElapsed(context, this.now)) {
            fail(new Error("ISO8583 response arrived after the deadline."));
            return;
          }
          const response = Buffer.concat(chunks, received).subarray(this.lengthBytes);
          if (response.some((byte) => byte < 0x20 || byte > 0x7e)) {
            fail(new Error("ISO8583 response must contain printable ASCII."));
            return;
          }
          const text = response.toString("ascii");
          succeed(text);
        }
      };
      const onError = (...args: unknown[]) =>
        fail(args[0] instanceof Error ? args[0] : new Error("ISO8583 socket error."));
      const onClose = () => {
        if (!settled) fail(new Error("ISO8583 connection closed before a complete response."));
      };

      try {
        socket = this.socketFactory(this.options, this.secure);
      } catch (error) {
        reject(error);
        return;
      }
      context?.signal.addEventListener("abort", onAbort, { once: true });
      socket.once(this.secure ? "secureConnect" : "connect", onConnect);
      socket.on("data", onData);
      socket.once("error", onError);
      socket.once("close", onClose);
      armTimer(
        effectiveTimeout(this.connectTimeoutMs, context, this.now),
        "ISO8583 host connection timed out."
      );
    });
  }
}

function defaultSocketFactory(
  options: FramedIso8583TransportOptions,
  secure: boolean
): HostSocket {
  if (!secure) return connectTcp({ host: options.host, port: options.port }) as HostSocket;
  const tlsOptions: ConnectionOptions = {
    host: options.host,
    port: options.port,
    servername: options.tls?.servername ?? options.host,
    rejectUnauthorized: true,
    minVersion: options.tls?.minVersion ?? "TLSv1.2",
    ca: options.tls?.ca as ConnectionOptions["ca"],
    cert: options.tls?.cert,
    key: options.tls?.key
  };
  return connectTls(tlsOptions) as HostSocket;
}

function effectiveTimeout(
  configured: number,
  context: AdapterOperationContext | undefined,
  now: () => number
): number {
  if (!context) return configured;
  const deadline = Date.parse(context.deadlineAt);
  return Number.isFinite(deadline)
    ? Math.max(1, Math.min(configured, deadline - now()))
    : configured;
}

function deadlineElapsed(
  context: AdapterOperationContext,
  now: () => number
): boolean {
  const deadline = Date.parse(context.deadlineAt);
  return Number.isFinite(deadline) && deadline <= now();
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
  return value;
}

function isLoopback(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function errorMessage(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "string" && value.trim()) return value;
  return "unknown error";
}
