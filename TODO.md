# Cashblocks 0.2 TODO: XFS4IoT Withdrawal Reference

## Milestone

Run the existing Cashblocks cash-withdrawal flow against a reproducible
XFS4IoT service, including fault injection, recovery evidence, documentation,
and a recorded demonstration.

The milestone proves protocol-level interoperability. It does **not** claim
compatibility with a specific ATM, production readiness, PCI compliance, or
certification against real hardware.

## Definition of Done

- [ ] A fresh clone can start the XFS4IoT service and Cashblocks demo with one
      documented command per process.
- [ ] Cashblocks discovers the service and validates the capabilities needed
      for a withdrawal before starting the transaction.
- [ ] The existing withdrawal flow completes through XFS4IoT card-reader and
      cash-dispenser commands rather than the in-process device simulator.
- [ ] Happy-path and uncertain-dispense scenarios are covered by deterministic
      automated tests.
- [ ] A connection loss after a state-changing dispense request produces a
      reconciliation-required outcome and never a false success.
- [ ] Journal replay and the certification harness produce saved, reviewable
      evidence for the XFS4IoT scenarios.
- [ ] The protocol messages used by the adapter validate against a pinned
      public XFS4IoT specification release.
- [ ] The README links to a runnable quickstart, compatibility matrix, known
      limitations, and a short recorded demo.
- [ ] `bun run check` and `bun audit` pass from a clean checkout.

## Scope Decisions

- [ ] Pin the target XFS4IoT specification release. Start with release
      `2024-03` unless an incompatibility is documented.
- [ ] Record the exact command and event subset required by the current
      withdrawal flow.
- [ ] Decide whether the first external service is KAL SP-Dev, another public
      implementation, or a repository-owned protocol emulator.
- [ ] Document license and redistribution constraints for schemas, generated
      types, fixtures, and third-party binaries before committing them.
- [ ] Write an architecture decision record for the mapping between XFS4IoT
      services and Cashblocks adapter contracts.

### Required protocol subset

- [ ] Common: endpoint discovery, service identity, capabilities, status,
      open/close lifecycle, and error mapping.
- [ ] Card reader: card-present activation, card data required by the demo,
      card removal/ejection, device offline, and media-jammed events.
- [ ] Cash dispenser: capabilities, cash-unit status, denomination/dispense,
      present, cash-taken, retract or incomplete operation, and device events.
- [ ] Correlate every command, completion, event, session, and journal record.
- [ ] Preserve XFS4IoT vendor-specific fields without allowing them into flow
      policy.

### Explicitly out of scope for 0.2

- [ ] Do not implement PIN-pad encryption, PIN blocks, EMV kernels, key loading,
      MACs, production host messages, or handling of real cardholder data.
- [ ] Do not claim certification for XFS4IoT, CEN/XFS, ISO8583, PCI, or a vendor.
- [ ] Do not add receipt printer, cash acceptor/recycler, NFC, QR, biometrics, or
      fleet management unless required to unblock the withdrawal proof.
- [ ] Do not couple the flow SDK directly to XFS4IoT message shapes.

## 1. Protocol Research and Fixtures

- [ ] Add `docs/xfs4iot-compatibility.md` with the pinned release, supported
      services, commands, events, fields, and known gaps.
- [ ] Capture minimal valid request, completion, event, and error fixtures for
      each required command.
- [ ] Add malformed, mismatched-request, unsupported-command, timeout, and
      disconnect fixtures.
- [ ] Define protocol limits for message size, pending requests, event backlog,
      reconnect attempts, and deadlines.
- [ ] Ensure fixtures contain no real PAN, PIN, keys, account data, or vendor
      credentials.

## 2. XFS4IoT Client Package

- [ ] Create `packages/xfs4iot-client` with no dependency on ATM flows or UI.
- [ ] Implement secure WebSocket connection setup and explicit loopback-only
      opt-in for plaintext development connections.
- [ ] Implement command/completion correlation and asynchronous event routing.
- [ ] Validate inbound envelopes and the supported payload subset at runtime.
- [ ] Support cancellation, command deadlines, reconnect policy, and bounded
      resource use.
- [ ] Classify failures as safe-to-retry, declined/known, or indeterminate after
      a state-changing send.
- [ ] Redact sensitive or unknown protocol fields from diagnostic logs.
- [ ] Add unit tests for framing, correlation, duplicate or late completions,
      unexpected events, disconnects, aborts, and malformed messages.

## 3. Cashblocks Device Adapters

- [ ] Create `packages/device-xfs4iot` on top of `xfs4iot-client`.
- [ ] Implement an XFS4IoT-backed `CardReaderAdapter`.
- [ ] Implement an XFS4IoT-backed `CashDispenserAdapter`.
- [ ] Map service capabilities into Cashblocks adapter identity and capability
      declarations.
- [ ] Reject startup when required services or capabilities are missing.
- [ ] Map XFS4IoT device errors into structured `AdapterResult` failures.
- [ ] Treat disconnect, timeout, or ambiguous completion after dispense as an
      indeterminate cash movement requiring reconciliation.
- [ ] Keep XFS4IoT types and vendor extensions out of flow code and ATM modules.
- [ ] Add adapter contract tests shared with the existing simulator adapters
      where practical.

## 4. Reproducible XFS4IoT Service

