import { spawnSync } from "node:child_process";
import { checkoutRoot, decidePermission } from "./harmony-lib.mjs";

const root = checkoutRoot();
const result = spawnSync("opencode", ["debug", "config", "--pure"], {
  cwd: root,
  encoding: "utf8",
  windowsHide: true,
  shell: process.platform === "win32",
});

if (result.status !== 0) {
  process.stderr.write(result.stderr || result.stdout || "opencode debug config failed\n");
  process.exit(result.status ?? 1);
}

const raw = result.stdout ?? "";
const start = raw.indexOf("{");
const end = raw.lastIndexOf("}");
if (start < 0 || end <= start) {
  process.stderr.write("opencode did not print a configuration object\n");
  process.exit(1);
}

const config = JSON.parse(raw.slice(start, end + 1));
const permission = config.permission;
const checks = [
  ["bash", "git merge origin/main", "deny"],
  ["bash", "git push", "deny"],
  ["bash", "git status --short", "allow"],
  ["webfetch", "https://example.invalid/docs", "deny"],
  ["read", "C:/Users/someone/.ssh/id_rsa", "deny"],
];

const failures = [];
for (const [action, resource, expected] of checks) {
  const actual = decidePermission(permission, action, resource);
  if (actual !== expected) {
    failures.push(`${action} ${resource} resolved to ${actual}, expected ${expected}`);
  }
}

if (config.compaction?.auto !== false) {
  failures.push("compaction.auto is not false");
}

if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`${failure}\n`);
  process.exit(1);
}

process.stdout.write("opencode smoke ok\n");
