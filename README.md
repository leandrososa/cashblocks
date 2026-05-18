# Cashblocks

Cashblocks is an open source runtime for ATM and self-service terminal software.
It separates transaction modules from customer-specific flow code, so projects
can customize behavior with a controlled TypeScript API instead of editing core
runtime logic.

## MVP

- TypeScript monorepo with runtime contracts, runtime core, ATM modules, flow SDK,
  a simulated ATM flow, and a minimal browser shell.
- The example flow is in `examples/atm-basic/src/flow.ts`.
- The example flow package manifest is `examples/atm-basic/cashblocks.flow.json`.
- Adapter contracts and JSONL journal persistence are documented in `ADAPTERS.md`.
- Hardware, XFS/CEN XFS, ISO8583, legacy host protocols, and proprietary drivers
  are intentionally adapter concerns outside the first simulator MVP.

## Commands

```sh
bun install
bun run build
bun run test
bun run example:atm
bun run dev
bun run demo
```

`bun run dev` starts a local browser shell with simulator controls and a journal
timeline at `http://localhost:4173`.

Set `CASHBLOCKS_JOURNAL_PATH=./data/runtime.journal.jsonl` before `bun run dev`
to persist runs and view them in the shell's Journal History tab.

`bun run demo` starts the same shell with durable demo history enabled at
`./data/demo.journal.jsonl`.

## Flow Packages

Flow packages include a `cashblocks.flow.json` manifest and a TypeScript
entrypoint that exports `defineFlow((globals) => lifecycle)`. The runtime
injects a fresh `Cashblocks` API and transaction modules for each run.
