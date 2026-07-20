import { spawnSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const npmCLI = process.env.npm_execpath;
const packageResult = spawnSync(
  npmCLI ? process.execPath : (process.platform === "win32" ? "npm.cmd" : "npm"),
  npmCLI
    ? [npmCLI, "pack", "--dry-run", "--json", "--ignore-scripts"]
    : ["pack", "--dry-run", "--json", "--ignore-scripts"],
  { cwd: root, encoding: "utf8" },
);
if (packageResult.status !== 0) {
  if (packageResult.error) throw packageResult.error;
  process.stderr.write(packageResult.stderr || packageResult.stdout || "npm pack failed\n");
  process.exit(packageResult.status ?? 1);
}

const [manifest] = JSON.parse(packageResult.stdout);
const files = manifest.files.map((entry) => entry.path).sort();
const allowedRoots = new Set(["LICENSE", "README.md", "package.json", "server.mjs", "cli", "public", "src"]);
for (const file of files) {
  const first = file.split("/")[0];
  if (!allowedRoots.has(first)) throw new Error(`Unexpected npm package file: ${file}`);
}
for (const required of ["cli/quota-deck.mjs", "server.mjs", "public/index.html", "src/cli/index.mjs"]) {
  if (!files.includes(required)) throw new Error(`Missing npm package file: ${required}`);
}

const forbidden = [
  /CODEXBAR_DASHBOARD_TOKEN\s*=/u,
  /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/u,
  /https:\/\/(?!example)[a-z0-9-]+\.tail[a-z0-9]+\.ts\.net/iu,
  /\/Users\/(?!example(?:\/|\s)|alice\/)[^/\n]+\//iu,
  /gui\/\d+\/com\.[a-z0-9.-]*quotadeck/iu,
];
for (const file of files.filter(isTextFile)) {
  const contents = await readFile(path.join(root, file), "utf8");
  for (const pattern of forbidden) {
    if (pattern.test(contents)) throw new Error(`Forbidden private material in ${file}: ${pattern}`);
  }
}

const packageJSON = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
if (packageJSON.scripts?.postinstall) throw new Error("postinstall scripts are forbidden");
for (const [name, version] of Object.entries(packageJSON.dependencies ?? {})) {
  if (!/^\d+\.\d+\.\d+(?:[-+].+)?$/u.test(version)) {
    throw new Error(`Runtime dependency ${name} is not exactly pinned: ${version}`);
  }
}

const unexpectedArchives = (await readdir(root)).filter((entry) => entry.endsWith(".tgz"));
if (unexpectedArchives.length > 0) throw new Error(`Package check left archives behind: ${unexpectedArchives.join(", ")}`);
console.log(`Package check passed: ${files.length} files, ${manifest.size} bytes`);

function isTextFile(file) {
  return /(?:\.m?js|\.html|\.css|\.json|\.md|LICENSE)$/u.test(file);
}
