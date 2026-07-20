const root = document.documentElement;
const languageToggle = document.getElementById("language-toggle");
const themeToggle = document.getElementById("theme-toggle");
const copyButton = document.getElementById("copy-command");
const themeColor = document.querySelector('meta[name="theme-color"]');
const prefersDark = window.matchMedia("(prefers-color-scheme: dark)");
const setupCommand = "npx quota-deck@latest setup";

const browserLanguage = navigator.language?.toLowerCase() ?? "en";
let language = localStorage.getItem("quota-deck-site-language")
  ?? (browserLanguage.startsWith("th") ? "th" : "en");
let theme = localStorage.getItem("quota-deck-site-theme") ?? "auto";

function setLanguage(nextLanguage) {
  language = nextLanguage;
  root.lang = language;
  document.querySelectorAll("[data-en][data-th]").forEach((element) => {
    element.textContent = element.dataset[language];
  });
  document.querySelectorAll("[data-en-aria][data-th-aria]").forEach((element) => {
    element.setAttribute("aria-label", element.dataset[`${language}Aria`]);
  });
  languageToggle.textContent = language === "th" ? "EN" : "ไทย";
  languageToggle.setAttribute("aria-label", language === "th" ? "เปลี่ยนเป็นภาษาอังกฤษ" : "Switch to Thai");
  document.title = language === "th"
    ? "Quota Deck | ดูโควตา AI แบบเป็นส่วนตัว"
    : "Quota Deck | Private AI quota monitoring";
  localStorage.setItem("quota-deck-site-language", language);
}

function resolvedTheme() {
  return theme === "auto" ? (prefersDark.matches ? "dark" : "light") : theme;
}

function setTheme(nextTheme) {
  theme = nextTheme;
  root.dataset.theme = theme;
  const activeTheme = resolvedTheme();
  const nextLabel = activeTheme === "dark"
    ? (language === "th" ? "สว่าง" : "Light")
    : (language === "th" ? "มืด" : "Dark");
  themeToggle.textContent = nextLabel;
  themeToggle.setAttribute("aria-label", language === "th"
    ? `เปลี่ยนเป็นธีม${nextLabel}`
    : `Use ${nextLabel.toLowerCase()} theme`);
  themeColor.content = activeTheme === "dark" ? "#0a0f0e" : "#f1f5f2";
  localStorage.setItem("quota-deck-site-theme", theme);
}

languageToggle.addEventListener("click", () => setLanguage(language === "th" ? "en" : "th"));
themeToggle.addEventListener("click", () => setTheme(theme === "dark" ? "light" : "dark"));

copyButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(setupCommand);
    copyButton.textContent = language === "th" ? "คัดลอกแล้ว" : "Copied";
  } catch {
    copyButton.textContent = language === "th" ? "เลือกคำสั่งด้านบน" : "Select command above";
  }
  window.setTimeout(() => {
    copyButton.textContent = language === "th" ? "คัดลอก" : "Copy";
  }, 1800);
});

setLanguage(language);
setTheme(theme);

prefersDark.addEventListener("change", () => {
  if (theme === "auto") setTheme(theme);
});

if ("IntersectionObserver" in window && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  try {
    const observer = new IntersectionObserver((entries, currentObserver) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        currentObserver.unobserve(entry.target);
      });
    }, { threshold: 0.14 });
    root.classList.add("js-ready");
    document.querySelectorAll(".reveal").forEach((element) => observer.observe(element));
  } catch {
    // Keep content visible if the browser exposes but cannot construct the observer.
  }
}
