import { lstat, mkdir, open } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { AdapterOperationContext } from "../../runtime-contracts/src/index.js";
import type { Iso8583Transport } from "./index.js";
import { withFileLock } from "./file-lock.js";

export type ReversalIntent = {
  id: string;
  transaction: string;
  originalTrace: string;
  amountMinor: number;
  currencyNumericCode: string;
  terminalId: string;
  transmissionDateTime: string;
  reason: string;
};

export type ReversalRecord = ReversalIntent & {
  status: "pending" | "completed";
  attempts: number;
  createdAt: string;
  updatedAt: string;
  lastError?: string;
};

type ReversalEvent =
  | { type: "queued"; ts: string; intent: ReversalIntent }
  | { type: "attempted"; ts: string; id: string }
  | { type: "failed"; ts: string; id: string; error: string }
  | { type: "completed"; ts: string; id: string };

export class JsonlReversalStore {
  readonly path: string;
  private readonly maxFileBytes: number;
  private readonly maxRecords: number;
  private readonly maxEvents: number;
  private readonly now: () => Date;
  private mutation = Promise.resolve();

  constructor(options: {
    path: string;
    maxFileBytes?: number;
    maxRecords?: number;
    maxEvents?: number;
    now?: () => Date;
  }) {
    if (!options.path.trim()) throw new Error("Reversal store path is required.");
    this.path = resolve(options.path);
    this.maxFileBytes = positiveInteger(
      options.maxFileBytes ?? 10 * 1024 * 1024,
      "maxFileBytes"
    );
    this.maxRecords = positiveInteger(
      options.maxRecords ?? 10_000,
      "maxRecords"
    );
    this.maxEvents = positiveInteger(options.maxEvents ?? 100_000, "maxEvents");
    this.now = options.now ?? (() => new Date());
  }

  enqueue(intent: ReversalIntent): Promise<ReversalRecord> {
    validateIntent(intent);
    return this.mutate(async () => {
      const records = await this.load();
      const existing = records.get(intent.id);
      if (existing) {
        if (!sameIntent(existing, intent)) {
          throw new Error(`Reversal id ${intent.id} already has different data.`);
        }
        return existing;
      }
      if (records.size >= this.maxRecords) {
        throw new Error("Reversal store reached its configured record limit.");
      }
      const ts = timestamp(this.now());
      await this.append({ type: "queued", ts, intent });
      return {
        ...intent,
        status: "pending",
        attempts: 0,
        createdAt: ts,
        updatedAt: ts
      };
    });
  }

  pending(limit = 100): Promise<ReversalRecord[]> {
    positiveInteger(limit, "limit");
    return this.mutate(async () => [...(await this.load()).values()]
        .filter((record) => record.status === "pending")
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .slice(0, limit)
    );
  }

  beginAttempt(id: string): Promise<void> {
    return this.transition(id, "attempted");
  }

  markFailed(id: string, error: string): Promise<void> {
    if (!error.trim() || error.length > 500) {
      throw new Error("Reversal failure must be a bounded non-empty message.");
    }
    return this.transition(id, "failed", boundedError(error));
  }

  markCompleted(id: string): Promise<void> {
    return this.transition(id, "completed");
  }

  private transition(
    id: string,
    type: "attempted" | "failed" | "completed",
    error?: string
  ): Promise<void> {
    return this.mutate(async () => {
      const record = (await this.load()).get(id);
      if (!record) throw new Error(`Unknown reversal id ${id}.`);
      if (record.status === "completed") {
        if (type === "completed") return;
        throw new Error(`Reversal ${id} is already completed.`);
      }
      const ts = timestamp(this.now());
      await this.append(
        type === "failed"
          ? { type, ts, id, error: error! }
          : { type, ts, id }
      );
    });
  }

