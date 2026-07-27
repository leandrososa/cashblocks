# Roadmap

Cashblocks is currently a simulator-first MVP focused on developer experience,
flow architecture, and adapter boundaries.

## Current MVP

| Area | Status |
| --- | --- |
| TypeScript monorepo | Done |
| Runtime contracts | Done |
| Runtime core | Done |
| Simulator adapters | Done |
| ATM modules | Done |
| Flow SDK | Done |
| Example ATM flow | Done |
| Browser shell | Done |
| Customer-facing terminal app | Done |
| JSONL journal persistence | Done |
| Diagnostic logging contracts | Done |
| Simulator account balances and terminal cash | Done |
| Introductory developer docs | Done |
| API reference and cookbook | Done |
| Cancellation, warning, and device-fault flow tests | Done |
| Capability and cash-management simulator profiles | Done |
| Configurable diagnostic sinks and correlation conventions | Done |
| Validated adapter identity, capabilities, and operation context | Done |
| Transport-independent ISO8583 authorization adapter | Done |
| Vendor-neutral device gateway adapters | Done |
| Native customer-terminal executable packaging | Done |
| Side-effect-free journal validation and replay | Done |
| Deterministic certification and recovery harness | Done |

## Next Priority

| Area | Goal |
| --- | --- |
| Production device integration | Add a concrete XFS4IoT or vendor transport, recovery policy, drivers, and hardware certification. |

## Planned Later

| Area | Direction |
| --- | --- |
| Production host integration | Add framing, security, reversals, durable STANs, and certification against a real host specification. |

## Outside the MVP

| Area | Reason |
| --- | --- |
| Certification-grade XFS/J-XFS implementations | Requires hardware, vendor service providers, and deployment targets. |
| Production ISO8583 host stack | Requires host specs, security requirements, keys, and network certification. |
| Vendor-specific behavior | Should wait for device profiles, docs, or real devices. |
| Signed OS installers and kiosk lockdown | Require target operating systems, signing identities, and fleet policy. |
| Full observability platform | The current goal is a minimal diagnostic logging boundary. |

The near-term product promise is not "runs every ATM." It is "makes ATM flow
development understandable, testable, and ready for real adapters."
