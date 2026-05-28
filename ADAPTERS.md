# Adapter Contracts

Cashblocks modules do not talk directly to hardware or payment networks. They
call adapters through the runtime. This keeps project flow scripts stable while
different deployments swap simulator, Windows, Linux, vendor, or host-specific
implementations.

## Runtime Adapters

The public adapter contracts live in `packages/runtime-contracts/src/index.ts`.
The first supported adapter set is:

- `ReceiptPrinterAdapter`: reads printer/paper status and prints receipt lines.
- `CashDispenserAdapter`: dispenses cash for withdrawal modules.
- `CashAcceptorAdapter`: accepts cash for deposit modules.
- `CardReaderAdapter`: reads card data before PIN entry or reports reader failures.
- `HostAuthorizationAdapter`: approves or declines transaction authorization.

`packages/runtime-core` ships simulator implementations for each contract. Real
hardware or host integrations should implement the same interfaces and pass them
to `new CashblocksRuntime({ adapters })`.

Expected device or host outcomes should return an `AdapterResult`. Unexpected
software exceptions should be emitted through diagnostic logs with adapter,
operation, session, and error metadata.

## Journal Persistence

`RuntimeJournal` always keeps an in-memory event list for the active process.
For durable audit/replay, pass `journalPath` when creating the runtime or running
a flow through the SDK:

```ts
await runFlow(flow, {
  journalPath: "./data/runtime.journal.jsonl"
});
```

The durable format is JSON Lines. Each line is one `RuntimeEvent` with a
monotonic `seq` assigned by the runtime.

Call `await runtime.Journal.flush()` before process exit when a CLI or service
needs to guarantee all pending appends are on disk.

## Diagnostic Logs

Diagnostic logging is separate from journal persistence. The journal records
runtime-visible truth for audit and replay. Diagnostic logs record technical
software failures such as thrown adapter errors, flow lifecycle failures, and
stack traces.

Pass a logger when constructing the runtime:

```ts
const runtime = new CashblocksRuntime({
  logger: new ConsoleDiagnosticLogger()
});
```

If no logger is supplied, the runtime uses a no-op logger.

## Current Scope

The simulator is intentionally deterministic and small. It is enough for flow
tests, UI development, and adapter-contract iteration. It is not a substitute
for certification-grade implementations of CEN/XFS, J/XFS, ISO8583, legacy host
protocols, or vendor-specific device services.
