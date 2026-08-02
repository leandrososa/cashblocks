# Device Gateway Adapters

`@cashblocks/device-gateway` connects the runtime device contracts to an
external device process. It supplies adapters for receipt printers, cash
dispensers, cash acceptors, and card readers without exposing transport or
vendor APIs to flow packages.

The package includes a concrete WebSocket transport. A deployment-side service
translates the Cashblocks wire contract to XFS4IoT, a vendor SDK, or another
device API. Cashblocks owns request validation, correlation, cancellation,
connection management, and response validation; the bridge owns device-specific
translation.

## Wire Contract

Each command contains a unique request id, configured service id, command,
JSON payload, and runtime correlation:

```json
{
  "requestId": "device-42",
  "serviceId": "cash-dispenser-1",
  "command": "dispense",
  "payload": {
    "amount": 40,
    "currencyCode": "AUD"
  },
  "correlation": {
    "operationId": "operation-8",
    "sessionId": "session-2",
    "transactionName": "CashWithdrawal",
    "deadlineAt": "2026-07-27T12:35:26.000Z"
  }
}
```

The device process must echo `requestId` and return a structured result:

```json
{
  "requestId": "device-42",
  "ok": true,
  "code": "DISPENSED",
  "message": "Cash presented.",
  "details": {
    "amount": 40,
    "currencyCode": "AUD"
  }
}
```

Printer status uses `details.health` (`HEALTHY`, `DEGRADED`, `FATAL`, or
`MISSING`) and `details.paper` (`OK`, `LOW`, or `OUT`). Invalid JSON values,
objects with custom prototypes, missing result fields, and mismatched request
ids are rejected as protocol errors rather than being attributed to the wrong
operation. Default request ids are cryptographic UUIDs and can be replaced with
an injected generator for deterministic tests.

## Configuration

```ts
const deviceAdapters = createDeviceGatewayAdapters({
  transport: {
    exchange(request, context) {
      return localDeviceProcess.exchange(request, {
        signal: context?.signal,
        deadlineAt: context?.deadlineAt
      });
    }
  },
  bindings: {
    receiptPrinter: {
      adapterId: "printer",
      serviceId: "receipt-printer-1"
    },
    cashDispenser: {
      adapterId: "dispenser",
      serviceId: "cash-dispenser-1",
      capabilities: ["finite-inventory"]
    },
    cashAcceptor: {
      adapterId: "acceptor",
      serviceId: "cash-acceptor-1",
      capabilities: ["amount-confirmation"]
    },
    cardReader: {
      adapterId: "reader",
      serviceId: "card-reader-1",
      capabilities: ["chip", "contactless"]
    }
  }
});

const adapters: TerminalAdapters = {
  ...deviceAdapters,
  hostAuthorization
};
```

Command names default to `status`, `print`, `dispense`, `accept`, and `read`.
Each binding can override them for an existing device process. Receipt text is
data, not a raw printer-command channel: C0/C1 control characters are rejected
before transport.

## WebSocket Transport

```ts
import {
  WebSocketDeviceGatewayTransport,
  createDeviceGatewayAdapters
} from "../packages/device-gateway/src/index.js";

const transport = new WebSocketDeviceGatewayTransport({
  url: "wss://127.0.0.1:9443/devices",
  // Custom names extend the built-in dispense/accept policy.
  indeterminateCommands: ["cash-out", "cash-in"]
});

const adapters = createDeviceGatewayAdapters({
  transport,
  bindings
});
```

The transport uses one connection per operation, the
`cashblocks.device.v1` WebSocket subprotocol, and text JSON frames. It rejects
embedded URL credentials, fragments, oversized requests and responses,
mismatched response IDs, expired deadlines, and non-text or invalid JSON
responses. The server must negotiate one of the configured subprotocols before
Cashblocks sends a request. `wss://` is required. `ws://` is available only for loopback
development when `allowInsecureLoopback: true` is explicit.

Request serialization is byte-budgeted before the complete string is built.
The standard runtime WebSocket API exposes an incoming message only after its
frame is materialized, so the built-in response limit detects and closes an
oversized response but cannot prevent that initial allocation. Deployments that
treat the bridge as untrusted should inject a WebSocket factory backed by a
client with a native ingress limit; the factory receives `maxResponseBytes` as
its third argument.

Connection failures before `send()` are safe to retry. After a request is sent,
the recovery result depends on effect risk:

| Command class | Result |
| --- | --- |
| `dispense`, `accept`, or configured equivalent | `ADAPTER_OUTCOME_UNKNOWN`; manual reconciliation |
| `print`, or configured non-idempotent command | `DEVICE_OUTCOME_UNKNOWN`; operator review |
| Idempotent status/read command | `DEVICE_GATEWAY_UNAVAILABLE`; safe retry |
| Invalid protocol response for an idempotent command | `DEVICE_OUTCOME_UNKNOWN`; operator review |

The transport reports recovery metadata but never retries, reconciles, or
reissues a command itself.

## Deployment Boundary

This package is a production integration boundary, not a certified device
service provider. It supplies the network transport and recovery classification;
a deployment still needs device-specific command translation, vendor drivers,
mutual-authentication policy where required, and hardware certification. Those
concerns stay outside flow code and can evolve without changing transaction
definitions.
