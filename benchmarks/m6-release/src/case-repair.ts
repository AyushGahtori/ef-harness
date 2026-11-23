import fs from "node:fs";
import path from "node:path";
import { git, gitAllowFail, listedFiles } from "./git-util.ts";
import type { LinuxCaseRepairTrace } from "./types.ts";

const PUSH_CAP = 3 as const;

export function classifyCiFailure(log: string, caseMismatch: boolean): string {
  if (caseMismatch && /TS2307|Cannot find module|Could not resolve/.test(log)) {
    return "class-2";
  }
  if (/secret .+ not set|Missing repository secret/i.test(log)) return "class-4";
  if (/503|ETIMEDOUT|ENOTFOUND|Service Unavailable/.test(log)) return "class-3";
  if (/already failing on .+base/i.test(log)) return "class-5";
  return "class-1";
}

export function repairPushAllowed(existingRepairPushes: number): boolean {
  return existingRepairPushes < PUSH_CAP;
}

export function acceptIndexCase(actual: readonly string[], desired: string): boolean {
  return actual.length === 1 && actual[0] === desired;
}

interface ResolvedImport {
  readonly ok: boolean;
  readonly match: string | null;
}

function resolveImport(
  tracked: readonly string[],
  importer: string,
  specifier: string,
  sensitive: boolean,
): ResolvedImport {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(importer), specifier));
  const candidates = [base, `${base}.tsx`, `${base}.ts`, `${base}.jsx`, `${base}.js`];
  for (const candidate of candidates) {
    const match = tracked.find((file) =>
      sensitive ? file === candidate : file.toLowerCase() === candidate.toLowerCase(),
    );
    if (match) {
      return { ok: sensitive ? match === candidate : true, match };
    }
  }
  return { ok: false, match: null };
}

function write(repo: string, rel: string, text: string): void {
  const full = path.join(repo, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text.replaceAll("\r\n", "\n"), "utf8");
}

function initRepo(repo: string): void {
  fs.mkdirSync(repo, { recursive: true });
  git(["init", "-b", "main"], repo);
}

function commitAll(repo: string, message: string): void {
  git(["add", "--", "."], repo);
  git(["commit", "-m", message], repo);
}

function twoStepGitMv(repo: string, from: string, to: string): void {
  const temp = `${from}.__ef_case_tmp`;
  git(["mv", from, temp], repo);
  git(["mv", temp, to], repo);
}

function brokenFilesystemRename(repo: string, from: string, to: string): void {
  fs.renameSync(path.join(repo, from), path.join(repo, to));
  git(["add", "-A"], repo);
}

function indexCaseScenario(parent: string, strategy: "two-step" | "filesystem" | "git-mv"): string {
  const repo = path.join(parent, strategy);
  initRepo(repo);
  write(repo, "src/Header.tsx", "export const Header = 1;\n");
  commitAll(repo, "track mixed-case header");
  if (strategy === "two-step") {
    twoStepGitMv(repo, "src/Header.tsx", "src/header.tsx");
  } else if (strategy === "filesystem") {
    brokenFilesystemRename(repo, "src/Header.tsx", "src/header.tsx");
  } else {
    gitAllowFail(["mv", "src/Header.tsx", "src/header.tsx"], repo);
  }
  const files = listedFiles(repo);
  return files[0] ?? "";
}

export function certifyLinuxCaseRepair(parent: string, inject: readonly string[]): LinuxCaseRepairTrace {
  const repo = path.join(parent, "import-mismatch");
  initRepo(repo);
  write(repo, "src/header.tsx", 'export function Header(): string {\n  return "header";\n}\n');
  write(repo, "src/app.tsx", 'import { Header } from "./Header";\nexport const view = Header();\n');
  commitAll(repo, "feature with case-mismatched import");
  const bare = path.join(parent, "import-mismatch.git");
  git(["init", "--bare", bare], parent);
  git(["remote", "add", "origin", bare], repo);
  git(["push", "origin", "main"], repo);

  const before = listedFiles(repo);
  const local = resolveImport(before, "src/app.tsx", "./Header", false);
  const linux = resolveImport(before, "src/app.tsx", "./Header", true);
  const log = "TS2307: Cannot find module './Header'";
  const classification = classifyCiFailure(log, !linux.ok);
  const appPath = path.join(repo, "src", "app.tsx");
  const rewritten = fs.readFileSync(appPath, "utf8").replace('from "./Header"', 'from "./header"');
  fs.writeFileSync(appPath, rewritten, "utf8");
  commitAll(repo, "rewrite import case for linux CI");
  git(["push", "origin", "main"], repo);
  const after = listedFiles(repo);
  const linuxAfter = resolveImport(after, "src/app.tsx", "./header", true);

  const twoStepIndexCase = indexCaseScenario(parent, "two-step");
  const brokenIndexCase = indexCaseScenario(parent, "filesystem");
  const singleStepGitMvIndexCase = indexCaseScenario(parent, "git-mv");
  const forcedBroken = inject.includes("single-step-rename");
  const appliedRepairIndexCase = forcedBroken ? brokenIndexCase : twoStepIndexCase;
  const repairAccepted = acceptIndexCase([appliedRepairIndexCase], "src/header.tsx");
  const ciGreen = classification === "class-2" && linuxAfter.ok && local.ok && repairAccepted && linux.ok === false;

  return {
    classification,
    localWindowsVerification: local.ok ? "PASS" : "FAIL",
    linuxBefore: linux.ok ? "RESOLVED" : "TS2307",
    ciStatus: ciGreen ? "CI_GREEN" : "CI_RED",
    repairPushes: 1,
    pushCap: PUSH_CAP,
    fourthPushRejected: repairPushAllowed(PUSH_CAP) === false,
    ledgerApproved: true,
    importBefore: "./Header",
    importAfter: "./header",
    repairStrategy: forcedBroken ? "filesystem-rename-plus-add" : "two-step-git-mv",
    twoStepIndexCase,
    appliedRepairIndexCase,
    brokenIndexCase,
    brokenRenameAccepted: acceptIndexCase([brokenIndexCase], "src/header.tsx"),
    singleStepGitMvIndexCase,
    gitMvSingleStepChangedIndex: singleStepGitMvIndexCase === "src/header.tsx",
  };
}
