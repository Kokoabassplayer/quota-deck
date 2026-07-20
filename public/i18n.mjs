const STORAGE_KEY = "quota-deck.locale";

const EXACT_ENGLISH = new Map([
  ["กำลังเชื่อมต่อ", "Connecting"],
  ["รอสักครู่", "Please wait"],
  ["มุมมองโควตา", "Quota views"],
  ["เลือกผู้ให้บริการ", "Choose provider"],
  ["ทางเลือกที่ใช้ได้ตอนนี้", "Available now"],
  ["รอบโควตา", "Quota windows"],
  ["กำลังโหลดข้อมูลผู้ให้บริการ", "Loading provider data"],
  ["เรียงตามเวลาจริง", "Ordered by reset time"],
  ["ขบวนรีเซ็ตถัดไป", "Next resets"],
  ["รอการเชื่อมต่อ", "Waiting for connection"],
  ["ข้อมูลส่วนตัวไม่ถูกเก็บบนมือถือ", "Personal data is not stored on this phone"],
  ["ข้ามไปดูโควตา", "Skip to quotas"],
  ["ภาพรวม", "Overview"],
  ["ภาพรวมผู้ให้บริการทั้งหมด", "Overview of all providers"],
  ["พร้อม", "Ready"],
  ["จำกัด", "Limited"],
  ["หมด", "Exhausted"],
  ["อ่านไม่ได้", "Unavailable"],
  ["ข้อมูลไม่ครบ", "Partial data"],
  ["ยังไม่มีข้อมูล", "No data yet"],
  ["ยังไม่ทราบ", "Unknown"],
  ["ยังไม่ทราบเวลารีเซ็ต", "Reset time unknown"],
  ["ถึงเวลารีเซ็ตแล้ว", "Reset due now"],
  ["ซิงก์ใหม่", "Refresh"],
  ["กำลังซิงก์", "Refreshing"],
  ["กำลังซิงก์ข้อมูล", "Refreshing quota data"],
  ["ซิงก์ข้อมูลโควตาล่าสุดแล้ว", "Latest quota data refreshed"],
  ["เชื่อมต่อ CodexBar ไม่ได้", "Could not connect to CodexBar"],
  ["เชื่อมต่อ Mac ไม่ได้ · แสดงข้อมูลล่าสุดบนหน้าจอ", "Computer unavailable · showing the latest on-screen data"],
  ["ออฟไลน์ · ใช้ข้อมูลล่าสุดบนหน้าจอ", "Offline · showing the latest on-screen data"],
  ["Mac ออฟไลน์", "Computer offline"],
  ["กำลังแสดงผู้ให้บริการทั้งหมด", "Showing all providers"],
  ["ผู้ให้บริการที่เลือกไม่อยู่ในข้อมูลล่าสุด กลับไปที่ภาพรวมแล้ว", "The selected provider disappeared; returned to overview"],
  ["ยังไม่มีข้อมูลบนอุปกรณ์นี้", "No data is available on this device"],
  ["ยังไม่มีข้อมูลโควตาจาก CodexBar", "CodexBar has not returned quota data"],
  ["ไม่มีผู้ให้บริการในข้อมูลล่าสุด", "No providers are present in the latest data"],
  ["ค่าใช้จ่าย 30 วัน", "30-day cost"],
  ["วันนี้", "Today"],
  ["30 วัน", "30 days"],
  ["โทเค็นล่าสุด", "Latest tokens"],
  ["โทเค็น 30 วัน", "30-day tokens"],
  ["รอบที่ติดตาม", "Tracked windows"],
  ["เหลือต่ำสุด", "Lowest remaining"],
  ["รีเซ็ตถัดไป", "Next reset"],
  ["อัปเดตรายละเอียด", "Detail updated"],
  ["เครดิตรีเซ็ตโควตา", "Limit reset credits"],
  ["ประวัติโทเค็นรายวัน", "Daily token history"],
  ["รุ่นที่ใช้มากสุด", "Top model"],
  ["ประเมินจากการใช้โทเค็น ไม่ใช่ยอดเรียกเก็บจริง", "Estimated from token usage, not a subscription bill"],
  ["ผู้ให้บริการนี้ยังไม่ส่งข้อมูลรอบโควตา", "This provider has not returned quota windows"],
  ["CodexBar อ่านผู้ให้บริการนี้ไม่ได้ กดซิงก์ใหม่หลังตรวจการเชื่อมต่อ", "CodexBar could not read this provider. Check the connection and refresh."],
  ["CodexBar timeout ชั่วคราว · แสดงโควตาล่าสุดที่มี", "Temporary CodexBar timeout · showing latest quota"],
  ["CodexBar ถูกจำกัดชั่วคราว · แสดงโควตาล่าสุดที่มี", "CodexBar is temporarily rate-limited · showing latest quota"],
  ["ติดต่อ CodexBar ไม่ได้ชั่วคราว · แสดงโควตาล่าสุดที่มี", "CodexBar is temporarily unavailable · showing latest quota"],
  ["CodexBar อัปเดตไม่สำเร็จ · แสดงโควตาล่าสุดที่มี", "CodexBar refresh failed · showing latest quota"],
]);

