import { open, readFile, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";

export async function withFileLock<T>(
  lockPath: string,
  timeoutMs: number,
  operation: () => Promise<T>,
  retryDelayMs = 10,
  signal?: AbortSignal
): Promise<T> {
  const token = randomUUID();
  const started = Date.now();
  while (true) {
    signal?.throwIfAborted();
    try {
      const handle = await open(lockPath, "wx", 0o600);
      try {
        await handle.writeFile(JSON.stringify({ token, pid: process.pid }), "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      break;
    } catch (error) {
      if (!contention(error)) throw error;
      if (Date.now() - started >= timeoutMs) {
        throw new Error(`Timed out acquiring lock ${lockPath}.`);
      }
      await abortableDelay(retryDelayMs, signal);
    }
  }
  try {
    signal?.throwIfAborted();
    return await operation();
  } finally {
    const value = JSON.parse(await readFile(lockPath, "utf8")) as unknown;
    if (
      typeof value !== "object" ||
      value === null ||
      !("token" in value) ||
      value.token !== token
    ) {
      throw new Error(`Lock ownership changed for ${lockPath}.`);
    }
    await unlink(lockPath);
  }
}

function abortableDelay(durationMs: number, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    return new Promise((resolve) => setTimeout(resolve, durationMs));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, durationMs);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function contention(error: unknown): boolean {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? (error as { code?: unknown }).code
      : undefined;
  return code === "EEXIST" || code === "EPERM" || code === "EACCES";
}
