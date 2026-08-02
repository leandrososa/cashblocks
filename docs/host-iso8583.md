# ISO8583 Host Adapter

`@cashblocks/host-iso8583` keeps ISO8583 encoding, response mapping, network
framing, trace allocation, and reversal recovery behind the runtime host
boundary so flow packages remain unchanged.

## Supported Message Subset

The codec supports an ASCII MTI, hexadecimal primary bitmap, and these fields:

| Field | Meaning | Format |
| --- | --- | --- |
| 2 | PAN, for codec use | LLVAR numeric, up to 19 |
| 3 | Processing code | 6 numeric |
| 4 | Transaction amount | 12 numeric |
| 7 | Transmission date/time | 10 numeric |
| 11 | Systems trace audit number | 6 numeric |
| 39 | Response code | 2 numeric |
| 41 | Terminal id | 8 printable ASCII |
| 49 | Currency numeric code | 3 numeric |

Authorization requests use MTI `0100`; responses must use `0110`, include field
39, and echo field 11. Response code `00` maps to `HOST_APPROVED`; other valid
codes are classified through a configurable `responseCodeMap` as declined,
retryable, or error. Malformed, unsupported, or mismatched responses map to
`HOST_PROTOCOL_ERROR`.

Transaction names map to six-digit field-3 values through `processingCodes`.
Known ATM transactions have defaults; unknown names fail closed before the
transport is called. Amounts are converted deterministically to minor units and
rejected when they exceed the precision represented by that currency's entry
in `minorUnitScales`.

## Framed TLS Transport

The included transport opens one isolated connection per exchange and supports
two- or four-byte big-endian length headers:

```ts
import {
  DurableStanAllocator,
  FramedIso8583Transport
} from "../packages/host-iso8583/src/index.js";

const transport = new FramedIso8583Transport({
  host: "switch.example.net",
  port: 443,
  tls: {
    servername: "switch.example.net",
    ca: trustedHostCa,
    cert: terminalCertificate,
    key: terminalPrivateKey,
    minVersion: "TLSv1.3"
  }
});

const stan = new DurableStanAllocator({
  path: "./data/iso8583-stan.json"
});

const hostAuthorization = new Iso8583HostAuthorizationAdapter({
  terminalId: "ATM00001",
  transport,
  currencyNumericCodes: {
    AUD: "036"
  },
  minorUnitScales: {
    AUD: 100
  },
  processingCodes: {
    CashWithdrawal: "010000"
  },
  responseCodeMap: {
    "91": "retryable"
  },
  nextTrace: () => stan.next()
});
```

TLS certificate verification is always enabled. Plain TCP is limited to an
explicitly opted-in loopback connection for local testing. The transport bounds
frames, rejects data trailing a complete frame in the same read and non-ASCII
payloads, requires positive TLS authorization, and rechecks deadlines before
send and response acceptance. Each exchange closes its connection after the
first complete response, so bytes arriving after response acceptance are not
reused by another request.

The STAN allocator uses an exclusive lock and atomic state replacement, survives
process restarts, serializes concurrent allocators, and wraps from `999999` to
`000001`. It synchronizes the replacement file before rename and synchronizes
the parent directory where the operating system supports directory `fsync`.
Windows does not expose that operation through Node, so power-loss durability
there depends on the selected filesystem and deployment policy. The adapter
accepts either synchronous or asynchronous `nextTrace` providers.

Lock files are never removed automatically because process liveness cannot be
determined safely from file age. After a crash, an operator may remove a
`*.lock` file only after verifying that no Cashblocks process is using the same
state path.

## Reversal Recovery

`JsonlReversalStore` records non-sensitive reversal intentions and their
attempt/completion lifecycle in append-only JSONL. `ReversalProcessor` drains a
bounded batch through the configured transport:

```ts
const reversals = new JsonlReversalStore({
  path: "./data/iso8583-reversals.jsonl"
});

const processor = new ReversalProcessor({
  store: reversals,
  transport,
  buildMessage: (intent) => hostProfile.buildReversal(intent),
  acceptResponse: (intent, response) =>
    hostProfile.acceptsReversalResponse(intent, response)
});
```

The store accepts an exact schema and persists identifiers, a bounded
transaction code, trace, amount, currency, terminal, time, and a bounded reason
code—not PAN, PIN, keys, arbitrary extra fields, or a raw authorization message.
It serializes writers and processors across processes, synchronizes every
appended event, repairs an incomplete final JSONL line after a crash, and bounds
file bytes, records, events, and batch size. Failure messages are bounded and
long digit sequences are redacted; callers must still avoid putting sensitive
data in identifiers, reason codes, or thrown errors.

The deployment-owned host profile builds and validates the actual reversal
because MTI, original-data fields, MACs, and acknowledgement rules vary by host.
As with STAN allocation, abandoned reversal lock files require operator
recovery only after process liveness has been checked.

## Deliberate Limits

This package provides production-readiness mechanisms, not a certified
ISO8583 switch implementation. It does not provide:

- binary field packing or secondary bitmaps
- PAN/PIN capture or PIN blocks
- MACs, key management, HSM integration, or encryption
- a host-specific reversal message, advice, settlement, echo, or network management
- automatic retries or an always-on connection pool
- scheme- or host-specific field dictionaries

Those require an actual host specification, security design, test keys, and
network certification. Extend the codec/transport behind the same adapter
contract rather than adding protocol logic to flows.
