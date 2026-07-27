# API Reference

This reference describes the public surface of the Cashblocks workspace packages.
Imports below use workspace package names. Until packages are published, source
imports used by the example flow remain valid.

## `@cashblocks/runtime-contracts`

### Runtime events

`RuntimeEvent` is the append-only journal record:

```ts
type RuntimeEvent = {
  seq: number;
  type: RuntimeEventType;
  ts: string;
  source: "runtime" | "flow" | "module" | "simulator" | "ui";
  sessionId?: string;
  payload?: Record<string, JsonValue>;
};
```

Transaction events include `transaction.selected`, `transaction.started`,
`transaction.completed`, `transaction.cancelled`, and `transaction.failed`.
Journal consumers should use these structured event types instead of parsing
`journal.line_logged` messages.

### Adapter contracts

| Contract | Operation | Purpose |
| --- | --- | --- |
| `ReceiptPrinterAdapter` | `getStatus`, `printReceipt` | Query paper/device health and print lines. |
| `CashDispenserAdapter` | `dispense` | Dispense a currency amount. |
| `CashAcceptorAdapter` | `accept` | Accept an optional expected amount. |
| `CardReaderAdapter` | `readCard` | Read or validate card availability. |
| `HostAuthorizationAdapter` | `authorize` | Authorize a normalized host request. |

Action operations return `AdapterResult`. Expected operational failures should
return `{ ok: false, code, message }`; unexpected exceptions are diagnostic
failures. `ReceiptPrinterAdapter.getStatus` is the query exception and returns
`ReceiptPrinterStatus`.

`TerminalAdapters` groups one implementation of each adapter contract.

### Flow package contracts

`FlowPackage` is the parsed form of `cashblocks.flow.json`:

```ts
type FlowPackage = {
  id: string;
  version: string;
  description?: string;
  entrypoint: string;
  capabilities: string[];
  modules?: string[];
};
```

Use `validateFlowPackage` to validate ids, versions, entrypoints, capabilities,
and module names. `knownFlowCapabilities` and `knownAtmModules` expose the
accepted manifest values.

### Customer interaction

`CustomerInteraction.request` receives a discriminated `CustomerPrompt` for PIN,
transaction, account, amount, or option input. It returns a
`CustomerPromptAnswer`. Browser applications normally use
`QueuedCustomerInteraction`; deterministic tests use
`SimulatorCustomerInteraction`.

### Diagnostic logging

`DiagnosticLogger.log` accepts a `DiagnosticLogEntry` containing level, source,
message, timestamp, optional session id, structured error, and JSON metadata.
Diagnostic entries are not journal events.

## `@cashblocks/runtime-core`

### `CashblocksRuntime`

The runtime owns state and adapter wiring for one session.

```ts
const runtime = new CashblocksRuntime({
  simulator: new RuntimeSimulator(),
  adapters,
  interaction,
  journalPath,
  logger,
  sessionId
});
```

Important members:

| Member | Description |
| --- | --- |
| `SessionId` | Correlation id supplied by options or generated for the runtime session. |
| `Journal` | Active `RuntimeJournal`. |
| `ScratchPad` | Session-scoped transient values. |
| `Properties` | Hierarchical runtime configuration values. |
| `Simulator` | Deterministic financial/device model. |
| `Adapters` | Active terminal adapter set. |
| `Interaction` | Active customer prompt implementation. |
| `Logger` | Active diagnostic logger. |
| `Cashblocks` | Controlled API exposed to flow code. |

`result` creates a `TransactionResult`; `logDiagnostic` adds runtime correlation
before forwarding an entry to the configured logger.

### Journal classes

- `RuntimeJournal.append` assigns sequence and timestamp, retains the event, and
  forwards it to optional persistence.
- `RuntimeJournal.all` returns a snapshot of current events.
- `RuntimeJournal.flush` waits for pending persistence writes.
- `JsonlJournalPersistence.readAll` reads newline-delimited journal events.

### Simulator classes

`RuntimeSimulator` models queued customer answers, account balances, terminal
cash, printer status, host approval, and device availability.
`createSimulatedAdapters` binds that state to all five adapter contracts.

### Interaction classes

- `SimulatorCustomerInteraction` resolves prompts immediately from simulator
  queues.
- `QueuedCustomerInteraction` exposes one pending prompt at a time and resumes it
  through `answer`.
- `PendingCustomerPrompt` carries the prompt id and response promise.

### Diagnostic logger implementations

- `NoopDiagnosticLogger`: discards entries.
- `ConsoleDiagnosticLogger`: writes structured entries to the console.
- `MemoryDiagnosticLogger`: retains entries for tests and inspection.
- `JsonlDiagnosticLogger`: queues JSONL writes and exposes `flush`/`readAll`.
- `CompositeDiagnosticLogger`: fans an entry out to isolated sinks.
- `FilteredDiagnosticLogger`: filters by minimum level and source.
- `createDiagnosticLogger`: builds a filtered composite from configuration.

