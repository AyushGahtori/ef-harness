import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  PROTECTED_BRANCHES,
  changedFiles,
  checkoutRoot,
  contentViolations,
  currentBranch,
  handoffErrors,
  isEnvFile,
  isFoundationFrozen,
  matchesOwned,
  parseFrontmatter,
} from "./harmony-lib.mjs";

const root = checkoutRoot();
const args = process.argv.slice(2);
const preCommit = args.includes("--pre-commit");
const requireReady = args.includes("--require-ready");
const taskIndex = args.indexOf("--task");
const taskNumber = taskIndex >= 0 ? args[taskIndex + 1] : undefined;

const failures = [];

function fail(message) {
  failures.push(message);
}

function walk(dir, out) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "coverage") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
}

function scanTree() {
  const files = [];
  for (const dir of ["packages", "apps", "spikes", "corpus", "benchmarks", "tests", "scripts", ".opencode", ".github", ".githooks"]) {
    walk(path.join(root, dir), files);
  }
  for (const file of [
    "package.json",
    "pnpm-workspace.yaml",
    "tsconfig.base.json",
    "tsconfig.json",
    "eslint.config.mjs",
    "opencode.json",
    "eslint.config.mjs",
    "stack-manifest.json",
    "CONTRIBUTING_AGENTS.md",
    ".npmrc",
    ".gitignore",
    ".gitattributes",
    ".prettierrc",
  ]) {
    const full = path.join(root, file);
    if (fs.existsSync(full)) files.push(full);
  }
  const seen = new Set();
  for (const full of files) {
    if (seen.has(full)) continue;
    seen.add(full);
    scanFile(full);
  }
}

function scanFile(full) {
  const rel = path.relative(root, full).replaceAll("\\", "/");
  if (isEnvFile(rel)) {
    fail(`${rel} is an env file`);
  }
  const stat = fs.statSync(full);
  if (stat.size > 50 * 1024 * 1024) {
    fail(`${rel} is larger than 50 MB`);
  }
  if (stat.size > 2 * 1024 * 1024) return;
  const text = fs.readFileSync(full, "utf8");
  for (const violation of contentViolations(text, rel)) {
    fail(violation);
  }
}

function runNode(scriptArgs) {
  return spawnSync(process.execPath, scriptArgs, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
}

function checkSchema() {
  const result = runNode(["schema/schema-test.js"]);
  const combined = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.status !== 0 || !/67\/67 passed/.test(combined)) {
    fail("schema/schema-test.js did not pass 67/67");
  }
}

function checkDiagrams() {
  const result = runNode(["scripts/verify-diagrams.mjs"]);
  if (result.status !== 0) {
    fail((result.stderr || result.stdout || "diagram integrity check failed").trim());
  }
}

function checkHandoff(nnn, requireReady) {
  const rel = `.agent-handoffs/task-${nnn}.md`;
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) {
    fail(`missing ${rel}`);
    return null;
  }
  let parsed;
  try {
    parsed = parseFrontmatter(fs.readFileSync(full, "utf8"));
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
    return null;
  }
  for (const error of handoffErrors(parsed.data, parsed.body, { nnn, requireReady })) {
    fail(error);
  }
  return parsed.data;
}

async function checkScope(nnn, requireReady) {
  const data = checkHandoff(nnn, requireReady);
  const owned = Array.isArray(data?.owned_paths) ? data.owned_paths.map(String) : [];
  const files = await changedFiles(root);
  if (requireReady && files.length === 0) {
    fail("there is nothing to commit");
  }
  for (const file of files) {
    if (isFoundationFrozen(file)) {
      fail(`${file} is frozen by Task 001; request a wiring or contract change in the handoff instead`);
      continue;
    }
    const handoff = `.agent-handoffs/task-${nnn}.md`;
    if (file !== handoff && !matchesOwned(file, owned)) {
      fail(`${file} is outside owned_paths`);
    }
    const full = path.join(root, file);
    if (fs.existsSync(full) && fs.statSync(full).isFile()) {
      scanFile(full);
    }
  }
}

function runPnpm(script) {
  const result = spawnSync("pnpm", [script], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
    fail(`pnpm ${script} failed\n${output}`);
  }
}

async function main() {
  if (taskNumber !== undefined && !/^\d{3}$/.test(taskNumber)) {
    console.error("verify-harmony --task expects a three-digit task number");
    process.exit(2);
  }

  scanTree();
  checkSchema();
  checkDiagrams();

  if (preCommit || taskNumber) {
    const branch = await currentBranch(root);
    if (!branch) {
      fail("detached HEAD is not a task branch");
    } else if (PROTECTED_BRANCHES.has(branch)) {
      if (process.env.EF_HARNESS_MAINTAINER !== "1") {
        fail(`refusing a task-agent commit on ${branch}`);
      }
    } else if (!/^task\/\d{3}-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(branch)) {
      fail(`branch ${branch} is not a task branch`);
    }

    if (taskNumber) {
      if (!branch || !branch.startsWith(`task/${taskNumber}-`)) {
        fail(`HEAD is ${branch ?? "detached"}, expected task/${taskNumber}-*`);
      } else {
        await checkScope(taskNumber, requireReady);
      }
    } else if (preCommit && branch?.startsWith("task/")) {
      const nnn = branch.slice("task/".length, "task/".length + 3);
      if (/^\d{3}$/.test(nnn)) {
        await checkScope(nnn, false);
      }
    }
  }

  if (taskNumber && failures.length === 0) {
    runPnpm("typecheck");
    runPnpm("lint");
    runPnpm("test");
  }

  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(`harmony: ${failure}`);
    }
    process.exit(1);
  }
  console.log(taskNumber ? `harmony ok for Task-${taskNumber}` : "harmony ok");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
