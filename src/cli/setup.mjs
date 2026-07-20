import { randomBytes } from "node:crypto";
import { cp, mkdir, readFile, rename, rm, writeFile, chmod } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";
import qrCode from "qrcode-terminal";

import { collectDoctorReport, formatDoctorReport } from "./doctor.mjs";
import {
  codexBarServeArgs,
  executableCandidates,
  inspectServeStatus,
  installationPaths,
} from "./platform.mjs";
import { copyText, openTarget } from "./open.mjs";
import { firstExecutable, runCommand } from "./process.mjs";

const PACKAGE_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const MAC_LABELS = ["app.quotadeck.codexbar", "app.quotadeck.gateway"];
const WINDOWS_TASKS = ["QuotaDeck CodexBar", "QuotaDeck Gateway"];

export async function setupQuotaDeck(options, context = {}) {
  const io = context.io ?? console;
  const run = context.runCommand ?? runCommand;
  const locate = context.firstExecutable ?? firstExecutable;
  const platform = context.platform ?? process.platform;
  const env = context.env ?? process.env;
  const paths = installationPaths({ platform, env, home: context.home });
  let report = await collectDoctorReport({
    platform,
    env,
    codexBarPort: options.codexBarPort,
    gatewayPort: options.gatewayPort,
    runCommand: run,
    firstExecutable: locate,
    checkPort: context.checkPort,
  });

  if (options.check) {
    io.log(formatDoctorReport(report, context.locale));
    return { status: report.ready ? "ready" : "needs_attention", report };
  }
  if (!report.node.supported) {
    throw setupError(localized(context.locale, "Node.js 22 or newer is required", "ต้องใช้ Node.js 22 หรือใหม่กว่า"), 69);
  }

  report = await ensurePrerequisites(report, options, { ...context, io, run, locate, platform, env });
  const previousState = await readState(paths.state);
  if (report.ports.gateway.inUse && previousState?.gatewayPort !== options.gatewayPort) {
    throw setupError(
      localized(
        context.locale,
        `Port ${options.gatewayPort} is already in use. Quota Deck will not replace an unknown service.`,
        `พอร์ต ${options.gatewayPort} ถูกใช้งานอยู่ Quota Deck จะไม่แทนที่บริการที่ไม่รู้จัก`,
      ),
      73,
    );
  }
  if (report.ports.codexBar.inUse && previousState?.codexBarPort !== options.codexBarPort) {
    throw setupError(
      localized(
        context.locale,
        `Port ${options.codexBarPort} is already in use. Stop the existing service or choose --codexbar-port.`,
        `พอร์ต ${options.codexBarPort} ถูกใช้งานอยู่ กรุณาหยุดบริการเดิมหรือเลือก --codexbar-port`,
      ),
      73,
    );
  }

  const executables = await resolveExecutables(platform, env, locate, context.locale);
  await ensureProviderLogin(options, { ...context, io, platform, run, executables });
  const serveHelp = await run(executables.codexBar, ["serve", "--help"]);
  if (serveHelp.code !== 0) {
    throw setupError(localized(context.locale, "CodexBar does not provide the required serve command", "CodexBar ไม่มีคำสั่ง serve ที่จำเป็น"), 69);
  }

  const target = `http://127.0.0.1:${options.gatewayPort}`;
  const serveStatus = await run(executables.tailscale, ["serve", "status", "--json"]);
  const route = inspectServeStatus(serveStatus.code === 0 ? serveStatus.stdout : "", target);
  if (route.state === "occupied") {
    throw setupError(localized(
      context.locale,
      "Tailscale Serve already has a route. Quota Deck will not overwrite it.",
      "Tailscale Serve มีเส้นทางอยู่แล้ว Quota Deck จะไม่เขียนทับ",
    ), 73);
  }

  const version = context.packageVersion ?? await packageVersion(PACKAGE_ROOT);
  const runtimePath = path.join(paths.versions, `${version}-${Date.now()}`);
  const token = platform === "darwin" ? randomBytes(32).toString("hex") : null;
  const state = {
    schemaVersion: 1,
    version,
    platform,
    runtimePath,
    codexBarExecutable: executables.codexBar,
    tailscaleExecutable: executables.tailscale,
    nodeExecutable: process.execPath,
    codexBarArgs: codexBarServeArgs(serveHelp.stdout, { port: options.codexBarPort, platform }),
    codexBarPort: options.codexBarPort,
    gatewayPort: options.gatewayPort,
    publicOrigin: `https://${report._tailscaleDNSName}`,
    routeTarget: target,
    tokenFile: paths.token,
    installedAt: new Date().toISOString(),
  };

  try {
    await stageRuntime(runtimePath);
    await mkdir(paths.bin, { recursive: true });
    await mkdir(paths.logs, { recursive: true });
    if (token) {
      await writeFile(paths.token, `${token}\n`, { mode: 0o600 });
      await chmod(paths.token, 0o600);
    }
    await writeServiceFiles(state, paths);
    await registerServices(state, paths, { run });

    if (route.state === "empty") {
      const configured = await run(executables.tailscale, ["serve", "--bg", "--yes", target]);
      if (configured.code !== 0) {
        throw setupError(localized(context.locale, "Tailscale Serve could not be configured", "ตั้งค่า Tailscale Serve ไม่สำเร็จ"), 69);
      }
    }

    const checkURL = context.waitForURL ?? waitForURL;
    await checkURL(`http://127.0.0.1:${options.codexBarPort}/health`, 45_000, context.fetchImpl);
    await checkURL(`http://127.0.0.1:${options.gatewayPort}/`, 45_000, context.fetchImpl);
    await checkURL(`http://127.0.0.1:${options.gatewayPort}/api/snapshot`, 90_000, context.fetchImpl);
    await atomicWriteJSON(paths.state, state);
    await removeOldVersions(paths.versions, runtimePath);
  } catch (error) {
    await unregisterServices(platform, paths, { run }).catch(() => undefined);
    if (route.state === "empty") {
      const current = await run(executables.tailscale, ["serve", "status", "--json"]).catch(() => null);
      if (current?.code === 0 && inspectServeStatus(current.stdout, target).state === "owned") {
        await disableServeRoute(state, { run }).catch(() => undefined);
      }
    }
    await rm(runtimePath, { recursive: true, force: true }).catch(() => undefined);
    if (previousState) {
      await writeServiceFiles(previousState, paths).catch(() => undefined);
      await registerServices(previousState, paths, { run }).catch(() => undefined);
      await atomicWriteJSON(paths.state, previousState).catch(() => undefined);
    } else {
      await removeFreshInstallArtifacts(platform, paths).catch(() => undefined);
    }
    throw error;
  }

  const copied = await (context.copyText ?? copyText)(state.publicOrigin, platform);
  io.log(localized(context.locale, "\n✓ Quota Deck is ready", "\n✓ Quota Deck พร้อมใช้งานแล้ว"));
  io.log(state.publicOrigin);
  if (copied) io.log(localized(context.locale, "URL copied to clipboard", "คัดลอก URL ไปยังคลิปบอร์ดแล้ว"));
  if (io === console) qrCode.generate(state.publicOrigin, { small: true });
  if (!options.noOpen) await (context.openTarget ?? openTarget)(state.publicOrigin, platform);
  return { status: "installed", state };
}

