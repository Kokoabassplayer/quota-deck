import net from "node:net";
import process from "node:process";

import { executableCandidates, parseTailscaleStatus, supportedPlatform } from "./platform.mjs";
import { firstExecutable, runCommand } from "./process.mjs";

export async function collectDoctorReport(options = {}) {
  const platformName = supportedPlatform(options.platform ?? process.platform);
  const candidates = executableCandidates({
    platform: options.platform ?? process.platform,
    env: options.env ?? process.env,
  });
  const locate = options.firstExecutable ?? firstExecutable;
  const run = options.runCommand ?? runCommand;
  const checkPort = options.checkPort ?? portInUse;
  const codexBar = await locate(candidates.codexBar);
  const tailscale = await locate(candidates.tailscale);
  const packageManager = await locate(candidates.packageManager);
  let tailscaleDNSName = null;
  const report = {
    schemaVersion: 1,
    platform: platformName ?? "unsupported",
    architecture: options.arch ?? process.arch,
    node: {
      version: options.nodeVersion ?? process.versions.node,
      supported: nodeMajor(options.nodeVersion ?? process.versions.node) >= 22,
    },
    codexBar: { installed: Boolean(codexBar), executable: codexBar ? "detected" : null, serve: false },
    tailscale: { installed: Boolean(tailscale), connected: false, dnsName: null },
    packageManager: { installed: Boolean(packageManager) },
    ports: {
      codexBar: { port: options.codexBarPort ?? 8080, inUse: false },
      gateway: { port: options.gatewayPort ?? 8787, inUse: false },
    },
    ready: false,
  };

  if (codexBar) {
    const result = await run(codexBar, ["serve", "--help"]);
    report.codexBar.serve = result.code === 0;
    report.codexBar.version = safeVersion(await run(codexBar, ["--version"]));
  }
  if (tailscale) {
    const result = await run(tailscale, ["status", "--json"]);
    const status = result.code === 0 ? parseTailscaleStatus(result.stdout) : null;
    report.tailscale.connected = status?.connected === true;
    tailscaleDNSName = status?.dnsName ?? null;
    report.tailscale.dnsName = tailscaleDNSName ? "detected" : null;
    report.tailscale.version = safeVersion(await run(tailscale, ["version"]));
  }

  report.ports.codexBar.inUse = await checkPort(report.ports.codexBar.port);
  report.ports.gateway.inUse = await checkPort(report.ports.gateway.port);
  report.ready = Boolean(
    platformName
    && report.node.supported
    && report.codexBar.installed
    && report.codexBar.serve
    && report.tailscale.installed
    && report.tailscale.connected,
  );
  Object.defineProperty(report, "_executables", {
    enumerable: false,
    value: { codexBar, tailscale, packageManager },
  });
  Object.defineProperty(report, "_tailscaleDNSName", {
    enumerable: false,
    value: tailscaleDNSName,
  });
  return report;
}

export function formatDoctorReport(report, locale = "en") {
  const th = locale.startsWith("th");
  const mark = (value) => value ? "✓" : "✗";
  const lines = [
    `Quota Deck doctor · ${report.platform} ${report.architecture}`,
    `${mark(report.node.supported)} Node ${report.node.version}`,
    `${mark(report.codexBar.installed && report.codexBar.serve)} CodexBar${report.codexBar.version ? ` ${report.codexBar.version}` : ""}`,
    `${mark(report.tailscale.connected)} Tailscale${report.tailscale.version ? ` ${report.tailscale.version}` : ""}`,
    `${report.ports.codexBar.inUse ? "•" : "○"} ${th ? "พอร์ต CodexBar" : "CodexBar port"} ${report.ports.codexBar.port}`,
    `${report.ports.gateway.inUse ? "•" : "○"} ${th ? "พอร์ต gateway" : "Gateway port"} ${report.ports.gateway.port}`,
  ];
  lines.push(report.ready
    ? (th ? "พร้อมติดตั้ง Quota Deck" : "Ready to install Quota Deck")
    : (th ? "ยังต้องตั้งค่ารายการที่มีเครื่องหมาย ✗" : "Complete the items marked ✗"));
  return lines.join("\n");
}

function safeVersion(result) {
  if (result.code !== 0) return null;
  return result.stdout.match(/\bv?\d+(?:\.\d+){1,3}(?:[-+][A-Za-z0-9.-]+)?\b/u)?.[0] ?? null;
}

function nodeMajor(version) {
  return Number.parseInt(String(version).split(".")[0], 10) || 0;
}

async function portInUse(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(500);
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("timeout", () => { socket.destroy(); resolve(false); });
    socket.once("error", () => resolve(false));
  });
}
