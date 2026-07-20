#!/usr/bin/env node

import { runCLI } from "../src/cli/index.mjs";

runCLI(process.argv.slice(2)).catch((error) => {
  const message = error?.publicMessage ?? error?.message ?? "Quota Deck failed";
  console.error(`\nQuota Deck: ${message}`);
  if (error?.hint) console.error(error.hint);
  process.exitCode = Number.isInteger(error?.exitCode) ? error.exitCode : 1;
});
