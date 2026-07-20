import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const publicURL = new URL("../public/", import.meta.url);

test("declares an installable, self-contained Android PWA shell", async () => {
  const [manifestText, indexHTML] = await Promise.all([
    readFile(new URL("manifest.webmanifest", publicURL), "utf8"),
    readFile(new URL("index.html", publicURL), "utf8"),
  ]);
  const manifest = JSON.parse(manifestText);

  assert.equal(manifest.name, "Quota Deck");
  assert.equal(manifest.id, "/quota-deck");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.lang, "th");
  assert.equal(manifest.background_color, "#091210");
  assert.equal(manifest.theme_color, "#091210");
  assert(manifest.icons.some((icon) => icon.sizes === "192x192"));
  assert(manifest.icons.some((icon) => icon.sizes === "512x512"));
  assert.match(indexHTML, /rel="manifest" href="\/manifest\.webmanifest"/);
  assert.match(indexHTML, /rel="stylesheet" href="\/styles\.css"/);
  assert.match(indexHTML, /<meta name="color-scheme" content="dark">/);
  assert.match(indexHTML, /<meta name="theme-color" content="#091210">/);
  assert.match(indexHTML, /<meta name="mobile-web-app-capable" content="yes">/);
  assert.match(indexHTML, /<meta name="apple-mobile-web-app-capable" content="yes">/);
  assert.match(indexHTML, /<script type="module" src="\/app\.mjs"><\/script>/);
  assert.match(indexHTML, /<h1 id="providers-title" data-i18n="รอบโควตา">รอบโควตา<\/h1>/);
  assert.match(indexHTML, /<button class="sync-chip" id="refresh-button"/);
  assert.match(indexHTML, /id="language-button"/);
  assert.match(indexHTML, /id="install-button"/);
  assert.doesNotMatch(indexHTML, /id="readiness"/);
  assert.doesNotMatch(indexHTML, /<script(?![^>]+src=)/);
  assert.doesNotMatch(indexHTML, /https?:\/\/(?!127\.0\.0\.1)/);
});
