import { parseArguments } from "./args.mjs";
import { collectDoctorReport, formatDoctorReport } from "./doctor.mjs";
import { createPrompter } from "./prompt.mjs";
import { setupQuotaDeck } from "./setup.mjs";
import { uninstallQuotaDeck } from "./uninstall.mjs";

export async function runCLI(argv, context = {}) {
  const options = parseArguments(argv);
  const output = context.output ?? console;
  const locale = context.locale ?? detectLocale(context.env ?? process.env);
  if (options.command === "help") {
    output.log(helpText(locale));
    return;
  }
  if (options.command === "doctor") {
    const report = await collectDoctorReport({
      platform: context.platform,
      env: context.env,
      codexBarPort: options.codexBarPort,
      gatewayPort: options.gatewayPort,
    });
    output.log(options.json ? JSON.stringify(report, null, 2) : formatDoctorReport(report, locale));
    if (!report.ready) process.exitCode = 2;
    return report;
  }

  const prompt = context.prompt ?? (
    options.nonInteractive || !process.stdin.isTTY
      ? null
      : createPrompter()
  );
  try {
    if (options.command === "setup") {
      return await setupQuotaDeck(options, { ...context, prompt, io: output, locale });
    }
    if (options.command === "uninstall") {
      const result = await uninstallQuotaDeck(options, { ...context, prompt, locale });
      output.log(uninstallMessage(result.status, locale));
      return result;
    }
  } finally {
    if (!context.prompt) prompt?.close();
  }
}

function detectLocale(env) {
  return String(env.LC_ALL ?? env.LC_MESSAGES ?? env.LANG ?? "en").toLowerCase().startsWith("th")
    ? "th"
    : "en";
}

function uninstallMessage(status, locale) {
  const messages = locale === "th"
    ? { uninstalled: "ถอนการติดตั้ง Quota Deck แล้ว", not_installed: "ยังไม่ได้ติดตั้ง Quota Deck", cancelled: "ยกเลิกแล้ว" }
    : { uninstalled: "Quota Deck was uninstalled", not_installed: "Quota Deck is not installed", cancelled: "Cancelled" };
  return messages[status] ?? status;
}

function helpText(locale) {
  if (locale === "th") return `Quota Deck — ดูโควตา AI ส่วนตัวบนมือถือ

การใช้งาน:
  quota-deck setup [ตัวเลือก]
  quota-deck doctor [--json]
  quota-deck uninstall [--yes]

ตัวเลือก:
  --check                 ตรวจสอบความพร้อมโดยไม่เปลี่ยนแปลงเครื่อง
  --gateway-port <port>   พอร์ต gateway (ค่าเริ่มต้น: 8787)
  --codexbar-port <port>  พอร์ต CodexBar (ค่าเริ่มต้น: 8080)
  --non-interactive       ไม่ถามและไม่ติดตั้งโปรแกรมที่ขาด
  --no-open               ไม่เปิดแอปหรือแดชบอร์ดเมื่อเสร็จ
  --yes, -y               ยืนยันการติดตั้ง/ถอนการติดตั้งที่ร้องขอ
  --json                  ผล doctor สำหรับเครื่องอ่าน
  --help, -h              แสดงวิธีใช้`;
  return `Quota Deck — private AI quota on your phone

Usage:
  quota-deck setup [options]
  quota-deck doctor [--json]
  quota-deck uninstall [--yes]

Options:
  --check                 Check prerequisites without changing the computer
  --gateway-port <port>   Gateway port (default: 8787)
  --codexbar-port <port>  CodexBar port (default: 8080)
  --non-interactive       Never prompt or install missing prerequisites
  --no-open               Do not open apps or the completed dashboard
  --yes, -y               Confirm requested install/uninstall actions
  --json                  Machine-readable doctor output
  --help, -h              Show this help`;
}
