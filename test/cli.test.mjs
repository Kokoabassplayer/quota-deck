import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { parseArguments } from "../src/cli/args.mjs";
import { collectDoctorReport } from "../src/cli/doctor.mjs";
import { runCLI } from "../src/cli/index.mjs";
import {
  codexBarServeArgs,
  chooseServePort,
  inspectServeStatus,
  installationPaths,
  parseTailscaleStatus,
} from "../src/cli/platform.mjs";
import { setupQuotaDeck } from "../src/cli/setup.mjs";
import { uninstallQuotaDeck } from "../src/cli/uninstall.mjs";

test("parses the public one-command setup interface", () => {
  assert.deepEqual(parseArguments([
    "setup", "--gateway-port", "9000", "--codexbar-port", "9001", "--no-open", "--yes",
  ]), {
    command: "setup",
    check: false,
    json: false,
    nonInteractive: false,
    noOpen: true,
    yes: true,
    gatewayPort: 9000,
    codexBarPort: 9001,
  });
  assert.throws(() => parseArguments(["setup", "--gateway-port", "8080", "--codexbar-port", "8080"]));
  assert.throws(() => parseArguments(["setup", "--unknown"]));
});

test("builds user-scoped paths on macOS and Windows including spaces", () => {
  assert.equal(
    installationPaths({ platform: "darwin", home: "/Users/Example Person" }).root,
    "/Users/Example Person/Library/Application Support/QuotaDeck",
  );
  assert.equal(
    installationPaths({
      platform: "win32",
      home: "C:\\Users\\Example Person",
      env: { LOCALAPPDATA: "C:\\Users\\Example Person\\AppData\\Local" },
    }).root,
    path.win32.join("C:\\Users\\Example Person\\AppData\\Local", "QuotaDeck"),
  );
});

test("uses only serve flags supported by each CodexBar build", () => {
  assert.deepEqual(
    codexBarServeArgs("--port --refresh-interval --host --request-timeout --log-level", {
      platform: "darwin",
      port: 8181,
    }),
    [
      "serve", "--port", "8181", "--refresh-interval", "120", "--host", "127.0.0.1",
      "--request-timeout", "60", "--log-level", "warning",
    ],
  );
  assert.deepEqual(
    codexBarServeArgs("--port --refresh-interval", { platform: "win32", port: 8181 }),
    ["serve", "--port", "8181", "--refresh-interval", "120"],
  );
});

test("extracts a privacy-safe Tailscale identity and protects existing Serve routes", () => {
  assert.deepEqual(parseTailscaleStatus(JSON.stringify({
    BackendState: "Running",
    Self: { DNSName: "friend-machine.example.ts.net.", UserID: 1234 },
  })), { connected: true, dnsName: "friend-machine.example.ts.net" });
  assert.deepEqual(inspectServeStatus("{}", "http://127.0.0.1:8787"), { state: "empty" });
  assert.deepEqual(
    inspectServeStatus(JSON.stringify({ Web: { Handlers: { "/": { Proxy: "http://127.0.0.1:8787" } } } }), "http://127.0.0.1:8787"),
    { state: "owned" },
  );
  assert.deepEqual(
    inspectServeStatus(JSON.stringify({ Web: { Handlers: { "/": { Proxy: "http://127.0.0.1:3000" } } } }), "http://127.0.0.1:8787"),
    { state: "occupied" },
  );
  assert.deepEqual(
    inspectServeStatus(JSON.stringify({
      Web: {
        "friend-machine.example.ts.net:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:8787" } } },
        "other.example.ts.net:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:3000" } } },
      },
    }), "http://127.0.0.1:8787"),
    { state: "occupied" },
  );
  const existingRoute = JSON.stringify({
    TCP: { "443": { HTTPS: true } },
    Web: {
      "friend-machine.example.ts.net:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:3000" } } },
    },
  });
  assert.deepEqual(inspectServeStatus(existingRoute, "http://127.0.0.1:8787", 443), { state: "occupied" });
  assert.deepEqual(inspectServeStatus(existingRoute, "http://127.0.0.1:8787", 8443), { state: "empty" });
  assert.deepEqual(
    chooseServePort(existingRoute, "http://127.0.0.1:8787", { platform: "win32" }),
    { port: 8443, state: "empty" },
  );
  const ownedAlternate = JSON.stringify({
    TCP: { "443": { HTTPS: true }, "8443": { HTTPS: true } },
    Web: {
      "friend-machine.example.ts.net:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:3000" } } },
      "friend-machine.example.ts.net:8443": { Handlers: { "/": { Proxy: "http://127.0.0.1:8787" } } },
    },
  });
  assert.deepEqual(
    chooseServePort(ownedAlternate, "http://127.0.0.1:8787", { platform: "win32" }),
    { port: 8443, state: "owned" },
  );
});

