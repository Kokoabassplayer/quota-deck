# Quota Deck product specification

## Product job

Show which AI provider is usable now, how much quota remains, and when it resets. The computer is the source of truth; the phone is a private display, not a credential holder or provider client.

## Supported hosts

- macOS is the stable target. Quota Deck prefers CodexBar's authenticated dashboard snapshot on loopback and keeps a bounded legacy fallback for older builds.
- Windows 10/11 is beta. Win-CodexBar provides compatible legacy usage and cost endpoints on loopback.
- Node.js 22 or newer is the only prerequisite installed by the user before running `npx quota-deck@latest setup`.

## Installation contract

The setup command detects the host and prerequisites, obtains explicit consent before installing third-party software, waits for user-controlled authentication, installs a versioned runtime in the user application-data directory, registers user-level background services, and configures only an unused Tailscale Serve root route.

Upgrades are staged and health-checked. State switches only after the new runtime passes checks; failure restores the previous runtime. Uninstall is scoped to Quota Deck and preserves Node.js, CodexBar, Tailscale, provider credentials, and unrelated Serve configuration.

## Architecture

```text
Mobile PWA -> Tailscale Serve HTTPS -> Quota Deck on 127.0.0.1
                                           |
                                           v
                                  CodexBar on 127.0.0.1
```

`GET /api/snapshot` schema v1 returns normalized provider windows, reset timestamps, freshness, privacy-safe errors, and optional summary detail. Optional fields may be added; existing fields do not change meaning without a version bump.

The gateway keeps the last successful in-memory snapshot. Requests can receive it immediately while one coalesced refresh runs in the background. Temporary provider failures preserve recent quota for a bounded period while the provider remains visibly partial.

## Security invariants

- No public internet route and no Tailscale Funnel.
- Local services bind to loopback; the upstream override is loopback-only.
- Secrets remain server-side and outside the npm package.
- Upstream paths and methods are allowlisted; request time, response size, and content type are bounded.
- API responses use `Cache-Control: no-store`; the service worker bypasses `/api/`.
- Upstream values render as text, never HTML.
- Unknown ports and Tailscale Serve routes fail closed.
- Diagnostics exclude credentials, executable paths, provider payloads, and account identity.

## Acceptance criteria

- `setup`, `doctor`, and `uninstall` work from the published package on Node 22.
- Setup is idempotent and upgrades roll back on failed health checks.
- A phone in the permitted tailnet can refresh and install the PWA over HTTPS.
- Healthy providers remain visible when another provider fails.
- English and Thai UI use browser-local timezone formatting.
- Package inspection and scans find no credentials or machine-specific metadata.
- CI passes on macOS and Windows; Windows remains beta until real Windows 10/11 persistence and mobile smoke tests pass.

## Non-goals

- Tailscale Funnel or other public exposure.
- Editing provider settings from the phone.
- Reimplementing provider authentication.
- Docker-based installation.
- Keeping the host awake automatically.
