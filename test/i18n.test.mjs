import assert from "node:assert/strict";
import test from "node:test";

import { detectBrowserLocale, localizeText, persistLocale } from "../public/i18n.mjs";

test("chooses Thai or English from browser preferences and persists an explicit choice", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  assert.equal(detectBrowserLocale({ languages: ["th-TH", "en-US"] }, storage), "th");
  assert.equal(detectBrowserLocale({ languages: ["en-GB"] }, storage), "en");
  persistLocale("en", storage);
  assert.equal(detectBrowserLocale({ languages: ["th-TH"] }, storage), "en");
});

test("localizes dynamic quota, reset, and accessibility copy without translating provider names", () => {
  assert.equal(localizeText("เหลือ 12%", "en"), "12% left");
  assert.equal(localizeText("อีก 6 วัน 12 ชม.", "en"), "in 6d 12h");
  assert.equal(
    localizeText("Codex, ข้อมูลไม่ครบ, เหลือต่ำสุดประมาณ 12 เปอร์เซ็นต์", "en"),
    "Codex, partial data, about 12 percent left",
  );
  assert.equal(localizeText("พร้อม", "th"), "พร้อม");
});