async function ensurePrerequisites(report, options, context) {
  if (report.codexBar.installed && report.tailscale.installed && report.tailscale.connected) {
    return report;
  }
  if (options.nonInteractive) {
    throw setupError(localized(
      context.locale,
      "Missing prerequisites in non-interactive mode. Run quota-deck doctor.",
      "ยังขาดโปรแกรมที่จำเป็นในโหมด non-interactive กรุณารัน quota-deck doctor",
    ), 69);
  }
  const prompt = context.prompt;
  if (!prompt) {
    throw setupError(localized(context.locale, "Interactive setup requires a terminal", "การตั้งค่าแบบโต้ตอบต้องรันในเทอร์มินัล"), 69);
  }
  const candidates = executableCandidates({ platform: context.platform, env: context.env });

  if (!report.codexBar.installed) {
    const accepted = options.yes || await prompt.confirm(localized(context.locale, "Install CodexBar now?", "ติดตั้ง CodexBar ตอนนี้ไหม?"));
    if (!accepted) throw setupError(localized(context.locale, "CodexBar is required", "จำเป็นต้องมี CodexBar"), 69);
    await installPrerequisite("codexbar", candidates, { ...context, noOpen: options.noOpen });
  }
  if (!report.tailscale.installed) {
    const accepted = options.yes || await prompt.confirm(localized(context.locale, "Install Tailscale now?", "ติดตั้ง Tailscale ตอนนี้ไหม?"));
    if (!accepted) throw setupError(localized(context.locale, "Tailscale is required", "จำเป็นต้องมี Tailscale"), 69);
    await installPrerequisite("tailscale", candidates, { ...context, noOpen: options.noOpen });
  }

  if (!options.noOpen) {
    await openApplications(context.platform, context.run, context.env);
  }
  await prompt.pause(localized(
    context.locale,
    "Sign in to Tailscale, then configure at least one provider in CodexBar.",
    "ลงชื่อเข้าใช้ Tailscale แล้วตั้งค่าผู้ให้บริการอย่างน้อยหนึ่งรายใน CodexBar",
  ));
  const refreshed = await collectDoctorReport({
    platform: context.platform,
    env: context.env,
    codexBarPort: options.codexBarPort,
    gatewayPort: options.gatewayPort,
    runCommand: context.run,
    firstExecutable: context.locate,
    checkPort: context.checkPort,
  });
  if (!refreshed.codexBar.installed || !refreshed.codexBar.serve) {
    throw setupError(localized(context.locale, "CodexBar is installed but its CLI serve command is not ready", "ติดตั้ง CodexBar แล้ว แต่คำสั่ง CLI serve ยังไม่พร้อม"), 69);
  }
  if (!refreshed.tailscale.connected) {
    throw setupError(localized(context.locale, "Tailscale is not connected", "Tailscale ยังไม่ได้เชื่อมต่อ"), 69);
  }
  return refreshed;
}