test("doctor output never exposes executable paths or account metadata", async () => {
  const report = await collectDoctorReport({
    platform: "win32",
    arch: "x64",
    nodeVersion: "22.15.0",
    firstExecutable: async (candidates) => candidates[0] ?? null,
    runCommand: async (_command, args) => {
      if (args[0] === "status") return {
        code: 0,
        stdout: JSON.stringify({ BackendState: "Running", Self: { DNSName: "safe.ts.net.", UserID: 42 } }),
        stderr: "",
      };
      return { code: 0, stdout: args[0] === "--version" ? "CodexBar 1.0" : "ok", stderr: "" };
    },
    checkPort: async () => false,
  });
  assert.equal(report.ready, true);
  assert.equal(report.codexBar.executable, "detected");
  assert.equal(report.tailscale.dnsName, "detected");
  assert.equal(JSON.stringify(report).includes("AppData"), false);
  assert.equal(JSON.stringify(report).includes("UserID"), false);
  assert.equal(JSON.stringify(report).includes("safe.ts.net"), false);
});

test("prints Thai setup help when the detected locale is Thai", async () => {
  const output = [];
  await runCLI(["help"], { locale: "th", output: { log: (value) => output.push(value) } });
  assert.match(output.join("\n"), /ดูโควตา AI ส่วนตัวบนมือถือ/u);
  assert.match(output.join("\n"), /ไม่ถามและไม่ติดตั้งโปรแกรมที่ขาด/u);
});

