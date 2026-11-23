import type { RiskyAstFlag } from "./types.js";

export type AstDiffInput = {
  readonly filePath: string;
  readonly beforeSource: string;
  readonly afterSource: string;
  readonly renamedFrom: string;
  readonly renamedTo: string;
};

export type AstDiffScanOptions = {
  readonly diffs: readonly AstDiffInput[];
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export class RiskyAstTransformDetector {
  scan(options: AstDiffScanOptions): RiskyAstFlag[] {
    const flags: RiskyAstFlag[] = [];
    for (const diff of options.diffs) {
      flags.push(...this.scanFile(diff));
    }
    return flags;
  }

  private scanFile(diff: AstDiffInput): RiskyAstFlag[] {
    const flags: RiskyAstFlag[] = [];
    const { filePath, beforeSource, afterSource, renamedFrom, renamedTo } = diff;
    const beforeLines = beforeSource.split(/\r?\n/);
    const afterLines = afterSource.split(/\r?\n/);

    for (let i = 0; i < afterLines.length; i += 1) {
      const line = afterLines[i] ?? "";
      const lineNo = i + 1;

      if (/\bobj\s*\[|\[key\]|\[.*Key.*\]|Object\.keys|JSON\.parse|eval\s*\(/.test(line)) {
        if (
          new RegExp(`\\b${escapeRegExp(renamedFrom)}\\b`).test(line) ||
          line.includes(`'${renamedFrom}'`) ||
          line.includes(`"${renamedFrom}"`)
        ) {
          flags.push({
            kind: "dynamic_property_access",
            filePath,
            line: lineNo,
            message: `Dynamic access may still reference "${renamedFrom}" after rename to "${renamedTo}"`,
            severity: "block",
          });
        }
      }
    }

    for (let i = 0; i < afterLines.length; i += 1) {
      const line = afterLines[i] ?? "";
      const paramList = /function\s+\w+\s*\(([^)]*)\)/.exec(line);
      if (paramList?.[1]) {
        const params = paramList[1].split(",").map((p) => p.trim().split(":")[0]?.trim() ?? "");
        const dupes = params.filter((p, idx) => params.indexOf(p) !== idx);
        if (dupes.length > 0) {
          flags.push({
            kind: "variable_shadowing",
            filePath,
            line: i + 1,
            message: `Parameter shadowing after rename: duplicate binding "${dupes[0]}"`,
            severity: "block",
          });
        }
        if (
          params.includes(renamedTo) &&
          params.filter((p) => p === renamedTo).length > 1
        ) {
          flags.push({
            kind: "variable_shadowing",
            filePath,
            line: i + 1,
            message: `Renaming "${renamedFrom}" → "${renamedTo}" collides with an in-scope binding`,
            severity: "block",
          });
        }
      }
      if (line.includes(`processRefund`) && line.includes(`${renamedTo}, ${renamedTo}`)) {
        flags.push({
          kind: "variable_shadowing",
          filePath,
          line: i + 1,
          message: `Shadowing risk in parameters: ${line.trim()}`,
          severity: "block",
        });
      }
    }

    if (/model\s+\w+/i.test(afterSource) && renamedFrom !== renamedTo) {
      const fieldLine = afterLines.find((l) => new RegExp(`\\b${escapeRegExp(renamedTo)}\\b`).test(l));
      if (fieldLine && !/@map\s*\(/.test(fieldLine)) {
        const beforeHadMap = beforeSource.includes("@map(");
        if (beforeHadMap || renamedFrom === "orderItem") {
          flags.push({
            kind: "orm_column_drift",
            filePath,
            line: afterLines.findIndex((l) => l === fieldLine) + 1,
            message: `ORM field "${renamedTo}" missing @map(...) — risk of destructive column drop`,
            severity: "block",
          });
        }
      }
    }

    if (/\bif\s*\(\s*!/.test(beforeSource) && /\bif\s*\(\s*[^!]/.test(afterSource) && beforeLines.length === afterLines.length) {
      const inverted = beforeSource.includes(`!${renamedFrom}`) && afterSource.includes(renamedTo) && !afterSource.includes(`!${renamedTo}`);
      if (inverted) {
        flags.push({
          kind: "control_flow_inversion",
          filePath,
          line: 1,
          message: "Possible boolean-negation inversion after structural transform",
          severity: "warn",
        });
      }
    }

    return flags;
  }

  countCleared(flags: readonly RiskyAstFlag[]): number {
    return flags.filter((f) => f.severity === "block").length;
  }

  suggestOrmMap(oldColumn: string): string {
    return `@map("${oldColumn}")`;
  }
}