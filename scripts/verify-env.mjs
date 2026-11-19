import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { checkoutRoot, decidePermission, run } from "./harmony-lib.mjs";

const root = checkoutRoot();
const jsonMode = process.argv.includes("--json");

function capture(command, args) {
  return run(command, args, { cwd: root });
}

function readRegistry(name) {
  if (process.platform !== "win32") return "";
  const result = spawnSync(
    "reg",
    ["query", "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion", "/v", name],
    { encoding: "utf8", windowsHide: true },
  );
  const match = /REG_\w+\s+(\S+)\s*$/m.exec(result.stdout ?? "");
  const raw = match?.[1] ?? "";
  if (/^0x[0-9a-f]+$/i.test(raw)) return String(Number.parseInt(raw, 16));
  return raw;
}

function freeGb(target) {
  try {
    const stats = fs.statfsSync(target);
    const bytes = Number(stats.bavail) * Number(stats.bsize);
    return Math.round((bytes / 1024 ** 3) * 100) / 100;
  } catch {
    return 0;
  }
}

function nodeIsSupported(version) {
  const match = /^v?(\d+)\.(\d+)/.exec(version);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 22 || (major === 22 && minor >= 13);
}

function probeSqlite() {
  const probe = `
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(":memory:");
    const version = db.prepare("select sqlite_version() as v").get().v;
    process.stdout.write(String(version));
    db.exec("create table sample(id integer primary key, name text) strict");
    db.exec("insert into sample(name) values ('ok') returning id");
    db.exec("create virtual table docs using fts5(body, content='', contentless_delete=1, tokenize='trigram')");
    db.exec("insert into docs(body) values ('alphabet')");
    const found = db.prepare("select count(*) as c from docs where docs match 'alp'").get().c;
    if (found < 1) throw new Error("trigram query returned no rows");
    db.close();
  `;
  const result = spawnSync(process.execPath, ["-e", probe], {
    encoding: "utf8",
    windowsHide: true,
  });
  return {
    ok: result.status === 0,
    version: (result.stdout ?? "").trim(),
    detail: (result.stderr ?? "").trim(),
  };
}

function oneDriveDesktopDetected() {
  const home = process.env.USERPROFILE || os.homedir();
  const desktop = path.join(home, "Desktop");
  const markers = [process.env.OneDrive, process.env.OneDriveConsumer, process.env.OneDriveCommercial].filter(
    (value) => typeof value === "string" && value.length > 0,
  );
  const targets = [root, desktop].map((value) => value.toLowerCase());
  for (const marker of markers) {
    const prefix = marker.toLowerCase();
    if (targets.some((target) => target === prefix || target.startsWith(`${prefix}${path.sep}`))) {
      return true;
    }
  }
  try {
    if (fs.lstatSync(desktop).isSymbolicLink()) return true;
  } catch {
    return false;
  }
  return false;
}

function devDriveAvailable() {
  if (process.platform !== "win32") return false;
  const result = spawnSync("fsutil", ["devdrv", "query"], {
    encoding: "utf8",
    windowsHide: true,
  });
  const text = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  return result.status === 0 && /dev\s*drive|refs/i.test(text);
}

function strictDepBuildsEnabled() {
  const npmrc = fs.existsSync(path.join(root, ".npmrc"))
    ? fs.readFileSync(path.join(root, ".npmrc"), "utf8")
    : "";
  const workspace = fs.existsSync(path.join(root, "pnpm-workspace.yaml"))
    ? fs.readFileSync(path.join(root, "pnpm-workspace.yaml"), "utf8")
    : "";
  const strict = /strict-dep-builds\s*=\s*true/i.test(npmrc) || /strictDepBuilds:\s*true/i.test(workspace);
  const allow =
    /onlyBuiltDependencies/.test(workspace) ||
    /allowBuilds:/.test(workspace) ||
    /"onlyBuiltDependencies"/.test(
      fs.existsSync(path.join(root, "package.json"))
        ? fs.readFileSync(path.join(root, "package.json"), "utf8")
        : "",
    );
  return strict && allow;
}