  private async load(): Promise<Map<string, ReversalRecord>> {
    const handle = await openVerifiedRegularFile(this.path, "r", false);
    if (!handle) return new Map();
    let text: string;
    try {
      const info = await handle.stat();
      if (info.size > this.maxFileBytes) {
        throw new Error("Reversal store exceeds its configured byte limit.");
      }
      text = await handle.readFile("utf8");
    } finally {
      await handle.close();
    }
    const records = new Map<string, ReversalRecord>();
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length > this.maxEvents) {
      throw new Error("Reversal store contains too many events.");
    }
    for (const line of lines) {
      if (Buffer.byteLength(line, "utf8") > 8_192) {
        throw new Error("Reversal store contains an oversized event.");
      }
      let event: unknown;
      try {
        event = JSON.parse(line) as unknown;
      } catch {
        throw new Error("Reversal store contains invalid JSON.");
      }
      applyEvent(records, parseEvent(event));
    }
    return records;
  }

  private async append(event: ReversalEvent): Promise<void> {
    const line = `${JSON.stringify(event)}\n`;
    if (Buffer.byteLength(line, "utf8") > 8_192) {
      throw new Error("Reversal event exceeds 8192 bytes.");
    }
    await mkdir(dirname(this.path), { recursive: true });
    const handle = await openVerifiedRegularFile(this.path, "r+", true);
    if (!handle) throw new Error("Failed to create reversal store.");
    try {
      const info = await handle.stat();
      if (info.size + Buffer.byteLength(line, "utf8") > this.maxFileBytes) {
        throw new Error("Reversal store exceeds its configured byte limit.");
      }
      const text = await handle.readFile("utf8");
      const events = text.split(/\r?\n/).filter(Boolean).length;
      if (events >= this.maxEvents) {
        throw new Error("Reversal store reached its configured event limit.");
      }
      await handle.write(line, info.size, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const guarded = async () => {
      await mkdir(dirname(this.path), { recursive: true });
      return withFileLock(`${this.path}.lock`, 5_000, async () => {
        await this.repairPartialTail();
        return operation();
      });
    };
    const result = this.mutation.then(guarded, guarded);
    this.mutation = result.then(() => undefined, () => undefined);
    return result;
  }

  private async repairPartialTail(): Promise<void> {
    const handle = await openVerifiedRegularFile(this.path, "r+", false);
    if (!handle) return;
    try {
      const text = await handle.readFile("utf8");
      if (!text || text.endsWith("\n")) return;
      const lastNewline = text.lastIndexOf("\n");
      const tail = text.slice(lastNewline + 1);
      try {
        parseEvent(JSON.parse(tail) as unknown);
        await handle.write("\n", Buffer.byteLength(text), "utf8");
      } catch {
        await handle.truncate(
          lastNewline < 0
            ? 0
            : Buffer.byteLength(text.slice(0, lastNewline + 1))
        );
      }
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
}

export class ReversalProcessor {
  constructor(
    private readonly options: {
      store: JsonlReversalStore;
      transport: Iso8583Transport;
      buildMessage(intent: ReversalIntent): string;
      acceptResponse(intent: ReversalIntent, response: string): boolean;
      maxBatch?: number;
    }
  ) {}

  async process(context?: AdapterOperationContext): Promise<{
    attempted: number;
    completed: number;
    failed: number;
  }> {
    context?.signal.throwIfAborted();
    await mkdir(dirname(this.options.store.path), { recursive: true });
    return withFileLock(
      `${this.options.store.path}.processor.lock`,
      5_000,
      async () => {
        const records = await this.options.store.pending(
          positiveInteger(this.options.maxBatch ?? 100, "maxBatch")
        );
        let completed = 0;
        let failed = 0;
        for (const record of records) {
          context?.signal.throwIfAborted();
          await this.options.store.beginAttempt(record.id);
          try {
            const message = this.options.buildMessage(record);
            const response = await this.options.transport.exchange(message, context);
            if (!this.options.acceptResponse(record, response)) {
              throw new Error("Host did not acknowledge reversal.");
            }
            await this.options.store.markCompleted(record.id);
            completed += 1;
          } catch (error) {
            const message = boundedError(error);
            await this.options.store.markFailed(record.id, message);
            if (context?.signal.aborted) {
              context.signal.throwIfAborted();
            }
            failed += 1;
          }
        }
        return { attempted: records.length, completed, failed };
      },
      10,
      context?.signal
    );
  }
}

function applyEvent(
  records: Map<string, ReversalRecord>,
  event: ReversalEvent
): void {
  if (event.type === "queued") {
    if (records.has(event.intent.id)) {
      throw new Error(`Duplicate queued reversal id ${event.intent.id}.`);
    }
    records.set(event.intent.id, {
      ...event.intent,
      status: "pending",
      attempts: 0,
      createdAt: event.ts,
      updatedAt: event.ts
    });
    return;
  }
  const record = records.get(event.id);
  if (!record) throw new Error(`Reversal event references unknown id ${event.id}.`);
  if (record.status === "completed" && event.type !== "completed") {
    throw new Error(`Reversal ${event.id} changed after completion.`);
  }
  record.updatedAt = event.ts;
  if (event.type === "attempted") record.attempts += 1;
  if (event.type === "failed") record.lastError = event.error;
  if (event.type === "completed") record.status = "completed";
}

function parseEvent(value: unknown): ReversalEvent {
  if (!isRecord(value) || typeof value.type !== "string" || !validTs(value.ts)) {
    throw new Error("Reversal event schema is invalid.");
  }
  if (value.type === "queued") {
    requireExactKeys(value, ["type", "ts", "intent"]);
    validateIntent(value.intent);
    return { type: "queued", ts: value.ts, intent: value.intent };
  }
  if (
    ["attempted", "completed"].includes(value.type) &&
    typeof value.id === "string"
  ) {
    requireExactKeys(value, ["type", "ts", "id"]);
    return { type: value.type as "attempted" | "completed", ts: value.ts, id: value.id };
  }
  if (
    value.type === "failed" &&
    typeof value.id === "string" &&
    typeof value.error === "string" &&
    value.error.length <= 500
  ) {
    requireExactKeys(value, ["type", "ts", "id", "error"]);
    return { type: "failed", ts: value.ts, id: value.id, error: value.error };
  }
  throw new Error("Reversal event schema is invalid.");
}

function requireExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[]
): void {
  if (
    Object.keys(value).length !== allowed.length ||
    Object.keys(value).some((key) => !allowed.includes(key))
  ) {
    throw new Error("Reversal event schema is invalid.");
  }
}

function validateIntent(value: unknown): asserts value is ReversalIntent {
  const allowed = [
    "id", "transaction", "originalTrace", "amountMinor",
    "currencyNumericCode", "terminalId", "transmissionDateTime", "reason"
  ];
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => !allowed.includes(key)) ||
    typeof value.id !== "string" ||
    !/^[A-Za-z0-9._:-]{1,128}$/.test(value.id) ||
    typeof value.transaction !== "string" ||
    !/^[A-Za-z][A-Za-z0-9._:-]{0,63}$/.test(value.transaction) ||
    typeof value.originalTrace !== "string" ||
    !/^\d{6}$/.test(value.originalTrace) ||
    !Number.isSafeInteger(value.amountMinor) ||
    (value.amountMinor as number) < 0 ||
    (value.amountMinor as number) > 999_999_999_999 ||
    typeof value.currencyNumericCode !== "string" ||
    !/^\d{3}$/.test(value.currencyNumericCode) ||
    typeof value.terminalId !== "string" ||
    !/^[\x20-\x7E]{1,8}$/.test(value.terminalId) ||
    typeof value.transmissionDateTime !== "string" ||
    !/^\d{10}$/.test(value.transmissionDateTime) ||
    typeof value.reason !== "string" ||
    !/^[a-z][a-z0-9_]{0,63}$/.test(value.reason)
  ) {
    throw new Error("Reversal intent is invalid.");
  }
}

