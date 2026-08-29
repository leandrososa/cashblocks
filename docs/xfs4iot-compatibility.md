# XFS4IoT 2024-03 Compatibility

This document fixes the protocol scope for the Cashblocks 0.2 withdrawal
reference. It is a design target, not a claim that the listed messages are
implemented or hardware-verified.

## Pinned specification

Cashblocks targets the XFS4IoT publication named `2024-03` at repository commit
[`263591f189c3045296396bafcc52425a867fae09`][spec-commit]. The publication is
available from the official site, but the upstream repository does not provide
a `2024-03` Git tag or GitHub release. Pinning the commit prevents changes on the
`master` branch from silently changing the protocol target.

The schema used during research was downloaded from the immutable URL below:

- Path: `2024-03/Schema_2024-03.json`
- Size: `1,169,223` bytes
- SHA-256: `6f164b34e37c46a9890d4f4e9ea2fed3b3abb50999bb3a914a026a72df0cd952`
- Git blob: `ee3f42de4f781a8e0cefe331af2ef1ae1e86730f`

The upstream repository does not contain a license for the specification,
schema, or generated artifacts. Cashblocks therefore must not commit copies,
modified copies, or generated derivatives of those files until redistribution
rights are confirmed. Tests may download the pinned schema after verifying its
SHA-256, or CI may receive it through a separately approved artifact source.
Locally authored fixtures and types must contain only the minimum protocol
shapes required by this document and must not copy descriptive specification
text.

The publication states that it is distributed for review and comment, is
subject to change without notice, and is not a CEN Workshop Agreement. That
notice is not treated as a software or redistribution license.

## Interoperability target

The first external service will be a repository-owned protocol emulator in
`apps/xfs4iot-emulator`. It will implement the pinned message subset and expose
deterministic fault controls. This choice makes local development and CI
reproducible, but it does not establish interoperability with an independent
service provider or physical hardware.

The 0.2 release must be labelled `hardware-unverified`. A future test against an
independent implementation must identify that implementation and its exact
version separately.

## Withdrawal message subset

Message names and versions below are the exact `header.name` and message version
values from the pinned schema. `Required` means required by the 0.2 reference,
not that support already exists.

### Common

| Message | Direction | Version | Requirement | Cashblocks use |
| --- | --- | --- | --- | --- |
| `Common.Status` | completion | 3.0 | Required | Startup and recovery status query. |
| `Common.Capabilities` | completion | 3.0 | Required | Validate required service capabilities before a transaction. |
| `Common.SetVersions` | command | 2.0 | Required | Negotiate the supported interface versions. |
| `Common.SetTransactionState` | command | 2.0 | Required | Mark the customer transaction active or inactive. |
| `Common.Cancel` | command | 2.0 | Required | Request cancellation after local abort or deadline. Cancellation does not prove that a state-changing operation had no effect. |
| `Common.StatusChangedEvent` | unsolicited | 3.0 | Required | Track device transitions after initial status validation. |
| `Common.ErrorEvent` | event | 2.0 | Required | Map service and device errors to structured adapter outcomes. |

`ServicePublisher.GetServices` completion 2.0 and
`ServicePublisher.ServiceDetailEvent` 2.0 provide endpoint discovery and stable
service identity. WebSocket connection lifecycle, command completion
correlation, and unsolicited event routing are also required protocol
infrastructure rather than ATM flow operations.

### Minimum envelope fields

Every message requires `header`; payload is an object or null. The supported
header subset is:

| Field | Use |
| --- | --- |
| `header.type` | Distinguish command, acknowledge, event, completion, and unsolicited messages. |
| `header.name` | Select one of the explicitly listed message shapes. |
| `header.version` | Enforce the pinned per-message version. |
| `header.requestId` | Correlate command, acknowledge, completion, and solicited event messages. |
| `header.timeout` | Bound command execution when present. |
| `header.status` | Reject invalid acknowledgements such as `invalidMessage`, `invalidRequestID`, or `tooManyRequests`. |
| `header.completionCode` | Separate successful completion from canceled, timeout, unsupported, hardware, data, and sequence failures. |

