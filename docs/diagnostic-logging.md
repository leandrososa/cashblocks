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

Use `MemoryDiagnosticLogger` in tests:

```ts
const logger = new MemoryDiagnosticLogger();
const result = await runFlow(flow, {
  runtimeOptions: { logger }
});

assert.equal(logger.all()[0]?.source, "flow");
```

## Correlation

Log entries include `sessionId` when emitted through the runtime. Add metadata
for adapter names, operations, transaction names, and other technical context.

Do not put sensitive customer data such as PINs, PANs, or track data in
diagnostic logs.
