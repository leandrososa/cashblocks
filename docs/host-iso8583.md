# ISO8583 Host Adapter

`@cashblocks/host-iso8583` is an initial, transport-independent
`HostAuthorizationAdapter`. It keeps ISO8583 encoding and response mapping behind
the runtime host boundary so flow packages remain unchanged.

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

## Transport

Network framing, TLS, connection management, and host-specific headers belong in
an injected transport:

```ts
const transport: Iso8583Transport = {
  async exchange(message, context) {
    return connection.request(message, {
      signal: context?.signal,
      deadlineAt: context?.deadlineAt
    });
  }
};

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
  }
});
```

Pass this adapter in the `hostAuthorization` slot of `TerminalAdapters`.
Cashblocks supplies the operation context and enforces its timeout.

## Deliberate Limits

This package is not a production ISO8583 switch implementation. It does not
provide:

- binary field packing or secondary bitmaps
- PAN/PIN capture or PIN blocks
- MACs, key management, HSM integration, or encryption
- reversals, advice, settlement, echo, or network management
- TCP length headers, reconnect policy, or store-and-forward
- scheme- or host-specific field dictionaries

Those require an actual host specification, security design, test keys, and
network certification. Extend the codec/transport behind the same adapter
contract rather than adding protocol logic to flows.
