# Contributing to Cashblocks

Thanks for helping improve Cashblocks. Keep changes small, explicit, and easy to
verify.

## Development Setup

Requirements:

- Bun 1.3.10 or newer
- Node.js 22 or newer

```sh
git clone https://github.com/leandrososa/cashblocks.git
cd cashblocks
bun install --frozen-lockfile
bun run check
```

## Before Opening a Pull Request

Run the same checks as CI:

```sh
bun run check
bun audit
git diff --check
```

Add or update tests for every behavior change. Prefer public behavior assertions
over implementation details.

## Design Boundaries

- Flow code owns ordering and customer-specific policy.
- Transaction modules own reusable financial behavior.
- Runtime code owns state, prompts, journals, and adapter orchestration.
- Device and host integrations stay behind adapter contracts.
- Journal events record business and audit facts; diagnostic logs record
  technical failures.
- Never treat an unknown cash-device outcome as a confirmed success or failure.

## Pull Requests

Explain the user-visible outcome, the boundary you changed, and how you verified
it. Keep unrelated refactors in separate pull requests so reviewers can reason
about financial behavior without noise.

For security-sensitive findings, follow [SECURITY.md](SECURITY.md) instead of
opening a public issue.
