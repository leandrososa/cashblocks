# Adapter Development

Adapters let Cashblocks run the same flow against simulators, vendor services,
host protocols, or real devices.

## Current Contracts

The public adapter contracts live in `packages/runtime-contracts/src/index.ts`.
The MVP supports:

- `ReceiptPrinterAdapter`
- `CashDispenserAdapter`
- `CashAcceptorAdapter`
- `CardReaderAdapter`
- `HostAuthorizationAdapter`

Pass implementations to the runtime:

```ts
const runtime = new CashblocksRuntime({
  adapters: {
    receiptPrinter,
    cashDispenser,
    cashAcceptor,
    cardReader,
    hostAuthorization
  }
});
```

If no adapters are provided, the runtime creates simulator adapters.

## Adapter Identity and Capabilities

Every adapter declares:

- a non-empty, set-wide unique `id`
- the `kind` required by its `TerminalAdapters` slot
- non-empty, unique capability names

`CashblocksRuntime` calls `validateTerminalAdapters` before startup and rejects
duplicate ids, mismatched kinds, and invalid capabilities. This catches wiring
errors before a customer transaction begins.

## Operation Context

Every adapter operation accepts an optional `AdapterOperationContext`:

```ts
type AdapterOperationContext = {
  operationId: string;
  sessionId: string;
  adapterId: string;
  operation: string;
  transactionName?: string;
  timeoutMs: number;
  startedAt: string;
  deadlineAt: string;
  signal: AbortSignal;
};
```

ATM modules create a fresh context for each adapter call. Use `operationId` for
driver/protocol request correlation, `sessionId` for the terminal session, and
`timeoutMs`/`deadlineAt` as the caller's operation budget. The runtime aborts
`signal` and returns `ADAPTER_TIMEOUT` when the operation exceeds that budget.
The default is 30 seconds and can be configured with
`CashblocksRuntime({ adapterTimeoutMs })`.

Timeouts for cash movement are different: an abort signal is cooperative and
cannot prove whether physical cash moved. Dispenser and acceptor timeouts return
`ADAPTER_OUTCOME_UNKNOWN` and journal
`transaction.reconciliation_required`. Operators or recovery tooling must
reconcile that outcome; it is never recorded as a definitive transaction
failure.

Receipt printing is best-effort after the financial operation. Printer
exceptions and timeouts are journaled as device failures without erasing a
completed withdrawal.

## Migrating Existing Adapters

The refined contracts are a breaking source-level change from the initial 0.1
shape. Existing adapters must add `kind` and `capabilities`:

```ts
const dispenser: CashDispenserAdapter = {
  id: "vendor.dispenser",
  kind: "cash-dispenser",
  capabilities: ["dispense"],
  async dispense(input, context) {
    context?.signal.throwIfAborted();
    return driver.dispense(input, context);
  }
};
```

Operation context parameters are optional for compatibility, but hardware and
network adapters should accept them and pass the abort signal/deadline to their
driver. Capability names are validated per adapter kind; the core operation
capability and method are required.

## Simulator First

The simulator is deterministic on purpose. It is enough for:

- flow tests
- UI development
- journal and diagnostic-log validation
- adapter contract iteration
- common failure-path design

It is not a substitute for certification-grade hardware integration.

## Diagnostic Logging

Adapters should return structured `AdapterResult` failures for expected device or
host outcomes, such as offline devices or host declines.

Unexpected thrown exceptions are diagnostic-log events. They should include:

- adapter name
- operation name
- session id
- error name/message/stack when available
- relevant transaction metadata

The journal should still represent runtime-visible outcomes. Diagnostic logs are
for technical troubleshooting.

## Developing Without Hardware

You can build useful behavior without physical devices:

- flow orchestration
- simulator profiles
- host simulators
- replayable journals
- common fault handling
- UI and operator tooling

Hardware becomes necessary for:

- exact vendor codes and capabilities
- timing and recovery behavior
- cash handling edge cases
- certification
- service-provider configuration
- operating-system and driver differences

Start with capability-oriented adapters such as `cashDispenser`, `cardReader`,
and `hostAuthorization`. Add vendor-specific behavior only after a real service
provider, protocol spec, or device profile is available.
