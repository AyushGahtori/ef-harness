import type { PorcelainKind, WorkingTreeEntry } from "./types.js";

function classifyCode(code: string): PorcelainKind {
  const x = code[0] ?? " ";
  const y = code[1] ?? " ";
  if (x === "?" && y === "?") return "untracked";
  if (x === "!" && y === "!") return "ignored";
  if (x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D")) return "unmerged";
  if (x === "R" || y === "R") return "renamed";
  if (x === "C" || y === "C") return "copied";
  if (x === "T" || y === "T") return "typechange";
  if (x === "A" || y === "A") return "added";
  if (x === "D" || y === "D") return "deleted";
  return "modified";
}

/** Parse `git status --porcelain=v1 -z`. */
export function parsePorcelainZ(text: string): WorkingTreeEntry[] {
  if (text.length === 0) return [];
  const records = text.split("\0");
  if (records[records.length - 1] === "") records.pop();
  const files: WorkingTreeEntry[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index] ?? "";
    if (record.length < 3) continue;
    const code = record.slice(0, 2);
    const current = record.slice(3);
    const kind = classifyCode(code);
    let originalPath: string | null = null;
    if (kind === "renamed" || kind === "copied") {
      index += 1;
      originalPath = records[index] ?? null;
    }
    files.push({
      code,
      path: current.replaceAll("\\", "/"),
      originalPath: originalPath?.replaceAll("\\", "/") ?? null,
      kind,
    });
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  return files;
}