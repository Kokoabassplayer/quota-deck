# Coding standards

- Target Node.js 22 and modern evergreen browsers.
- Keep runtime dependencies at zero unless a dependency removes more risk than it adds.
- Use ECMAScript modules and JSDoc where a public interface needs a contract.
- Keep CodexBar schema variation behind one normalization module.
- Never expose provider credentials or `CODEXBAR_DASHBOARD_TOKEN` to browser code.
- Never cache `/api/*` responses in the service worker or shared HTTP caches.
- Test behavior through the documented seams; do not test private implementation details.
- Preserve keyboard focus, semantic landmarks, readable contrast, and reduced-motion behavior.
- Treat upstream strings as text, never as HTML.