async function installPrerequisite(kind, candidates, context) {
  const manager = await context.locate(candidates.packageManager);
  if (context.platform === "darwin" && manager) {
    const formula = kind === "codexbar" ? "steipete/tap/codexbar" : "tailscale";
    const result = await context.run(manager, ["install", "--cask", formula], { inherit: true });
    if (result.code !== 0) throw setupError(`${kind} installation failed`, 69);
    return;
  }
  if (context.platform === "win32" && manager) {
    const id = kind === "codexbar" ? "Finesssee.Win-CodexBar" : "Tailscale.Tailscale";
    const result = await context.run(manager, [
      "install", "--exact", "--id", id,
      "--accept-source-agreements", "--accept-package-agreements",
    ], { inherit: true });
    if (![0, -1978335189].includes(result.code)) throw setupError(`${kind} installation failed`, 69);
    return;
  }
  const url = kind === "codexbar"
    ? context.platform === "darwin"
      ? "https://github.com/steipete/CodexBar/releases/latest"
      : "https://github.com/Finesssee/Win-CodexBar/releases/latest"
    : context.platform === "darwin"
      ? "https://tailscale.com/download/mac"
      : "https://tailscale.com/download/windows";
  if (!context.noOpen) await openTarget(url, context.platform);
  await context.prompt.pause(localized(
    context.locale,
    `Install ${kind} from ${url}.`,
    `ติดตั้ง ${kind} จาก ${url}`,
  ));
}

async function resolveExecutables(platform, env, locate, locale) {
  const candidates = executableCandidates({ platform, env });
  const [codexBar, tailscale] = await Promise.all([
    locate(candidates.codexBar),
    locate(candidates.tailscale),
  ]);
  if (!codexBar || !tailscale) {
    throw setupError(localized(locale, "Required executables could not be located", "ไม่พบโปรแกรมที่จำเป็น"), 69);
  }
  return { codexBar, tailscale };
}

async function ensureProviderLogin(options, context) {
  if (options.nonInteractive || options.noOpen) return;
  if (context.platform === "darwin") {
    await context.run("/usr/bin/open", ["-a", "CodexBar"]);
  } else {
    const desktop = path.join(path.dirname(context.executables.codexBar), "codexbar.exe");
    await openTarget(desktop, context.platform);
  }
  await context.prompt?.pause(localized(
    context.locale,
    "Confirm your required providers are enabled in CodexBar.",
    "ตรวจสอบว่าผู้ให้บริการที่ต้องการถูกเปิดใช้งานใน CodexBar แล้ว",
  ));
}

async function openApplications(platform, run, env) {
  if (platform === "darwin") {
    await run("/usr/bin/open", ["-a", "CodexBar"]);
    await run("/usr/bin/open", ["-a", "Tailscale"]);
  } else {
    const local = env.LOCALAPPDATA ?? "";
    await openTarget(path.join(local, "Programs", "CodexBar", "codexbar.exe"), platform);
    await openTarget("tailscale://", platform);
  }
}

