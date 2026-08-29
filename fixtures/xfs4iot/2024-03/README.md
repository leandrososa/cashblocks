# XFS4IoT 2024-03 fixtures

This directory contains Cashblocks-authored, minimal fixtures for the withdrawal
subset. It does not contain copies of the upstream specification or schema.

- `valid-messages.json` covers every supported command, completion, solicited
  event, unsolicited event, acknowledgement, and representative device error.
- `adversarial.json` captures malformed input, correlation mismatch,
  unsupported commands, command timeout, and disconnect boundaries.
- `limits.json` fixes the transport and resource limits that the client and
  emulator must share.

All card data is synthetic. `AQID` is the Base64 encoding of three arbitrary
bytes and is not a PAN, track, PIN, key, account value, or vendor credential.
Do not replace it with real cardholder or production data.

Run `bun run xfs4iot:validate-fixtures` to download the immutable upstream
schema, verify its byte count and SHA-256 digest, validate the valid message
corpus, and prove that schema-level adversarial messages are rejected. Pass a
previously downloaded schema with `--schema /absolute/path/to/schema.json` for
an offline run.
