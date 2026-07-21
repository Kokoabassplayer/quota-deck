import { createHash, timingSafeEqual } from "node:crypto";
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_PUBLIC_DIR = fileURLToPath(new URL("../../public", import.meta.url));

const STATIC_ASSETS = new Map([
  ["/", { file: "index.html", type: "text/html; charset=utf-8", cache: "no-cache" }],
  ["/index.html", { file: "index.html", type: "text/html; charset=utf-8", cache: "no-cache" }],
  ["/app.mjs", { file: "app.mjs", type: "text/javascript; charset=utf-8", cache: "no-cache" }],
  ["/i18n.mjs", { file: "i18n.mjs", type: "text/javascript; charset=utf-8", cache: "no-cache" }],
  ["/view-model.mjs", { file: "view-model.mjs", type: "text/javascript; charset=utf-8", cache: "no-cache" }],
  ["/styles.css", { file: "styles.css", type: "text/css; charset=utf-8", cache: "no-cache" }],
  ["/manifest.webmanifest", { file: "manifest.webmanifest", type: "application/manifest+json; charset=utf-8", cache: "no-cache" }],
  ["/sw.js", { file: "sw.js", type: "text/javascript; charset=utf-8", cache: "no-cache" }],
  ["/icons/quota-deck.svg", { file: "icons/quota-deck.svg", type: "image/svg+xml", cache: "public, max-age=86400" }],
  ["/icons/icon-192.png", { file: "icons/icon-192.png", type: "image/png", cache: "public, max-age=86400" }],
  ["/icons/icon-512.png", { file: "icons/icon-512.png", type: "image/png", cache: "public, max-age=86400" }],
]);

const SECURITY_HEADERS = {
  "Content-Security-Policy": [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
  ].join("; "),
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "Referrer-Policy": "no-referrer",
  "Strict-Transport-Security": "max-age=31536000",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

/**
 * @param {{
 *   codexBarClient: { getSnapshot(): Promise<unknown> },
 *   logger?: Pick<Console, "error">,
 *   publicDir?: string,
 *   allowedHosts?: string[],
 *   publicOrigin?: string | null,
 *   accessToken?: string | null,
 *   instanceID?: string | null,
 * }} options
 */
export function createQuotaDeckServer({
  codexBarClient,
  logger = console,
  publicDir = DEFAULT_PUBLIC_DIR,
  allowedHosts = ["127.0.0.1", "localhost"],
  publicOrigin = null,
  accessToken = null,
  instanceID = null,
}) {
  if (!codexBarClient || typeof codexBarClient.getSnapshot !== "function") {
    throw new TypeError("codexBarClient.getSnapshot is required");
  }

  const trustedHosts = new Set(allowedHosts.map(normalizeHostname));
  const trustedOrigins = new Set();
  if (publicOrigin !== null && publicOrigin !== undefined) {
    trustedOrigins.add(normalizeOrigin(publicOrigin));
  }
  const trustedInstanceID = /^[a-f0-9]{32}$/u.test(String(instanceID ?? "")) ? String(instanceID) : null;
  const requiredAccessToken = normalizeAccessToken(accessToken);

  const server = http.createServer(
    {
      maxHeaderSize: 8 * 1024,
      requireHostHeader: true,
    },
    (request, response) => {
      handleRequest(request, response, {
        codexBarClient,
        logger,
        publicDir,
        trustedHosts,
        trustedOrigins,
        accessToken: requiredAccessToken,
        instanceID: trustedInstanceID,
      }).catch((error) => {
        logger.error?.("Quota Deck request failed", {
          name: error?.name ?? "Error",
          status: error?.status ?? 502,
        });
        if (response.headersSent) {
          response.destroy();
          return;
        }
        sendJSON(response, error?.status === 504 ? 504 : 502, {
          error: error?.status === 504 ? "upstream_timeout" : "upstream_unavailable",
        });
      });
    },
  );

  server.headersTimeout = 5_000;
  server.requestTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  // The socket must outlive the CodexBar client's 65 s upstream deadline.
  server.timeout = 70_000;
  server.maxHeadersCount = 64;
  server.maxRequestsPerSocket = 100;
  server.maxConnections = 64;

  return server;
}

async function handleRequest(request, response, context) {
  applyHeaders(response, SECURITY_HEADERS);
  if (context.instanceID) response.setHeader("X-Quota-Deck-Instance", context.instanceID);

  if (!isTrustedRequest(request, context.trustedHosts, context.trustedOrigins)) {
    response.setHeader("Cache-Control", "no-store");
    sendJSON(response, 403, { error: "forbidden" });
    return;
  }

  const method = request.method?.toUpperCase() ?? "";
  const target = request.url ?? "";
  if (target.length === 0 || target.length > 2048 || !target.startsWith("/") || target.startsWith("//")) {
    sendJSON(response, 400, { error: "bad_request" });
    return;
  }

  let url;
  try {
    url = new URL(target, "http://quota-deck.local");
  } catch {
    sendJSON(response, 400, { error: "bad_request" });
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    response.setHeader("Cache-Control", "no-store");
    if (method !== "GET" && method !== "HEAD") {
      response.setHeader("Allow", "GET, HEAD");
      sendJSON(response, 405, { error: "method_not_allowed" }, method === "HEAD");
      return;
    }
    if (url.pathname !== "/api/snapshot" || url.search !== "") {
      sendJSON(response, 404, { error: "not_found" }, method === "HEAD");
      return;
    }
    if (context.accessToken && !requestHasAccessToken(request, context.accessToken)) {
      response.setHeader("WWW-Authenticate", 'Bearer realm="Quota Deck", charset="UTF-8"');
      sendJSON(response, 401, { error: "unauthorized" }, method === "HEAD");
      return;
    }

    const snapshot = await context.codexBarClient.getSnapshot();
    sendJSON(response, 200, snapshot, method === "HEAD");
    return;
  }

  if (method !== "GET" && method !== "HEAD") {
    response.setHeader("Allow", "GET, HEAD");
    sendJSON(response, 405, { error: "method_not_allowed" }, method === "HEAD");
    return;
  }

  // Shell may carry a one-time ?t= bootstrap query; other assets stay exact-path.
  const asset = shellSearchAllowed(url) ? STATIC_ASSETS.get(url.pathname) : null;
  if (!asset) {
    sendJSON(response, 404, { error: "not_found" }, method === "HEAD");
    return;
  }

  let contents;
  try {
    contents = await readFile(path.join(context.publicDir, asset.file));
  } catch (error) {
    if (error?.code === "ENOENT") {
      sendJSON(response, 404, { error: "not_found" }, method === "HEAD");
      return;
    }
    throw error;
  }

  response.statusCode = 200;
  response.setHeader("Content-Type", asset.type);
  response.setHeader("Cache-Control", asset.cache);
  response.setHeader("Content-Length", contents.byteLength);
  response.end(method === "HEAD" ? undefined : contents);
}

function sendJSON(response, status, body, headOnly = false) {
  const json = JSON.stringify(body);
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Content-Length", Buffer.byteLength(json));
  response.end(headOnly ? undefined : json);
}

function applyHeaders(response, headers) {
  for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
}

function isTrustedRequest(request, trustedHosts, trustedOrigins) {
  const hostValues = [];
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLowerCase() === "host") {
      hostValues.push(request.rawHeaders[index + 1]);
    }
  }
  if (hostValues.length !== 1) return false;

  const requestHost = hostnameFromAuthority(hostValues[0]);
  if (!requestHost || !trustedHosts.has(requestHost)) return false;

  const origin = request.headers.origin;
  const trustedOrigin = origin === undefined ? true : isTrustedOrigin(origin, trustedOrigins);
  if (request.headers["sec-fetch-site"] === "cross-site" && !isPwaShellNavigation(request) && !trustedOrigin) {
    return false;
  }
  return trustedOrigin;
}

