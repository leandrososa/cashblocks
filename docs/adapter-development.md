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