Unknown envelope fields are rejected by the pinned schema. Vendor-specific
payload fields may be retained only in a bounded, redacted diagnostic structure.
The adapter records the XFS4IoT `requestId` alongside the Cashblocks operation
and session correlation without using one identifier as a substitute for the
other.

### Card reader

| Message | Direction | Version | Requirement | Cashblocks use |
| --- | --- | --- | --- | --- |
| `CardReader.ReadRawData` | command/completion | 2.0/3.0 | Required | Wait for media and establish that the demo card was read. |
| `CardReader.InsertCardEvent` | event | 2.0 | Required | Prompt or signal card insertion where supported. |
| `CardReader.MediaInsertedEvent` | event | 2.0 | Required | Correlate physical media presence with the active session. |
| `CardReader.InvalidMediaEvent` | event | 2.0 | Required | Return a known read failure. |
| `CardReader.TrackDetectedEvent` | event | 2.0 | Required | Record that requested data was detected without exposing it to flow code. |
| `CardReader.Move` | command/completion | 2.0 | Required | Move retained media to the customer exit. |
| `CardReader.MediaRemovedEvent` | event | 2.0 | Required | Confirm customer removal and permit session closure. |

The current `CardReaderAdapter.readCard()` consumer checks only success or
failure. No PAN, track, PIN, EMV, or cardholder data is required by the flow.
Fixtures and evidence must use synthetic values and redact raw card data.
Device-offline and media-jammed conditions are required error mappings even
when delivered through `Common.ErrorEvent` or command completions rather than a
dedicated event.

### Cash dispenser

| Message | Direction | Version | Requirement | Cashblocks use |
| --- | --- | --- | --- | --- |
| `CashDispenser.Dispense` | command/completion | 3.0 | Required | Perform denomination selection and cash movement. |
| `CashDispenser.Present` | command/completion | 2.0 | Required when the profile uses a stacker | Present prepared cash to the customer. |
| `CashDispenser.GetPresentStatus` | command/completion | 2.0/3.0 | Required | Query presented-cash state after reconnect or restart. |
| `CashDispenser.DelayedDispenseEvent` | event | 2.0 | Required | Keep the pending operation bounded without treating delay as success. |
| `CashDispenser.StartDispenseEvent` | event | 2.0 | Required | Record that physical cash movement may have started. |
| `CashDispenser.IncompleteDispenseEvent` | event | 3.0 | Required | Produce a known partial or indeterminate outcome requiring operator action. |

### Cash management used by the dispenser

Cash removal and retract are defined by the Cash Management interface, not the
Cash Dispenser interface. They are part of the dispenser adapter's internal
state machine even though Cashblocks does not expose a separate cash-management
adapter.

| Message | Direction | Version | Requirement | Cashblocks use |
| --- | --- | --- | --- | --- |
| `CashManagement.ItemsPresentedEvent` | unsolicited | 2.0 | Required | Confirm items reached the customer output position. |
| `CashManagement.ItemsTakenEvent` | unsolicited | 2.0 | Required | Confirm the customer took the cash before normal completion. |
| `CashManagement.Retract` | command/completion | 2.0 | Required for automatic cash-not-taken recovery | Move unclaimed cash to the configured retract area. |
| `CashManagement.IncompleteRetractEvent` | event | 2.0 | Required when retract is supported | Require reconciliation after a partial or uncertain retract. |

`CashDispenser.Denominate` is deferred because `CashDispenser.Dispense` can
carry the denomination request needed by the reference profile. The emulator
profile will support Cash Management retract so the required cash-not-taken
scenario has a deterministic recovery path. A missing, failed, or ambiguous
retract remains an explicit reconciliation outcome.

## Adapter mapping

| Cashblocks operation | XFS4IoT sequence | Successful result | Failure boundary |
| --- | --- | --- | --- |
| `CardReaderAdapter.readCard()` | Status/capabilities already validated; `ReadRawData`; card events | Required synthetic card data was detected | Known device/read failures return a failed `AdapterResult`; malformed protocol is diagnostic failure. |
| Terminal card lifecycle | `Move`; `MediaRemovedEvent` | Card return and removal are confirmed before session closure | Requires a lifecycle hook beyond the current `readCard()` contract. |
| `CashDispenserAdapter.dispense()` | Status/capabilities already validated; `Dispense`; optional `Present`; `ItemsPresentedEvent`; `ItemsTakenEvent`; recovery query/retract | Cash movement, presentation, and customer removal are confirmed | Disconnect or timeout after a state-changing send returns `ADAPTER_OUTCOME_UNKNOWN` and requires reconciliation. |

