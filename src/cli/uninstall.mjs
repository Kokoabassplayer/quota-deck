import { readFile, rm } from "node:fs/promises";
import path from "node:path";

import { inspectServeStatus, installationPaths } from "./platform.mjs";
import { runCommand } from "./process.mjs";
import { disableServeRoute, unregisterServices } from "./setup.mjs";

export async function uninstallQuotaDeck(options, context = {}) {
  const platform = context.platform ?? process.platform;
  const paths = installationPaths({ platform, env: context.env, home: context.home });
  const state = await readState(paths.state);
  if (!state) {
    return { status: "not_installed" };
  }
  if (!options.yes && !options.nonInteractive) {
    const accepted = await context.prompt?.confirm(
      String(context.locale ?? "en").startsWith("th")
        ? "ถอนการติดตั้ง Quota Deck จากคอมพิวเตอร์เครื่องนี้ไหม?"
        : "Remove Quota Deck from this computer?",
      false,
    );
    if (!accepted) return { status: "cancelled" };
  }
  if (options.nonInteractive && !options.yes) {
    throw Object.assign(new Error("Uninstall requires --yes in non-interactive mode"), { exitCode: 64 });
  }

  const run = context.runCommand ?? runCommand;
  await unregisterServices(platform, paths, { run });
  const serve = await run(state.tailscaleExecutable, ["serve", "status", "--json"]);
  if (
    serve.code === 0
    && inspectServeStatus(serve.stdout, state.routeTarget, state.servePort ?? 443).state === "owned"
  ) {
    await disableServeRoute(state, { run });
  }
  if (platform === "darwin") {
    for (const label of ["app.quotadeck.codexbar", "app.quotadeck.gateway"]) {
      await rm(path.join(paths.services, `${label}.plist`), { force: true });
    }
  }
  await rm(paths.root, { recursive: true, force: true });
  if (paths.logs !== paths.root && !paths.logs.startsWith(`${paths.root}${path.sep}`)) {
    await rm(paths.logs, { recursive: true, force: true });
  }
  return { status: "uninstalled" };
}

async function readState(file) {
  try {
    const value = JSON.parse(await readFile(file, "utf8"));
    return value?.schemaVersion === 1 ? value : null;
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}
