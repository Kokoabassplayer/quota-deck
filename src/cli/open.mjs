import { runCommand } from "./process.mjs";

export async function openTarget(target, platform = process.platform) {
  if (platform === "darwin") return runCommand("/usr/bin/open", [target]);
  if (platform === "win32") {
    return runCommand("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Start-Process -FilePath $args[0]",
      target,
    ]);
  }
  return { code: 1, stdout: "", stderr: "unsupported platform" };
}

export async function copyText(value, platform = process.platform) {
  const command = platform === "darwin" ? "/usr/bin/pbcopy" : "clip.exe";
  return new Promise((resolve) => {
    import("node:child_process").then(({ spawn }) => {
      const child = spawn(command, [], { stdio: ["pipe", "ignore", "ignore"], windowsHide: true });
      child.once("error", () => resolve(false));
      child.once("close", (code) => resolve(code === 0));
      child.stdin.end(value);
    }).catch(() => resolve(false));
  });
}
