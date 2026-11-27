import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  AttemptMcpServer,
  LeaseFencedError,
  MemoryReadSetStore,
  SqliteReadSetStore,
  openReadSetDatabase,
} from "../src/index.js";
import type {
  ArtifactLogPage,
  ArtifactRecord,
  AttemptMcpDependencies,
  CandidateV1,
  CodeLookupResult,
  DocFetchResult,
  KnowledgeNode,
  KnowledgeSearchFilters,
  NeighborQueryResult,
  PullPatternEvent,
  ReadSetStore,
  SandboxedCommandResult,
  SecurityAnomalyKind,
  SubmitCandidateInput,
  TaskPacketV1,
} from "../src/index.js";

export interface WorldOptions {
  tools?: string[];
  goal?: string;
  quotas?: {
    maxToolCalls?: number;
    kbMaxCalls?: number;
    kbMaxReturnedTokens?: number;
    maxSearchReads?: number;
  };
  memory?: boolean;
  worktreePath?: string;
  baseCommit?: string;
  bearerToken?: string;
  projectId?: string;
  taskId?: string;
  attemptId?: string;
  epoch?: number;
  kbPull?: AttemptMcpDependencies["kbPull"];
}

export interface World {
  server: AttemptMcpServer;
  db?: DatabaseSync;
  store: ReadSetStore;
  notes: string[];
  mutations: string[];
  security: Array<{ kind: SecurityAnomalyKind; detail?: string }>;
  pulls: PullPatternEvent[];
  submitted: SubmitCandidateInput[];
  snapshots: string[][];
  runs: Array<{ command: string; cwd?: string }>;
  asks: Array<{ question: string; criterionId?: string }>;
  disputes: Array<{ checkId: string; counterexample: string }>;
  intents: Array<{ packageName: string; versionRange: string; rationale: string }>;
  blocked: string[];
  services: string[];
  docs: string[];
  logReads: Array<{ artifactId: string; query?: string; range?: { start?: number; end?: number } }>;
  snippets: string[];
  fenced: { current: boolean };
  packet: TaskPacketV1;
}

const VERSIONS: Record<string, KnowledgeNode[]> = {
  R17: [
    node("R17", 1, "rule", "Cutoff rule", "Orders close at 10:45 Europe/Berlin", "h-r17-1"),
    node("R17", 2, "rule", "Cutoff rule", "Orders close at 11:00 Europe/Berlin", "h-r17-2"),
  ],
  "C-014": [
    node("C-014", 1, "contract", "kitchen-totals", "contract schema v1", "h-c-1"),
    node("C-014", 2, "contract", "kitchen-totals", "contract schema v2", "h-c-2"),
  ],
  "SI-212": [node("SI-212", 1, "spec_item", "Locked totals", "Show locked totals after cutoff", "h-si-1")],
  T03: [node("T03", 1, "task", "Map totals", "export function toPrintRows(totals: Totals): PrintRow[]", "h-t03-1")],
  T07: [node("T07", 1, "task", "Kitchen print page", "Print today's totals", "h-t07-1")],
  D1: [node("D1", 1, "decision", "Cutoff decision", "Quote: the office closes the book at 10:45.", "h-d1-1")],
  "AC-31-HIDDEN": [
    node(
      "AC-31-HIDDEN",
      1,
      "check",
      "Hidden check",
      "SEALED_EXPECTATION_ALPHA must equal 9",
      "h-hidden-1",
      "held_back",
      { expectation: "SEALED_EXPECTATION_ALPHA" },
    ),
  ],
};

function node(
  id: string,
  version: number,
  kind: string,
  title: string,
  text: string,
  contentHash: string,
  visibility: "visible" | "held_back" = "visible",
  fields: Record<string, unknown> = {},
): KnowledgeNode {
  return {
    id,
    kind,
    version,
    contentHash,
    title,
    text,
    fields,
    status: "active",
    visibility,
  };
}

function latestOf(id: string): KnowledgeNode | undefined {
  const versions = VERSIONS[id];
  if (!versions || versions.length === 0) return undefined;
  return versions[versions.length - 1];
}

