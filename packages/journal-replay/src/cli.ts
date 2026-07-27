#!/usr/bin/env bun

import { inspectJournalFile } from "./index.js";

async function main(argv: string[]): Promise<void> {
  const { filePath, sessionId, includeFrames, pretty, mode } =
    parseArguments(argv);
  const report = await inspectJournalFile(filePath, { includeFrames, mode });
  const output = sessionId
    ? {
        ...report,
        sessions: report.sessions.filter(
          (session) => session.sessionId === sessionId
        )
      }
    : report;
  if (sessionId && output.sessions.length === 0) {
    throw new Error(`Session ${sessionId} was not found.`);
  }
  process.stdout.write(`${JSON.stringify(output, null, pretty ? 2 : undefined)}\n`);
  if (!report.valid) {
    process.exitCode = 2;
  }
}

function parseArguments(argv: string[]): {
  filePath: string;
  sessionId?: string;
  includeFrames: boolean;
  pretty: boolean;
  mode: "strict" | "partial";
} {
  const positional: string[] = [];
  let sessionId: string | undefined;
  let includeFrames = false;
  let pretty = false;
  let mode: "strict" | "partial" = "strict";
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? "";
    if (argument === "--frames") {
      includeFrames = true;
    } else if (argument === "--pretty") {
      pretty = true;
    } else if (argument === "--partial") {
      mode = "partial";
    } else if (argument === "--session") {
      sessionId = argv[index + 1];
      if (!sessionId || sessionId.startsWith("--")) {
        throw new Error("--session requires a session id.");
      }
      index += 1;
    } else if (argument.startsWith("--")) {
      throw new Error(`Unknown replay option: ${argument}`);
    } else {
      positional.push(argument);
    }
  }
  if (positional.length !== 1) {
    throw new Error(
      "Usage: bun run replay -- <journal.jsonl> [--session <id>] [--frames] [--partial] [--pretty]"
    );
  }
  return {
    filePath: positional[0] ?? "",
    sessionId,
    includeFrames,
    pretty,
    mode
  };
}

main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
});