async function stageRuntime(runtimePath) {
  await mkdir(runtimePath, { recursive: true });
  for (const entry of ["server.mjs", "public", path.join("src", "server")]) {
    await cp(path.join(PACKAGE_ROOT, entry), path.join(runtimePath, entry), { recursive: true });
  }
  await writeFile(path.join(runtimePath, "package.json"), JSON.stringify({
    name: "quota-deck-runtime",
    private: true,
    type: "module",
  }, null, 2));
}

async function writeServiceFiles(state, paths) {
  if (state.platform === "darwin") return writeMacServiceFiles(state, paths);
  return writeWindowsServiceFiles(state, paths);
}

async function writeMacServiceFiles(state, paths) {
  const uid = process.getuid();
  const loader = `#!/bin/sh\nset -eu\nTOKEN_FILE=${sh(state.tokenFile)}\n[ -f "$TOKEN_FILE" ] && [ ! -L "$TOKEN_FILE" ] || exit 78\n[ "$(/usr/bin/stat -f '%u:%Lp' "$TOKEN_FILE")" = '${uid}:600' ] || exit 78\nIFS= read -r CODEXBAR_DASHBOARD_TOKEN < "$TOKEN_FILE"\nexport CODEXBAR_DASHBOARD_TOKEN\n`;
  const codexbar = `#!/bin/sh\nset -eu\numask 077\n. ${sh(path.join(paths.bin, "load-dashboard-token.sh"))}\nexec ${sh(state.codexBarExecutable)} ${state.codexBarArgs.map(sh).join(" ")}\n`;
  const gateway = `#!/bin/sh\nset -eu\numask 077\n. ${sh(path.join(paths.bin, "load-dashboard-token.sh"))}\nexport QUOTA_DECK_PORT=${sh(String(state.gatewayPort))}\nexport QUOTA_DECK_PUBLIC_ORIGIN=${sh(state.publicOrigin)}\nexport QUOTA_DECK_CODEXBAR_ORIGIN=${sh(`http://127.0.0.1:${state.codexBarPort}`)}\nexec ${sh(state.nodeExecutable)} ${sh(path.join(state.runtimePath, "server.mjs"))}\n`;
  await writeExecutable(path.join(paths.bin, "load-dashboard-token.sh"), loader);
  await writeExecutable(path.join(paths.bin, "run-codexbar.sh"), codexbar);
  await writeExecutable(path.join(paths.bin, "run-gateway.sh"), gateway);
  await mkdir(paths.services, { recursive: true });
  await writeFile(path.join(paths.services, `${MAC_LABELS[0]}.plist`), macPlist({
    label: MAC_LABELS[0],
    program: path.join(paths.bin, "run-codexbar.sh"),
    workingDirectory: paths.root,
    stdout: path.join(paths.logs, "codexbar.stdout.log"),
    stderr: path.join(paths.logs, "codexbar.stderr.log"),
  }));
  await writeFile(path.join(paths.services, `${MAC_LABELS[1]}.plist`), macPlist({
    label: MAC_LABELS[1],
    program: path.join(paths.bin, "run-gateway.sh"),
    workingDirectory: state.runtimePath,
    stdout: path.join(paths.logs, "gateway.stdout.log"),
    stderr: path.join(paths.logs, "gateway.stderr.log"),
  }));
}

async function writeWindowsServiceFiles(state, paths) {
  const codexbar = `& ${ps(state.codexBarExecutable)} ${state.codexBarArgs.map(ps).join(" ")}\nexit $LASTEXITCODE\n`;
  const gateway = `$env:QUOTA_DECK_PORT=${ps(String(state.gatewayPort))}\n$env:QUOTA_DECK_PUBLIC_ORIGIN=${ps(state.publicOrigin)}\n$env:QUOTA_DECK_CODEXBAR_ORIGIN=${ps(`http://127.0.0.1:${state.codexBarPort}`)}\n& ${ps(state.nodeExecutable)} ${ps(path.join(state.runtimePath, "server.mjs"))}\nexit $LASTEXITCODE\n`;
  await writeFile(path.join(paths.bin, "run-codexbar.ps1"), codexbar);
  await writeFile(path.join(paths.bin, "run-gateway.ps1"), gateway);
}