function versionOf(id: string, version: number | undefined, latest: boolean): KnowledgeNode | null {
  const versions = VERSIONS[id];
  if (!versions) return null;
  if (latest || version === undefined) return latestOf(id) ?? null;
  return versions.find((item) => item.version === version) ?? null;
}

function neighborsOf(id: string): NeighborQueryResult | null {
  const source = latestOf(id) ?? null;
  if (!source && id !== "T07") return source ? { source, sets: [] } : null;
  if (!source) return null;
  if (id !== "T07") return { source, sets: [] };
  const hidden = latestOf("AC-31-HIDDEN");
  const dependency = latestOf("T03");
  return {
    source,
    sets: [
      {
        node: "T07",
        dir: "out",
        type: "depends_on",
        version: 4,
        neighbors: dependency ? [dependency] : [],
      },
      {
        node: "T07",
        dir: "out",
        type: "verifies",
        version: 2,
        neighbors: hidden ? [hidden] : [],
      },
      {
        node: "T07",
        dir: "in",
        type: "implements",
        version: 0,
        neighbors: [],
      },
    ],
  };
}

function matches(entry: KnowledgeNode, query: string, filters: KnowledgeSearchFilters | undefined): boolean {
  if (filters?.kind !== undefined && entry.kind !== String(filters.kind)) return false;
  const haystack = `${entry.title}\n${entry.text}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 0)
    .every((term) => haystack.includes(term));
}

const ARTIFACTS: Record<string, ArtifactRecord> = {
  "ART-OK": {
    id: "ART-OK",
    projectId: "proj-a",
    status: "accepted",
    kind: "schema",
    visibility: "visible",
    declared: true,
    content: "accepted totals schema",
    slices: { schema: "schema-slice" },
    source: "artifact:ART-OK",
  },
  "ART-DRAFT": {
    id: "ART-DRAFT",
    projectId: "proj-a",
    status: "draft",
    kind: "note",
    visibility: "visible",
    declared: true,
    content: "draft worker note",
    source: "artifact:ART-DRAFT",
  },
  "ART-OTHER": {
    id: "ART-OTHER",
    projectId: "proj-b",
    status: "accepted",
    kind: "schema",
    visibility: "visible",
    declared: false,
    content: "other project secret",
    source: "artifact:ART-OTHER",
  },
  "ART-LOCAL": {
    id: "ART-LOCAL",
    projectId: "proj-a",
    status: "accepted",
    kind: "schema",
    visibility: "visible",
    declared: false,
    content: "undeclared local artifact",
    source: "artifact:ART-LOCAL",
  },
  "checks-sealed/AC-31": {
    id: "checks-sealed/AC-31",
    projectId: "proj-a",
    status: "sealed",
    kind: "checks-sealed",
    visibility: "held_back",
    declared: true,
    content: "SEALED_EXPECTATION_ALPHA",
    source: "artifact:checks-sealed/AC-31",
  },
};

const LOGS: Record<string, ArtifactLogPage> = {
  "LOG-1": {
    artifactId: "LOG-1",
    text: "first failure assertion",
    visibility: "visible",
    kind: "log",
    source: "log:LOG-1",
  },
  "LOG-SEALED": {
    artifactId: "LOG-SEALED",
    text: "SEALED_EXPECTATION_ALPHA",
    visibility: "held_back",
    kind: "checks-sealed",
    source: "log:LOG-SEALED",
  },
};

export function createWorld(options: WorldOptions = {}): World {
  const attemptId = options.attemptId ?? "A-T07-1";
  const projectId = options.projectId ?? "proj-a";
  const taskId = options.taskId ?? "T07";
  const epoch = options.epoch ?? 5;
  const baseCommit = options.baseCommit ?? "4c1e000000000000000000000000000000000000";
  const worktreePath = options.worktreePath ?? path.join(tmpdir(), "ef-mcp-missing-worktree");
  const fenced = { current: false };
  const notes: string[] = [];
  const mutations: string[] = [];
  const security: World["security"] = [];
  const pulls: PullPatternEvent[] = [];
  const submitted: SubmitCandidateInput[] = [];
  const snapshots: string[][] = [];
  const runs: World["runs"] = [];
  const asks: World["asks"] = [];
  const disputes: World["disputes"] = [];
  const intents: World["intents"] = [];
  const blocked: string[] = [];
  const services: string[] = [];
  const docs: string[] = [];
  const logReads: World["logReads"] = [];
  const snippets: string[] = [];

  let db: DatabaseSync | undefined;
  let store: ReadSetStore;
  if (options.memory) {
    store = new MemoryReadSetStore();
  } else {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "ef-mcp-state-")), "state.db");
    db = openReadSetDatabase(file);
    store = new SqliteReadSetStore(db);
  }

  const packet: TaskPacketV1 = {
    schema: "task-packet@1",
    task: taskId,
    attempt: 2,
    epoch,
    brief_version: 3,
    base: { branch: "harness/f/F12", commit: baseCommit },
    goal: options.goal ?? "Show today's totals on /kitchen",
    write_scope: ["src/**", "tests/kitchen/print.*"],
    must: [{ id: "R17", v: 1, text: "Cutoff is 10:45 Europe/Berlin" }],
    contracts: [{ id: "C-014", v: 1, role: "consume" }],
    checks_visible: ["AC-31"],
    checks_hidden_count: 1,
    visible_examples: [{ id: "AC-31", text: "Totals grouped by dish" }],
    skills: [{ id: "accessible-ui", digest: "sha256:skill" }],
    tools: options.tools ?? ["harness.*", "kb.*"],
    dependencies: [
      { artifactId: "ART-OK", projectId },
      { artifactId: "ART-DRAFT", projectId },
      { artifactId: "checks-sealed/AC-31", projectId },
    ],
  };

  const dependencies: AttemptMcpDependencies = {
    epoch: {
      assertCurrentEpoch: async () => {
        if (fenced.current) throw new LeaseFencedError();
      },
    },
    knowledge: {
      currentRevision: async () => 214,
      search: async (input) => {
        const hits: KnowledgeNode[] = [];
        for (const versions of Object.values(VERSIONS)) {
          const current = versions[versions.length - 1];
          if (!current) continue;
          if (matches(current, input.query, input.filters)) hits.push(current);
        }
        return hits;
      },
      get: async (input) => versionOf(input.id, input.version, input.latest),
      neighbors: async (input) => neighborsOf(input.id),
      contract: async (input) => versionOf(input.id, input.version, input.latest),
      listRulesForTags: async (input) => {
        if (!input.tags.includes("ui")) return [];
        return [{ id: "RULE-A11Y", title: "Accessible UI" }];
      },
      why: async (input) => {
        if (!VERSIONS[input.id] && input.id !== "R17") return null;
        const root = versionOf(input.id, 1, false);
        const hidden = latestOf("AC-31-HIDDEN");
        const decision = latestOf("D1");
        const nodes = [root, decision, hidden].filter((item): item is KnowledgeNode => item !== null);
        return { nodes };
      },
    },
    submissions: {
      submitAndAcceptCandidate: async (input) => {
        mutations.push("submit");
        submitted.push(input);
        return { receiptId: "VR-7781", accepted: true };
      },
    },
    docs: {
      fetchDocs: async (urlOrPkg) => {
        docs.push(urlOrPkg);
        const result: DocFetchResult = {
          source: urlOrPkg,
          fetchedAt: "2026-11-16T00:00:00Z",
          markdown: `docs for ${urlOrPkg}`,
          contentHash: "h-doc",
        };
        return result;
      },
    },
    runner: {
      run: async (input) => {
        mutations.push("run");
        const recorded = input.cwd === undefined ? { command: input.command } : { command: input.command, cwd: input.cwd };
        runs.push(recorded);
        const result: SandboxedCommandResult = {
          command: input.command,
          cwd: input.cwd ?? worktreePath,
          exitCode: 0,
          summary: "1 passed",
          artifactId: "LOG-1",
        };
        return result;
      },
    },
    artifacts: {
      readResult: async (input) => ARTIFACTS[input.artifactId] ?? null,
      readLog: async (input) => {
        const recorded =
          input.range === undefined
            ? input.query === undefined
              ? { artifactId: input.artifactId }
              : { artifactId: input.artifactId, query: input.query }
            : input.query === undefined
              ? { artifactId: input.artifactId, range: input.range }
              : { artifactId: input.artifactId, query: input.query, range: input.range };
        logReads.push(recorded);
        return LOGS[input.artifactId] ?? null;
      },
    },
    startService: {
      startService: async (input) => {
        services.push(input.name);
        return { url: `http://env-91.localhost:41010/${input.name}` };
      },
    },
    askOwner: {
      askOwner: async (input) => {
        const asked = input.criterionId === undefined ? { question: input.question } : { question: input.question, criterionId: input.criterionId };
        asks.push(asked);
        return { mailboxId: "MBX-1" };
      },
    },
    disputeTest: {
      disputeTest: async (input) => {
        disputes.push({ checkId: input.checkId, counterexample: input.counterexample });
        return { mailboxId: "MBX-2" };
      },
    },
    codeLookup: {
      lookup: async (input) => {
        if (input.symbolOrPath !== "toPrintRows") return null;
        const card: CodeLookupResult = {
          symbolOrPath: input.symbolOrPath,
          signatures: "toPrintRows(totals: Totals): PrintRow[]",
          moduleCard: "Accepted mapper at src/kitchen/to-print-rows.ts",
          nodeId: "T03",
          version: 1,
          contentHash: "h-t03-1",
          visibility: "visible",
        };
        return card;
      },
    },
    telemetry: {
      reportProgress: async (input) => {
        notes.push(input.note);
      },
    },
    dependencyIntents: {
      append: async (intent) => {
        intents.push({
          packageName: intent.packageName,
          versionRange: intent.versionRange,
          rationale: intent.rationale,
        });
        return { intentId: "DEP-1" };
      },
    },
    blocked: {
      flagBlocked: async (input) => {
        blocked.push(input.reason);
        return { alertId: "ALERT-1" };
      },
    },
    snapshot: {
      snapshot: async (input) => {
        snapshots.push([...input.changedPaths]);
        return { commitSha: "9ab2snapshot" };
      },
    },
    readSets: store,
    pullPatterns: {
      record: (event) => {
        pulls.push(event);
      },
    },
    security: {
      record: (event) => {
        security.push(event.detail === undefined ? { kind: event.kind } : { kind: event.kind, detail: event.detail });
      },
    },
    snippet: (text, query) => {
      snippets.push(text);
      const at = text.toLowerCase().indexOf(query.toLowerCase());
      if (at < 0) return text.slice(0, 80);
      return text.slice(Math.max(0, at - 10), at + query.length + 10);
    },
    ...(options.kbPull ? { kbPull: options.kbPull } : {}),
  };

  const server = new AttemptMcpServer({
    lease: {
      projectId,
      taskId,
      attemptId,
      epoch,
      bearerToken: options.bearerToken ?? "token-a",
      worktreePath,
      baseCommit,
    },
    packet,
    dependencies,
    ...(options.quotas ? { quotas: options.quotas } : {}),
  });

  return {
    server,
    db,
    store,
    notes,
    mutations,
    security,
    pulls,
    submitted,
    snapshots,
    runs,
    asks,
    disputes,
    intents,
    blocked,
    services,
    docs,
    logReads,
    snippets,
    fenced,
    packet,
  };
}

export function candidate(overrides: Partial<CandidateV1> = {}): CandidateV1 {
  return {
    schema: "candidate@1",
    task: "T07",
    attempt: 2,
    epoch: 5,
    changed_paths: ["src/ok.ts"],
    dependency_intents: [],
    note: "done",
    ...overrides,
  };
}
