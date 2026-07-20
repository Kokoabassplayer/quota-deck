const DEFAULT_PORT = 8787;
const CODEXBAR_PORT = 8080;
const DEFAULT_CODEXBAR_ORIGIN = `http://127.0.0.1:${CODEXBAR_PORT}`;

/**
 * Validate the small environment interface before opening a socket.
 *
 * @param {Record<string, string | undefined>} env
 */
export function loadRuntimeConfig(env) {
  const publicOrigin = parsePublicOrigin(env.QUOTA_DECK_PUBLIC_ORIGIN);
  const dashboardToken = parseDashboardToken(env.CODEXBAR_DASHBOARD_TOKEN);
  const codexBarOrigin = parseCodexBarOrigin(env.QUOTA_DECK_CODEXBAR_ORIGIN);
  const port = parsePort(env.QUOTA_DECK_PORT, Number(new URL(codexBarOrigin).port));
  const allowedHosts = ["127.0.0.1", "localhost"];
  if (publicOrigin) allowedHosts.push(new URL(publicOrigin).hostname.toLowerCase());

  return {
    host: "127.0.0.1",
    port,
    allowedHosts,
    publicOrigin,
    dashboardToken,
    codexBarOrigin,
  };
}

function parsePort(value, codexBarPort) {
  if (value !== undefined && value !== "" && !/^\d{1,5}$/u.test(value)) {
    throw new TypeError("QUOTA_DECK_PORT must be an integer");
  }
  const port = value === undefined || value === "" ? DEFAULT_PORT : Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === codexBarPort) {
    throw new RangeError("QUOTA_DECK_PORT must be 1024-65535 and different from the CodexBar port");
  }
  return port;
}

function parsePublicOrigin(value) {
  if (value === undefined || value === "") return null;
  if (value !== value.trim()) throw new TypeError("QUOTA_DECK_PUBLIC_ORIGIN cannot contain outer whitespace");

  let url;
  try {
    url = new URL(value);
  } catch (error) {
    throw new TypeError("QUOTA_DECK_PUBLIC_ORIGIN must be a valid URL", { cause: error });
  }

  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    !url.hostname.toLowerCase().endsWith(".ts.net")
  ) {
    throw new TypeError("QUOTA_DECK_PUBLIC_ORIGIN must be an origin-only Tailscale HTTPS URL");
  }
  return url.origin;
}

function parseDashboardToken(value) {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new TypeError("CODEXBAR_DASHBOARD_TOKEN must be a string");
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 4096 || /[\r\n\0]/u.test(trimmed)) {
    throw new TypeError("CODEXBAR_DASHBOARD_TOKEN is invalid");
  }
  return trimmed;
}

function parseCodexBarOrigin(value) {
  if (value === undefined || value === "") return DEFAULT_CODEXBAR_ORIGIN;
  if (typeof value !== "string" || value !== value.trim()) {
    throw new TypeError("QUOTA_DECK_CODEXBAR_ORIGIN must be a loopback HTTP origin");
  }

  let url;
  try {
    url = new URL(value);
  } catch (error) {
    throw new TypeError("QUOTA_DECK_CODEXBAR_ORIGIN must be a valid URL", { cause: error });
  }
  if (
    url.protocol !== "http:"
    || url.hostname !== "127.0.0.1"
    || !url.port
    || url.username
    || url.password
    || url.pathname !== "/"
    || url.search
    || url.hash
  ) {
    throw new TypeError("QUOTA_DECK_CODEXBAR_ORIGIN must be an origin-only 127.0.0.1 HTTP URL");
  }
  const port = Number(url.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new RangeError("QUOTA_DECK_CODEXBAR_ORIGIN port must be 1024-65535");
  }
  return url.origin;
}
