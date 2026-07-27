# Native Terminal Packaging

Cashblocks includes a native launcher for the customer-facing terminal. The
launcher reuses the same flow, session manager, HTTP server, and static UI as
development; it adds deployment-safe defaults and can be compiled into a
standalone Bun executable.

## Build a Package

```sh
bun run package:native
```

The command writes `release/native-terminal/` with:

- `cashblocks-terminal` (`.exe` on Windows)
- customer-terminal static assets, including the local campaign manifest and
  campaign images
- `package-manifest.json` for installers and service wrappers

Run the executable with its working directory set to the release directory.
The default URL is `http://127.0.0.1:4174`, health is available at `/health`,
and journal events are persisted to `data/native-terminal.journal.jsonl`.

## Configuration

The executable supports:

```text
--host <address>
--port <1-65535>
--public-dir <path>
--journal <path>
--allow-remote
--origin <http(s) origin>
```

Equivalent environment variables are `CASHBLOCKS_HOST`, `CASHBLOCKS_PORT`,
`CASHBLOCKS_PUBLIC_DIR`, `CASHBLOCKS_JOURNAL_PATH`, and
`CASHBLOCKS_ALLOW_REMOTE=true`. `CASHBLOCKS_ORIGIN` is the externally visible
origin used to validate both `Host` and browser `Origin`.

The launcher refuses non-loopback binding unless `--allow-remote` is explicit.
Remote binding also requires an explicit `--origin`.
Remote deployments must put authentication, TLS, firewall policy, and kiosk
network isolation in front of the terminal server. The launcher also verifies
all required UI assets before listening, verifies journal writability, caps
live sessions, expires inactive sessions, and forces shutdown after a bounded
grace period. Campaign paths are constrained to the packaged public directory;
missing files, invalid JSON, and symbolic links fail preflight before the
terminal begins listening.

## Deployment Boundary

This produces a local executable bundle, not a signed operating-system
installer. MSI/PKG/deb packaging, code signing, auto-start services, browser
kiosk lockdown, and device-driver installation depend on the target fleet and
remain deployment concerns.
