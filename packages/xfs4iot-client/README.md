# @cashblocks/xfs4iot-client

Protocol-only XFS4IoT 2024-03 client for Cashblocks. This package has no
dependency on ATM flows, device adapters, or UI packages.

```ts
import { Xfs4IotClient } from "@cashblocks/xfs4iot-client";

const client = new Xfs4IotClient({
  url: "wss://service.example.test/xfs4iot"
});

const status = await client.execute({ name: "Common.Status" });
```

The client keeps one persistent WebSocket connection, correlates commands,
acknowledgements, completions, and solicited events by numeric `requestId`, and
routes unsolicited events through a bounded backlog. `onEvent()` provides live
delivery and `drainEvents()` returns the current backlog.

Transport failures are `Xfs4IotClientError` values classified as
`safe-to-retry`, `known`, or `indeterminate`. A disconnect, timeout, abort, or
protocol failure after `CashDispenser.Dispense` is sent is indeterminate and
must be mapped to reconciliation by the device adapter. The client never
reissues an ambiguous command.

Secure `wss:` connections are required. Plaintext `ws:` is accepted only when
`allowInsecureLoopback` is explicitly enabled and the endpoint uses the literal
`127.0.0.1` or `::1` address. Embedded URL credentials are rejected.

Protocol limits and supported messages are exported from the package and are
shared with `fixtures/xfs4iot/2024-03`. Diagnostic output contains correlation
headers only; use `redactXfs4IotDiagnostic()` before including protocol-derived
values in custom diagnostics.
