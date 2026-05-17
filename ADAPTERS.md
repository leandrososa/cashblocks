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
- `CardReaderAdapter`: reads card data or reports reader failures.
- `HostAuthorizationAdapter`: approves or declines transaction authorization.

`packages/runtime-core` ships simulator implementations for each contract. Real
hardware or host integrations should implement the same interfaces and pass them
to `new CashblocksRuntime({ adapters })`.

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

## Current Scope

The simulator is intentionally deterministic and small. It is enough for flow
tests, UI development, and adapter-contract iteration. It is not a substitute
for certification-grade implementations of CEN/XFS, J/XFS, ISO8583, legacy host
protocols, or vendor-specific device services.
