import { lstat, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { withFileLock } from "./file-lock.js";

export type DurableStanAllocatorOptions = {
  path: string;
  lockTimeoutMs?: number;
  staleLockMs?: number;
  retryDelayMs?: number;
  now?: () => number;
};

type StanState = {
  version: 1;
  last: number;
};

export class DurableStanAllocator {
  readonly path: string;
  private readonly lockPath: string;
  private readonly lockTimeoutMs: number;
  private readonly retryDelayMs: number;

  constructor(options: DurableStanAllocatorOptions) {
    if (!options.path.trim()) throw new Error("STAN state path is required.");
    this.path = resolve(options.path);
    this.lockPath = `${this.path}.lock`;
    this.lockTimeoutMs = positiveInteger(
      options.lockTimeoutMs ?? 5_000,
      "lockTimeoutMs"
    );
    this.retryDelayMs = positiveInteger(
      options.retryDelayMs ?? 10,
      "retryDelayMs"
    );
    if (options.staleLockMs !== undefined) {
      throw new Error("Automatic stale-lock removal is unsafe and unsupported.");
    }
  }

  async next(): Promise<number> {
    await mkdir(dirname(this.path), { recursive: true });
    return withFileLock(
      this.lockPath,
      this.lockTimeoutMs,
      async () => {
        const state = await this.readState();
        const next = (state.last % 999_999) + 1;
        await this.writeState({ version: 1, last: next });
        return next;
      },
      this.retryDelayMs
    );
  }

  private async readState(): Promise<StanState> {
    let text: string;
    try {
      const info = await lstat(this.path);
      if (!info.isFile() || info.isSymbolicLink()) {
        throw new Error("Durable STAN state must be a regular file.");
      }
      text = await readFile(this.path, "utf8");
    } catch (error) {
      if (hasCode(error, "ENOENT")) return { version: 1, last: 0 };
      throw error;
    }
    if (Buffer.byteLength(text, "utf8") > 1024) {
      throw new Error("Durable STAN state exceeds 1024 bytes.");
    }
    let value: unknown;
    try {
      value = JSON.parse(text) as unknown;
    } catch {
      throw new Error("Durable STAN state is not valid JSON.");
    }
    if (
      !isRecord(value) ||
      value.version !== 1 ||
      !Number.isSafeInteger(value.last) ||
      (value.last as number) < 0 ||
      (value.last as number) > 999_999
    ) {
      throw new Error("Durable STAN state is invalid.");
    }
    return { version: 1, last: value.last as number };
  }

  private async writeState(state: StanState): Promise<void> {
    const temporary = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(state)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(temporary, this.path);
      await syncParentDirectory(this.path);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }
}

async function syncParentDirectory(path: string): Promise<void> {
  let directory;
  try {
    directory = await open(dirname(path), "r");
    await directory.sync();
  } catch (error) {
    if (process.platform === "win32" && hasCode(error, "EPERM")) return;
    throw error;
  } finally {
    await directory?.close();
  }
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
  return value;
}

function hasCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
