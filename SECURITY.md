# Security policy

## Reporting

Please report suspected vulnerabilities through GitHub private vulnerability reporting. Do not include provider tokens, OAuth material, raw CodexBar responses, account identifiers, private access tokens, or private tailnet hostnames in a public issue.

## Security boundary

Quota Deck is designed for access through Tailscale Serve inside a tailnet. It does not enable Funnel or expose provider credentials to the browser.

Access control has two layers:

1. **Tailscale** — only devices and users permitted by your tailnet ACL can reach the Serve hostname.
2. **Gateway access token** — setup generates a 256-bit token stored owner-only on disk. The mobile QR/URL includes `?t=…` once; the PWA keeps it in `sessionStorage` and calls `GET /api/snapshot` with `Authorization: Bearer`. Without the token, the shell may load but quota data is not returned.

Access control still also depends on the user's Tailscale account, tailnet policy, device security, CodexBar configuration, and host operating system. Prefer a personal tailnet ACL that allows only your devices.

### Local secrets

| Secret | Location | Notes |
|--------|----------|--------|
| CodexBar dashboard token (macOS) | `~/Library/Application Support/QuotaDeck/dashboard-token` | Owner `0600`, not in plist/args/logs |
| Gateway access token | `…/QuotaDeck/access-token` | Owner `0600` (macOS) / owner-only ACL (Windows); not written to `install.json` |
| z.ai API key (Windows, optional) | `%LOCALAPPDATA%\QuotaDeck\zai-api-key` | Loaded only if the file is a regular owner-only file; refused otherwise |

### Setup fail-closed rules

The setup command intentionally refuses unknown occupied ports and existing Serve configuration. If automatic setup stops for this reason, inspect the conflict instead of deleting or replacing it blindly.

Quota Deck never enables Tailscale Funnel. `QUOTA_DECK_CODEXBAR_ORIGIN` accepts only `http://127.0.0.1:<port>`.

### Install trust

`npx quota-deck@latest setup` installs user-level background services. Prefer pinning a release (`npx quota-deck@0.1.0 setup`), review the GitHub source for that tag, and verify npm provenance when available.

Supported security fixes target the latest released version on macOS and the current Windows beta.
