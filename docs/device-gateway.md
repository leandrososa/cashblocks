# Device Gateway Adapters

`@cashblocks/device-gateway` connects the runtime device contracts to an
external device process. It supplies adapters for receipt printers, cash
dispensers, cash acceptors, and card readers without exposing transport or
vendor APIs to flow packages.

The injected transport can be implemented with WebSocket, local IPC, a vendor
SDK bridge, XFS4IoT, or another protocol. Cashblocks owns request validation,
correlation, cancellation, and response validation; the transport owns
connection management and the translation to the target device API.

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

## Deployment Boundary

This package is a production integration boundary, not a certified device
service provider. A deployment still needs a transport implementation,
device-specific command translation, recovery policy, vendor drivers, and
hardware certification. Those concerns stay outside flow code and can evolve
without changing transaction definitions.
