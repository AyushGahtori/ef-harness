import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

export function checkoutRoot() {
  return path.resolve(scriptDir, "..");
}

export function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function isTransientGitFailure(result) {
  const blob = `${result.stderr ?? ""}\n${result.stdout ?? ""}\n${result.error?.message ?? ""}`;
  return /EPERM|EBUSY|EACCES|index\.lock/i.test(blob);
}

/**
 * @param {string[]} args
 * @param {string} cwd
 */
export async function git(args, cwd) {
  let last = /** @type {import("node:child_process").SpawnSyncReturns<string> | undefined} */ (undefined);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const result = spawnSync("git", args, {
      cwd,
      encoding: "utf8",
      windowsHide: true,
    });
    last = result;
    if (result.status === 0 || !isTransientGitFailure(result) || attempt === 4) {
      return result;
    }
    await delay(50 * 2 ** attempt + Math.floor(Math.random() * 40));
  }
  if (!last) {
    throw new Error("git did not run");
  }
  return last;
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv }} [options]
 */
function quoteCmd(value) {
  if (/[\s"&]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

export function run(command, args, options = {}) {
  const executable = command.toLowerCase();
  const direct =
    process.platform !== "win32" ||
    executable.endsWith(".exe") ||
    command === process.execPath ||
    command === "git" ||
    command === "node" ||
    command === "reg";
  if (!direct) {
    return spawnSync([command, ...args].map(quoteCmd).join(" "), {
      cwd: options.cwd,
      env: options.env ?? process.env,
      encoding: "utf8",
      windowsHide: true,
      shell: true,
    });
  }
  return spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: "utf8",
    windowsHide: true,
  });
}

export async function mainRepoRoot() {
  const start = checkoutRoot();
  const result = await git(["rev-parse", "--git-common-dir"], start);
  if (result.status !== 0) {
    return start;
  }
  const common = path.resolve(start, result.stdout.trim());
  return path.dirname(common);
}

export function worktreeHome(mainRoot) {
  if (process.env.EF_WT_ROOT) {
    return path.resolve(process.env.EF_WT_ROOT);
  }
  return path.resolve(mainRoot, "..", "ef-wt");
}

export function normalizeRel(file) {
  let rel = file.replaceAll("\\", "/").replace(/^\.\//, "");
  if (rel.startsWith('"') && rel.endsWith('"')) {
    rel = rel.slice(1, -1);
  }
  return rel;
}

const FOUNDATION_EXACT = new Set([
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
  "tsconfig.json",
  "eslint.config.mjs",
  ".npmrc",
  ".gitignore",
  ".gitattributes",
  ".prettierrc",
  ".prettierignore",
  "opencode.json",
  "stack-manifest.json",
  "CONTRIBUTING_AGENTS.md",
  ".github/workflows/ci-harmony.yml",
  "packages/shared-contracts/src/index.ts",
  "scripts/agent-worktree.mjs",
  "scripts/agent-worktree.ps1",
  "scripts/verify-harmony.mjs",
  "scripts/verify-env.mjs",
  "scripts/verify-diagrams.mjs",
  "scripts/bootstrap-dev.ps1",
  "scripts/layers.mjs",
  "scripts/harmony-lib.mjs",
  "scripts/harmony.test.mjs",
  "scripts/opencode-smoke.mjs",
  "scripts/run-tests.mjs",
]);

const FOUNDATION_PREFIXES = ["schema/", ".opencode/", ".githooks/"];

export function isFoundationFrozen(file) {
  const rel = normalizeRel(file);
  if (FOUNDATION_EXACT.has(rel)) return true;
  if (FOUNDATION_PREFIXES.some((prefix) => rel.startsWith(prefix))) return true;
  return /(^|\/)(package\.json|tsconfig\.json|vitest\.config\.ts)$/.test(rel);
}

export function matchesOwned(file, ownedPaths) {
  const rel = normalizeRel(file);
  return ownedPaths.some((pattern) => matchPattern(rel, pattern));
}

function matchPattern(file, pattern) {
  const normalized = normalizeRel(pattern);
  if (normalized.endsWith("/**")) {
    const prefix = normalized.slice(0, -3);
    return file === prefix || file.startsWith(`${prefix}/`);
  }
  if (normalized.endsWith("/")) {
    return file.startsWith(normalized);
  }
  return file === normalized;
}

export function secretNeedles() {
  return [
    ["sk", "_live_"].join(""),
    ["sk-ant", "-"].join(""),
    ["sk-proj", "-"].join(""),
    ["ghp", "_"].join(""),
    ["AK", "IA"].join(""),
    ["BEGIN ", "PRIVATE KEY"].join(""),
  ];
}

export function forbiddenSnippets() {
  return [
    ["anti", "gravity"].join(""),
    ["setup-", "token"].join(""),
    ["~/", ".gemini"].join(""),
  ];
}

export function markerPattern() {
  const todo = ["TO", "DO"].join("");
  const fixme = ["FIX", "ME"].join("");
  return new RegExp(`\\b(?:${todo}|${fixme})\\b(?!\\(DEF-[A-Za-z0-9-]+\\))`);
}

/**
 * @param {string} text
 * @param {string} label
 * @returns {string[]}
 */
export function contentViolations(text, label) {
  const violations = [];
  for (const needle of secretNeedles()) {
    if (text.includes(needle)) {
      violations.push(`${label} contains a secret marker`);
    }
  }
  for (const snippet of forbiddenSnippets()) {
    if (text.includes(snippet)) {
      violations.push(`${label} contains a forbidden compliance string`);
    }
  }
  if (markerPattern().test(text)) {
    violations.push(`${label} contains an unanchored task marker`);
  }
  if (/^(<{7}|={7}|>{7})/m.test(text)) {
    violations.push(`${label} contains conflict markers`);
  }
  return violations;
}

export function isEnvFile(file) {
  const base = path.posix.basename(normalizeRel(file));
  if (base === ".env.example") return false;
  return base === ".env" || base.startsWith(".env.");
}

/**
 * @param {string} text
 */
export function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    throw new Error("handoff is missing YAML frontmatter");
  }
  const lines = match[1].split(/\r?\n/);
  /** @type {Record<string, unknown>} */
  const data = {};
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (!line.trim()) continue;
    const kv = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
    if (!kv) {
      throw new Error(`handoff frontmatter has an unreadable line: ${line}`);
    }
    const key = kv[1] ?? "";
    const raw = kv[2] ?? "";
    if (raw === "[]") {
      data[key] = [];
      continue;
    }
    if (raw === "") {
      const items = [];
      while (i + 1 < lines.length && /^ {2}-\s+/.test(lines[i + 1] ?? "")) {
        i += 1;
        items.push(unquote((lines[i] ?? "").replace(/^ {2}-\s+/, "")));
      }
      data[key] = items;
      continue;
    }
    if (raw === "true" || raw === "false") {
      data[key] = raw === "true";
      continue;
    }
    data[key] = unquote(raw);
  }
  return { data, body: text.slice(match[0].length) };
}

