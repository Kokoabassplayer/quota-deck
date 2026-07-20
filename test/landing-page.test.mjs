import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const siteURL = new URL("../site/", import.meta.url);

test("GitHub Pages landing page is self-contained and public-safe", async () => {
  const [html, css, script] = await Promise.all([
    readFile(new URL("index.html", siteURL), "utf8"),
    readFile(new URL("styles.css", siteURL), "utf8"),
    readFile(new URL("script.js", siteURL), "utf8"),
  ]);

  await access(new URL("assets/quota-deck-hero.png", siteURL));
  await access(new URL("assets/quota-deck-mark.svg", siteURL));

  assert.match(html, /npx quota-deck@latest setup/u);
  assert.match(html, /github\.com\/Kokoabassplayer\/quota-deck/u);
  assert.match(html, /github\.com\/sponsors\/Kokoabassplayer/u);
  assert.match(html, /color-scheme" content="dark light/u);
  assert.match(css, /prefers-color-scheme: light/u);
  assert.match(css, /prefers-reduced-motion/u);
  assert.match(script, /IntersectionObserver/u);
  assert.doesNotMatch(`${html}\n${css}\n${script}`, /[—–]/u);
  assert.doesNotMatch(`${html}\n${css}\n${script}`, /127\.0\.0\.1|localhost|tail3dd677/u);
});
