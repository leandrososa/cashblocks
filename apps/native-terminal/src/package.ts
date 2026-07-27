import {
  cp,
  mkdir,
  mkdtemp,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const releaseRoot = resolve("release/native-terminal");
const releaseParent = dirname(releaseRoot);
await mkdir(releaseParent, { recursive: true });
const stagingRoot = await mkdtemp(join(releaseParent, ".native-terminal-stage-"));
const executableName =
  process.platform === "win32" ? "cashblocks-terminal.exe" : "cashblocks-terminal";
const executablePath = resolve(stagingRoot, executableName);

try {
  const build = spawnSync(
    "bun",
    [
      "build",
      "apps/native-terminal/src/main.ts",
      "--compile",
      "--outfile",
      executablePath
    ],
    { stdio: "inherit", shell: process.platform === "win32" }
  );
  if (build.error) {
    throw build.error;
  }
  if (build.status !== 0) {
    throw new Error(
      `Native executable build failed with status ${build.status}.`
    );
  }

  await cp(
    resolve("apps/customer-terminal/public"),
    resolve(stagingRoot, "apps/customer-terminal/public"),
    { recursive: true, force: true }
  );
  await writeFile(
    resolve(stagingRoot, "package-manifest.json"),
    `${JSON.stringify(
      {
        name: "cashblocks-native-terminal",
        version: "0.1.0",
        executable: executableName,
        entryUrl: "http://127.0.0.1:4174",
        healthUrl: "http://127.0.0.1:4174/health",
        journal: "data/native-terminal.journal.jsonl"
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const backupRoot = resolve(
    releaseParent,
    `.native-terminal-backup-${randomUUID()}`
  );
  let hasBackup = false;
  try {
    await rename(releaseRoot, backupRoot);
    hasBackup = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
  try {
    await rename(stagingRoot, releaseRoot);
  } catch (error) {
    if (hasBackup) {
      await rename(backupRoot, releaseRoot);
    }
    throw error;
  }
  if (hasBackup) {
    await rm(backupRoot, { recursive: true, force: true });
  }
} catch (error) {
  await rm(stagingRoot, { recursive: true, force: true });
  throw error;
}

console.log(`Native terminal package written to ${releaseRoot}`);
