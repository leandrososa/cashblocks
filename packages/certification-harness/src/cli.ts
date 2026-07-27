#!/usr/bin/env bun

import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { runAtmCertificationSuite } from "./atm-profile.js";

export async function runCertificationCli(
  args: readonly string[],
  write: (text: string) => void = (text) => process.stdout.write(text),
  writeError: (text: string) => void = (text) => process.stderr.write(text)
): Promise<number> {
  let outputPath: string | undefined;
  let pretty = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--pretty") {
      pretty = true;
      continue;
    }
    if (argument === "--output") {
      if (outputPath) {
        writeError("--output may only be provided once.\n");
        return 2;
      }
      outputPath = args[index + 1];
      if (!outputPath || outputPath.startsWith("--")) {
        writeError("--output requires a file path.\n");
        return 2;
      }
      index += 1;
      continue;
    }
    if (argument === "--help") {
      write("Usage: bun run certify -- [--pretty] [--output report.json]\n");
      return 0;
    }
    writeError(`Unknown option: ${argument}\n`);
    return 2;
  }

  try {
    const report = await runAtmCertificationSuite();
    const json = `${JSON.stringify(report, null, pretty ? 2 : undefined)}\n`;
    if (outputPath) {
      await writeFile(resolve(outputPath), json, { encoding: "utf8", flag: "wx" });
    } else {
      write(json);
    }
    return report.passed ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeError(`Certification failed: ${message}\n`);
    return 2;
  }
}

if (import.meta.main) {
  process.exitCode = await runCertificationCli(process.argv.slice(2));
}
