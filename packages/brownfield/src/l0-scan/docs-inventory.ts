import fs from "node:fs";
import path from "node:path";
import type { MinGitRepoInspectorPort } from "./git-exec.js";
import type { DocInventoryEntry, ScannedFile } from "./types.js";

const DOC_NAMES = new Set(["README.md", "ARCHITECTURE.md", "AGENTS.md", "CLAUDE.md"]);

function countLines(text: string): number {
  if (text.length === 0) return 0;
  return text.split(/\r?\n/).length;
}

function isDocFile(rel: string): boolean {
  const base = path.posix.basename(rel);
  if (DOC_NAMES.has(base)) return true;
  if (rel.startsWith("docs/") && rel.endsWith(".md")) return true;
  return false;
}

export function inventoryDocs(
  root: string,
  files: readonly ScannedFile[],
  git: MinGitRepoInspectorPort,
  isGit: boolean,
): DocInventoryEntry[] {
  const docCandidates = files.filter((file) => !file.isBinary && isDocFile(file.path));
  const docs: DocInventoryEntry[] = [];
  for (const file of docCandidates) {
    const full = path.join(root, file.path);
    let text = "";
    try {
      text = fs.readFileSync(full, "utf8");
    } catch {
      continue;
    }
    const lastCommitIso =
      isGit && docCandidates.length < 80 ? git.logLastCommitForFile(root, file.path) : isGit ? null : null;
    docs.push({
      path: file.path,
      bytes: file.bytes,
      lines: countLines(text),
      lastCommitIso,
    });
  }
  return docs.sort((a, b) => a.path.localeCompare(b.path));
}