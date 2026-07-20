import os from "node:os";
import path from "node:path";

export function supportedPlatform(platform = process.platform) {
  if (platform === "darwin") return "macos";
  if (platform === "win32") return "windows";
  return null;
}

export function installationPaths({ platform = process.platform, home = os.homedir(), env = process.env } = {}) {
  const pathAPI = platform === "win32" ? path.win32 : path;
  if (platform === "darwin") {
    const root = pathAPI.join(home, "Library", "Application Support", "QuotaDeck");
    return {
      root,
      versions: pathAPI.join(root, "versions"),
      bin: pathAPI.join(root, "bin"),
      logs: pathAPI.join(home, "Library", "Logs", "QuotaDeck"),
      token: pathAPI.join(root, "dashboard-token"),
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

export function inspectServeStatus(value, target) {
  if (!value || !String(value).trim()) return { state: "empty" };
  let parsed;
  try { parsed = JSON.parse(value); } catch { return { state: "occupied" }; }
  if (!parsed || (typeof parsed === "object" && Object.keys(parsed).length === 0)) {
    return { state: "empty" };
  }
  return isExactQuotaDeckRoute(parsed, target) ? { state: "owned" } : { state: "occupied" };
}

function isExactQuotaDeckRoute(parsed, target) {
  const web = parsed.Web ?? parsed.web;
  if (!web || typeof web !== "object" || Array.isArray(web)) return false;
  const servers = (web.Handlers ?? web.handlers) ? [web] : Object.values(web);
  if (servers.length !== 1) return false;
  const handlers = servers[0]?.Handlers ?? servers[0]?.handlers;
  if (!handlers || typeof handlers !== "object" || Array.isArray(handlers)) return false;
  const entries = Object.entries(handlers);
  if (entries.length !== 1 || entries[0][0] !== "/") return false;
  const handler = entries[0][1];
  if (!handler || typeof handler !== "object" || Array.isArray(handler)) return false;
  const proxy = handler.Proxy ?? handler.proxy;
  if (proxy !== target) return false;
  const handlerKeys = Object.keys(handler).map((key) => key.toLowerCase());
  if (handlerKeys.some((key) => key !== "proxy")) return false;

  const tcp = parsed.TCP ?? parsed.tcp;
  if (tcp && typeof tcp === "object") {
    const ports = Object.keys(tcp);
    if (ports.some((port) => port !== "443")) return false;
  }
  const funnel = parsed.AllowFunnel ?? parsed.allowFunnel;
  if (funnel && typeof funnel === "object" && Object.values(funnel).some(Boolean)) return false;
  for (const [key, item] of Object.entries(parsed)) {
    if (["web", "tcp", "allowfunnel", "foreground"].includes(key.toLowerCase())) continue;
    if (item && (typeof item !== "object" || Object.keys(item).length > 0)) return false;
  }
  return true;
}
