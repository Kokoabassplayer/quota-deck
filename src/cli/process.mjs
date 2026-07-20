import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";

export async function runCommand(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: false,
      stdio: options.inherit ? "inherit" : ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => { stdout += chunk; });
    child.stderr?.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({
      code: code ?? 1,
      signal,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
    }));
  });
}

export async function executableExists(candidate) {
  if (!candidate) return false;
  if (!candidate.includes(path.sep) && !(process.platform === "win32" && candidate.includes("\\"))) {
    const locator = process.platform === "win32" ? "where.exe" : "/usr/bin/which";
    const args = [candidate];
    try {
      return (await runCommand(locator, args)).code === 0;
    } catch {
      return false;
    }
  }
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}

export async function firstExecutable(candidates) {
  for (const candidate of candidates) {
    if (await executableExists(candidate)) return candidate;
  }
  return null;
}

export function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