export function detectBrowserLocale(navigatorValue = globalThis.navigator, storage = globalThis.localStorage) {
  const stored = safeStorageGet(storage, STORAGE_KEY);
  if (stored === "th" || stored === "en") return stored;
  const languages = navigatorValue?.languages ?? [navigatorValue?.language ?? "th"];
  return languages.some((value) => String(value).toLowerCase().startsWith("th")) ? "th" : "en";
}

export function persistLocale(locale, storage = globalThis.localStorage) {
  if (locale !== "th" && locale !== "en") return;
  try { storage?.setItem(STORAGE_KEY, locale); } catch { /* private storage may be unavailable */ }
}

export function browserTimeZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
}

export function localizeText(value, locale) {
  const text = String(value);
  if (locale !== "en") return text;
  if (EXACT_ENGLISH.has(text)) return EXACT_ENGLISH.get(text);

  const replacements = [
    [/^อัปเดต (.+)$/u, "Updated $1"],
    [/^ข้อมูลเมื่อ (.+)$/u, "Data from $1"],
    [/^เหลือ ([\d.]+)%$/u, "$1% left"],
    [/^อีก (\d+) นาที$/u, "in $1m"],
    [/^อีก (\d+) ชม\.$/u, "in $1h"],
    [/^อีก (\d+) ชม\. (\d+) นาที$/u, "in $1h $2m"],
    [/^อีก (\d+) วัน$/u, "in $1d"],
    [/^อีก (\d+) วัน (\d+) ชม\.$/u, "in $1d $2h"],
    [/^(\d+) ผู้ให้บริการ$/u, "$1 providers"],
    [/^1 จาก (\d+) ผู้ให้บริการ$/u, "1 of $1 providers"],
    [/^(\d+) รอบ$/u, "$1 windows"],
    [/^(\d+) ใช้ได้$/u, "$1 available"],
    [/^หมดอายุใน (.+)$/u, "Expires in $1"],
    [/^โทเค็น (\d+) วันล่าสุด$/u, "Tokens · last $1 days"],
    [/^สูงสุด (.+)$/u, "Peak $1"],
    [/^(.+) ([\d,.]+) โทเค็น$/u, "$1 $2 tokens"],
    [/^กำลังแสดง (.+)$/u, "Showing $1"],
    [/^(.+) โควตา$/u, "$1 quota"],
    [/^(.+), อ่านโควตาไม่ได้$/u, "$1, quota unavailable"],
    [/^(.+), ข้อมูลไม่ครบ, เหลือต่ำสุดประมาณ (\d+) เปอร์เซ็นต์$/u, "$1, partial data, about $2 percent left"],
    [/^(.+), ข้อมูลไม่ครบ, ยังไม่มีข้อมูลโควตา$/u, "$1, partial data, quota unavailable"],
    [/^(.+), เหลือต่ำสุดประมาณ (\d+) เปอร์เซ็นต์$/u, "$1, about $2 percent left"],
    [/^(.+), ยังไม่มีข้อมูลโควตา$/u, "$1, quota unavailable"],
    [/^ซิงก์ใหม่, (.+)$/u, "Refresh, $1"],
  ];
  for (const [pattern, replacement] of replacements) {
    if (pattern.test(text)) return text.replace(pattern, replacement);
  }
  return text;
}

export function applyStaticLocale(documentValue, locale) {
  if (documentValue.documentElement) documentValue.documentElement.lang = locale;
  documentValue.querySelector?.('meta[name="description"]')?.setAttribute(
    "content",
    locale === "th" ? "ดูโควตา CodexBar บนมือถือผ่านเครือข่ายส่วนตัว" : "View CodexBar quota privately on your phone",
  );
  for (const element of documentValue.querySelectorAll?.("[data-i18n]") ?? []) {
    element.textContent = localizeText(element.dataset.i18n, locale);
  }
  for (const element of documentValue.querySelectorAll?.("[data-i18n-aria]") ?? []) {
    element.setAttribute("aria-label", localizeText(element.dataset.i18nAria, locale));
  }
}

function safeStorageGet(storage, key) {
  try { return storage?.getItem(key) ?? null; } catch { return null; }
}
