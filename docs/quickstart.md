# Quickstart

This guide gets a new developer from clone to a running ATM simulator.

## Requirements

- Bun 1.3.x
- Node.js compatible with the TypeScript output used by the repo

## Install and Verify

```sh
bun install
bun run build
bun run test
```

The test suite covers the runtime core, ATM modules, flow SDK, terminal shell
simulation, and the example flow package.

## Run the Browser Shell

```sh
bun run dev
```

Open `http://localhost:4173`.

Use the left panel to choose a transaction and flip simulated faults:

- `CashWithdrawal` with all devices online should complete.
- `CashWithdrawal` with `Host declined` should fail at authorization.
- `BalanceInquiry` with `Receipt printer out` should offer the receipt warning.
- Any card flow with `Card reader offline` should fail before PIN entry.

The terminal screen is backed by a paused runtime session. Customer prompts are
answered through:

```sh
POST /api/session/start
POST /api/session/answer
```

## Run the Customer Terminal

```sh
bun run customer
```

Open `http://localhost:4174`.

This is the customer-facing kiosk simulation. It has no developer fault panel,
selector, or journal timeline. Start from `Insert card`, choose the transaction
inside the ATM screen, and finish with `Print receipt` or `Finish`.

Operator mode is available through `Operator access` with service code `0000`.

## Persist Journal History

```sh
CASHBLOCKS_JOURNAL_PATH=./data/runtime.journal.jsonl bun run dev
```

or:

```sh
bun run demo
```

Then open the Journal History tab in the shell. The durable journal is JSON
Lines: one runtime event per line.

## Make a First Flow Change

Open `examples/atm-basic/src/flow.ts` and find `OnStartOfDay`.

For example, change the currency setup:

```ts
Cashblocks.SetCurrencyDetails("AUD", "$", true);
```

Rebuild and rerun the shell:

```sh
bun run build
bun run dev
```

Flow code controls customer policy and sequencing. It should not talk directly to
files, devices, networks, or processes. Device and host work belongs behind
adapters.

## What to Inspect

- Use the journal timeline for audit-style runtime facts: prompts, selected
  transactions, authorization results, transaction completion, and flow failures.
- Use diagnostic logs for software diagnosis: thrown errors, adapter exceptions,
  stack traces, and technical metadata.
