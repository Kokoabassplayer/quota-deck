import os from "node:os";
import path from "node:path";

export function supportedPlatform(platform = process.platform) {
  if (platform === "darwin") return "macos";
  if (platform === "win32") return "windows";
  return null;
}

export function installationPaths({ platform = process.platform, home = os.homedir(), env = process.env } = {}) {
  const pathAPI = platform === "win32" ? path.win32 : path.posix;
  if (platform === "darwin") {
    const root = pathAPI.join(home, "Library", "Application Support", "QuotaDeck");
    return {
      root,
      versions: pathAPI.join(root, "versions"),
      bin: pathAPI.join(root, "bin"),
      logs: pathAPI.join(home, "Library", "Logs", "QuotaDeck"),
      token: pathAPI.join(root, "dashboard-token"),
      accessToken: pathAPI.join(root, "access-token"),
      zaiToken: null,
      state: pathAPI.join(root, "install.json"),
      services: pathAPI.join(home, "Library", "LaunchAgents"),
    };
  }
  if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA ?? pathAPI.join(home, "AppData", "Local");
    const root = pathAPI.join(localAppData, "QuotaDeck");
    return {
      root,
      versions: pathAPI.join(root, "versions"),
      bin: pathAPI.join(root, "bin"),
      logs: pathAPI.join(root, "logs"),
      token: null,
      accessToken: pathAPI.join(root, "access-token"),
      zaiToken: pathAPI.join(root, "zai-api-key"),
      state: pathAPI.join(root, "install.json"),
      services: null,
    };
  }
  throw new Error("Quota Deck supports macOS and Windows only");
}

export function executableCandidates({ platform = process.platform, env = process.env } = {}) {
  const pathAPI = platform === "win32" ? path.win32 : path;
  if (platform === "darwin") {
    return {
      codexBar: [
        "/Applications/CodexBar.app/Contents/Helpers/CodexBarCLI",
        "/opt/homebrew/bin/codexbar",
        "/usr/local/bin/codexbar",
        "codexbar",
      ],
      tailscale: [
        "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
        "/opt/homebrew/bin/tailscale",
        "/usr/local/bin/tailscale",
        "tailscale",
      ],
      packageManager: ["brew"],
    };
  }
  if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA ?? "";
    const programFiles = env.ProgramFiles ?? "C:\\Program Files";
    return {
      codexBar: [
        pathAPI.join(localAppData, "Programs", "CodexBar", "codexbar-cli.exe"),
        "codexbar-cli.exe",
      ],
      tailscale: [pathAPI.join(programFiles, "Tailscale", "tailscale.exe"), "tailscale.exe"],
      packageManager: ["winget.exe"],
    };
  }
  return { codexBar: [], tailscale: [], packageManager: [] };
}

export function codexBarServeArgs(helpText, { port = 8080, platform = process.platform } = {}) {
  const args = ["serve", "--port", String(port), "--refresh-interval", "120"];
  if (platform === "darwin" && /--host\b/u.test(helpText)) args.push("--host", "127.0.0.1");
  if (platform === "darwin" && /--request-timeout\b/u.test(helpText)) {
    args.push("--request-timeout", "60");
  }
  if (platform === "darwin" && /--log-level\b/u.test(helpText)) args.push("--log-level", "warning");
  return args;
}

export function parseTailscaleStatus(value) {
  let payload = value;
  if (typeof value === "string") {
    try { payload = JSON.parse(value); } catch { return { connected: false, dnsName: null }; }
  }
  const self = payload && typeof payload === "object" ? payload.Self : null;
  const rawDNS = typeof self?.DNSName === "string" ? self.DNSName : null;
  const dnsName = rawDNS?.replace(/\.$/u, "") ?? null;
  const state = typeof payload?.BackendState === "string" ? payload.BackendState : "";
  return { connected: state === "Running" && Boolean(dnsName), dnsName };
}

export function inspectServeStatus(value, target, port = 443) {
  if (!value || !String(value).trim()) return { state: "empty" };
  let parsed;
  try { parsed = JSON.parse(value); } catch { return { state: "occupied" }; }
  if (!parsed || (typeof parsed === "object" && Object.keys(parsed).length === 0)) {
    return { state: "empty" };
  }
  const entries = webEntriesForPort(parsed, port);
  if (entries.length === 0 && !hasPort(parsed, port)) return { state: "empty" };
  return isExactQuotaDeckRoute(parsed, target, port) ? { state: "owned" } : { state: "occupied" };
}

/**
 * Pick a Tailscale Serve HTTPS listener without replacing an existing one.
 * Windows machines commonly already use 443 for another homelab service, so
 * the beta setup can safely fall back to the documented alternate listeners.
 */
export function chooseServePort(value, target, {
  platform = process.platform,
  preferred = 443,
} = {}) {
  const candidates = [...new Set([
    preferred,
    ...(platform === "win32" ? [8443, 10000] : []),
  ])];
  for (const port of candidates) {
    const result = inspectServeStatus(value, target, port);
    if (result.state === "owned") return { port, state: "owned" };
    if (result.state === "empty") return { port, state: "empty" };
  }
  return { port: null, state: "occupied" };
}

function isExactQuotaDeckRoute(parsed, target, port) {
  const webEntries = webEntriesForPort(parsed, port);
  if (webEntries.length !== 1) return false;
  const web = webEntries[0][1];
  const handlers = web?.Handlers ?? web?.handlers;
  if (!handlers || typeof handlers !== "object" || Array.isArray(handlers)) return false;
  const handlerEntries = Object.entries(handlers);
  if (handlerEntries.length !== 1 || handlerEntries[0][0] !== "/") return false;
  const handler = handlerEntries[0][1];
  if (!handler || typeof handler !== "object" || Array.isArray(handler)) return false;
  const proxy = handler.Proxy ?? handler.proxy;
  if (proxy !== target) return false;
  const handlerKeys = Object.keys(handler).map((key) => key.toLowerCase());
  if (handlerKeys.some((key) => key !== "proxy")) return false;

  const funnel = parsed.AllowFunnel ?? parsed.allowFunnel;
  if (funnel && typeof funnel === "object" && Boolean(funnel[String(port)] ?? funnel[port])) return false;
  return true;
}

function webEntriesForPort(parsed, port) {
  const web = parsed?.Web ?? parsed?.web;
  if (!web || typeof web !== "object" || Array.isArray(web)) return [];
  if (web.Handlers ?? web.handlers) return port === 443 ? [["", web]] : [];
  return Object.entries(web).filter(([key]) => servePortFromKey(key) === port);
}

function servePortFromKey(value) {
  const text = String(value);
  const match = text.match(/:(\d+)$/u);
  return match ? Number(match[1]) : 443;
}

function hasPort(parsed, port) {
  const tcp = parsed?.TCP ?? parsed?.tcp;
  if (tcp && typeof tcp === "object" && Object.prototype.hasOwnProperty.call(tcp, String(port))) return true;
  const funnel = parsed?.AllowFunnel ?? parsed?.allowFunnel;
  return Boolean(funnel && typeof funnel === "object" && Object.prototype.hasOwnProperty.call(funnel, String(port)));
}
