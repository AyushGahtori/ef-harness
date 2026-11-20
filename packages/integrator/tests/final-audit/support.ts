import type { CompletionWaveRequest } from "../../src/final-audit/completion-wave-controller.js";
import { InMemoryBudgetLedger } from "../../src/final-audit/budget.js";
import { createHttpPlaywrightVerifier } from "../../src/final-audit/live-route-crawler.js";
import type { PlannedFeature, RepoSnapshot, SuiteCase } from "../../src/final-audit/types.js";

export function marker(kind: "todo" | "fix"): string {
  return kind === "todo" ? ["TO", "DO"].join("") : ["FIX", "ME"].join("");
}

export function liveSecret(): string {
  return `${["sk", "_live_"].join("")}abc123`;
}

export function cleanSnapshot(): RepoSnapshot {
  return {
    entryFile: "src/main.ts",
    files: [
      { path: "src/nav.ts", content: "export const links = [{ href: \"/orders\" }];\n" },
      { path: "src/router.ts", content: "export function mount() {\n  return handleOrders(\"/orders\");\n}\n" },
      { path: "src/handlers/orders.ts", content: "export function handleOrders(path: string) {\n  return process.env.MAIL_HOST ?? path;\n}\n" },
      { path: "src/main.ts", content: "import { used } from \"./mod\";\nexport function start() { return used(); }\n" },
      { path: "src/mod.ts", content: "export function used() { return 1; }\n" },
      { path: "migrations/001_init.sql", content: "CREATE TABLE orders (id TEXT PRIMARY KEY);\n" },
      { path: ".env.example", content: "MAIL_HOST=\n" },
    ],
  };
}

export function passingCases(): SuiteCase[] {
  return [
    { id: "leaf-1", kind: "leaf", passed: true, featureId: "F-Orders" },
    { id: "journey-1", kind: "feature_journey", passed: true, featureId: "F-Orders" },
    { id: "sealed-1", kind: "sealed_hidden", passed: true, featureId: "F-Orders" },
  ];
}

export function emptyAudit(): {
  missing: [];
  stubbed: [];
  unhandled_edge_cases: [];
  weak_checks: [];
  verdict: "complete";
} {
  return { missing: [], stubbed: [], unhandled_edge_cases: [], weak_checks: [], verdict: "complete" };
}

export function doneFeature(id = "F-Orders", journeys: readonly string[] = ["order lunch before cutoff"]): PlannedFeature {
  return { id, state: "DONE", mergedTo: "harness/integration", journeys };
}

export function cliBoot(): CompletionWaveRequest["boot"] {
  let next = 1;
  const alive = new Set<number>();
  return {
    async boot() {
      const pid = next;
      next += 1;
      alive.add(pid);
      return {
        baseUrl: null,
        pid,
        alive: () => alive.has(pid),
        async stop() {
          alive.delete(pid);
        },
      };
    },
  };
}

export function waveRequest(overrides: Partial<CompletionWaveRequest> = {}): CompletionWaveRequest {
  const ledger = overrides.ledger ?? new InMemoryBudgetLedger();
  const request: CompletionWaveRequest = {
    projectId: "kitchen",
    integrationRef: "harness/integration",
    waves: [{ id: "wave-1", features: [doneFeature()] }],
    snapshot: cleanSnapshot(),
    catalog: { requirementIds: ["SI-1"], ruleIds: ["X-01"], checkIds: ["leaf-1"] },
    shardInputs: {
      features: [
        {
          id: "F-Orders",
          requirements: [{ id: "SI-1", text: "Staff can order lunch before the cutoff" }],
          files: [{ path: "src/mod.ts", content: "export function used() { return 1; }\n" }],
          diff: "diff -- src/mod.ts",
        },
      ],
      seams: [],
      rules: [],
    },
    kind: "cli",
    routes: [],
    commands: [{ argv: ["meal", "--help"], json: false }],
    operations: [],
    boot: cliBoot(),
    browser: createHttpPlaywrightVerifier(),
    commandsExec: {
      async exec() {
        return { exitCode: 0, stdout: "usage\n", stderr: "" };
      },
    },
    checkRunner: {
      async run() {
        return { passed: true, detail: "ok" };
      },
    },
    verifier: {
      async runCombined() {
        return { passed: true, cases: passingCases() };
      },
    },
    model: {
      async audit() {
        return emptyAudit();
      },
    },
    fixExecutor: {
      async apply() {
        return { changedFiles: [] };
      },
    },
    ledger,
    ledgerRecap: {
      chosenForYou: [{ id: "D-1", summary: "Email the catering totals" }],
      deferred: [{ id: "D-2", summary: "Native mobile app" }],
    },
    spend: {
      codingUnits: 800n,
      paperworkUnits: 100n,
      connections: [{ connectionId: "chatgpt-personal", costUnits: 20n, windowUnits: 100n, usedUnits: 20n }],
    },
    projectBudgetUnits: 10_000n,
    auditCostPerShardUnits: 1n,
    defaultFixCostUnits: 1n,
  };
  return { ...request, ...overrides };
}
