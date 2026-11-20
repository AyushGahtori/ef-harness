import type { AddedLine } from "./diff-lines.js";
import { makeFinding } from "./findings.js";
import { isGeneratedOrSeed, normalizePath } from "./path-match.js";
import type { AllowedEscape, StaticAuditFinding } from "./types.js";

export interface EscapeFile {
  readonly path: string;
  readonly lines: readonly string[];
  readonly added: readonly AddedLine[];
}

export interface EscapeScan {
  readonly findings: readonly StaticAuditFinding[];
  readonly allowed: readonly AllowedEscape[];
}

const ESCAPE_PATTERNS: readonly { kind: string; pattern: RegExp }[] = [
  { kind: "ts-ignore", pattern: /@ts-ignore\b/ },
  { kind: "ts-expect-error", pattern: /@ts-expect-error\b/ },
  { kind: "ts-nocheck", pattern: /@ts-nocheck\b/ },
  { kind: "as-any", pattern: /\bas\s+any\b/ },
  { kind: "explicit-any", pattern: /:\s*any\b/ },
  { kind: "eslint-disable", pattern: /\beslint-disable\b/ },
];

export function scanTypeEscapes(
  files: readonly EscapeFile[],
  justifiedNotes: readonly string[],
  generated: readonly string[],
  seeds: readonly string[],
): EscapeScan {
  const allowedNotes = new Set(justifiedNotes);
  const findings: StaticAuditFinding[] = [];
  const allowed: AllowedEscape[] = [];
  for (const file of files) {
    const path = normalizePath(file.path);
    if (isGeneratedOrSeed(path, generated, seeds)) continue;
    for (const added of file.added) {
      const note = justifiedNote(file.lines, added.line, allowedNotes);
      for (const escape of ESCAPE_PATTERNS) {
        if (!escape.pattern.test(added.text)) continue;
        if (note) {
          allowed.push({ file: path, line: added.line, kind: escape.kind, noteId: note });
          continue;
        }
        findings.push(
          makeFinding({
            ruleId: "check8.type-escape",
            file: path,
            line: added.line,
            column: 1,
            snippet: added.text.trim().slice(0, 180),
            message: `Type or lint escape "${escape.kind}" has no justified task-note reference.`,
            remediation:
              "Remove the escape, or attach a kernel-approved task note such as // reason: T07-note-1.",
          }),
        );
      }
    }
  }
  return { findings, allowed };
}

function justifiedNote(lines: readonly string[], line: number, allowed: ReadonlySet<string>): string | null {
  const candidates = [lines[line - 1] ?? "", lines[line - 2] ?? ""];
  for (const text of candidates) {
    const notes = text.match(/\bT\d+-note-\d+\b/g) ?? [];
    for (const note of notes) {
      if (allowed.has(note)) return note;
    }
  }
  return null;
}
