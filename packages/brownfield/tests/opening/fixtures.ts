import type {
  BrownfieldL0RepoScannerPort,
  CompactCodeMapQueryServicePort,
  DiscoverySessionCoordinatorPort,
  GitLogPort,
  L0StackSnapshot,
  ModuleCardCacheEnginePort,
  RepoFileReaderPort,
  SqlExplainPort,
  StaleDocsDetectorPort,
  TimingBenchmarkPort,
} from "../../src/opening/index.js";

export const resumeChangerL0: L0StackSnapshot = {
  languagePrimary: "TypeScript",
  frameworks: ["next"],
  orms: ["drizzle-orm"],
  uiKits: ["tailwindcss"],
  testRunners: ["vitest"],
  testFileCount: 24,
  authLibraries: ["next-auth"],
  stackSummaryLine: "TypeScript · Next.js · Drizzle · Tailwind · Vitest",
  configFiles: [
    "package.json",
    "tsconfig.json",
    "eslint.config.mjs",
    ".prettierrc",
    "drizzle.config.ts",
  ],
  contributorDocPaths: ["AGENTS.md", "CONTRIBUTING.md"],
};

export class FixtureL0Scanner implements BrownfieldL0RepoScannerPort {
  constructor(private readonly snapshot: L0StackSnapshot = resumeChangerL0) {}
  scanSummary(_repoRoot: string): L0StackSnapshot {
    void _repoRoot;
    return this.snapshot;
  }
}

const CODE_MAP_MODULES = [
  { id: "auth", label: "src/auth", paths: ["src/auth/options.ts"], hubScore: 0.8 },
  { id: "dashboard", label: "src/app/dashboard", paths: ["src/app/dashboard/data.ts"], hubScore: 0.7 },
  { id: "export", label: "src/features/export", paths: ["src/features/export/csv.ts"], hubScore: 0.65 },
  { id: "billing-legacy", label: "LegacyBilling.ts", paths: ["src/LegacyBilling.ts"], hubScore: 0.3 },
  { id: "billing-v2", label: "v2/BillingService", paths: ["src/v2/BillingService.ts"], hubScore: 0.6 },
  { id: "ui", label: "src/components/ui", paths: ["src/components/ui/button.tsx"], hubScore: 0.5 },
] as const;

export class FixtureCodeMap implements CompactCodeMapQueryServicePort {
  listModulesForPaths(paths: readonly string[]): { readonly id: string; readonly label: string; readonly paths: readonly string[]; readonly hubScore: number }[] {
    const broadRoots = new Set(["src", "packages", "apps"]);
    if (paths.some((p) => broadRoots.has(p))) {
      return [...CODE_MAP_MODULES];
    }
    const matched = CODE_MAP_MODULES.filter((m) =>
      paths.some(
        (p) =>
          m.id === p ||
          m.paths.some((mp) => mp.startsWith(p) || p.startsWith(m.label) || mp.includes(p.slice(4))),
      ),
    );
    return matched.length > 0 ? [...matched] : [...CODE_MAP_MODULES];
  }

  entryRoutes() {
    return ["/", "/dashboard", "/login"];
  }
}

export class FixtureModuleCards implements ModuleCardCacheEnginePort {
  cardsForModuleIds(ids: readonly string[]) {
    return ids.map((id) => ({
      moduleId: id,
      purpose: `${id} module`,
      keyExports: [`${id}Entry`],
    }));
  }
}

export class FixtureStaleDocs implements StaleDocsDetectorPort {
  detectStaleDocs() {
    return [{ path: "README.md", reason: "npm start mentioned but script missing" }];
  }
}

export class FixtureDiscovery implements DiscoverySessionCoordinatorPort {
  readonly calls: { workItemId: string; count: number }[] = [];

  preSettleObservedCriteria(input: { workItemId: string; settlements: readonly unknown[] }) {
    this.calls.push({ workItemId: input.workItemId, count: input.settlements.length });
    return { applied: input.settlements.length, skippedGreenfieldStackQuestions: true as const };
  }
}

export class FixtureFileReader implements RepoFileReaderPort {
  private readonly files: Readonly<Record<string, string>>;

  constructor(files: Readonly<Record<string, string>>) {
    this.files = files;
  }

  readText(relativePath: string): string | null {
    return this.files[relativePath] ?? null;
  }

  listPathsMatching(globPrefix: string): readonly string[] {
    return Object.keys(this.files).filter((p) => p.startsWith(globPrefix));
  }
}

export class FixtureGitLog implements GitLogPort {
  recentCommitSubjects() {
    return [
      "feat(auth): add magic links",
      "fix(dashboard): trim query",
      "chore: bump vitest",
    ];
  }
}

export class FixtureTiming implements TimingBenchmarkPort {
  measureP95() {
    return 840;
  }
}

export class FixtureSqlExplain implements SqlExplainPort {
  explainAnalyze(query: string) {
    const seq = /orders/i.test(query);
    return {
      timingMsP95: 0,
      explain: [
        {
          planLine: seq ? "SCAN TABLE orders" : "SEARCH TABLE orders USING INDEX idx_orders_user_id",
          usesSequentialScan: seq,
          indexName: seq ? null : "idx_orders_user_id",
        },
      ],
      capturedAtMs: Date.now(),
      engine: "sqlite" as const,
    };
  }
}