import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { inspectWorkspaceFolder } from "./inspect-folder.js";
import { runInit } from "./init-repo.js";
import { isOsJunkName, pathIsInside } from "./paths.js";
import type { StructuredLogger, WorkOnCopyOptions, WorkOnCopyResult } from "./types.js";

const VCS_NAMES = new Set([".hg", ".git", ".svn", ".p4", ".p4config", ".p4ignore"]);

interface IgnoreRule {
  readonly negation: boolean;
  readonly directoryOnly: boolean;
  readonly anchored: boolean;
  readonly regex: RegExp;
  readonly source: string;
}

interface IgnoreSet {
  readonly base: string;
  readonly rules: readonly IgnoreRule[];
}

function globToRegExp(pattern: string): RegExp {
  let body = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index] ?? "";
    if (char === "*") {
      if (pattern[index + 1] === "*") {
        body += ".*";
        index += 1;
        if (pattern[index + 1] === "/") index += 1;
      } else {
        body += "[^/]*";
      }
      continue;
    }
    if (char === "?") {
      body += "[^/]";
      continue;
    }
    body += /[.+^${}()|[\]\\]/.test(char) ? `\\${char}` : char;
  }
  return new RegExp(`^${body}$`);
}

function parseIgnore(text: string): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("\\#") || line.startsWith("\\!")) line = line.slice(1);
    let negation = false;
    if (line.startsWith("!")) {
      negation = true;
      line = line.slice(1);
    }
    let anchored = false;
    if (line.startsWith("/")) {
      anchored = true;
      line = line.slice(1);
    }
    let directoryOnly = false;
    if (line.endsWith("/") && line.length > 1) {
      directoryOnly = true;
      line = line.slice(0, -1);
    }
    anchored = anchored || line.includes("/");
    rules.push({
      negation,
      directoryOnly,
      anchored,
      regex: globToRegExp(line),
      source: line,
    });
  }
  return rules;
}

function ruleMatches(rule: IgnoreRule, relativePath: string, isDir: boolean): boolean {
  const rel = relativePath.replaceAll("\\", "/");
  if (rule.directoryOnly && !isDir && !rel.includes("/")) return false;
  if (rule.anchored) {
    if (rule.directoryOnly) {
      return rel === rule.source || rel.startsWith(`${rule.source}/`) || rule.regex.test(rel);
    }
    return rule.regex.test(rel);
  }
  const parts = rel.split("/");
  if (rule.directoryOnly) return parts.some((part) => rule.regex.test(part));
  const base = parts[parts.length - 1] ?? rel;
  return rule.regex.test(base);
}

function isIgnored(sets: readonly IgnoreSet[], relativePath: string, isDir: boolean): boolean {
  let ignored = false;
  for (const set of sets) {
    const prefix = set.base ? `${set.base}/` : "";
    if (set.base && relativePath !== set.base && !relativePath.startsWith(prefix)) continue;
    const local = set.base ? relativePath.slice(prefix.length) : relativePath;
    if (!local) continue;
    for (const rule of set.rules) {
      if (ruleMatches(rule, local, isDir)) ignored = !rule.negation;
    }
  }
  return ignored;
}

async function fingerprint(root: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  const walk = async (current: string, relativePath: string): Promise<void> => {
    const entries = await fs.promises.readdir(current, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const childRel = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      const childAbs = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        hash.update(`link:${childRel}\n`);
        continue;
      }
      if (entry.isDirectory()) {
        hash.update(`dir:${childRel}\n`);
        await walk(childAbs, childRel);
        continue;
      }
      if (entry.isFile()) {
        hash.update(`file:${childRel}\n`);
        hash.update(await fs.promises.readFile(childAbs));
      }
    }
  };
  await walk(root, "");
  return hash.digest("hex");
}

