import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  PROTECTED_BRANCHES,
  assertSlug,
  assertTaskNumber,
  changedFiles,
  checkoutRoot,
  currentBranch,
  git,
  mainRepoRoot,
  worktreeHome,
} from "./harmony-lib.mjs";

function usage() {
  return `Usage:
  node scripts/agent-worktree.mjs create <NNN> <slug> [--base <ref>]
  node scripts/agent-worktree.mjs check <NNN>
  node scripts/agent-worktree.mjs commit <NNN> <message>
  node scripts/agent-worktree.mjs status
  node scripts/agent-worktree.mjs list
  node scripts/agent-worktree.mjs remove <NNN> [--force]`;
}

function parseArgs(argv) {
  const positional = [];
  let base;
  let force = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--base") {
      base = argv[i + 1];
      i += 1;
    } else if (arg === "--force") {
      force = true;
    } else if (arg) {
      positional.push(arg);
    }
  }
  return { positional, base, force };
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function requireGit(args, cwd) {
  const result = await git(args, cwd);
  if (result.status !== 0) {
    fail((result.stderr || result.stdout || `git ${args.join(" ")} failed`).trim());
  }
  return result;
}

function quoteCmd(value) {
  if (/[\s"&]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

function runInherited(command, args, cwd, env) {
  const direct = process.platform !== "win32" || command.toLowerCase().endsWith(".exe");
  if (!direct) {
    return spawnSync([command, ...args].map(quoteCmd).join(" "), {
      cwd,
      env,
      stdio: "inherit",
      windowsHide: true,
      shell: true,
    });
  }
  return spawnSync(command, args, {
    cwd,
    env,
    stdio: "inherit",
    windowsHide: true,
  });
}

async function listWorktrees(main) {
  const result = await requireGit(["worktree", "list", "--porcelain"], main);
  const items = [];
  for (const block of result.stdout.split(/\r?\n\r?\n/)) {
    const wt = /^worktree (.*)$/m.exec(block)?.[1];
    const branch = /^branch refs\/heads\/(.*)$/m.exec(block)?.[1] ?? "";
    if (wt) items.push({ path: wt, branch });
  }
  return items;
}

function fillHandoff(template, nnn, branch, baseCommit) {
  return template
    .replaceAll("Task-NNN", `Task-${nnn}`)
    .replaceAll("task/NNN-<slug>", branch)
    .replaceAll("0000000000000000000000000000000000000000", baseCommit)
    .replace('status: "ready_for_integration"', 'status: "in_progress"');
}

async function create(nnn, slug, base) {
  assertTaskNumber(nnn);
  assertSlug(slug);
  const main = await mainRepoRoot();
  const branch = `task/${nnn}-${slug}`;
  const destination = path.join(worktreeHome(main), `task-${nnn}-${slug}`);
  if (fs.existsSync(destination)) {
    fail(`Worktree already exists: ${destination}`);
  }
  const existing = await git(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], main);
  if (existing.status === 0) {
    fail(`Branch already exists: ${branch}`);
  }
  const baseRef = base || "harness/integration";
  await requireGit(["rev-parse", "--verify", baseRef], main);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const added = await git(["worktree", "add", "-b", branch, destination, baseRef], main);
  if (added.status !== 0) {
    fail((added.stderr || added.stdout || "git worktree add failed").trim());
  }
  const sha = (await requireGit(["rev-parse", baseRef], destination)).stdout.trim();
  const templatePath = path.join(destination, ".agent-handoffs", "TEMPLATE.md");
  if (!fs.existsSync(templatePath)) {
    fail(`Missing handoff template at ${templatePath}`);
  }
  const handoff = fillHandoff(fs.readFileSync(templatePath, "utf8"), nnn, branch, sha);
  fs.writeFileSync(path.join(destination, ".agent-handoffs", `task-${nnn}.md`), handoff);
  const install =
    process.platform === "win32"
      ? spawnSync('pnpm install --frozen-lockfile --prefer-offline', {
          cwd: destination,
          encoding: "utf8",
          windowsHide: true,
          shell: true,
          env: { ...process.env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1" },
        })
      : spawnSync("pnpm", ["install", "--frozen-lockfile", "--prefer-offline"], {
          cwd: destination,
          encoding: "utf8",
          windowsHide: true,
          env: { ...process.env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1" },
        });
  if (install.status !== 0) {
    await git(["worktree", "remove", "--force", destination], main);
    await git(["branch", "-D", branch], main);
    fail((install.stderr || install.stdout || "pnpm install failed in the new worktree").trim());
  }
  console.log(`Created ${branch} at ${destination}`);
}

async function ensureTaskBranch(nnn) {
  assertTaskNumber(nnn);
  const branch = await currentBranch(process.cwd());
  if (!branch || PROTECTED_BRANCHES.has(branch)) {
    fail(`refusing to operate on ${branch ?? "detached HEAD"}`);
  }
  if (!branch.startsWith(`task/${nnn}-`)) {
    fail(`HEAD is ${branch}, expected task/${nnn}-*`);
  }
  return branch;
}

async function check(nnn, requireReady) {
  await ensureTaskBranch(nnn);
  const args = [path.join(checkoutRoot(), "scripts", "verify-harmony.mjs"), "--task", nnn];
  if (requireReady) args.push("--require-ready");
  const result = runInherited(process.execPath, args, process.cwd());
  if (result.status !== 0) process.exit(result.status ?? 1);
}

async function commit(nnn, message) {
  if (!message.trim()) fail("commit message is required");
  const branch = await ensureTaskBranch(nnn);
  await check(nnn, true);
  const cwd = process.cwd();
  const files = await changedFiles(cwd);
  if (files.length === 0) fail("there is nothing to commit");
  const whitespace = await git(["diff", "--check"], cwd);
  if (whitespace.status !== 0) {
    fail((whitespace.stdout || whitespace.stderr || "git diff --check failed").trim());
  }
  await requireGit(["add", "--", ...files], cwd);
  const staged = await git(["diff", "--cached", "--check"], cwd);
  if (staged.status !== 0) {
    fail((staged.stdout || staged.stderr || "git diff --cached --check failed").trim());
  }
  const body = `${message.trim()}\n\nEF-Task-ID: Task-${nnn}\nEF-Commit-Only: true\nEF-Never-Merge: true\n`;
  const created = await git(["commit", "-m", body], cwd);
  if (created.status !== 0) {
    fail((created.stderr || created.stdout || "git commit failed").trim());
  }
  console.log(created.stdout.trim());
  console.log(`Committed on ${branch} with EF-Never-Merge: true`);
}

async function status() {
  const main = await mainRepoRoot();
  const items = await listWorktrees(main);
  if (items.length === 0) {
    console.log("No worktrees.");
    return;
  }
  for (const item of items) {
    const dirty = (await git(["status", "--porcelain"], item.path)).stdout.trim();
    console.log(`${item.branch || "(detached)"}\t${item.path}${dirty ? "\tdirty" : "\tclean"}`);
  }
}

async function remove(nnn, force) {
  assertTaskNumber(nnn);
  const main = await mainRepoRoot();
  const items = await listWorktrees(main);
  const matches = items.filter(
    (item) => item.branch.startsWith(`task/${nnn}-`) || path.basename(item.path).startsWith(`task-${nnn}-`),
  );
  if (matches.length === 0) fail(`No worktree found for task ${nnn}`);
  for (const item of matches) {
    const dirty = (await git(["status", "--porcelain"], item.path)).stdout.trim();
    if (dirty) fail(`Refusing to remove a dirty worktree: ${item.path}`);
    const removed = await git(["worktree", "remove", item.path], main);
    if (removed.status !== 0) {
      fail((removed.stderr || removed.stdout || "git worktree remove failed").trim());
    }
    if (!item.branch) continue;
    const merged = await git(["merge-base", "--is-ancestor", item.branch, "harness/integration"], main);
    if (merged.status === 0 || force) {
      const deleted = await git(["branch", "-D", item.branch], main);
      if (deleted.status !== 0) {
        fail((deleted.stderr || deleted.stdout || "git branch -D failed").trim());
      }
      console.log(`Removed ${item.path} and branch ${item.branch}`);
    } else {
      console.log(`Removed ${item.path}. Branch ${item.branch} is unmerged; pass --force to delete it.`);
    }
  }
}

async function main() {
  const { positional, base, force } = parseArgs(process.argv.slice(2));
  const [command, first, ...rest] = positional;
  if (!command) fail(usage());
  if (command === "create") {
    if (!first || !rest[0]) fail(usage());
    await create(first, rest[0], base);
    return;
  }
  if (command === "check") {
    if (!first) fail(usage());
    await check(first, false);
    return;
  }
  if (command === "commit") {
    if (!first) fail(usage());
    await commit(first, rest.join(" "));
    return;
  }
  if (command === "status" || command === "list") {
    await status();
    return;
  }
  if (command === "remove") {
    if (!first) fail(usage());
    await remove(first, force);
    return;
  }
  fail(usage());
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
