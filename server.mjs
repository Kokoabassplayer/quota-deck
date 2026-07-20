import { createCodexBarClient } from "./src/server/codexbar-client.mjs";
import { createQuotaDeckServer } from "./src/server/http-server.mjs";
import { loadRuntimeConfig } from "./src/server/runtime-config.mjs";

const config = loadRuntimeConfig(process.env);
const codexBarClient = createCodexBarClient({
  token: config.dashboardToken,
  origin: config.codexBarOrigin,
  provider: process.env.QUOTA_DECK_CODEXBAR_PROVIDER,
});
const server = createQuotaDeckServer({
  codexBarClient,
  allowedHosts: config.allowedHosts,
  publicOrigin: config.publicOrigin,
});
const WARM_INTERVAL_MS = 90_000;
let warmTimer = null;

server.on("error", (error) => {
  console.error("Quota Deck could not start", {
    code: error?.code ?? "UNKNOWN",
    message: error?.code === "EADDRINUSE" ? `Port ${config.port} is already in use` : "Server error",
  });
  process.exitCode = 1;
});

server.listen(config.port, config.host, () => {
  const localURL = `http://${config.host}:${config.port}`;
  console.log(`Quota Deck listening on ${localURL}`);
  if (config.publicOrigin) console.log(`Allowed Tailscale origin: ${config.publicOrigin}`);
  warmSnapshot();
  warmTimer = setInterval(warmSnapshot, WARM_INTERVAL_MS);
  warmTimer.unref();
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => shutdown(signal));
}

function shutdown(signal) {
  console.log(`Quota Deck stopping after ${signal}`);
  if (warmTimer) clearInterval(warmTimer);
  codexBarClient.close();
  server.close(() => {
    process.exitCode = 0;
  });
  setTimeout(() => server.closeAllConnections(), 5_000).unref();
}

function warmSnapshot() {
  codexBarClient.refreshSnapshot().catch((error) => {
    console.warn("Quota Deck background refresh failed", {
      name: error?.name ?? "Error",
      status: error?.status ?? 502,
    });
  });
}
