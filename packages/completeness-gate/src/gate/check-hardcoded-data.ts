import { makeFinding } from "./findings.js";
import { findFakeStrings, findLiteralHits } from "./literals.js";
import { isFixturePath, isGeneratedOrSeed, lineSnippet, matchAny } from "./path-match.js";
import type { StaticAuditFinding, StaticDataDeclaration } from "./types.js";

const MOCK_PACKAGES = ["@faker-js/faker", "msw", "sinon", "vitest"] as const;

export interface HardcodedFile {
  readonly path: string;
  readonly content: string;
}

export function scanHardcodedData(
  files: readonly HardcodedFile[],
  staticData: readonly StaticDataDeclaration[],
  generated: readonly string[],
  seeds: readonly string[],
): StaticAuditFinding[] {
  const findings: StaticAuditFinding[] = [];
  for (const file of files) {
    if (isFixturePath(file.path, seeds) || isGeneratedOrSeed(file.path, generated, seeds)) {
      continue;
    }
    const declared = staticData.some((entry) => matchAny(file.path, [entry.pathGlob]));
    for (const hit of findFakeStrings(file.content)) {
      findings.push(
        makeFinding({
          ruleId: "check6.fake-data",
          file: file.path,
          line: hit.line,
          column: hit.column,
          snippet: lineSnippet(file.content, hit.line),
          message: `Fake data string "${hit.value}" is outside test and fixture paths.`,
          remediation: "Load real or plan-declared data, or move the fixture into a kernel-declared fixture path.",
        }),
      );
    }
    for (const mock of findMockImports(file.content)) {
      findings.push(
        makeFinding({
          ruleId: "check6.mock-import",
          file: file.path,
          line: mock.line,
          column: mock.column,
          snippet: lineSnippet(file.content, mock.line),
          message: `Production code imports mock library "${mock.specifier}".`,
          remediation: "Remove the mock library import from production code.",
        }),
      );
    }
    if (declared) continue;
    for (const hit of findLiteralHits(file.content)) {
      const message =
        hit.kind === "large-constant"
          ? `Constant collection has ${hit.count} entries and is not in the plan static_data manifest.`
          : `Hard-coded ${hit.count} structured records exceed the limit of 5 and are not declared static data.`;
      findings.push(
        makeFinding({
          ruleId: "check6.hardcoded-records",
          file: file.path,
          line: hit.line,
          column: hit.column,
          snippet: lineSnippet(file.content, hit.line),
          message,
          remediation:
            "Move the list into a plan-declared static_data path or load it from the database. Status maps under 20 entries stay allowed.",
        }),
      );
    }
  }
  return findings;
}

function findMockImports(source: string): { specifier: string; line: number; column: number }[] {
  const hits: { specifier: string; line: number; column: number }[] = [];
  const pattern =
    /(?:import|export)\s+(?:type\s+)?[\s\S]*?\sfrom\s+['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)|import\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(pattern)) {
    const specifier = match[1] ?? match[2] ?? match[3] ?? match[4] ?? "";
    if (!isMockSpecifier(specifier)) continue;
    const index = match.index ?? 0;
    const line = source.slice(0, index).split(/\r?\n/).length;
    hits.push({ specifier, line, column: 1 });
  }
  return hits;
}

function isMockSpecifier(specifier: string): boolean {
  return MOCK_PACKAGES.some((name) => specifier === name || specifier.startsWith(`${name}/`));
}
