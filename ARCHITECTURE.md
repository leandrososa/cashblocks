# Cashblocks Architecture

Cashblocks separates stable terminal behavior from project-specific flow code.

## Layers

- `runtime-contracts` defines public types, runtime events, transaction results,
  module interfaces, scratchpad, diagnostic logging, and flow package validation.
- `runtime-core` owns runtime state: property store, scratchpad, handler registry,
  simulator, adapter registry, append-only journal, and diagnostic logger
  implementations.
- `atm-modules` provides reusable ATM transaction objects. These modules own
  transaction configuration and execution behavior.
- `flow-sdk` binds a flow module to controlled runtime globals. Flow code can
  orchestrate modules but cannot directly access devices, filesystem, processes,
  or network.
- `examples/atm-basic` demonstrates a financial ATM flow similar to legacy
  customer scripts.
- `apps/terminal-shell` is the initial web shell for simulator inspection. It is
  intentionally small so it can be wrapped by Tauri once native packaging starts.

## Flow Boundary

Flow packages have a `cashblocks.flow.json` manifest with id, version,
entrypoint, required capabilities, and module names. Flow files are TypeScript
modules that export `defineFlow((globals) => lifecycle)`. The runtime creates
fresh globals for each run, then the flow uses `Cashblocks`, transaction modules,
and module handlers from that scoped context.

The core rule is that flow code decides ordering and customer-specific policy,
while modules and runtime own transaction mechanics, state recording, device
status, and journaled truth.

Flow lifecycle errors are captured by the SDK and appended as `flow.failed`
events. A broken flow should produce audit context in the journal and technical
diagnosis in diagnostic logs instead of crashing without context.

## Adapter Boundary

The MVP ships simulator adapters only. Real integrations such as CEN/XFS,
J/XFS, ISO8583, legacy host protocols, receipt printers, card readers, and cash
dispensers should be added behind module/runtime adapter contracts without
changing flow scripts.

Runtime events can be persisted as JSON Lines by passing `journalPath` to the
runtime or flow SDK. In-memory journal state remains available for the active
process; durable journal files are the audit/replay boundary.

Diagnostic logs are separate from the journal. They are for software diagnosis:
flow exceptions, adapter exceptions, stack traces, and technical metadata. The
default logger is a no-op so existing flows do not need to configure
observability before running.
