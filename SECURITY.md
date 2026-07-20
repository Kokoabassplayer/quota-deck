# Security policy

## Reporting

Please report suspected vulnerabilities through GitHub private vulnerability reporting. Do not include provider tokens, OAuth material, raw CodexBar responses, account identifiers, or private tailnet hostnames in a public issue.

## Security boundary

Quota Deck is designed for access through Tailscale Serve inside a tailnet. It does not enable Funnel, expose provider credentials to the browser, or authenticate arbitrary public users itself. Access control therefore also depends on the user's Tailscale account, tailnet policy, device security, CodexBar configuration, and host operating system.

The setup command intentionally refuses unknown occupied ports and existing Serve configuration. If automatic setup stops for this reason, inspect the conflict instead of deleting or replacing it blindly.

Supported security fixes target the latest released version on macOS and the current Windows beta.