### Supporting exports

The package also exports these building blocks for custom runtimes and tests:

| Export | Purpose |
| --- | --- |
| `MemoryScratchPad` | In-memory `ScratchPad` implementation. |
| `PropertyStore` | Dot-path runtime property storage. |
| `HandlerRegistry` | Ordered async module-handler execution. |
| `JournalPersistence` | Persistence boundary consumed by `RuntimeJournal`. |
| `RuntimeSimulatorOptions` | Simulator queue, balance, cash, and fault inputs. |
| `CashblocksRuntimeOptions` | Runtime construction options. |
| `SimulatedReceiptPrinterAdapter` | Printer adapter backed by simulator state. |
| `SimulatedCashDispenserAdapter` | Dispenser adapter backed by simulator state. |
| `SimulatedCashAcceptorAdapter` | Acceptor adapter backed by simulator state. |
| `SimulatedCardReaderAdapter` | Reader adapter backed by simulator state. |
| `SimulatedHostAuthorizationAdapter` | Host adapter backed by simulator state. |

## `@cashblocks/atm-modules`

`createAtmModules(runtime)` creates the module set exposed to a flow:

| Flow global | Class | Responsibility |
| --- | --- | --- |
| `Idle` | `IdleModule` | Starts a terminal session and cardless activation. |
| `Customer` | `CustomerModule` | PIN, transaction, account, amount, and option prompts. |
| `CoreSession` | `SessionModule` | Session state and structured cancellation. |
| `BalanceInquiry` | `BalanceInquiryModule` | Reads an account balance. |
| `CashWithdrawal` | `CashWithdrawalModule` | Host authorization and dispense. |
| `CardlessCashWithdrawal` | `CashWithdrawalModule` | Cardless withdrawal configuration. |
| `CashDeposit` | `CashDepositModule` | Cash acceptance and account credit. |
| `FastCash` | `FastCashModule` | Fixed-amount withdrawal. |
| `TerminalAdmin` | `AdminModule` | Simulator totals and cash adjustments. |

Classes derived from `AtmModule` support `AddHandler(eventName, handler)` for
flow-specific policy. Returning `false` from a handler stops the remaining
handlers for that event. `SessionModule` and `AuthorizationModule` are exported
state/configuration helpers rather than `AtmModule` subclasses.

Call `CoreSession.CancelTransaction(reason, transaction?)` before an intentional
early return. This creates a `transaction.cancelled` journal event.

## `@cashblocks/flow-sdk`

### `defineFlow`

Captures a `FlowFactory` without creating runtime state:

```ts
export default defineFlow(({ Cashblocks, Customer }) => ({
  OnStartOfDay() {
    Cashblocks.SetCurrencyDetails("AUD", "$", true);
  },
  async OnIdle() {
    await Customer.PinEntry();
  }
}));
```

### `runFlow`

Creates or accepts a runtime, validates an optional flow manifest, constructs
fresh module globals, and invokes `OnStartOfDay` followed by `OnIdle`.

`FlowRunOptions` accepts:

- `simulator`: options for a newly created simulator.
- `runtime`: a prebuilt runtime.
- `runtimeOptions`: options for a newly created runtime.
- `journalPath`: shorthand for JSONL persistence.
- `flowPackage`: manifest to validate and journal.
- `configure`: callback invoked before the flow factory.

The resolved `FlowRunResult` contains `ok`, `runtime`, `globals`, and structured
phase/error details on failure. Lifecycle exceptions are journaled as
`flow.failed` instead of escaping.

### `validateFlowManifest`

Validates a `FlowPackage` using the runtime-contract rules.

## `@cashblocks/terminal-session`

### `TerminalSessionManager`

Runs browser-facing paused sessions:

- `start(request)` creates and starts a session.
- `state(session)` waits for a prompt or result and serializes the current state.
- `answer({ sessionId, promptId, value })` resumes the matching pending prompt.
- `get(sessionId)` retrieves an active session.

`TerminalSessionManagerOptions` supplies the flow, manifest, summary function,
optional event inclusion, default transaction, and flow configuration callback.
`TerminalSessionState<Summary>` is the typed serialized response and uses
`SerializedCustomerPrompt` for pending prompts.

### `TerminalSessionRequest`

The request controls transaction, customer type, account, amount, simulated
device/host faults, receipt-warning answer, transaction option answers, and
journal path.

### `buildSimulatorOptions`

Converts a terminal-session request into deterministic `RuntimeSimulatorOptions`.
Receipt-warning answers are queued before transaction-specific option answers.
