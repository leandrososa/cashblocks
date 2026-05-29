# Concepts

Cashblocks separates stable terminal behavior from customer-specific flow code.

## Runtime

The runtime owns process-local state:

- property store
- scratchpad
- simulator state
- adapter registry
- customer interaction prompts
- append-only journal
- diagnostic logger

Flow code receives a controlled `Cashblocks` API instead of direct access to
hardware, files, processes, or networks.

## Flow Packages

A flow package has a `cashblocks.flow.json` manifest and a TypeScript entrypoint.
The entrypoint exports:

```ts
export default defineFlow((globals) => ({
  OnStartOfDay() {},
  async OnIdle() {}
}));
```

The runtime creates fresh globals for every run. The flow decides ordering and
customer policy. It can orchestrate modules, set properties, use scratchpad
values, and register handlers.

## Modules

Modules implement reusable terminal behaviors such as:

- idle session start
- PIN entry and transaction selection
- balance inquiry
- cash withdrawal
- cash deposit
- fast cash
- terminal admin operations

Modules own transaction mechanics. Flows configure and sequence them.

## Adapters

Adapters isolate device and host integrations. Modules call adapters through the
runtime. The MVP ships simulator adapters for:

- receipt printer
- cash dispenser
- cash acceptor
- card reader
- host authorization

Real XFS, J/XFS, XFS4IoT, ISO8583, legacy host, or vendor integrations should be
implemented behind these boundaries.

## Simulator State

The simulator includes a small financial world so flows can be evaluated without
real hardware or host systems:

- account balances for Checking, Savings, and Credit
- terminal cash inventory
- selected account and amount prompts
- host authorization checks for insufficient funds
- cash movement when withdrawals dispense or deposits are accepted

This is not a banking ledger. It is a deterministic development model that makes
the demo behave like a real terminal session and gives tests concrete state
changes to assert.

## Journal vs Diagnostic Logs

The journal is the audit-style event stream. It records what happened in the
runtime: lifecycle events, prompts, selected transactions, host authorization
results, transaction failures, transaction completions, and flow failures.

Diagnostic logs are for software diagnosis. They record technical failures such
as thrown flow errors, adapter exceptions, stack traces, and debugging metadata.

Keep this split:

- Journal: stable runtime truth that can support audit and replay.
- Diagnostic logs: technical evidence for developers and operators.

Both should include correlation data such as `sessionId` when available.
