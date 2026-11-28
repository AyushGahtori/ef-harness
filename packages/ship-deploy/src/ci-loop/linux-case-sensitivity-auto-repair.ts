import type { CaseRepairAction } from "./types.js";

export type GitLsFilesProvider = {
  listTrackedFiles(): readonly string[];
};

const IMPORT_CASE_PATTERN =
  /(?:Cannot find module|Could not resolve) ['"]([^'"]+)['"]|TS2307: Cannot find module ['"]([^'"]+)['"]/i;

const SHEBANG_CRLF_PATTERN = /\/bin\/bash\^M: bad interpreter/i;

function normalizePosix(path: string): string {
  return path.replaceAll("\\", "/");
}

function basenameWithoutExt(filePath: string): string {
  const base = filePath.slice(filePath.lastIndexOf("/") + 1);
  return base.replace(/\.(tsx|ts|jsx|js|mjs|cjs)$/, "");
}

function findTrackedCaseMatch(specifier: string, tracked: readonly string[]): string | undefined {
  const posix = normalizePosix(specifier);
  const wantedBase = basenameWithoutExt(posix.replace(/^\.\//, "")).toLowerCase();
  let best: string | undefined;
  for (const file of tracked) {
    const candidate = normalizePosix(file);
    if (basenameWithoutExt(candidate).toLowerCase() === wantedBase) {
      if (!best || candidate.length < best.length) {
        best = candidate;
      }
    }
  }
  return best;
}

function rewriteImportLine(source: string, specifier: string, resolvedPath: string): { readonly next: string; readonly changed: boolean } {
  const targetName = resolvedPath.slice(resolvedPath.lastIndexOf("/") + 1).replace(/\.(tsx|ts|jsx|js)$/, "");
  const desired = `./${targetName}`;
  if (specifier === desired) {
    return { next: source, changed: false };
  }
  const pattern = new RegExp(`(['"])${specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\1`);
  if (!pattern.test(source)) {
    return { next: source, changed: false };
  }
  return { next: source.replace(pattern, `$1${desired}$1`), changed: true };
}

export class LinuxCaseSensitivityAutoRepair {
  constructor(private readonly gitFiles: GitLsFilesProvider) {}

  planRepairs(logExcerpt: readonly string[], sources: Readonly<Record<string, string>>): CaseRepairAction[] {
    const actions: CaseRepairAction[] = [];
    const blob = logExcerpt.join("\n");
    const tracked = this.gitFiles.listTrackedFiles();

    const importMatch = IMPORT_CASE_PATTERN.exec(blob);
    const specifier = importMatch?.[1] ?? importMatch?.[2];
    if (specifier) {
      const trackedPath = findTrackedCaseMatch(specifier, tracked);
      if (trackedPath) {
        for (const [file, content] of Object.entries(sources)) {
          const rewrite = rewriteImportLine(content, specifier, trackedPath);
          if (rewrite.changed) {
            actions.push({
              kind: "rewrite_import",
              file,
              before: specifier,
              after: `./${trackedPath.slice(trackedPath.lastIndexOf("/") + 1).replace(/\.(tsx|ts|jsx|js)$/, "")}`,
            });
            break;
          }
        }

      }
    }

    if (SHEBANG_CRLF_PATTERN.test(blob)) {
      const script = tracked.find((file) => file.includes(".github/scripts/") && file.endsWith(".sh"));
      if (script) {
        actions.push({ kind: "normalize_crlf", file: script });
        actions.push({ kind: "chmod_executable", file: script });
      }
    }

    return actions;
  }

  applyImportRewrite(source: string, specifier: string, trackedPath: string): string {
    return rewriteImportLine(source, specifier, trackedPath).next;
  }

  /** Windows NTFS two-step git mv so Git records case-only renames. */
  planTwoStepCaseRename(fromPath: string, toPath: string): CaseRepairAction {
    const tmp = `${fromPath}.__tmp`;
    return {
      kind: "two_step_git_mv",
      from: fromPath,
      to: toPath,
      commands: [`git mv ${fromPath} ${tmp}`, `git mv ${tmp} ${toPath}`],
    };
  }

  normalizeCrlf(content: string): string {
    return content.replace(/\r\n/g, "\n");
  }
}