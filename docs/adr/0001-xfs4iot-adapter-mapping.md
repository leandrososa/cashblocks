# ADR 0001: Map XFS4IoT Through Dedicated Device Adapters

- Status: Accepted
- Date: 2026-08-29
- Target: Cashblocks 0.2

## Context

Cashblocks flow code depends on stable `CardReaderAdapter` and
`CashDispenserAdapter` contracts. XFS4IoT has service discovery, versioned
commands, completions, unsolicited events, and multi-step physical operations
that do not map one-to-one to those methods.

The 0.2 milestone needs a reproducible withdrawal reference, deterministic
fault injection, and evidence for uncertain dispense recovery. It does not need
vendor hardware certification or additional device classes.

The existing generic device gateway already establishes useful transport rules,
including secure WebSockets and distinguishing failures before and after a
state-changing send. XFS4IoT still needs its own protocol client because its
envelopes, discovery, version negotiation, event routing, and service lifecycle
are protocol-specific.

## Decision

Create these boundaries:

1. `packages/xfs4iot-client` owns XFS4IoT transport, discovery, envelopes,
   runtime validation, version negotiation, command/completion correlation,
   asynchronous events, cancellation, deadlines, reconnect policy, and redacted
   diagnostics. It has no dependency on ATM modules, flows, or UI.
2. `packages/device-xfs4iot` owns the stateful mapping from XFS4IoT services to
   Cashblocks `CardReaderAdapter` and `CashDispenserAdapter` contracts. It
   validates the required service profile before customer sessions begin.
3. `apps/xfs4iot-emulator` is the first service provider. It implements only the
   pinned subset, deterministic profiles, resettable state, and operator-only
   fault controls.
4. Flow code and ATM modules continue to consume only Cashblocks adapter types.
   They must not import XFS4IoT message shapes or branch on vendor extensions.

The client targets the XFS4IoT `2024-03` publication at commit
`263591f189c3045296396bafcc52425a867fae09`. The exact subset and licensing
constraints are recorded in `docs/xfs4iot-compatibility.md`.

## Operation mapping

### Card reader

`readCard()` issues `CardReader.ReadRawData` and observes the media events needed
to establish that required synthetic card data was read. It must not eject the
card at that point because the current flow calls it before PIN entry.

Card return uses `CardReader.Move` and waits for
`CardReader.MediaRemovedEvent`. The current Cashblocks contract has no session
end device hook, so implementation must add a protocol-neutral lifecycle
operation rather than hiding card return inside `readCard()` or importing
XFS4IoT messages into flow code.

The adapter returns a structured success/failure only. Raw card data is not
returned to flow code and must not appear in journal or diagnostic output.

### Cash dispenser

`dispense({ amount, currencyCode })` owns denomination, dispense, optional
present, `CashManagement.ItemsPresentedEvent`,
`CashManagement.ItemsTakenEvent`, and recovery observation or retract for the
configured device profile. The Cashblocks method remains one logical operation
even though XFS4IoT may use multiple interfaces, commands, and events.

A known rejection before cash movement returns a normal failed
`AdapterResult`. A connection loss or deadline after a state-changing command
was sent returns `ADAPTER_OUTCOME_UNKNOWN` with reconciliation metadata. The
client and adapter never automatically reissue an ambiguous dispense.

### Capabilities and identity

Discovery results are mapped into stable adapter ids and the existing
capabilities (`read`, optional reader media capabilities, `dispense`, and
optional `finite-inventory`). XFS4IoT-only capabilities stay internal. Missing
required services, incompatible versions, unsupported currency/note profiles,
or missing recovery queries reject startup rather than failing halfway through
a transaction.

## Emulator decision

Cashblocks will build a repository-owned emulator instead of making KAL SP-Dev
the required 0.2 service. This gives Linux CI and clean checkouts a deterministic
service with externally controlled failure points and resettable state.

The tradeoff is that an emulator written from the same protocol interpretation
is not independent interoperability evidence. The release and compatibility
matrix must say `hardware-unverified`, and evidence from this emulator must be
identified as Cashblocks-owned. Validation against an independent service
provider remains follow-up work.

## Security and licensing

- Secure WebSockets are required outside explicit plaintext loopback
  development.
- Fixtures, emulator profiles, logs, journal events, and evidence use synthetic
  card and account values only. PINs, keys, real PANs, vendor credentials, and
  production host endpoints are prohibited.
- Unknown and vendor-specific fields are not trusted as flow policy and are
  redacted from diagnostics by default.
- The upstream specification repository has no identified redistribution
  license. Schemas and generated derivatives are not committed until rights are
  confirmed. Any fetched schema must use the immutable URL and verified hash
  documented in the compatibility matrix.

## Consequences

Positive:

- Flow packages remain protocol-independent.
- Failure classification stays close to the transport that knows whether a
  state-changing request was sent.
- The emulator can reproduce recovery scenarios in local development and CI.
- A future independent service provider can reuse the client and adapters.

Negative:

- The adapter must maintain a state machine behind a small Cashblocks contract.
- The customer terminal needs runtime/adapter injection instead of constructing
  only simulator-backed sessions.
- Physical cash inventory cannot remain represented solely by
  `RuntimeSimulator`; a device-owned projection is needed for truthful evidence.
- Self-hosted emulator tests alone cannot substantiate vendor or hardware
  compatibility.

## Rejected alternatives

### Couple ATM modules directly to XFS4IoT

Rejected because protocol versions and vendor behavior would leak into flow
policy and make other device integrations harder.

### Treat the generic device gateway as the XFS4IoT client

Rejected because its wire contract deliberately omits XFS4IoT discovery,
version negotiation, completions, and asynchronous service events. Its security
and recovery patterns should be reused, not its application-level envelopes.

### Require KAL SP-Dev for the first milestone

Rejected as the default because it would make deterministic fault injection and
portable CI depend on an external implementation. It remains a valuable
independent validation target after the emulator-backed milestone.
