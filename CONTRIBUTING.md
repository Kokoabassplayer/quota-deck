# Contributing

Use Node.js 22 or newer.

```bash
npm ci
npm test
```

Keep provider-schema variation behind the normalization layer. Never add credentials, account identities, private URLs, local paths, raw provider payloads, generated service files, or runtime state to the repository or fixtures. Use reserved example domains and clearly fictional test values.

Changes to setup, services, Tailscale routing, token handling, or uninstall must include tests for consent boundaries, rollback, and scoped cleanup. Windows behavior remains beta and needs a real Windows smoke before being described as stable.