- [ ] Add `apps/xfs4iot-emulator` or a pinned container/script for the selected
      third-party service.
- [ ] Provide deterministic device profiles for card reader and cash dispenser.
- [ ] Expose fault controls outside the customer-facing terminal.
- [ ] Support at least: offline device, delayed completion, pre-send disconnect,
      post-send disconnect, dispense failure, cash not taken, and recovery query.
- [ ] Reset emulator state deterministically between test cases.
- [ ] Add health and readiness checks for local development and CI.
- [ ] Document ports, TLS certificates, configuration files, startup, shutdown,
      and state cleanup.
- [ ] Pin all external versions and verify downloads or container digests.

## 5. End-to-End Withdrawal Scenarios

- [ ] Add a runtime configuration that selects XFS4IoT devices while retaining
      the simulated host authorization adapter.
- [ ] Complete a card-present cash withdrawal through the customer terminal.
- [ ] Verify card removal and cash-taken events close the session correctly.
- [ ] Test insufficient device capabilities before transaction start.
- [ ] Test device-offline failure before dispense as safe and non-financial.
- [ ] Test host decline and confirm no dispense command is issued.
- [ ] Test disconnect before the dispense send as safe to retry.
- [ ] Test disconnect after the dispense send as reconciliation required.
- [ ] Test late or duplicate completion without double completion or double
      journal effects.
- [ ] Test restart/reconnect and query enough device state to support operator
      reconciliation.

## 6. Evidence, Replay, and Certification

- [ ] Extend the certification harness with an `xfs4iot.withdrawal.v1` profile.
- [ ] Save machine-readable evidence for happy path and recovery scenarios.
- [ ] Assert that approved host requests and dispense attempts pair correctly in
      strict journal replay.
- [ ] Assert that uncertain cash movement cannot be reported as a normal failure
      or success.
- [ ] Include adapter id, service identity, protocol release, request ids, and
      correlation ids in evidence without sensitive payloads.
- [ ] Emit CI-friendly JUnit or JSON summaries for the interoperability suite.
- [ ] Document which assertions are Cashblocks-owned and which, if any, come
      from an external conformance suite.

## 7. Developer Experience and Documentation

- [ ] Add `docs/xfs4iot-quickstart.md` for a clean machine.
- [ ] Provide commands to install, start the service, run the terminal, inject a
      fault, replay the journal, and run certification.
- [ ] Add a protocol/data-flow diagram to the architecture documentation.
- [ ] Add troubleshooting for ports, TLS, service discovery, unsupported
      capabilities, stale state, and reconciliation-required results.
- [ ] Clearly label simulated host behavior and protocol-emulated hardware.
- [ ] Add a security warning prohibiting real cards, PINs, keys, host endpoints,
      and production credentials.
- [ ] Publish a compatibility matrix with `implemented`, `tested`, and
      `hardware-verified` as separate columns.

## 8. CI and Release

- [ ] Run the XFS4IoT unit and adapter tests in the normal CI job.
- [ ] Add a bounded interoperability job that starts the selected service and
      runs the end-to-end suite.
- [ ] Cache or pin third-party dependencies without silently following `latest`.
- [ ] Upload certification evidence and relevant sanitized logs on CI failure.
- [ ] Verify clean shutdown so CI cannot leave ports or child processes behind.
- [ ] Add package exports and versioning for the new public packages.
- [ ] Create a `v0.2.0` release candidate and run the quickstart from its
      artifacts in a clean environment.
- [ ] Publish release notes with supported commands, limitations, security
      boundary, and the exact level of interoperability proven.

## 9. Demonstration and External Validation

- [ ] Record a 60-90 second demo covering a successful withdrawal, a
      post-dispense disconnect, reconciliation evidence, and journal replay.
- [ ] Add the recording and a concise milestone summary to the README.
- [ ] Ask at least one XFS4IoT or ATM-software practitioner to review the command
      mapping and failure classification.
- [ ] Have a developer unfamiliar with the repository run the quickstart and
      record setup time and blockers.
- [ ] Open follow-up issues for feedback rather than expanding the 0.2 scope.
- [ ] Mark the release `hardware-unverified` until a real vendor service provider
      and physical device have passed a separately documented test plan.

## Recommended Execution Order

1. Scope decisions and compatibility document.
2. Protocol fixtures and client transport.
3. Card-reader and cash-dispenser adapters.
4. Reproducible service and fault controls.
5. End-to-end scenarios and recovery behavior.
6. Certification evidence and CI.
7. Quickstart, compatibility matrix, demo, and release candidate.

## Post-0.2 Candidates

- [ ] Validate the same adapter against an independent XFS4IoT implementation.
- [ ] Test against a vendor service provider and record its exact device profile.
- [ ] Build a low-cost physical kiosk profile with touch display, reader, and
      thermal printer.
- [ ] Add printer, PIN-pad, NFC/QR credential, and cash-recycler services as
      separately scoped milestones.
- [ ] Develop a real-hardware certification plan with a laboratory, integrator,
      refurbisher, or ATM vendor.

## Reference Material

- XFS4IoT specification releases and schemas:
  <https://xfs4iot.github.io/Specifications-Preview.github.io/>
- KAL XFS4IoT SP-Dev:
  <https://github.com/KAL-ATM-Software/KAL_XFS4IoT_SP-Dev>

