import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const siteURL = new URL("../site/", import.meta.url);

test("GitHub Pages landing page is self-contained and public-safe", async () => {
  const [html, css, script, robots, sitemap, llms] = await Promise.all([
    readFile(new URL("index.html", siteURL), "utf8"),
    readFile(new URL("styles.css", siteURL), "utf8"),
    readFile(new URL("script.js", siteURL), "utf8"),
    readFile(new URL("robots.txt", siteURL), "utf8"),
    readFile(new URL("sitemap.xml", siteURL), "utf8"),
    readFile(new URL("llms.txt", siteURL), "utf8"),
  ]);

  await access(new URL("assets/quota-deck-hero.png", siteURL));
  await access(new URL("assets/quota-deck-mark.svg", siteURL));

  assert.match(html, /npx quota-deck@latest setup/u);
  assert.match(html, /github\.com\/Kokoabassplayer\/quota-deck/u);
  assert.match(html, /github\.com\/sponsors\/Kokoabassplayer/u);
  assert.match(html, /rel="canonical"/u);
  assert.match(html, /application\/ld\+json/u);
  assert.match(html, /twitter:card/u);
  assert.match(html, /color-scheme" content="dark light/u);
  assert.match(css, /prefers-color-scheme: light/u);
  assert.match(css, /prefers-reduced-motion/u);
  assert.match(css, /\.js-ready \.reveal/u);
  assert.match(script, /IntersectionObserver/u);
  assert.match(robots, /Sitemap: https:\/\/kokoabassplayer\.github\.io\/quota-deck\/sitemap\.xml/u);
  assert.match(sitemap, /<loc>https:\/\/kokoabassplayer\.github\.io\/quota-deck\/<\/loc>/u);
  assert.match(llms, /npx quota-deck@latest setup/u);
  assert.doesNotMatch(`${html}\n${css}\n${script}\n${robots}\n${sitemap}\n${llms}`, /[—–]/u);
  assert.doesNotMatch(`${html}\n${css}\n${script}\n${llms}`, /127\.0\.0\.1|localhost|tail3dd677|QUOTA_DECK_CODEXBAR/u);
});