function sameIntent(record: ReversalRecord, intent: ReversalIntent): boolean {
  return (Object.keys(intent) as (keyof ReversalIntent)[]).every(
    (key) => record[key] === intent[key]
  );
}

function timestamp(date: Date): string {
  if (!Number.isFinite(date.getTime())) throw new Error("Reversal timestamp is invalid.");
  return date.toISOString();
}

function validTs(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function boundedError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const scrubbed = message.replace(/\d{12,19}/g, "[redacted]").replace(/[\r\n]+/g, " ");
  return scrubbed.trim().slice(0, 500) || "Unknown reversal error.";
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
  return value;
}

function hasCode(error: unknown, code: string): boolean {
  return isRecord(error) && error.code === code;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function openVerifiedRegularFile(
  path: string,
  flags: "r" | "r+",
  create: boolean
): Promise<FileHandle | undefined> {
  for (;;) {
    let before;
    try {
      before = await lstat(path);
    } catch (error) {
      if (!hasCode(error, "ENOENT")) throw error;
      if (!create) return undefined;
      try {
        const created = await open(path, "wx+", 0o600);
        try {
          await verifyOpenFile(path, created);
          return created;
        } catch (verificationError) {
          await created.close();
          throw verificationError;
        }
      } catch (createError) {
        if (hasCode(createError, "EEXIST")) continue;
        throw createError;
      }
    }
    if (!before.isFile() || before.isSymbolicLink()) {
      throw new Error("Reversal store must be a regular file.");
    }
    const handle = await open(path, flags);
    try {
      await verifyOpenFile(path, handle);
      return handle;
    } catch (error) {
      await handle.close();
      throw error;
    }
  }
}

async function verifyOpenFile(path: string, handle: FileHandle): Promise<void> {
  const [opened, current] = await Promise.all([handle.stat(), lstat(path)]);
  if (
    !opened.isFile() ||
    !current.isFile() ||
    current.isSymbolicLink() ||
    opened.dev !== current.dev ||
    opened.ino !== current.ino
  ) {
    throw new Error("Reversal store path changed or is not a regular file.");
  }
}