async function copyTree(source: string, destination: string): Promise<{ copied: string[]; skipped: string[] }> {
  const copied: string[] = [];
  const skipped: string[] = [];
  const walk = async (current: string, relativePath: string, sets: readonly IgnoreSet[]): Promise<void> => {
    let nextSets = sets;
    const gitignorePath = path.join(current, ".gitignore");
    if (fs.existsSync(gitignorePath) && fs.statSync(gitignorePath).isFile()) {
      const text = await fs.promises.readFile(gitignorePath, "utf8");
      nextSets = [...sets, { base: relativePath, rules: parseIgnore(text) }];
    }
    const entries = await fs.promises.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const childRel = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      const childAbs = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        skipped.push(childRel);
        continue;
      }
      const isDir = entry.isDirectory();
      if (VCS_NAMES.has(entry.name) || isOsJunkName(entry.name) || isIgnored(nextSets, childRel, isDir)) {
        skipped.push(childRel);
        continue;
      }
      const target = path.join(destination, ...childRel.split("/"));
      if (isDir) {
        await fs.promises.mkdir(target, { recursive: true });
        await walk(childAbs, childRel, nextSets);
        continue;
      }
      if (!entry.isFile()) {
        skipped.push(childRel);
        continue;
      }
      await fs.promises.mkdir(path.dirname(target), { recursive: true });
      await fs.promises.copyFile(childAbs, target);
      copied.push(childRel);
    }
  };
  await walk(source, "", []);
  copied.sort((left, right) => left.localeCompare(right));
  skipped.sort((left, right) => left.localeCompare(right));
  return { copied, skipped };
}

export async function workOnACopy(options: WorkOnCopyOptions): Promise<WorkOnCopyResult> {
  const token = options.userExplicitConsentToken.trim();
  if (!token) throw new Error("Work on a copy requires an explicit user consent token.");
  const source = path.resolve(options.source);
  const destination = path.resolve(options.destination);
  if (source === destination || pathIsInside(destination, source) || pathIsInside(source, destination)) {
    throw new Error("The copy destination must be a different folder outside the original.");
  }
  const parent = path.dirname(destination);
  if (!fs.existsSync(parent)) throw new Error(`Destination parent does not exist: ${parent}`);
  if (fs.existsSync(destination)) throw new Error(`Destination already exists: ${destination}`);

  const inspected = await inspectWorkspaceFolder(source, {
    ...(options.gitBinary !== undefined ? { gitBinary: options.gitBinary } : {}),
    ...(options.resourcesRoot !== undefined ? { resourcesRoot: options.resourcesRoot } : {}),
    ...(options.settingsGitPath !== undefined ? { settingsGitPath: options.settingsGitPath } : {}),
    ...(options.env !== undefined ? { env: options.env } : {}),
    ...(options.logger !== undefined ? { logger: options.logger } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
  });
  if (inspected.primary !== "files_no_git" && inspected.primary !== "other_vcs") {
    throw new Error(
      `Work on a copy is only for folders with files and no Git, or another version-control system. This folder is ${inspected.primary}.`,
    );
  }

  const before = await fingerprint(source);
  await fs.promises.mkdir(destination);
  const { copied, skipped } = await copyTree(source, destination);
  const initOptions: {
    cwd: string;
    token: string;
    gitBinary?: string;
    resourcesRoot?: string;
    settingsGitPath?: string;
    env?: NodeJS.ProcessEnv;
    logger?: StructuredLogger;
    timeoutMs?: number;
  } = { cwd: destination, token };
  if (options.gitBinary !== undefined) initOptions.gitBinary = options.gitBinary;
  if (options.resourcesRoot !== undefined) initOptions.resourcesRoot = options.resourcesRoot;
  if (options.settingsGitPath !== undefined) initOptions.settingsGitPath = options.settingsGitPath;
  if (options.env !== undefined) initOptions.env = options.env;
  if (options.logger !== undefined) initOptions.logger = options.logger;
  if (options.timeoutMs !== undefined) initOptions.timeoutMs = options.timeoutMs;
  const git = await runInit(initOptions);
  const after = await fingerprint(source);
  if (before !== after) {
    throw new Error("Work on a copy mutated the original folder.");
  }
  if (git.exitCode !== 0) {
    throw new Error(`git init -b main failed in the copy: ${git.stderr || git.stdout}`);
  }
  return {
    source,
    destination,
    copiedPaths: copied,
    skippedPaths: skipped,
    initializedBranch: "main",
    git,
  };
}
