import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DurableStanAllocator } from "./stan-store.js";

test("durable STAN allocator persists and serializes concurrent allocations", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cashblocks-stan-"));
  const path = join(directory, "stan.json");
  const first = new DurableStanAllocator({ path, retryDelayMs: 1 });
  const second = new DurableStanAllocator({ path, retryDelayMs: 1 });

  const values = await Promise.all([
    ...Array.from({ length: 25 }, () => first.next()),
    ...Array.from({ length: 25 }, () => second.next())
  ]);

  assert.deepEqual(
    [...values].sort((left, right) => left - right),
    Array.from({ length: 50 }, (_, index) => index + 1)
  );
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), {
    version: 1,
    last: 50
  });
  const restarted = new DurableStanAllocator({ path });
  assert.equal(await restarted.next(), 51);
});

test("durable STAN allocator wraps and rejects corrupt state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cashblocks-stan-"));
  const path = join(directory, "stan.json");
  await writeFile(path, '{"version":1,"last":999999}\n', "utf8");
  const allocator = new DurableStanAllocator({ path });
  assert.equal(await allocator.next(), 1);

  await writeFile(path, '{"version":1,"last":"bad"}\n', "utf8");
  await assert.rejects(() => allocator.next(), /state is invalid/);
});
