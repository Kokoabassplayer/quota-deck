import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("the npm package exposes the public CLI without install-time execution", async () => {
  const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
  assert.equal(pkg.name, "quota-deck");
  assert.equal(pkg.license, "MIT");
  assert.equal(pkg.bin["quota-deck"], "cli/quota-deck.mjs");
  assert.equal(pkg.engines.node, ">=22");
  assert.equal(pkg.scripts?.postinstall, undefined);
  assert.equal(pkg.publishConfig.access, "public");
  assert.equal(pkg.publishConfig.provenance, true);
});

test("README leads with the one-command setup and scoped uninstall", async () => {
  const readme = await readFile(new URL("README.md", root), "utf8");
  assert.match(readme, /npx quota-deck@latest setup/u);
  assert.match(readme, /npx quota-deck@latest doctor/u);
  assert.match(readme, /npx quota-deck@latest uninstall/u);
  assert.match(readme, /preserves Node\.js, CodexBar, Tailscale/u);
});
