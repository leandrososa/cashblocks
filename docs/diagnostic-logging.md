# Diagnostic Logging

Diagnostic logging is separate from the runtime journal.

## Purpose

Use diagnostic logs for software diagnosis:

- thrown flow errors
- adapter exceptions
- stack traces
- technical metadata
- warnings that help developers or operators debug the runtime

Use the journal for runtime truth:

- prompts
- customer selections
- transaction starts and completions
- host authorization results
- device-visible failures
- `flow.failed`

## Logger Contract

The public contract is:

```ts
export type DiagnosticLogger = {
  log(entry: DiagnosticLogEntry): void;
};
```

Runtime options accept:

```ts
new CashblocksRuntime({ logger });
```

If no logger is provided, the runtime uses `NoopDiagnosticLogger`.

## Built-in Loggers

`packages/runtime-core` exports:

- `NoopDiagnosticLogger`
- `ConsoleDiagnosticLogger`
- `MemoryDiagnosticLogger`
- `JsonlDiagnosticLogger`
- `CompositeDiagnosticLogger`
- `FilteredDiagnosticLogger`
- `createDiagnosticLogger`

Use `MemoryDiagnosticLogger` in tests:

```ts
const logger = new MemoryDiagnosticLogger();
const result = await runFlow(flow, {
  runtimeOptions: { logger }
});

assert.equal(logger.all()[0]?.source, "flow");
```

Compose and filter multiple sinks:

```ts
const file = new JsonlDiagnosticLogger("./data/diagnostics.jsonl");
const memory = new MemoryDiagnosticLogger();
const logger = createDiagnosticLogger({
  minimumLevel: "warn",
  sources: ["runtime", "flow", "adapter"],
  sinks: [new ConsoleDiagnosticLogger(), file, memory]
});

const runtime = new CashblocksRuntime({ logger });

// Before shutdown, wait for asynchronous JSONL writes.
await file.flush();
```

Sink failures are isolated: a throwing sink cannot prevent delivery to later
sinks or alter runtime behavior. `JsonlDiagnosticLogger.readAll()` is available
for local inspection and tests.

## Correlation

Log entries emitted through `CashblocksRuntime.logDiagnostic` use this
convention:

- `sessionId` remains at the top level for compatibility.
- `correlation.sessionId` is always populated with the same value.
- `correlation.transactionId` identifies one transaction when available.
- `correlation.transactionName` identifies the module transaction type.

Adapter exceptions automatically include the session id and transaction name.
Add metadata for adapter names, operations, and other technical context.

Do not put sensitive customer data such as PINs, PANs, or track data in
diagnostic logs.