The adapters expose only Cashblocks types. XFS4IoT envelopes and vendor fields
remain in `xfs4iot-client` and `device-xfs4iot`; vendor fields may be preserved
for sanitized diagnostics and evidence but never used as flow policy.

## Required service profile

Startup must fail before accepting a customer session unless discovery finds:

- one Common endpoint with compatible status, capability, version negotiation,
  cancellation, and transaction-state support;
- one CardReader service able to read synthetic demo media and return it to the
  customer;
- one CashDispenser service able to dispense the configured currency and note
  mix, present cash for its transport profile, and report recovery state;
- stable service identities that can be included in journal and certification
  evidence.

The runtime will continue using simulated host authorization for 0.2. Receipt
printer and cash acceptor slots remain simulated because the existing runtime
requires all adapter slots, but they are not part of XFS4IoT interoperability
claims.

## Compatibility matrix

All rows start as unimplemented. The columns must remain separate when work is
completed so protocol tests are not presented as hardware verification.

| Area | Implemented | Tested | Hardware verified | Notes |
| --- | --- | --- | --- | --- |
| Common discovery/lifecycle | No | No | No | Emulator target only. |
| Common status/capabilities | No | No | No | Startup gate for both device services. |
| CardReader withdrawal subset | No | No | No | Synthetic card data only. |
| CashDispenser withdrawal subset | No | No | No | Deterministic emulator inventory. |
| Command/completion correlation | No | No | No | Must cover duplicate and late completions. |
| Async event routing | No | No | No | Must be bounded and session-correlated. |
| Post-send disconnect recovery | No | No | No | Must never report normal success or failure. |
| Independent service provider | No | No | No | Post-0.2 validation candidate. |

## Known gaps and prerequisites

- `TerminalSessionManager` currently constructs simulator-backed runtimes and
  needs an adapter/runtime injection point before the customer terminal can run
  the XFS4IoT profile.
- `CashWithdrawalModule` reads terminal cash from `RuntimeSimulator`; real
  dispenser inventory needs a device-owned projection so evidence does not
  report simulator cash as physical truth.
- The current adapter contract collapses dispense, present, cash-taken, and
  recovery into one `dispense()` promise. The XFS4IoT adapter must own that
  state machine without leaking protocol messages into flow code.
- The current card-reader contract invokes only `readCard()` before PIN entry.
  Returning/ejecting the card at session end requires a runtime lifecycle hook;
  it must not be hidden inside the initial read operation.
- The journal currently records the reconciliation code but not all adapter
  correlation details. The evidence work must add safe correlation metadata.
- No upstream redistribution license has been identified for the schema or
  generated derivatives.

## Artifact policy

| Artifact | Source and license decision |
| --- | --- |
| Official schema and specification HTML | Upstream license not identified; reference by immutable URL and checksum, do not redistribute. |
| Generated types derived from the official schema | Do not commit until derivative-work and redistribution rights are confirmed. |
| Cashblocks-authored fixtures and emulator messages | Original project work under Apache-2.0; use only minimal structural fields and synthetic data. |
| Third-party service binaries or containers | None selected for 0.2; the repository-owned emulator avoids redistribution of KAL or vendor binaries. |

## Protocol limits

The client and emulator use the shared limits in
`fixtures/xfs4iot/2024-03/limits.json`: 256 KiB per message, 32 pending requests,
256 queued events, at most five reconnect attempts within 30 seconds, and
command-specific deadlines between 5 and 30 seconds. A deadline or disconnect
never permits an automatic retry after a state-changing command was sent.

The Cashblocks-authored corpus lives beside the limits. Run
`bun run xfs4iot:validate-fixtures` to download the immutable schema, verify its
size and SHA-256 digest, and validate the corpus without redistributing the
upstream artifact.

[spec-commit]: https://github.com/XFS4IoT/Specifications-Preview.github.io/commit/263591f189c3045296396bafcc52425a867fae09