function findOpenCode() {
  const command = capture("opencode", ["--version"]);
  if (command.status === 0 && (command.stdout ?? "").trim()) {
    return { version: firstVersion(command.stdout), acp: acpHelpWorks() };
  }
  const home = process.env.USERPROFILE || os.homedir();
  const candidates = [
    path.join(home, ".opencode", "bin", "opencode.exe"),
    path.join(home, ".opencode", "bin", "opencode.cmd"),
    path.join(process.env.APPDATA || "", "npm", "opencode.cmd"),
    path.join(process.env.LOCALAPPDATA || "", "Programs", "opencode", "opencode.exe"),
  ];
  for (const candidate of candidates) {
    if (!candidate || !fs.existsSync(candidate)) continue;
    const result = run(candidate, ["--version"], { cwd: root });
    if (result.status === 0) {
      return { version: firstVersion(result.stdout), acp: acpHelpWorks(candidate), bin: candidate };
    }
  }
  return { version: "", acp: false };
}

function firstVersion(text) {
  const match = /(\d+\.\d+\.\d+)/.exec(text ?? "");
  return match?.[1] ?? (text ?? "").trim().split(/\s+/)[0] ?? "";
}

function acpHelpWorks(bin = "opencode") {
  const result = run(bin, ["acp", "--help"], { cwd: root });
  return result.status === 0 && /acp/i.test(`${result.stdout ?? ""}\n${result.stderr ?? ""}`);
}

function opencodeConfigValid() {
  const configPath = path.join(root, "opencode.json");
  if (!fs.existsSync(configPath)) return false;
  const result = capture("opencode", ["debug", "config", "--pure"]);
  if (result.status !== 0) return false;
  const raw = result.stdout ?? "";
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return false;
  let config;
  try {
    config = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return false;
  }
  if (config.compaction?.auto !== false) return false;
  if (config.permission?.webfetch !== "deny") return false;
  if (config.permission?.websearch !== "deny") return false;
  if (config.tools?.webfetch !== false || config.tools?.websearch !== false) return false;
  if (config.default_agent !== "task-worker") return false;
  const permission = config.permission;
  const denied = [
    ["bash", "git merge origin/main"],
    ["bash", "git push"],
    ["bash", "git rebase main"],
    ["bash", "git checkout main"],
    ["bash", "git checkout harness/integration"],
    ["bash", "git reset --hard HEAD"],
    ["bash", "git clean -fd"],
    ["bash", "curl https://example.invalid"],
    ["bash", "wget https://example.invalid"],
    ["bash", "npm i -g somewhere"],
    ["webfetch", "https://example.invalid"],
    ["websearch", "sqlite wal"],
    ["read", "C:/Users/someone/.ssh/id_rsa"],
  ];
  for (const [action, resource] of denied) {
    if (decidePermission(permission, action, resource) !== "deny") return false;
  }
  if (decidePermission(permission, "bash", "git status --short") !== "allow") return false;
  if (decidePermission(permission, "bash", "node scripts/agent-worktree.mjs commit 002 message") !== "allow") {
    return false;
  }
  const prompt = config.agent?.["task-worker"]?.prompt ?? "";
  if (!/agent-worktree\.mjs commit/.test(prompt) || !/never merge/i.test(prompt)) return false;
  return true;
}

const build = readRegistry("CurrentBuild");
const ubr = readRegistry("UBR");
const osBuild = build ? `${build}${ubr ? `.${ubr}` : ""}` : os.release();
const buildNumber = Number(build);
const revision = Number(ubr);
const mxcTierAReady =
  process.platform === "win32" &&
  ((buildNumber === 26100 && revision >= 9278) ||
    (buildNumber === 26200 && revision >= 9278) ||
    (buildNumber > 26200 && revision >= 0) ||
    (buildNumber > 26100 && buildNumber < 26200 && revision >= 9278));

