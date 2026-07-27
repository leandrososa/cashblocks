# Certification Harness

`@cashblocks/certification-harness` turns simulator or adapter executions into
bounded, machine-readable conformance reports. It verifies expected outcomes,
required and forbidden events, strict journal replay, financial deltas, and a
deterministic recovery action.

Run the built-in ATM simulator profile:

```sh
bun run certify -- --pretty
bun run certify -- --output ./reports/atm-certification.json
```

The second command creates a new file and refuses to overwrite existing
evidence. Exit code `0` means every scenario passed, `1` means at least one
scenario failed, and `2` means the command could not run because its arguments,
configuration, or output operation were invalid.

## Included ATM Scenarios

The `simulator.v1` profile covers:

- successful withdrawal with account and terminal-cash conservation
- successful deposit with account and terminal-cash conservation
- definitive host decline
- card reader failure before authorization
- dispenser failure after host approval
- customer cancellation before authorization

Each case carries a SHA-256 evidence digest over its request, normalized events,
and summary. Normalization intentionally excludes event timestamps and session
IDs, so identical behavior produces the same `reportId` across runs. Report
timestamps remain available for audit chronology but do not affect identity.

## Recovery Policy

The classifier is conservative and ordered:

| Evidence | Action |
| --- | --- |
| Unknown device outcome event | `manual_reconciliation` |
| Host authorization request without its matching transaction result | `manual_reconciliation` |
| Completed, cancelled, or definitive host decline | `none` |
| Failure after host approval | `reverse_authorization` |
| Known pre-authorization recoverable failure | `safe_retry` |
| Anything else | `operator_review` |

This classification recommends the next operational action; it never performs a
retry, reversal, or device command. It derives its decision from journal events,
not the executor summary, and scopes host approvals to the current transaction
occurrence.

## Reusable API

```ts
import { runCertificationSuite } from
  "../packages/certification-harness/src/index.js";

const report = await runCertificationSuite({
  suiteId: "acme.atm",
  profileId: "lab.v1",
  scenarios,
  execute: async (request) => runAgainstLab(request)
});
```

Executors return a summary and runtime events. The harness validates identifiers,
plain-JSON evidence, scenario, event, and serialized-byte limits, contains
executor exceptions as auditable failures, and uses strict journal replay
without re-executing side effects. Financial checks are derived from the
validated terminal event and must also agree with the executor summary.

## Scope Boundary

This is certification *support*, not a claim of external certification. The
built-in profile certifies simulator behavior against repository-owned rules.
Network, vendor, scheme, security-key, and hardware certification still require
the applicable specifications, test hosts, devices, laboratories, and evidence
owners.