function isTrustedOrigin(origin, trustedOrigins) {
  if (Array.isArray(origin) || typeof origin !== "string") return false;
  try {
    return trustedOrigins.has(normalizeOrigin(origin));
  } catch {
    return false;
  }
}

function normalizeOrigin(value) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError("Public origin must be a string");
  }
  const parsed = new URL(value);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new TypeError("Public origin must use HTTP or HTTPS");
  }
  if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new TypeError("Public origin must be origin-only");
  }
  return parsed.origin;
}

function isPwaShellNavigation(request) {
  const method = request.method?.toUpperCase() ?? "";
  return (
    (method === "GET" || method === "HEAD") &&
    (request.url === "/" || request.url === "/index.html") &&
    request.headers["sec-fetch-mode"] === "navigate" &&
    request.headers["sec-fetch-dest"] === "document"
  );
}

function hostnameFromAuthority(authority) {
  if (typeof authority !== "string" || authority.length === 0) return null;
  try {
    return normalizeHostname(new URL(`http://${authority}`).hostname);
  } catch {
    return null;
  }
}

function normalizeHostname(value) {
  if (typeof value !== "string") throw new TypeError("Allowed hosts must be strings");
  const normalized = value.trim().toLowerCase().replace(/\.$/u, "");
  if (!normalized || /[\s/\\\0]/u.test(normalized)) {
    throw new TypeError("Allowed host is invalid");
  }
  return normalized;
}

function normalizeAccessToken(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new TypeError("Access token must be a string");
  const trimmed = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(trimmed)) {
    throw new TypeError("Access token must be a 64-character hex string");
  }
  return trimmed;
}

function shellSearchAllowed(url) {
  if (url.search === "") return true;
  if (url.pathname !== "/" && url.pathname !== "/index.html") return false;
  const keys = [...url.searchParams.keys()];
  if (keys.length !== 1 || keys[0] !== "t") return false;
  return /^[a-f0-9]{64}$/iu.test(url.searchParams.get("t") ?? "");
}

function requestHasAccessToken(request, expectedToken) {
  const authorization = request.headers.authorization;
  if (typeof authorization !== "string") return false;
  const match = authorization.match(/^Bearer\s+(\S+)\s*$/iu);
  if (!match) return false;
  return secureTokenEquals(match[1], expectedToken);
}

function secureTokenEquals(provided, expected) {
  const left = createHash("sha256").update(String(provided)).digest();
  const right = createHash("sha256").update(String(expected)).digest();
  return timingSafeEqual(left, right);
}