function unquote(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export const REQUIRED_HANDOFF_SECTIONS = [
  "## Exports Provided",
  "## Shared Wiring Needs (Root / Index Barrels)",
  "## Dependency Intents (New Packages Requested)",
  "## Contract Change Requests",
  "## Exact Verification Commands & Results",
  "## Known Limitations / Follow-Ups",
];

/**
 * @param {Record<string, unknown>} data
 * @param {string} body
 * @param {{ nnn?: string, requireReady?: boolean }} [options]
 * @returns {string[]}
 */
export function handoffErrors(data, body, options = {}) {
  const errors = [];
  const taskId = data.task_id;
  const branch = data.branch;
  const base = data.base_commit;
  const owned = data.owned_paths;
  const status = data.status;
  const commitOnly = data.commit_only_never_merged;
  if (typeof taskId !== "string" || !/^Task-\d{3}$/.test(taskId)) {
    errors.push("task_id must look like Task-NNN");
  }
  if (typeof branch !== "string" || !/^task\/\d{3}-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(branch)) {
    errors.push("branch must look like task/NNN-<slug>");
  }
  if (typeof base !== "string" || !/^[0-9a-f]{40}$/.test(base)) {
    errors.push("base_commit must be a 40-character hexadecimal SHA");
  }
  if (!Array.isArray(owned) || owned.some((item) => typeof item !== "string")) {
    errors.push("owned_paths must be a string array");
  }
  if (commitOnly !== true) {
    errors.push("commit_only_never_merged must be true");
  }
  if (options.requireReady && status !== "ready_for_integration") {
    errors.push('status must be "ready_for_integration" before commit');
  } else if (status !== "ready_for_integration" && status !== "in_progress") {
    errors.push('status must be "in_progress" or "ready_for_integration"');
  }
  if (options.nnn) {
    if (taskId !== `Task-${options.nnn}`) {
      errors.push(`task_id must be Task-${options.nnn}`);
    }
    if (typeof branch === "string" && !branch.startsWith(`task/${options.nnn}-`)) {
      errors.push(`branch must start with task/${options.nnn}-`);
    }
  }
  for (const section of REQUIRED_HANDOFF_SECTIONS) {
    if (!body.includes(section)) {
      errors.push(`missing section ${section}`);
    }
  }
  return errors;
}

/**
 * Last matching glob wins. Unmatched resources stay "ask".
 * A string rule matches every resource.
 * @param {unknown} permission
 * @param {string} action
 * @param {string} resource
 */
export function decidePermission(permission, action, resource) {
  if (!permission || typeof permission !== "object") return "ask";
  const rules = /** @type {Record<string, unknown>} */ (permission)[action];
  if (typeof rules === "string") return rules;
  if (!rules || typeof rules !== "object") return "ask";
  const normalized = resource.replaceAll("\\", "/");
  let decision = "ask";
  let matched = false;
  for (const [pattern, effect] of Object.entries(rules)) {
    if (typeof effect !== "string") continue;
    if (globMatch(pattern, normalized) || globMatch(pattern, resource)) {
      decision = effect;
      matched = true;
    }
  }
  return matched ? decision : "ask";
}

function globMatch(pattern, value) {
  const placeholder = "\u0000";
  const source = pattern
    .replaceAll("**", placeholder)
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replaceAll(placeholder, "\u0001")
    .replaceAll("*", ".*")
    .replaceAll("\u0001", ".*");
  return new RegExp(`^${source}$`, "i").test(value);
}

export function assertTaskNumber(nnn) {
  if (!/^\d{3}$/.test(nnn)) {
    throw new Error("Task number must be three digits");
  }
  const value = Number(nnn);
  if (value !== 0 && (value < 2 || value > 200)) {
    throw new Error("Task number must be 000 for the smoke probe, or 002 through 200");
  }
}

export function assertSlug(slug) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new Error("Slug must be lowercase words separated by hyphens");
  }
}

/**
 * @param {string} cwd
 */
export async function currentBranch(cwd) {
  const result = await git(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
  if (result.status !== 0) return null;
  const branch = result.stdout.trim();
  return branch === "HEAD" ? null : branch;
}

/**
 * @param {string} cwd
 */
export async function changedFiles(cwd) {
  const result = await git(["status", "--porcelain=v1", "-uall"], cwd);
  if (result.status !== 0) {
    throw new Error(result.stderr || "git status failed");
  }
  const files = [];
  for (const line of result.stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let file = line.slice(3);
    if (file.includes(" -> ")) {
      file = file.split(" -> ").at(-1) ?? file;
    }
    files.push(normalizeRel(file));
  }
  return files;
}

export const PROTECTED_BRANCHES = new Set(["main", "master", "harness/integration"]);