test("non-interactive setup refuses missing prerequisites before writing files", async (t) => {
  const home = await mkdtemp(path.join(os.tmpdir(), "quota-deck-missing-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  await assert.rejects(
    setupQuotaDeck(setupOptions(), {
      platform: "darwin",
      home,
      env: {},
      firstExecutable: async () => null,
      runCommand: async () => result("", 1),
      checkPort: async () => false,
      io: { log() {} },
    }),
    /Missing prerequisites/u,
  );
  await assert.rejects(() => access(path.join(home, "Library", "Application Support", "QuotaDeck")));
});

test("failed fresh setup removes its runtime, services, logs, token, and Serve route", async (t) => {
  const home = await mkdtemp(path.join(os.tmpdir(), "quota-deck-interrupted-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  let routeOwned = false;
  const runCommand = async (_command, args) => {
    if (args[0] === "status" && args[1] === "--json") {
      return result(JSON.stringify({
        BackendState: "Running",
        Self: { DNSName: "interrupted.example.ts.net." },
      }));
    }
    if (args[0] === "serve" && args[1] === "status") {
      return result(routeOwned
        ? JSON.stringify({ Web: { Handlers: { "/": { Proxy: "http://127.0.0.1:8787" } } } })
        : "{}");
    }
    if (args[0] === "serve" && args.includes("--bg")) routeOwned = true;
    if (args[0] === "serve" && args.includes("off")) routeOwned = false;
    if (args[0] === "serve" && args.includes("--help")) {
      return result("--host --port --refresh-interval --request-timeout --log-level");
    }
    if (args[0] === "--version" || args[0] === "version") return result("test version");
    return result("");
  };
  const firstExecutable = async (candidates) => candidates.some((value) => String(value).includes("Tailscale"))
    ? "/Applications/Tailscale.app/Contents/MacOS/Tailscale"
    : candidates.some((value) => String(value).includes("CodexBar"))
      ? "/Applications/CodexBar.app/Contents/Helpers/CodexBarCLI"
      : "/opt/homebrew/bin/brew";

  await assert.rejects(
    setupQuotaDeck(setupOptions(), {
      platform: "darwin",
      home,
      env: {},
      runCommand,
      firstExecutable,
      checkPort: async () => false,
      waitForURL: async () => { throw new Error("simulated interruption"); },
      copyText: async () => false,
      io: { log() {} },
      packageVersion: "0.1.0-test",
    }),
    /simulated interruption/u,
  );

  const paths = installationPaths({ platform: "darwin", home, env: {} });
  await assert.rejects(() => access(paths.root));
  await assert.rejects(() => access(paths.logs));
  await assert.rejects(() => access(path.join(paths.services, "app.quotadeck.gateway.plist")));
  assert.equal(routeOwned, false);
});

test("installs, upgrades, and uninstalls atomically without touching unrelated software", async (t) => {
  const home = await mkdtemp(path.join(os.tmpdir(), "quota-deck-home-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const calls = [];
  let routeOwned = false;
  const runCommand = async (command, args) => {
    calls.push({ command, args: [...args] });
    if (args[0] === "status" && args[1] === "--json") {
      return result(JSON.stringify({
        BackendState: "Running",
        Self: { DNSName: "test-machine.test-tailnet.ts.net." },
      }));
    }
    if (args[0] === "serve" && args[1] === "status") {
      return result(routeOwned
        ? JSON.stringify({ Web: { Handlers: { "/": { Proxy: "http://127.0.0.1:8787" } } } })
        : "{}");
    }
    if (args[0] === "serve" && args.includes("--bg")) routeOwned = true;
    if (args[0] === "serve" && args.includes("off")) routeOwned = false;
    if (args[0] === "serve" && args.includes("--help")) {
      return result("--host --port --refresh-interval --request-timeout --log-level");
    }
    if (args[0] === "--version") return result("CodexBar test");
    if (args[0] === "version") return result("Tailscale test");
    return result("");
  };
  const firstExecutable = async (candidates) => candidates.some((value) => String(value).includes("Tailscale"))
    ? "/Applications/Tailscale.app/Contents/MacOS/Tailscale"
    : candidates.some((value) => String(value).includes("CodexBar"))
      ? "/Applications/CodexBar.app/Contents/Helpers/CodexBarCLI"
      : "/opt/homebrew/bin/brew";
  const options = setupOptions();
  const context = {
    platform: "darwin",
    home,
    env: {},
    runCommand,
    firstExecutable,
    checkPort: async () => false,
    fetchImpl: async () => new Response("{}", { headers: { "content-type": "application/json" } }),
    copyText: async () => true,
    io: { log() {} },
    packageVersion: "0.1.0-test",
  };

  const first = await setupQuotaDeck(options, context);
  assert.equal(first.status, "installed");
  assert.equal(routeOwned, true);
  assert.equal(first.state.publicOrigin, "https://test-machine.test-tailnet.ts.net");
  assert.equal(JSON.parse(await readFile(path.join(home, "Library", "Application Support", "QuotaDeck", "install.json"), "utf8")).version, "0.1.0-test");

  await assert.rejects(
    setupQuotaDeck(options, {
      ...context,
      packageVersion: "0.2.0-broken",
      waitForURL: async () => { throw new Error("simulated health failure"); },
    }),
    /simulated health failure/u,
  );
  const restored = JSON.parse(await readFile(
    path.join(home, "Library", "Application Support", "QuotaDeck", "install.json"),
    "utf8",
  ));
  assert.equal(restored.runtimePath, first.state.runtimePath);
  await access(first.state.runtimePath);
  assert.equal(routeOwned, true);

  const second = await setupQuotaDeck(options, context);
  assert.equal(second.status, "installed");
  assert.notEqual(second.state.runtimePath, first.state.runtimePath);
  await assert.rejects(() => access(first.state.runtimePath));

  const removed = await uninstallQuotaDeck({ ...options, command: "uninstall" }, context);
  assert.equal(removed.status, "uninstalled");
  assert.equal(routeOwned, false);
  assert(calls.some(({ command, args }) => command === "/bin/launchctl" && args[0] === "bootstrap"));
  assert.equal(calls.some(({ command }) => command.includes("brew") || command.includes("winget")), false);
});

test("runs the Windows Scheduled Task lifecycle with native paths", {
  skip: process.platform !== "win32",
}, async (t) => {
  const home = await mkdtemp(path.join(os.tmpdir(), "Quota Deck Windows "));
  t.after(() => rm(home, { recursive: true, force: true }));
  const localAppData = path.join(home, "App Data", "Local");
  const calls = [];
  let routeOwned = false;
  const runCommand = async (command, args) => {
    calls.push({ command, args: [...args] });
    if (args[0] === "status" && args[1] === "--json") {
      return result(JSON.stringify({
        BackendState: "Running",
        Self: { DNSName: "windows-beta.example.ts.net." },
      }));
    }
    if (args[0] === "serve" && args[1] === "status") {
      return result(routeOwned
        ? JSON.stringify({ Web: { Handlers: { "/": { Proxy: "http://127.0.0.1:8787" } } } })
        : "{}");
    }
    if (args[0] === "serve" && args.includes("--bg")) routeOwned = true;
    if (args[0] === "serve" && args.includes("off")) routeOwned = false;
    if (args[0] === "serve" && args.includes("--help")) {
      return result("--port --refresh-interval");
    }
    if (args[0] === "--version" || args[0] === "version") return result("0.33.2");
    return result("");
  };
  const firstExecutable = async (candidates) => candidates.some((value) => String(value).includes("CodexBar"))
    ? path.join(localAppData, "Programs", "CodexBar", "codexbar-cli.exe")
    : candidates.some((value) => String(value).includes("Tailscale"))
      ? "C:\\Program Files\\Tailscale\\tailscale.exe"
      : "winget.exe";
  const context = {
    platform: "win32",
    home,
    env: { LOCALAPPDATA: localAppData, ProgramFiles: "C:\\Program Files" },
    runCommand,
    firstExecutable,
    checkPort: async () => false,
    waitForURL: async () => undefined,
    copyText: async () => true,
    io: { log() {} },
    packageVersion: "0.1.0-windows-test",
  };

  const installed = await setupQuotaDeck(setupOptions(), context);
  assert.equal(installed.status, "installed");
  assert.equal(installed.state.platform, "win32");
  assert.equal(installed.state.publicOrigin, "https://windows-beta.example.ts.net");
  assert.equal(routeOwned, true);
  const paths = installationPaths({ platform: "win32", home, env: context.env });
  const gatewayScript = await readFile(path.join(paths.bin, "run-gateway.ps1"), "utf8");
  assert.match(gatewayScript, /QUOTA_DECK_CODEXBAR_ORIGIN/u);
  assert.match(gatewayScript, /App Data/u);
  const taskCreates = calls.filter(({ command, args }) => command === "schtasks.exe" && args[0] === "/Create");
  assert.equal(taskCreates.length, 2);
  assert(taskCreates.every(({ args }) => args.includes("LIMITED") && args.includes("ONLOGON")));

  const removed = await uninstallQuotaDeck({ ...setupOptions(), command: "uninstall" }, context);
  assert.equal(removed.status, "uninstalled");
  assert.equal(routeOwned, false);
  await assert.rejects(() => access(paths.root));
  assert.equal(calls.some(({ command }) => command.includes("winget")), false);
});

function result(stdout, code = 0) {
  return { code, stdout, stderr: "" };
}

function setupOptions() {
  return {
    command: "setup",
    check: false,
    json: false,
    nonInteractive: true,
    noOpen: true,
    yes: true,
    gatewayPort: 8787,
    codexBarPort: 8080,
  };
}
