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
selector, operator entry point, or journal timeline. Its idle screen rotates
local campaign images and waits for a physical card event. The card instruction
is status text, not a button.

For local development, press `Shift+C` to simulate presenting a physical card.
The shortcut uses an endpoint that is enabled only by the development launcher.
You can also choose `Operar sin tarjeta` / `Bank without a card` to exercise the
cardless flow.

Verify the customer experience in both languages:

1. Let the idle screen rotate through the three bundled campaigns.
2. Toggle `English` / `Español` and the accessibility preference.
3. Press `Shift+C`, enter a four-digit PIN, and complete each transaction type.
4. Finish a result screen and confirm the terminal returns to the screensaver.
5. Resize the browser to confirm the layout remains usable at 800×600,
   1024×768, 1280×1024, 1920×1080, and 1080×1920.
6. At every resolution, verify the idle campaign, PIN keypad, transaction menu,
   amount entry, confirmation, processing, and result screens. No control
   should be clipped horizontally; vertical scrolling is reserved for content
   that cannot fit after accessibility text enlargement.

Production device integrations call `CustomerTerminalServer.presentCard()` when
the card reader reports a presentation. The production/native server does not
expose the development simulation endpoint.

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
