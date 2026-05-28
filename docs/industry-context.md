# Industry Context

Cashblocks does not implement real ATM hardware or payment-network protocols in
the MVP. It defines boundaries where those integrations can be added later.

## XFS / CEN XFS

XFS, commonly discussed as CEN/XFS in the ATM industry, standardizes how
financial applications communicate with device service providers. It is strongly
associated with Windows ATM stacks and vendor service-provider implementations.

In Cashblocks, XFS belongs behind device adapters:

- card reader service provider -> `CardReaderAdapter`
- cash dispenser service provider -> `CashDispenserAdapter`
- receipt printer service provider -> `ReceiptPrinterAdapter`
- cash acceptor/recycler service provider -> `CashAcceptorAdapter`

Flow packages should not call XFS APIs directly.

## J/XFS

J/XFS is a Java-oriented API for financial device access. It is better described
as a Java portability layer for financial devices than simply "open XFS for
Linux." Whether a real deployment can run on Linux depends on available service
providers, vendor support, and device certification.

In Cashblocks, J/XFS also belongs behind device adapters.

## XFS4IoT

XFS4IoT is a newer direction for financial device APIs that uses a more modern
service model. It is relevant for future adapter design because it can map more
naturally to process or network boundaries than classic in-process Windows
service providers.

In Cashblocks, XFS4IoT should still be hidden behind device adapters.

## ISO8583

ISO8583 is a message format for card-originated financial transactions. It is
about host and network messaging, not local ATM device control.

Typical ISO8583 work includes:

- authorization requests and responses
- reversals
- balance inquiries
- network management messages
- terminal and transaction identifiers
- response codes

In Cashblocks, ISO8583 belongs behind `HostAuthorizationAdapter` or future host
adapter contracts. A withdrawal module should ask for authorization; the host
adapter should translate that request into the protocol required by the bank,
switch, or processor.

## Design Rule

Keep industry-specific integrations out of flow code:

- Flow: ordering and customer policy.
- Modules: reusable terminal behavior.
- Device adapters: XFS, J/XFS, XFS4IoT, vendor services, drivers.
- Host adapters: ISO8583, legacy protocols, proprietary host APIs.
