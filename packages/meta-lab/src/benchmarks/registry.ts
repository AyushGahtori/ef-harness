import { SEVEN_SUITE_DEFINITIONS } from "./seven-suite-definitions.js";
import type { BenchmarkFilter, SuiteDefinition, SuiteId } from "./types.js";

export class MetaLabBenchmarkRegistry {
  private readonly suites: ReadonlyMap<SuiteId, SuiteDefinition>;

  constructor(definitions: readonly SuiteDefinition[] = SEVEN_SUITE_DEFINITIONS) {
    this.suites = new Map(definitions.map((suite) => [suite.id, suite]));
    if (definitions.length !== 7) {
      throw new Error(`expected 7 canonical suites, got ${definitions.length}`);
    }
  }

  listSuites(filter: BenchmarkFilter = {}): readonly SuiteDefinition[] {
    return [...this.suites.values()].filter((suite) => matchesSuite(suite, filter));
  }

  getSuite(id: SuiteId): SuiteDefinition {
    const suite = this.suites.get(id);
    if (!suite) {
      throw new Error(`unknown suite ${id}`);
    }
    return suite;
  }

  listCases(filter: BenchmarkFilter = {}): readonly {
    readonly suiteId: SuiteId;
    readonly caseId: string;
    readonly definition: SuiteDefinition["cases"][number];
  }[] {
    const rows: {
      suiteId: SuiteId;
      caseId: string;
      definition: SuiteDefinition["cases"][number];
    }[] = [];
    for (const suite of this.listSuites(filter)) {
      if (filter.suite && suite.id !== filter.suite) {
        continue;
      }
      for (const benchmarkCase of suite.cases) {
        if (filter.split && benchmarkCase.split !== filter.split) {
          continue;
        }
        if (filter.tag && !benchmarkCase.tags.includes(filter.tag)) {
          continue;
        }
        if (filter.smoke === true && !benchmarkCase.smoke) {
          continue;
        }
        rows.push({ suiteId: suite.id, caseId: benchmarkCase.id, definition: benchmarkCase });
      }
    }
    return rows;
  }

  manifestLedger(): readonly { readonly suiteId: SuiteId; readonly suiteVersion: string; readonly manifestDigest: string }[] {
    return [...this.suites.values()].map((suite) => ({
      suiteId: suite.id,
      suiteVersion: suite.suiteVersion,
      manifestDigest: suite.manifestDigest,
    }));
  }
}

function matchesSuite(suite: SuiteDefinition, filter: BenchmarkFilter): boolean {
  if (filter.suite && suite.id !== filter.suite) {
    return false;
  }
  if (filter.split && !suite.cases.some((benchmarkCase) => benchmarkCase.split === filter.split)) {
    return false;
  }
  const tag = filter.tag;
  if (tag && !suite.cases.some((benchmarkCase) => benchmarkCase.tags.includes(tag))) {
    return false;
  }
  if (filter.smoke === true && !suite.cases.some((benchmarkCase) => benchmarkCase.smoke)) {
    return false;
  }
  return true;
}