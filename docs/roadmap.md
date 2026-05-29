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

## Next Priority

| Area | Goal |
| --- | --- |
| Documentation | Expand API reference and cookbook examples. |
| Flow testing | Add more examples for cancellation, warnings, and device faults. |
| Simulator profiles | Model richer device and cash-management capabilities without binding to vendors. |
| Observability | Add configurable diagnostic log sinks and correlation conventions. |
| Adapter design | Refine contracts before real hardware integrations. |

## Planned Later

| Area | Direction |
| --- | --- |
| Host integrations | ISO8583 or legacy-host adapters behind runtime contracts. |
| Device integrations | XFS, J/XFS, XFS4IoT, or vendor adapters behind device contracts. |
| Native packaging | Wrap the shell/runtime for local terminal environments. |
| Replay tooling | Use durable journals to inspect and replay runtime sessions. |
| Certification support | Add stricter recovery, audit, and test harnesses once real targets exist. |

## Outside the MVP

| Area | Reason |
| --- | --- |
| Certification-grade XFS/J-XFS implementations | Requires hardware, vendor service providers, and deployment targets. |
| Production ISO8583 host stack | Requires host specs, security requirements, keys, and network certification. |
| Vendor-specific behavior | Should wait for device profiles, docs, or real devices. |
| Full observability platform | The current goal is a minimal diagnostic logging boundary. |

The near-term product promise is not "runs every ATM." It is "makes ATM flow
development understandable, testable, and ready for real adapters."
