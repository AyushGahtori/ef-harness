import type { CodeIndexSymbol } from "../../src/l2-cards/types.js";
import type { L0GroundTruthPort } from "../../src/l2-cards/ports.js";
import { InMemoryCodeMap } from "../../src/l2-cards/in-memory.js";

export function buildLargeFixture(requestTerms: string): {
  files: string[];
  ranks: Map<string, number>;
  sources: Map<string, string>;
  codeMap: InMemoryCodeMap;
} {
  const files: string[] = [];
  const ranks = new Map<string, number>();
  const sources = new Map<string, string>();
  const symbolSearch = new Map<string, string[]>();

  for (let i = 0; i < 200; i += 1) {
    const path = `src/modules/mod-${i}.ts`;
    files.push(path);
    ranks.set(path, Math.random());
    const relevant = i < 5 ? "pdf page-break achievement" : "utility helpers";
    sources.set(path, `// ${relevant}\nexport function fn${i}() {}\n`);
    if (i < 8) {
      symbolSearch.set(`renderResumePdf`, ["src/pdf/resume.ts"]);
      symbolSearch.set(`achievement`, [path]);
    }
  }
  files.push("src/pdf/resume.ts");
  ranks.set("src/pdf/resume.ts", 0.99);
  sources.set(
    "src/pdf/resume.ts",
    "export function renderResumePdf() {}\nexport function fixPdfPageBreak() {}\n",
  );
  symbolSearch.set("renderResumePdf", ["src/pdf/resume.ts"]);
  symbolSearch.set("fixPdfPageBreak", ["src/pdf/resume.ts"]);

  const symbolsByPath = new Map<string, CodeIndexSymbol[]>([
    [
      "src/pdf/resume.ts",
      [
        {
          fileHash: "abc",
          name: "renderResumePdf",
          kind: "function",
          line: 1,
          exported: true,
        },
        {
          fileHash: "abc",
          name: "fixPdfPageBreak",
          kind: "function",
          line: 2,
          exported: true,
        },
      ],
    ],
  ]);

  const codeMap = new InMemoryCodeMap(files, ranks, symbolsByPath, symbolSearch);
  void requestTerms;
  return { files, ranks, sources, codeMap };
}

export class TestL0GroundTruth implements L0GroundTruthPort {
  readonly commitSha = "cafebabe";

  constructor(
    private readonly paths: ReadonlySet<string>,
    private readonly scripts: ReadonlySet<string>,
    private readonly churn: ReadonlyMap<string, number>,
    private readonly docMtime: ReadonlyMap<string, number>,
    private readonly codeMtime: ReadonlyMap<string, number>,
  ) {}

  existingPaths(): ReadonlySet<string> {
    return this.paths;
  }

  npmScripts(): ReadonlySet<string> {
    return this.scripts;
  }

  churnByPath(): ReadonlyMap<string, number> {
    return this.churn;
  }

  docLastModifiedMs(docPath: string): number | null {
    return this.docMtime.get(docPath) ?? null;
  }

  codeLastModifiedMs(filePath: string): number | null {
    return this.codeMtime.get(filePath) ?? null;
  }
}