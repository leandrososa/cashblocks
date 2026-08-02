# Cashblocks

[![CI](https://github.com/leandrososa/cashblocks/actions/workflows/ci.yml/badge.svg)](https://github.com/leandrososa/cashblocks/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6.svg)](tsconfig.json)

A simulator-first TypeScript runtime for building, testing, and inspecting ATM
and self-service terminal flows.

Cashblocks keeps customer-specific flow logic separate from reusable transaction
modules, device and host adapters, and audit-style journals. The repository
includes a fault-injection developer shell, an accessible bilingual kiosk,
ISO8583 integration primitives, journal replay, and a deterministic
certification harness.

![Cashblocks customer terminal](docs/assets/customer-terminal.png)

> **Project status:** portfolio-quality MVP. Real ATM hardware, host-specific
> payment messages, cryptographic key management, and industry certification are
> intentionally outside the current scope.

## What It Demonstrates

- **Explicit flow boundary:** project flows orchestrate policy while direct
  infrastructure access stays behind adapters by convention. The current MVP
  does not sandbox untrusted third-party flow code.
- **Adapter boundaries:** simulator, device gateway, and ISO8583 host adapters can
  change without rewriting transaction flows.
- **Financial failure handling:** timeouts with uncertain cash movement become
  reconciliation-required outcomes instead of false successes.
- **Replayable evidence:** append-only JSONL journals can be validated and
  projected without repeating external side effects.
- **Testable terminal UX:** deterministic faults, paused browser sessions, Spanish
  and English content, keyboard support, and accessibility preferences.

## Quickstart

Requirements: [Bun 1.3.10+](https://bun.sh/) and Node.js 22+.

```sh
git clone https://github.com/leandrososa/cashblocks.git
cd cashblocks
bun install --frozen-lockfile
bun run check
bun run dev
```

Open `http://localhost:4173`. Start a transaction, flip a simulated host or
device fault, and inspect the journal timeline. `bun run check` performs a strict
typecheck, a clean build, and automatic test discovery.

To run the customer-facing terminal instead:

```sh
bun run customer
```

Open `http://localhost:4174`. Press `Shift+C` to simulate a physical card in
development, or choose **Operar sin tarjeta / Bank without a card**.

## Architecture

```text
Customer flow
     │
     ▼
Transaction modules ──► Runtime ──► Append-only journal
                            │
                 ┌──────────┴──────────┐
                 ▼                     ▼
          Device adapters        Host adapter
                 │                     │
                 ▼                     ▼
       Simulator / gateway      Simulator / ISO8583
```

The core rule is simple: flows decide ordering and customer policy; modules and
the runtime own transaction mechanics, state, devices, host calls, and journaled
truth. See [ARCHITECTURE.md](ARCHITECTURE.md) for package boundaries and
[ADAPTERS.md](ADAPTERS.md) for integration contracts.

## Repository Tour

| Path | Purpose |
| --- | --- |
| `packages/runtime-contracts` | Public events, prompts, adapters, and manifest contracts. |
| `packages/runtime-core` | Runtime state, simulator, journals, interactions, and diagnostics. |
| `packages/atm-modules` | Reusable withdrawal, deposit, inquiry, fast-cash, and admin modules. |
| `packages/flow-sdk` | Safe flow definition and execution. |
| `packages/terminal-session` | Paused sessions shared by browser applications. |
| `packages/host-iso8583` | ISO8583 codec, TLS framing, STAN allocation, and reversal recovery. |
| `packages/device-gateway` | Vendor-neutral device adapters and secure WebSocket transport. |
| `packages/journal-replay` | Journal validation, state projection, and replay CLI. |
| `packages/certification-harness` | Deterministic conformance and recovery evidence. |
| `examples/atm-basic` | Complete simulator-backed ATM flow. |
| `apps/terminal-shell` | Developer demo with fault injection and journal inspection. |
| `apps/customer-terminal` | Accessible bilingual customer kiosk. |
| `apps/native-terminal` | Native launcher and package builder. |

## Useful Commands

```sh
bun run check                 # typecheck, clean build, and tests
bun run dev                   # developer shell on :4173
bun run customer              # customer terminal on :4174
bun run example:atm           # run the example flow in the terminal
bun run demo                  # developer shell with a durable demo journal
bun run replay -- FILE --pretty
bun run certify -- --pretty
bun run package:native
```

Set `CASHBLOCKS_JOURNAL_PATH=./data/runtime.journal.jsonl` before `bun run dev`
to persist runtime events and inspect prior sessions in the shell.

## Documentation

- [Quickstart](docs/quickstart.md) provides a guided first run and flow change.
- [Concepts](docs/concepts.md) explains the runtime, modules, adapters, and journals.
- [Flow development](docs/flow-development.md) covers writing and testing flows.
- [API reference](docs/api-reference.md) documents the current public workspace API.
- [Cookbook](docs/cookbook.md) collects focused implementation recipes.
- [Industry context](docs/industry-context.md) places XFS, XFS4IoT, J/XFS, and
  ISO8583 around the project boundaries.
- [Project status](docs/roadmap.md) records what exists and what remains outside
  the MVP.

Contributions are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md), and use
[SECURITY.md](SECURITY.md) for vulnerability reports.

## License

Apache 2.0. See [LICENSE](LICENSE).
