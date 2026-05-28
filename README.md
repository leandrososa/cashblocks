# Cashblocks

Cashblocks is an open source TypeScript runtime for ATM and self-service
terminal software. It separates customer-specific flow code from stable runtime,
transaction modules, device adapters, host adapters, journals, and diagnostic
logs.

The current project is a simulator-first MVP. It is built to make terminal flows
easy to understand, test, and extend before real hardware, XFS/CEN XFS, J/XFS,
XFS4IoT, ISO8583, legacy host protocols, or proprietary drivers are added behind
adapter contracts.

## Quickstart

```sh
bun install
bun run build
bun run test
bun run dev
```

`bun run dev` starts the browser shell at `http://localhost:4173`. The shell
drives the example ATM flow, lets you flip simulated device and host faults, and
shows the resulting journal timeline.

For durable demo history:

```sh
bun run demo
```

This writes JSONL journal events to `./data/demo.journal.jsonl`.

## Documentation

- [Quickstart](docs/quickstart.md): run the simulator, inspect the shell, and
  make a first flow change.
- [Concepts](docs/concepts.md): runtime, flow packages, modules, adapters,
  journal, and diagnostic logs.
- [Flow development](docs/flow-development.md): write and test flow packages.
- [Adapter development](docs/adapter-development.md): current adapter contracts,
  simulator boundaries, and hardware limits.
- [Diagnostic logging](docs/diagnostic-logging.md): software logs separate from
  the runtime journal.
- [Industry context](docs/industry-context.md): where XFS, J/XFS, XFS4IoT, and
  ISO8583 fit.
- [Roadmap](docs/roadmap.md): what exists, what is next, and what is outside the
  MVP.

## Repository Shape

- `packages/runtime-contracts`: public types, events, adapter contracts, flow
  manifest validation, and diagnostic logging contracts.
- `packages/runtime-core`: runtime state, scratchpad, property store, simulator,
  adapters, append-only journal, and diagnostic logger implementations.
- `packages/atm-modules`: reusable ATM transaction modules.
- `packages/flow-sdk`: `defineFlow`, `runFlow`, and controlled runtime globals.
- `examples/atm-basic`: simulator-backed ATM flow package.
- `apps/terminal-shell`: local browser shell for running and inspecting the demo.

## Useful Commands

```sh
bun run build
bun run typecheck
bun run test
bun run example:atm
bun run dev
bun run demo
```

Set `CASHBLOCKS_JOURNAL_PATH=./data/runtime.journal.jsonl` before `bun run dev`
to persist runtime journal events and view them in the shell's Journal History
tab.
