# Quota Deck

Private, mobile-first AI quota monitoring powered by CodexBar and Tailscale.

## Install

Install [Node.js 22 or newer](https://nodejs.org/), then run:

```bash
npx quota-deck@latest setup
```

The wizard checks your computer, asks before installing missing software, opens the login screens, installs a private background runtime, configures an unused Tailscale Serve HTTPS listener (falling back to `:8443`/`:10000` on Windows when `:443` already serves another homelab app), and shows a mobile URL with a locally generated QR code.

- macOS: stable setup using CodexBar and LaunchAgents; it uses the authenticated local dashboard endpoint when available and a bounded legacy fallback otherwise.
- Windows 10/11: beta setup using Win-CodexBar legacy `serve` endpoints and limited-user Scheduled Tasks.
- English and Thai are detected automatically; the dashboard language can be switched at any time.

No repository clone, configuration file, service command, hostname lookup, Docker, or administrator-level Quota Deck service is required for the Codex-only path. Authentication still needs your interaction because provider and Tailscale login cannot be automated safely.

On Windows, z.ai is optional. To add it, place the API key in the owner-only file `%LOCALAPPDATA%\QuotaDeck\zai-api-key` and run `setup` again. Quota Deck loads that file only into the local CodexBar process, keeps the gateway and browser key-free, and never writes the key to `install.json`, logs, the QR code, or `/api/snapshot`.

## Commands

```bash
npx quota-deck@latest setup
npx quota-deck@latest doctor
npx quota-deck@latest doctor --json
npx quota-deck@latest uninstall
```

Running `setup` again repairs or upgrades the installation. A new runtime is staged and health-checked before it becomes active; a failed health check restores the previous version.

Advanced options:

```text
--gateway-port <port>   Quota Deck port (default 8787)
--codexbar-port <port>  CodexBar port (default 8080)
--non-interactive       Never prompt or install missing prerequisites
--no-open               Do not open applications or the finished dashboard
--yes, -y               Confirm requested install/uninstall actions
```

`uninstall` removes only the Quota Deck runtime, background tasks, token, logs, state, and the exact Tailscale Serve route that belongs to it. It preserves Node.js, CodexBar, Tailscale, provider credentials, and unrelated Serve routes.

## How it works

```text
Phone browser or installed PWA
          |
          | HTTPS inside your tailnet
          v
     Tailscale Serve
          |
          v
Quota Deck gateway (loopback)
          |
          v
   CodexBar serve (loopback)
```

The phone receives only normalized quota, reset, freshness, and optional usage-summary fields. Provider credentials remain on the computer. The browser API is `GET /api/snapshot` schema v1 and is never cached by the service worker.

The computer must be awake, logged in, and connected to Tailscale. Access is governed by your tailnet policy. Quota Deck never enables Tailscale Funnel or opens a public router port.

## Privacy and security

- Both local services bind to loopback.
- macOS uses a generated 256-bit CodexBar dashboard token stored outside the package with owner-only permissions.
- The token is not placed in a plist, command argument, browser response, QR service, or log.
- The QR code is rendered locally in the terminal; the private URL is not sent to a third party.
- `QUOTA_DECK_CODEXBAR_ORIGIN` accepts only strict `http://127.0.0.1:<port>` values.
- Setup refuses to replace an unknown local port or any existing Tailscale Serve configuration.
- `doctor --json` reports capability state without executable paths, credentials, account identities, or provider payloads.
- The npm package has no `postinstall` script and uses an explicit file allowlist.

See [SECURITY.md](SECURITY.md) for reporting and threat-boundary details.

## Development

```bash
npm ci
npm test
npm start
```

Node 22 is the supported baseline. Pull requests run the test suite on macOS and Windows. Release publishing is configured for npm trusted publishing with GitHub Actions OIDC and provenance; no long-lived npm write token is stored in the repository.

Quota Deck is independent community software. It is not affiliated with OpenAI, CodexBar, Win-CodexBar, or Tailscale.

## License

MIT