async function registerServices(state, paths, { run }) {
  if (state.platform === "darwin") {
    const domain = `gui/${process.getuid()}`;
    for (const label of MAC_LABELS) {
      const plist = path.join(paths.services, `${label}.plist`);
      await run("/bin/launchctl", ["bootout", domain, plist]);
      const loaded = await run("/bin/launchctl", ["bootstrap", domain, plist]);
      if (loaded.code !== 0) throw setupError(`Could not register ${label}`, 69);
      await run("/bin/launchctl", ["kickstart", "-k", `${domain}/${label}`]);
    }
    return;
  }
  const shell = `${process.env.SystemRoot ?? "C:\\Windows"}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
  const scripts = [path.join(paths.bin, "run-codexbar.ps1"), path.join(paths.bin, "run-gateway.ps1")];
  for (let index = 0; index < WINDOWS_TASKS.length; index += 1) {
    const taskCommand = `"${shell}" -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "${scripts[index]}"`;
    const created = await run("schtasks.exe", [
      "/Create", "/F", "/SC", "ONLOGON", "/RL", "LIMITED",
      "/TN", WINDOWS_TASKS[index], "/TR", taskCommand,
    ]);
    if (created.code !== 0) throw setupError(`Could not register ${WINDOWS_TASKS[index]}`, 69);
    await run("schtasks.exe", ["/Run", "/TN", WINDOWS_TASKS[index]]);
  }
}

export async function unregisterServices(platform, paths, { run = runCommand } = {}) {
  if (platform === "darwin") {
    const domain = `gui/${process.getuid()}`;
    for (const label of MAC_LABELS) {
      await run("/bin/launchctl", ["bootout", domain, path.join(paths.services, `${label}.plist`)]);
    }
  } else {
    for (const task of WINDOWS_TASKS) await run("schtasks.exe", ["/Delete", "/F", "/TN", task]);
  }
}

export async function disableServeRoute(state, { run = runCommand } = {}) {
  return run(state.tailscaleExecutable, ["serve", "--https=443", "off"]);
}

async function waitForURL(url, timeoutMs, fetchImpl = globalThis.fetch) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetchImpl(url, {
        headers: { Host: new URL(url).host },
        signal: AbortSignal.timeout(5_000),
      });
      lastStatus = response.status;
      await response.body?.cancel();
      if (response.ok) return;
    } catch {
      // The process may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw setupError(`Health check failed for ${new URL(url).pathname} (${lastStatus ?? "offline"})`, 69);
}

async function readState(file) {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8"));
    return parsed?.schemaVersion === 1 ? parsed : null;
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function atomicWriteJSON(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, file);
}

async function removeOldVersions(versionsPath, activePath) {
  const { readdir } = await import("node:fs/promises");
  try {
    for (const entry of await readdir(versionsPath)) {
      const candidate = path.join(versionsPath, entry);
      if (candidate !== activePath) await rm(candidate, { recursive: true, force: true });
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function removeFreshInstallArtifacts(platform, paths) {
  if (platform === "darwin") {
    for (const label of MAC_LABELS) {
      await rm(path.join(paths.services, `${label}.plist`), { force: true });
    }
  }
  await rm(paths.root, { recursive: true, force: true });
  if (paths.logs !== paths.root && !paths.logs.startsWith(`${paths.root}${path.sep}`)) {
    await rm(paths.logs, { recursive: true, force: true });
  }
}

async function packageVersion(root) {
  return JSON.parse(await readFile(path.join(root, "package.json"), "utf8")).version;
}

async function writeExecutable(file, contents) {
  await writeFile(file, contents, { mode: 0o700 });
  await chmod(file, 0o700);
}

function macPlist({ label, program, workingDirectory, stdout, stderr }) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>Label</key><string>${xml(label)}</string>\n<key>ProgramArguments</key><array><string>${xml(program)}</string></array>\n<key>WorkingDirectory</key><string>${xml(workingDirectory)}</string>\n<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>\n<key>ProcessType</key><string>Background</string><key>ThrottleInterval</key><integer>30</integer>\n<key>Umask</key><integer>63</integer>\n<key>StandardOutPath</key><string>${xml(stdout)}</string>\n<key>StandardErrorPath</key><string>${xml(stderr)}</string>\n</dict></plist>\n`;
}

function sh(value) { return `'${String(value).replaceAll("'", `'"'"'`)}'`; }
function ps(value) { return `'${String(value).replaceAll("'", "''")}'`; }
function xml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function setupError(message, exitCode) {
  return Object.assign(new Error(message), { publicMessage: message, exitCode });
}

function localized(locale, english, thai) {
  return String(locale ?? "en").toLowerCase().startsWith("th") ? thai : english;
}