const nodeVersion = process.version;
const sqlite = probeSqlite();
const schema = capture(process.execPath, ["schema/schema-test.js"]);
const schemaTest67Passed = schema.status === 0 && /67\/67 passed/.test(schema.stdout ?? "");
const pnpm = capture("pnpm", ["--version"]);
const pnpmVersion = (pnpm.stdout ?? "").trim();
const gitVersionResult = capture("git", ["--version"]);
const gitVersion = ((gitVersionResult.stdout ?? "").match(/(\d+\.\d+\.\d+(?:\.windows\.\d+)?)/) ?? ["", ""])[1] ?? "";
const longpaths = capture("git", ["config", "--get", "core.longpaths"]);
const gitLongPathsOk = process.platform !== "win32" || longpaths.stdout.trim() === "true";
const opencode = findOpenCode();
const configValid = opencode.version ? opencodeConfigValid() : false;
const appData = process.env.LOCALAPPDATA || process.env.APPDATA || os.homedir();

const report = {
  osBuild,
  mxcTierAReady,
  nodeVersion,
  sqliteVersion: sqlite.version,
  fts5TrigramOk: sqlite.ok,
  schemaTest67Passed,
  pnpmVersion,
  pnpmStrictDepBuildsOk: strictDepBuildsEnabled() && /^10\./.test(pnpmVersion),
  gitVersion,
  gitLongPathsOk,
  opencodeVersion: opencode.version,
  opencodeConfigValid: configValid && opencode.acp,
  oneDriveDesktopDetected: oneDriveDesktopDetected(),
  devDriveAvailable: devDriveAvailable(),
  workspaceDriveFreeGb: freeGb(root),
  appDataDriveFreeGb: freeGb(appData),
};

const hardFailures = [];
if (!nodeIsSupported(nodeVersion)) hardFailures.push(`Node >= 22.13 required, found ${nodeVersion}`);
if (!sqlite.ok) hardFailures.push(`node:sqlite FTS5/trigram/STRICT probe failed${sqlite.detail ? `: ${sqlite.detail}` : ""}`);
if (!schemaTest67Passed) hardFailures.push("schema/schema-test.js did not pass 67/67");
if (!/^10\./.test(pnpmVersion)) hardFailures.push(`pnpm 10.x required, found ${pnpmVersion || "nothing"}`);
if (!report.pnpmStrictDepBuildsOk) hardFailures.push("pnpm strict-dep-builds is not enabled with a build allowlist");
if (!gitVersion) hardFailures.push("git is not available");
if (!gitLongPathsOk) hardFailures.push("git core.longpaths is not true");
if (!opencode.version || !opencode.acp) {
  hardFailures.push(
    "OpenCode CLI is missing. Install it with: npm i -g opencode-ai   or winget/scoop, then reopen the shell so %USERPROFILE%\\.opencode\\bin and %APPDATA%\\npm are on PATH",
  );
} else if (!configValid) {
  hardFailures.push("opencode.json was rejected or does not enforce the deny rules");
}
if (report.workspaceDriveFreeGb < 5 || report.appDataDriveFreeGb < 5) {
  hardFailures.push("free disk space is below the 5 GB hard floor");
}

const warnings = [];
if (report.workspaceDriveFreeGb < 15 || report.appDataDriveFreeGb < 15) {
  warnings.push("free disk space is below the 15 GB recommendation");
}
if (report.oneDriveDesktopDetected) {
  warnings.push("Desktop or this workspace is under a OneDrive folder; set EF_WT_ROOT outside that folder");
}
if (process.platform === "win32" && !report.devDriveAvailable) {
  warnings.push("no Windows Dev Drive was detected");
}
if (!report.mxcTierAReady) {
  warnings.push("Windows build is below the Tier A MXC readiness line (24H2 26100.9278 / 25H2 26200.9278)");
}

if (jsonMode) {
  process.stdout.write(`${JSON.stringify(report)}\n`);
  for (const warning of warnings) process.stderr.write(`warning: ${warning}\n`);
  for (const failure of hardFailures) process.stderr.write(`error: ${failure}\n`);
} else {
  const rows = Object.entries(report).map(([key, value]) => `${key.padEnd(28)} ${String(value)}`);
  process.stdout.write(`${rows.join("\n")}\n`);
  for (const warning of warnings) process.stdout.write(`warning: ${warning}\n`);
  for (const failure of hardFailures) process.stdout.write(`error: ${failure}\n`);
}

process.exit(hardFailures.length === 0 ? 0 : 1);
