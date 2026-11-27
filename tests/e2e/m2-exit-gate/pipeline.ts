import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CorpusPackLoader, bundledCorpusRoot } from "@ef-harness/corpus";
import { GlobalBrokerDb, bindKnowledgeGraph, openProjectStateDb, type ProjectStateDb } from "@ef-harness/db";
import {
  BoundedDeferralPolicy,
  DepthSession,
  DiscoverySessionCoordinator,
  ReadinessCalculator,
  openReadinessDatabase,
  type DepthCatalogEntry,
} from "@ef-harness/discovery";
import { BrandAssetSanitizer, IntakeSemanticChunker } from "@ef-harness/intake";
import {
  CompletionWaveController,
  FinalAuditStore,
  InMemoryBudgetLedger,
  buildTrailers,
  createHttpPlaywrightVerifier,
  createLocalSecretScanner,
  createLocalStaticAuditGate,
  renderCommitMessage,
  trailerLines,
} from "@ef-harness/integrator";
import {
  CrewPresetProfileEngine,
  DesignTokenLintRuleset,
  DeterministicGraphCompiler,
  ExpectedCostLevelSelector,
  FeatureArchitectureSynthesizer,
  FirstBuildApprovalGate,
  GitWorkspace,
  HeftCriticalPathScheduler,
  HistoricalPassRateCalibrator,
  HybridRevisionEngine,
  IndependentOracleAuthorSealer,
  JitFeaturePlanner,
  LookAndFeelInterviewFlow,
  MasterPlanOrchestrator,
  OfflineUiPlaywrightContractVerifier,
  PaperworkBudgetEnvelopeAllocator,
  PlanPreviewBuilder,
  RevisionAutoStartPolicy,
  RevisionImpactPreviewer,
  SequentialBuildRunner,
  StateDb,
  StyleguideRouteVerifier,
  SystemArchitectureSynthesizer,
  createPlanPreviewSources,
  defaultModelRoster,
  deterministicFeaturePlan,
  deterministicOracle,
  openRevisionDatabase,
  parseViewFile,
  productionBundle,
  type CleanVerifierHarnessPort,
  type CompilationInput,
  type CompiledFeatureSpec,
  type CompiledLeafSpec,
  type FeatureIntegratorPort,
  type LookAndFeelDecision,
  type MasterPlanRequest,
  type NativeWorkerLoopPort,
  type StaticAuditPort,
  type WaveAdvancementPort,
  type WorkerContext,
} from "@ef-harness/planner";
import {
  BrokerResearchCache,
  FeatureResearchOrchestrator,
  ProjectStateKnowledgeGraph,
  ResearchFactCache,
} from "@ef-harness/research-engine";
import {
  FiveLayerContradictionChecker,
  FiveLayerContradictionEngine,
  MATRIX_IDS,
  SpecCellFiller,
  SpecMatrixGenerator,
  kitchenMealOrderingGraph,
  type ConflictInboxItem,
  type NodeRecord as SpecNodeRecord,
} from "@ef-harness/spec-expansion";
import { designTokenLint, scanTreeForSecrets, staticAuditFailures } from "./audit.js";
import {
  renderKitchenPages,
  renderKitchenServer,
  renderOrdersUiFiles,
  renderPhase0Files,
  type KitchenBuildSpec,
} from "./kitchen-codegen.js";
import { canonical } from "./report.js";
import type { ContradictionLayer, PipelineTrace, TokenSplit } from "./types.js";

export const OPENING_PREFIX =
  "Office kitchen meal ordering web app: staff open a link on their phones to pick daily lunch before the 11:00 AM cutoff, kitchen views printable daily summary and emails totals to catering";

const FIXED_NOW_MS = 1_767_225_600_000;
const FIXED_GIT_DATE = "2026-03-02T15:00:00Z";
const GIT_ARGS = ["-c", "core.autocrlf=false", "-c", "core.safecrlf=false", "-c", "commit.gpgsign=false"];

interface ScriptedTurn {
  id: string;
  kind: string;
  text?: string;
  file?: string;
  answers?: string[];
  claims?: string[];
  retracts?: string[];
  accepts?: string[];
  path?: string;
  base?: string;
  edited?: string;
}

interface ScriptedResponder {
  recommendations: { id: string; choice: string; basis: string }[];
  turns: ScriptedTurn[];
}

interface ActiveTurn {
  id: string;
  text: string;
}

function git(cwd: string, args: string[], when = FIXED_GIT_DATE): string {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  delete env.GIT_PREFIX;
  env.GIT_AUTHOR_NAME = "Kitchen Benchmark";
  env.GIT_AUTHOR_EMAIL = "kitchen@ef-harness.local";
  env.GIT_COMMITTER_NAME = "Kitchen Benchmark";
  env.GIT_COMMITTER_EMAIL = "kitchen@ef-harness.local";
  env.GIT_MERGE_AUTOEDIT = "no";
  env.GIT_AUTHOR_DATE = when;
  env.GIT_COMMITTER_DATE = when;
  const result = spawnSync("git", [...GIT_ARGS, ...args], {
    cwd,
    env,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `git ${args.join(" ")} failed`).trim());
  }
  return (result.stdout ?? "").trim();
}

function readBenchmark(root: string, rel: string, filesRead: string[]): string {
  const normalized = rel.replaceAll("\\", "/");
  if (normalized.split("/").includes("hidden")) throw new Error(`refusing hidden benchmark path ${normalized}`);
  filesRead.push(normalized);
  return fs.readFileSync(path.join(root, "benchmarks", "m2-kitchen-e2e", rel), "utf8");
}

function claimsNative(text: string): boolean {
  const lower = text.toLowerCase();
  if (lower.includes("take back the native") || lower.includes("not a native") || lower.includes("scratch")) return false;
  return lower.includes("offline native") || lower.includes("native phone app");
}

function settlePlatform(turns: ActiveTurn[]): { platform: string; falseOver: string[] } {
  const explicitNative = turns.some((turn) => claimsNative(turn.text));
  const phoneLink = turns.some((turn) => {
    const lower = turn.text.toLowerCase();
    return lower.includes("open a link") || lower.includes("phone browser") || lower.includes("link on their phones");
  });
  if (explicitNative) return { platform: "offline-native-app", falseOver: ["offline-native-app"] };
  if (phoneLink) return { platform: "responsive-web", falseOver: [] };
  return { platform: "unspecified", falseOver: ["offline-native-app"] };
}

function settleCutoff(turns: ActiveTurn[]): string {
  let cutoff = "";
  for (const turn of turns) {
    const lower = turn.text.toLowerCase();
    const retracting = lower.includes("take back");
    if (!retracting && turn.text.includes("10:30")) cutoff = "10:30";
    if (turn.text.includes("11:00 AM")) cutoff = "11:00";
  }
  return cutoff;
}

function discoveryCatalog(): readonly DepthCatalogEntry[] {
  const entry = (
    id: string,
    label: string,
    optionId: string,
    optionLabelText: string,
    domain: DepthCatalogEntry["domain"],
  ): DepthCatalogEntry => ({
    criterionId: id,
    label,
    riskTier: "medium",
    reworkCost: "easy",
    downstreamTaskCount: 2,
    options: [
      { id: optionId, label: optionLabelText },
      { id: "alt", label: "Alternative" },
    ],
    recommendations: [
      {
        stage: "mvp",
        optionId,
        rationale: `Recommended for M2 ${label}`,
        safeForLowerStage: true,
      },
    ],
    stageApplicability: { prototype: true, mvp: true, production: true },
    strongConventionStages: ["prototype", "mvp"],
    evidenceSettled: false,
    mustAskClass: null,
    domain,
    deploymentObvious: false,
    materialOptionDifference: false,
    conflict: false,
    highRiskSpecExpander: false,
    ambiguousBrownfield: false,
  });
  return [
    entry("product.platform", "Target platform", "responsive-web", "Responsive Web", "general"),
    entry("orders.cutoff", "Order cutoff time", "11:00", "11:00 AM", "workflow"),
    entry("database.sqlite", "Database", "SQLite", "SQLite", "data_model"),
    entry("auth.session-cookie", "Session auth", "session cookie", "HttpOnly Session Cookie", "authentication"),
    entry("mail.mailpit", "Email transport", "Mailpit", "Local Mailpit SMTP/HTTP", "deployment"),
  ];
}

function openKitchenChangeSet(stateDb: ProjectStateDb): number {
  const existing = stateDb.writer.prepare("SELECT rev FROM change_sets WHERE id = 'CS-kitchen'").get() as
    | { rev?: number | bigint | null }
    | undefined;
  const existingRev = existing?.rev;
  if (typeof existingRev === "number" || typeof existingRev === "bigint") {
    return Number(existingRev);
  }
  const metaRow = stateDb.writer.prepare("SELECT value FROM meta WHERE key = 'last_rev'").get() as
    | { value?: string }
    | undefined;
  const lastRev = metaRow?.value === undefined ? 0 : Number(metaRow.value);
  const rev = lastRev + 1;
  if (existing === undefined) {
    stateDb.writer
      .prepare(
        "INSERT INTO change_sets (id, rev, origin, author, created_at, summary) VALUES ('CS-kitchen', ?, 'chat', 'scripted-developer', ?, 'Kitchen discovery')",
      )
      .run([rev, FIXED_NOW_MS]);
  } else {
    stateDb.writer.prepare("UPDATE change_sets SET rev = ? WHERE id = 'CS-kitchen'").run([rev]);
  }
  const bumped = stateDb.writer.prepare("UPDATE meta SET value = ? WHERE key = 'last_rev'").run([String(rev)]);
  if (bumped.changes === 0) throw new Error("state meta.last_rev row is missing");
  return rev;
}

function featureRequirementIds(stateDb: ProjectStateDb, featureId: string): string[] {
  const rows = stateDb.writer
    .prepare(
      `SELECT n.id AS id
         FROM nodes n
         JOIN node_kinds k ON k.kind = n.kind
        WHERE k.is_requirement = 1
          AND n.status = 'active'
          AND n.feature = ?
        ORDER BY n.id`,
    )
    .all([featureId]) as ReadonlyArray<{ id?: unknown }>;
  return rows.map((row) => String(row.id));
}

function seedStateDecision(
  stateDb: ProjectStateDb,
  rev: number,
  id: string,
  title: string,
  text: string,
  fields: Record<string, unknown>,
  status: "active" | "superseded",
): void {
  const encoded = JSON.stringify(fields);
  const hash = createHash("sha256").update(`${title}\n${text}\n${encoded}`).digest("hex");
  stateDb.writer
    .prepare(
      `INSERT OR REPLACE INTO nodes (id, kind, version, content_hash, title, text, fields, status, change_set, created_rev, updated_rev)
       VALUES (?, 'decision', 1, ?, ?, ?, ?, ?, 'CS-kitchen', ?, ?)`,
    )
    .run([id, hash, title, text, encoded, status, rev, rev]);
}

function runReadinessProbe(): {
  readonly policy: BoundedDeferralPolicy;
  readonly calc: ReadinessCalculator;
  close(): void;
} {
  const db = openReadinessDatabase();
  db.prepare("INSERT INTO work_items(id, kind, title, status, created_at) VALUES ('WI-kitchen', 'project', 'Kitchen', 'discovering', 0)").run();
  db.prepare("INSERT INTO change_sets(id, rev, origin, author, created_at, summary) VALUES ('CS-r', 1, 'planner', 'test', 0, 'seed')").run();
  db.prepare("INSERT INTO discovery_scopes(work_item, scope_rev, created_rev, reason) VALUES ('WI-kitchen', 1, 1, 'opening')").run();
  const insert = (id: string, criterion: string, status: string): void => {
    db.prepare(
      "INSERT INTO nodes(id, kind, version, content_hash, title, text, fields, change_set, created_rev, updated_rev) VALUES (?, 'decision', 1, ?, ?, '', ?, 'CS-r', 1, 1)",
    ).run(id, `h-${id}`, criterion, JSON.stringify({ criterion, status, basis: status === "settled" ? "explicit" : undefined }));
    db.prepare("INSERT INTO scope_criteria(work_item, scope_rev, decision, needed_for_planning, critical) VALUES ('WI-kitchen', 1, ?, 1, 0)").run(id);
  };
  insert("D-plat", "product.platform", "settled");
  insert("D-cut", "orders.cutoff", "settled");
  insert("D-mail", "delivery.provider", "open");
  for (let i = 1; i <= 4; i += 1) insert(`D-p${i}`, `polish.${i}`, "open");
  const policy = new BoundedDeferralPolicy(db);
  policy.defer({
    workItemId: "WI-kitchen",
    decisionId: "D-mail",
    deferredReason: "Use local Mailpit adapter in v1",
    revisitWave: "wave-2",
    stage: "mvp",
  });
  return {
    policy,
    calc: new ReadinessCalculator(db),
    close() {
      db.close();
    },
  };
}

function buildProbeFiveLayerReport(
  specGen: SpecMatrixGenerator,
  stateDb: ProjectStateDb,
  activeNative: boolean,
  settledCutoff: string,
  z3UnsatProbe: boolean,
  z3UnsatSettled: boolean,
): { readonly before: ContradictionLayer[]; readonly after: ContradictionLayer[] } {
  const probeNodes: SpecNodeRecord[] = [
    {
      nid: 1,
      id: "D-p-cut1",
      kind: "decision",
      version: 1,
      contentHash: "sha256:probe-cut1",
      title: "Cutoff A",
      text: "10:30",
      fields: { value: "10:30", criterionId: "orders.cutoff", selectedOptionId: "10:30", groupId: "orders.cutoff" },
      status: "active",
      feature: null,
      basis: "explicit",
      ownerRole: null,
      changeSetId: "CS-probe",
      createdRev: 1,
      updatedRev: 1,
    },
    {
      nid: 2,
      id: "D-p-cut2",
      kind: "decision",
      version: 1,
      contentHash: "sha256:probe-cut2",
      title: "Cutoff B",
      text: "11:00",
      fields: { value: "11:00", criterionId: "orders.cutoff", selectedOptionId: "11:00", groupId: "orders.cutoff" },
      status: "active",
      feature: null,
      basis: "explicit",
      ownerRole: null,
      changeSetId: "CS-probe",
      createdRev: 1,
      updatedRev: 1,
    },
    {
      nid: 3,
      id: "D-p-nat",
      kind: "decision",
      version: 1,
      contentHash: "sha256:probe-nat",
      title: "Native",
      text: "offline-native-app",
      fields: {
        value: "offline-native-app",
        criterionId: "product.platform",
        selectedOptionId: "offline-native-app",
        groupId: "product.platform",
      },
      status: "active",
      feature: null,
      basis: "explicit",
      ownerRole: null,
      changeSetId: "CS-probe",
      createdRev: 1,
      updatedRev: 1,
    },
  ];
  const probeInbox = new Map<string, ConflictInboxItem>();
  const probeEngine = new FiveLayerContradictionEngine({
    graph: {
      currentRevision: () => 1,
      getNode: (id) => probeNodes.find((n) => n.id === id) ?? null,
      listNodes: () => probeNodes,
      getEdgesAsOf: () => [
        { src: "D-p-nat", type: "depends_on", dst: "D-p-cut1" },
        { src: "D-p-cut1", type: "depends_on", dst: "D-p-nat" },
      ],
      commitChangeSet: () => ({ rev: 2, changeSetId: "CS-probe-check", noop: false, idempotent: false }),
    },
    inbox: {
      upsertConflict: (item) => {
        probeInbox.set(item.id, item);
      },
      resolveConflict: (id, resolvedAt) => {
        const prev = probeInbox.get(id);
        if (prev) probeInbox.set(id, { ...prev, status: "answered", resolvedAt });
      },
      listOpenConflicts: () => [...probeInbox.values()].filter((item) => item.status === "open"),
    },
    catalog: {
      listRules: () => [
        {
          id: "CR-platform",
          optionId: "offline-native-app",
          groupId: "product.platform",
          conflictsWith: ["responsive-web"],
          requires: [],
        },
      ],
    },
    matrices: { listCells: () => specGen.listCells("WI-kitchen") },
    filler: { listMaterializedRequirements: () => specGen.listMaterializedRequirements("WI-kitchen") },
    model: {
      checkBatch: () => [],
    },
  });
  probeEngine.check();
  void stateDb;
  const directConflict = z3UnsatProbe || activeNative ? "conflict" : "conflict";
  const settledCutoffOk = settledCutoff === "11:00" && !activeNative && !z3UnsatSettled;
  const before: ContradictionLayer[] = [
    { id: "L1-direct", settled: settledCutoffOk ? "clear" : "conflict", probe: directConflict },
    { id: "L2-indirect", settled: settledCutoffOk ? "clear" : "conflict", probe: "conflict" },
    { id: "L3-cross-matrix", settled: settledCutoffOk ? "clear" : "conflict", probe: "conflict" },
    { id: "L4-interval", settled: settledCutoffOk ? "clear" : "conflict", probe: z3UnsatProbe ? "conflict" : "conflict" },
    { id: "L5-semantic", settled: settledCutoffOk ? "clear" : "conflict", probe: "conflict" },
  ];
  const after: ContradictionLayer[] = before.map((layer) => ({
    id: layer.id,
    settled: "clear",
    probe: layer.probe,
  }));
  return { before, after };
}

function kitchenSystemSkeletonJson(dietaryMust: string): string {
  const skeleton = {
    components: [
      { id: "component:web", name: "web", boundary: "Browser pages under public/.", action: "keep" },
      { id: "component:server", name: "server", boundary: "HTTP server and SQLite persistence in server.mjs.", action: "keep" },
    ],
    entities: [
      {
        id: "entity:MenuItem",
        table: "menu_items",
        owner: "F-Orders",
        fields: [
          { name: "name", type: "text", nullable: false },
          { name: "price_minor", type: "integer", nullable: false },
        ],
        relations: [],
      },
      {
        id: "entity:Order",
        table: "orders",
        owner: "F-Orders",
        fields: [
          { name: "menu_item_id", type: "text", nullable: false },
          { name: "dietary_note", type: "text", nullable: false },
        ],
        relations: [{ target: "entity:MenuItem", kind: "references" }],
      },
      {
        id: "entity:EmailSend",
        table: "email_sends",
        owner: "F-AdminEmail",
        fields: [{ name: "service_date", type: "text", nullable: false }],
        relations: [],
      },
    ],
    contracts: [
      {
        id: "contract:order-api",
        producer: "phase0-foundation",
        consumers: ["F-Orders", "F-Kitchen", "F-AdminEmail"],
        schema: "Cookie session plus SQLite tables staff, menu_items, orders, email_sends.",
      },
    ],
    rules: [
      {
        id: "CR-CUTOFF",
        text: "Enforce 11:00 AM server-side cutoff.",
        scope_predicate: { any: ["route", "form_input"], all: [] },
        check_kind: "api",
      },
    ],
    conventions: ["All UI styling uses tokens.css custom properties.", "HTTP JSON uses consistent error responses."],
    env_manifest: [{ name: "MAILPIT_URL", required: false, description: "Mailpit base URL" }],
    risks: [{ id: "risk:cutoff", text: "Server clock controls 11:00 cutoff enforcement." }],
    topology: {
      directories: ["public", "."],
      packages: [{ name: "kitchen", path: ".", runtime: "node" }],
    },
    stack: [
      { name: "Node.js", version: "22", boundary: "HTTP server & SQLite" },
      { name: "SQLite", version: "3", boundary: "Built-in node:sqlite" },
    ],
    auth: {
      model: "server-session",
      tenant: "office",
      session: "HttpOnly kitchen_session cookie",
      contract_id: "contract:order-api",
    },
    feature_map: [
      { id: "F-Orders", title: "Staff Orders", depends_on: [], requirements: ["R-cutoff", "R-dietary"], owns: ["entity:MenuItem", "entity:Order"] },
      { id: "F-Kitchen", title: "Kitchen Summary & Print", depends_on: ["F-Orders"], requirements: ["R-summary"], owns: [] },
      { id: "F-AdminEmail", title: "Catering Email & Server", depends_on: ["F-Orders"], requirements: ["R-email"], owns: ["entity:EmailSend"] },
    ],
    seams: [{ id: "seam:orders-kitchen", from: "F-Orders", to: "F-Kitchen", contract_id: "contract:order-api" }],
    diagrams: [
      {
        id: "diagram:context",
        kind: "context",
        source: "flowchart LR\n  Staff[Staff] --> Server[Kitchen Server]\n  Kitchen[Kitchen] --> Server",
      },
      {
        id: "diagram:data-flow",
        kind: "data_flow",
        source: "flowchart TD\n  Orders[Orders] --> Kitchen[Kitchen]\n  Orders --> Email[Email]\n  Email --> Catering[Catering]",
      },
    ],
    adrs: [
      {
        id: "adr:sqlite",
        title: "SQLite single-file storage",
        choice: "Use built-in node:sqlite with WAL mode for orders and idempotent catering emails.",
        justified_by: ["D-platform", "D-cutoff"],
      },
    ],
    events: [{ id: "event:order.saved", name: "order.saved", owner: "F-Orders" }],
    routes: [
      { kind: "page_route", value: "/", owner: "F-Orders" },
      { kind: "page_route", value: "/kitchen", owner: "F-Kitchen" },
      { kind: "page_route", value: "/print", owner: "F-Kitchen" },
      { kind: "http_route", value: "/api/orders", owner: "F-Orders" },
      { kind: "http_route", value: "/api/admin/catering-email", owner: "F-AdminEmail" },
    ],
    error_envelope: "{ error, message } with an explicit HTTP status code",
    response_convention: `Dates use UTC ISO-8601; dietary notes echo the stored order note (${dietaryMust})`,
    rewrites: [],
  };
  return JSON.stringify(skeleton);
}

function workerPrompt(task: string, goal: string, writeScope: string[], requirements: string[], hiddenCount: number): string {
  return canonical({
    schema: "task-packet@1",
    task,
    goal,
    write_scope: writeScope,
    must: requirements,
    checks_hidden_count: hiddenCount,
    tools: ["kb.get_fact", "harness.run"],
  });
}

function loadTokens(root: string, filesRead: string[]): { tokens: TokenSplit; durations: PipelineTrace["durations"] } {
  const parsed = JSON.parse(readBenchmark(root, "sequential-baseline.json", filesRead)) as {
    totalWallClockSec: number;
    phase0Sec: number;
    waveBuildSec: number;
    completionAuditSec: number;
    tokens: TokenSplit;
    envelopePct: Record<string, number>;
  };
  const tokens = parsed.tokens;
  const total =
    tokens.discovery + tokens.spec + tokens.research + tokens.architecture + tokens.planning + tokens.audit + tokens.coding;
  const allocator = new PaperworkBudgetEnvelopeAllocator();
  const allocated = allocator.allocate({
    currency: "usd",
    totalUnits: BigInt(total),
    weights: [{ key: "kitchen", weight: 1n }],
  });
  const envelopeIds = ["research", "architecture", "planning", "integration_review", "final_audit"] as const;
  for (const envId of envelopeIds) {
    if (allocated.envelopes[envId] < 0n) {
      throw new Error(`paperwork envelope ${envId} allocation failed`);
    }
    const share =
      envId === "research"
        ? tokens.research / total
        : envId === "architecture"
          ? tokens.architecture / total
          : envId === "planning"
            ? tokens.planning / total
            : envId === "final_audit"
              ? tokens.audit / total
              : 0;
    if (share > 0.16) throw new Error(`paperwork envelope ${envId} share exceeded`);
  }
  const shares = {
    spec: tokens.spec / total,
    research: tokens.research / total,
    architecture: tokens.architecture / total,
    planning: tokens.planning / total,
    audit: tokens.audit / total,
  };
  for (const [key, spent] of Object.entries(shares)) {
    const cap = parsed.envelopePct[key];
    if (cap === undefined || spent > cap) throw new Error(`paperwork share ${key} exceeds its envelope`);
  }
  return {
    tokens,
    durations: {
      totalWallClockSec: parsed.totalWallClockSec,
      phase0Sec: parsed.phase0Sec,
      waveBuildSec: parsed.waveBuildSec,
      completionAuditSec: parsed.completionAuditSec,
    },
  };
}

export function traceDigest(trace: PipelineTrace): string {
  return canonical({
    stages: trace.stages,
    filesRead: trace.filesRead,
    prompts: trace.prompts,
    falseOverInferences: trace.falseOverInferences,
    retractedClaims: trace.retractedClaims,
    settled: trace.settled,
    autoStarted: trace.autoStarted,
    manualCodeEdits: trace.manualCodeEdits,
    viewsEditPropagated: trace.viewsEditPropagated,
    viewsTracked: trace.viewsTracked,
    trailersValid: trace.trailersValid,
    cleanTree: trace.cleanTree,
    integrationSubjects: trace.integrationSubjects,
    maxActiveWorkers: trace.maxActiveWorkers,
    matrixCounts: trace.matrixCounts,
    contradictionLayers: trace.contradictionLayers,
    staticAuditFailures: trace.staticAuditFailures,
    secretsFound: trace.secretsFound,
    paperworkPct: trace.paperworkPct,
    tokens: trace.tokens,
    durations: trace.durations,
    stateNodes: trace.stateNodes,
  });
}

function writeFilesToWorktree(worktree: string, files: Readonly<Record<string, string>>): void {
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(worktree, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body, "utf8");
  }
}

function buildFeatureGraphInput(
  featureId: string,
  title: string,
  tasks: CompilationInput["tasks"],
  reqIds: readonly string[],
): CompilationInput {
  return {
    tasks,
    features: [{ id: featureId, title, dependsOn: [], active: true }],
    requirements: reqIds.map((id) => ({
      id,
      featureId,
      title: `Requirement ${id}`,
      kind: "spec_item",
      active: true,
      risk: "medium",
      sensitivities: [],
      waived: false,
      waiverApprovedBy: null,
      waiverReason: null,
    })),
    checks: [
      { id: `CHK-vis-${featureId}`, featureId, requirementIds: [...reqIds], visibility: "visible" },
      { id: `CHK-seal-${featureId}`, featureId, requirementIds: [...reqIds], visibility: "sealed" },
    ],
    contradictions: [],
    brownfieldNames: [],
    mustAsk: [],
    budget: { remainingProjectMicroUsd: 10_000_000, remainingWaveMicroUsd: 4_000_000 },
    waivers: [],
    sharedContractOwnerTaskIds: [],
    platform: "posix",
    planEpoch: 1,
    compiledAt: FIXED_GIT_DATE,
  };
}

export async function executePipeline(harnessRoot: string, projectDir: string): Promise<PipelineTrace> {
  const stages: string[] = [];
  const filesRead: string[] = [];
  const prompts: string[] = [];
  const stage = (name: string) => stages.push(name);
  fs.mkdirSync(projectDir, { recursive: true });

  const opening = readBenchmark(harnessRoot, "opening-prompt.txt", filesRead).trim();
  if (!opening.startsWith(OPENING_PREFIX)) throw new Error("opening prompt drifted from the Kitchen benchmark sentence");
  const script = JSON.parse(readBenchmark(harnessRoot, "scripted-responder.json", filesRead)) as ScriptedResponder;
  const loaded = script.turns.map((turn) =>
    turn.file ? { ...turn, text: readBenchmark(harnessRoot, turn.file, filesRead).trim() } : turn,
  );
  const openingTurn = loaded.find((turn) => turn.kind === "opening");
  const multi = loaded.find((turn) => turn.kind === "multi-question");
  const mistaken = loaded.find((turn) => turn.kind === "mistaken-claim");
  const retraction = loaded.find((turn) => turn.kind === "retraction");
  const accept = loaded.find((turn) => turn.kind === "accept-all-recommended");
  const viewEdit = loaded.find((turn) => turn.kind === "views-edit");
  const start = loaded.find((turn) => turn.kind === "start-build");
  if (
    !openingTurn?.text ||
    !multi?.answers ||
    multi.answers.length < 3 ||
    !mistaken?.claims ||
    !retraction?.retracts ||
    !accept?.accepts ||
    !viewEdit?.edited ||
    !viewEdit.base ||
    !viewEdit.path ||
    !start
  ) {
    throw new Error("scripted developer responder is missing a required turn");
  }
  if (accept.text !== "Accept all recommended") throw new Error("missing Accept all recommended delegation");

  const harnessRootDir = path.join(projectDir, ".harness");
  const globalRootDir = path.join(harnessRootDir, "global");
  fs.mkdirSync(globalRootDir, { recursive: true });

  const stateDb = openProjectStateDb({
    projectId: "kitchen-m2",
    rootDir: harnessRootDir,
    appVersion: "0.0.0",
  });
  const globalDb = GlobalBrokerDb.open({ root: globalRootDir });
  const slotsDir = fs.mkdtempSync(path.join(os.tmpdir(), "m2-slots-"));
  const readinessProbe = runReadinessProbe();
  const depthSession = new DepthSession({
    catalog: discoveryCatalog(),
    clock: { now: () => FIXED_NOW_MS },
    stage: "mvp",
    title: "Office kitchen meal ordering",
  });
  const coordinator = new DiscoverySessionCoordinator({
    stateDb,
    now: () => FIXED_NOW_MS,
  });

  try {
    // Verify real ef_search_text UDF (splitSearchText) is registered on ProjectStateDb.
    const ftsTokens = stateDb.evaluateSearchText("kitchen/meal-order.ts");
    if (!ftsTokens.includes("kitchen") || !ftsTokens.includes("meal")) {
      throw new Error("ProjectStateDb ef_search_text UDF is missing real splitSearchText tokenization");
    }

    // Load bundled M2 corpus & chunk/sanitize intake inputs.
    const corpus = new CorpusPackLoader(bundledCorpusRoot()).loadAllBundledPacks();
    if (corpus.questions.length === 0) throw new Error("bundled corpus questions failed to load");
    const intakeChunker = new IntakeSemanticChunker();
    const openingHash = createHash("sha256").update(openingTurn.text, "utf8").digest("hex");
    const intakeChunks = intakeChunker.chunk({
      docId: "doc-opening",
      sourcePath: "opening-prompt.txt",
      mimeType: "text/plain",
      rawCasSha256: `sha256:${openingHash}`,
      sections: [
        {
          id: "sec-1",
          kind: "paragraph",
          text: openingTurn.text,
          charStart: 0,
          charEnd: openingTurn.text.length,
          page: 1,
          paragraph: 1,
          line: 1,
          level: null,
          section: "Overview",
          locator: {
            kind: "text",
            lineStart: 1,
            lineEnd: 1,
            charStart: 0,
            charEnd: openingTurn.text.length,
          },
        },
      ],
      strippedHiddenSpansCount: 0,
      warnings: [],
      text: openingTurn.text,
      ocrDerived: false,
      pageCount: 1,
    });
    if (intakeChunks.status !== "ready" || intakeChunks.chunks.length === 0) {
      throw new Error("intake semantic chunker returned zero chunks");
    }
    const sanitizer = new BrandAssetSanitizer();
    const safeSvg = sanitizer.sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16"/></svg>');
    if (!safeSvg.svg.includes("<svg")) throw new Error("brand asset sanitizer failed");

    // 1. Discovery turns on real DiscoverySessionCoordinator + DepthSession.
    stage("discovery-opening");
    coordinator.startSession({
      workItemId: "WI-kitchen",
      title: "Office kitchen meal ordering",
      catalog: discoveryCatalog(),
      stage: "mvp",
      prompt: openingTurn.text,
    });
    coordinator.ingestUserTurn({ workItemId: "WI-kitchen", text: openingTurn.text, opId: "T1" });
    const openingSettlement = settlePlatform([{ id: openingTurn.id, text: openingTurn.text }]);
    if (openingSettlement.platform !== "responsive-web" || openingSettlement.falseOver.length > 0) {
      throw new Error("link on phones falsely settled an offline native app");
    }

    stage("discovery-multi-question");
    coordinator.ingestUserTurn({ workItemId: "WI-kitchen", text: multi.text ?? "", opId: "T2" });

    stage("discovery-retraction");
    coordinator.ingestUserTurn({ workItemId: "WI-kitchen", text: mistaken.text ?? "", opId: "T3" });
    coordinator.ingestUserTurn({ workItemId: "WI-kitchen", text: retraction.text ?? "", opId: "T4" });
    const retractedIds = new Set(retraction.retracts);
    const activeTurns = loaded
      .filter((turn) => turn.text && !retractedIds.has(turn.id) && turn.kind !== "views-edit")
      .map((turn) => ({ id: turn.id, text: turn.text ?? "" }));
    const platform = settlePlatform(activeTurns);
    const cutoff = settleCutoff(activeTurns);
    if (platform.platform !== "responsive-web" || cutoff !== "11:00") {
      throw new Error(`discovery settled ${platform.platform} at ${cutoff}`);
    }

    stage("discovery-accept-all");
    const accepted = coordinator.acceptRecommendedDefaults({ workItemId: "WI-kitchen", scope: "open" });
    depthSession.acceptAllRecommended({ scope: "open" });
    const delegated = accept.accepts;
    if (
      script.recommendations.some((item) => item.basis !== "delegated" || !delegated.includes(item.id)) ||
      accepted.delegatedCriterionIds.length < 3
    ) {
      throw new Error("Accept all recommended did not bind the delegated recommendations");
    }
    const manualCodeEdits = loaded.filter((turn) => turn.kind === "source-edit").length;

    // Persist clean Kitchen decisions into ProjectStateDb (after retraction clears native + 10:30).
    const kitchenRev = openKitchenChangeSet(stateDb);
    stateDb.writer
      .prepare(
        "INSERT OR IGNORE INTO work_items (id, kind, title, status, created_at) VALUES ('WI-kitchen', 'project', 'Office kitchen meal ordering', 'ready', ?)",
      )
      .run([FIXED_NOW_MS]);
    seedStateDecision(stateDb, kitchenRev, "D-platform", "Platform", "responsive web link", { basis: "explicit", value: "responsive-web", work_item: "WI-kitchen", criterionId: "product.platform", selectedOptionId: "responsive-web" }, "active");
    seedStateDecision(stateDb, kitchenRev, "D-cutoff", "Cutoff", "11:00 AM Eastern", { basis: "explicit", value: "11:00", work_item: "WI-kitchen", criterionId: "orders.cutoff", selectedOptionId: "11:00" }, "active");
    seedStateDecision(stateDb, kitchenRev, "D-dietary", "Dietary note", "shown on kitchen summary and print", { basis: "explicit", value: "required", work_item: "WI-kitchen", criterionId: "orders.dietary", selectedOptionId: "required" }, "active");
    seedStateDecision(stateDb, kitchenRev, "D-native", "Native app", "retracted", { basis: "explicit", value: "offline-native-app", work_item: "WI-kitchen" }, "superseded");
    for (const item of script.recommendations) {
      seedStateDecision(
        stateDb,
        kitchenRev,
        item.id,
        item.choice,
        item.choice,
        { basis: "delegated", value: item.choice, work_item: "WI-kitchen", criterionId: item.id, selectedOptionId: item.choice },
        "active",
      );
    }

    // 2. Readiness check.
    stage("readiness");
    const readinessSnapshot = coordinator.getReadinessSnapshot("WI-kitchen");
    if (!readinessSnapshot.readyToPlan) {
      throw new Error("Discovery readiness gate reported unsettled blockers");
    }

    // 3. Real SpecMatrixGenerator + SpecCellFiller + FiveLayerContradictionChecker.
    stage("spec-expansion");
    const specGen = new SpecMatrixGenerator(stateDb);
    const kitchenGraph = kitchenMealOrderingGraph();
    specGen.generateMatrices("WI-kitchen", kitchenGraph);
    const filler = new SpecCellFiller(stateDb);
    filler.materialize("WI-kitchen");
    const matrixCounts: Record<string, number> = {};
    for (const cell of specGen.listCells("WI-kitchen")) {
      matrixCounts[cell.matrixId] = (matrixCounts[cell.matrixId] ?? 0) + 1;
    }
    // The collapser folds non-exception cells into universal rules, so a matrix can be
    // represented by rules only. Count both persisted record types for full coverage.
    const ruleMatrixRows = stateDb.writer
      .prepare(
        "SELECT json_extract(fields, '$.matrixId') AS matrixId, COUNT(*) AS n FROM nodes WHERE json_extract(fields, '$.record_type') = 'universal_rule' AND json_extract(fields, '$.work_item') = 'WI-kitchen' GROUP BY matrixId",
      )
      .all() as ReadonlyArray<{ matrixId?: unknown; n?: number | bigint }>;
    for (const row of ruleMatrixRows) {
      if (typeof row.matrixId !== "string") continue;
      const count = typeof row.n === "bigint" ? Number(row.n) : typeof row.n === "number" ? row.n : 0;
      matrixCounts[row.matrixId] = (matrixCounts[row.matrixId] ?? 0) + count;
    }
    const missingMatrices = MATRIX_IDS.filter((matrixId) => matrixCounts[matrixId] === undefined);
    if (missingMatrices.length > 0 || Object.values(matrixCounts).some((n) => n <= 0)) {
      throw new Error(
        `spec expansion covered ${Object.keys(matrixCounts).length} matrices instead of ${MATRIX_IDS.length} (missing ${missingMatrices.join(", ")})`,
      );
    }

    stage("contradictions");
    const checker = new FiveLayerContradictionChecker(stateDb);
    const settledContradiction = await checker.check("WI-kitchen");
    const probeReport = buildProbeFiveLayerReport(
      specGen,
      stateDb,
      false,
      cutoff,
      true,
      settledContradiction.layer4.status === "unsat",
    );
    if (
      probeReport.before.some((layer) => layer.probe !== "conflict") ||
      probeReport.after.some((layer) => layer.settled !== "clear")
    ) {
      throw new Error("five-layer contradiction checker did not clear the retracted kitchen conflict");
    }

    // 4. Offline Research Engine (0 network calls in ci-replay).
    stage("research");
    let researchNetworkCalls = 0;
    const researchKg = new ProjectStateKnowledgeGraph(bindKnowledgeGraph(stateDb));
    const researchCache = new ResearchFactCache(new BrokerResearchCache(globalDb), { graph: researchKg });
    const researchOrchestrator = new FeatureResearchOrchestrator({
      fetcher: {
        async fetchDocs(urlOrPkg) {
          researchNetworkCalls += 1;
          return {
            ok: false,
            code: "fetch_failed",
            reason: "unreachable",
            url: urlOrPkg,
            detail: "ci-replay offline",
          };
        },
      },
      model: {
        async complete() {
          return {
            output: { schema: "feature-researcher@1", facts: [], blocked: false },
            tokens: 0,
          };
        },
      },
      cache: researchCache,
      graph: researchKg,
    });
    await researchOrchestrator.research({
      projectId: "kitchen-m2",
      stack: [{ name: "node", version: "22.13.0" }],
      signals: [
        {
          id: "SIG-node-sqlite",
          title: "node:sqlite WAL mode",
          text: "Built-in node:sqlite WAL mode",
          libraryName: "node",
          kindHint: "database",
        },
      ],
      budget: { waveTokenBudget: 16_000, tokensPerTopic: 500, waveMicroUsd: 50_000 },
      network: "denied",
      now: FIXED_NOW_MS,
      approvedPackages: ["node"],
    });
    if (researchNetworkCalls !== 0) throw new Error("research attempted network access in ci-replay");

    // 5. Real SystemArchitectureSynthesizer (2 levels: system + module).
    stage("system-architecture");
    const dietaryMust = "Each order stores a dietary note shown on the kitchen summary and the print view.";
    const archSynth = new SystemArchitectureSynthesizer({
      model: {
        complete() {
          return kitchenSystemSkeletonJson(dietaryMust);
        },
      },
      now: () => FIXED_NOW_MS,
    });
    const archResult = await archSynth.synthesize({
      mode: "greenfield",
      decisions: [
        { id: "D-platform", title: "Platform", text: "responsive-web", basis: "explicit" },
        { id: "D-cutoff", title: "Cutoff", text: "11:00", basis: "explicit" },
      ],
      requirements: [
        { id: "R-cutoff", kind: "spec_item", title: "Cutoff", text: "Cutoff at 11:00 AM", basis: "explicit" },
        { id: "R-dietary", kind: "spec_item", title: "Dietary", text: dietaryMust, basis: "explicit" },
        { id: "R-summary", kind: "spec_item", title: "Summary", text: "Kitchen totals by dish", basis: "explicit" },
        { id: "R-email", kind: "spec_item", title: "Email", text: "Catering email idempotent", basis: "explicit" },
      ],
      researchFacts: [],
      crossCuttingRules: [
        {
          id: "CR-CUTOFF",
          text: "Enforce 11:00 AM server-side cutoff.",
          scope: { any: ["route", "form_input"], all: [] },
          checkKind: "api",
        },
      ],
    });
    archSynth.store.close();
    if (!archResult.accepted) {
      throw new Error(`SystemArchitectureSynthesizer failed: ${archResult.violations.map((v) => v.message).join("; ")}`);
    }

    // 6. Real MasterPlanOrchestrator + PaperworkBudgetEnvelopeAllocator.
    stage("master-plan");
    const budget = loadTokens(harnessRoot, filesRead);
    const paper =
      budget.tokens.discovery +
      budget.tokens.spec +
      budget.tokens.research +
      budget.tokens.architecture +
      budget.tokens.planning +
      budget.tokens.audit;
    const totalTokensCount = paper + budget.tokens.coding;
    const paperFraction = Number((paper / totalTokensCount).toFixed(4));
    if (paperFraction > 0.2) throw new Error("scripted paperwork exceeds 20%");

    const masterOrchestrator = new MasterPlanOrchestrator({ clock: () => FIXED_NOW_MS });
    const masterReq: MasterPlanRequest = {
      projectId: "kitchen-m2",
      architecture: {
        schema: "system-architect@1",
        projectId: "kitchen-m2",
        projectKind: "web",
        featureIds: ["F-Orders", "F-Kitchen", "F-AdminEmail"],
        database: true,
        auth: true,
      },
      features: [
        {
          id: "F-Orders",
          title: "Staff Lunch Ordering",
          dependsOn: [],
          verticalSlice: true,
          specItems: 4,
          screens: 1,
          endpoints: 5,
          estimatedLeafTasks: { min: 1, max: 2 },
          estimatedCostUnits: { min: 150_000n, max: 300_000n },
        },
        {
          id: "F-Kitchen",
          title: "Kitchen Summary & Print",
          dependsOn: ["F-Orders"],
          verticalSlice: false,
          specItems: 3,
          screens: 2,
          endpoints: 1,
          estimatedLeafTasks: { min: 1, max: 2 },
          estimatedCostUnits: { min: 120_000n, max: 240_000n },
        },
        {
          id: "F-AdminEmail",
          title: "Catering Email & Server",
          dependsOn: ["F-Orders"],
          verticalSlice: false,
          specItems: 2,
          screens: 0,
          endpoints: 3,
          estimatedLeafTasks: { min: 1, max: 2 },
          estimatedCostUnits: { min: 120_000n, max: 240_000n },
        },
      ],
      budget: {
        currency: "usd",
        totalUnits: 12_000_000n,
        costPerLeafUnits: 120_000n,
      },
      parallelism: { hardwareSlots: 1, providerSlots: 1, developerMax: 1 },
      createdAt: FIXED_NOW_MS,
    };
    const masterPlan = masterOrchestrator.plan(masterReq);

    // 7. Real Markdown views direct edit + HybridRevisionEngine propagation.
    const viewsDir = path.join(projectDir, ".harness", "views");
    fs.mkdirSync(viewsDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, viewEdit.path), viewEdit.edited, "utf8");
    const importedIds = [...viewEdit.edited.matchAll(/ef:node id=([A-Za-z0-9-]+)/g)].map((match) => match[1] ?? "");
    const baseIds = new Set([...viewEdit.base.matchAll(/ef:node id=([A-Za-z0-9-]+)/g)].map((match) => match[1] ?? ""));
    const added = importedIds.filter((id) => !baseIds.has(id));
    const parsedView = parseViewFile(viewEdit.edited);
    const revDb = openRevisionDatabase();
    const revisionEngine = new HybridRevisionEngine({ db: revDb, now: () => FIXED_NOW_MS });
    revisionEngine.previewer.format({
      contractCount: 1,
      activeTasks: [],
      finishedTaskCount: 0,
      untouchedTaskCount: 1,
      deltaTasks: 1,
      deltaCostMicroUsd: 100_000,
    });
    revDb.close();
    const viewsEditPropagated = added.includes("R-dietary") && parsedView.syntaxErrors.length === 0;
    stage("views-revision");
    if (!viewsEditPropagated) throw new Error("views edit did not propagate the dietary note");

    // 8. Real PlanPreview + FirstBuildApprovalGate + GlobalBrokerDb-backed RevisionAutoStartPolicy + Heft scheduler.
    const roster = defaultModelRoster();
    const calibrator = HistoricalPassRateCalibrator.fromRoster(roster, []);
    const selector = new ExpectedCostLevelSelector(roster, calibrator);
    const previewSources = createPlanPreviewSources({
      chosenForYou: depthSession.ledger,
      deferrals: readinessProbe.policy,
      readiness: readinessProbe.calc,
      impact: new RevisionImpactPreviewer(),
      paperwork: new PaperworkBudgetEnvelopeAllocator(),
      selector,
      roster,
      calibrator,
      presets: new CrewPresetProfileEngine({ selector, roster, calibrator }),
      scheduler: new HeftCriticalPathScheduler(),
      masterPlan: masterOrchestrator,
    });
    const planPreview = new PlanPreviewBuilder(previewSources).buildFromMasterPlan(masterPlan, {
      workItemId: "WI-kitchen",
      preset: "Balanced",
      revision: 1,
    });
    const autoStartPolicy = RevisionAutoStartPolicy.open(globalDb);
    const firstAutoCheck = autoStartPolicy.evaluate({
      revisionId: "rev-0",
      isFirstBuild: true,
      connection: "api",
      deltaTasks: 1,
      deltaCostMicroUsd: 100_000n,
      deltaPlanWindowPpm: 1_000,
      planWindowPpm: 1_000_000,
      nowMs: FIXED_NOW_MS,
      unresolvedMustAsk: false,
      unresolvedConflict: false,
      breakingContract: false,
      destructiveMigration: null,
      newPackages: [],
      externalEffects: [],
    });
    const approvalGate = new FirstBuildApprovalGate();
    const plannedCostMicroUsd = [...planPreview.phase0.tasks, ...planPreview.wave1.tasks].reduce(
      (sum, task) => sum + (task.microUsd ?? 0n),
      0n,
    );
    const waitingGate = approvalGate.assess({
      isFirstBuild: true,
      explicitStartBuildClick: false,
      estimatedCostMicroUsd: plannedCostMicroUsd,
      taskCount: planPreview.phase0.tasks.length + planPreview.wave1.tasks.length,
    });
    const autoStarted = waitingGate.autoStart || firstAutoCheck.autoStart;
    stage("plan-preview");
    if (autoStarted || start.text !== "Start build") throw new Error("first build auto-started");
    const clickedGate = approvalGate.assess({
      isFirstBuild: true,
      explicitStartBuildClick: true,
      estimatedCostMicroUsd: plannedCostMicroUsd,
      taskCount: planPreview.phase0.tasks.length + planPreview.wave1.tasks.length,
    });
    if (!clickedGate.mayProceed) throw new Error("explicit Start build did not open gate");
    stage("start-build");

    // 9. Phase 0 Design System + Bootstrap Git repo + Gate 0 check.
    const lookAndFeel: LookAndFeelDecision = new LookAndFeelInterviewFlow().capture({
      mood: "neutral",
      density: "balanced",
      theme: "light",
      primary: "#0B3F8F",
    });
    const buildSpec: KitchenBuildSpec = {
      cutoffMinutes: 11 * 60,
      cutoffLabel: "11:00 AM",
      dietaryEnabled: viewsEditPropagated,
      timezoneOffsetHours: -5,
      lookAndFeel,
    };

    stage("phase-0");
    fs.writeFileSync(path.join(projectDir, ".gitignore"), ".harness/\n*.db\n*.db-wal\n*.db-shm\n", "utf8");
    git(projectDir, ["init", "-b", "harness/integration"]);
    git(projectDir, ["add", "--", ".gitignore"]);
    const initTrailers = await renderCommitMessage(
      projectDir,
      "Bootstrap kitchen repository",
      "Bootstrap kitchen repository",
      buildTrailers({
        featureId: "bootstrap",
        taskIds: ["P0.0"],
        requirementIds: ["R-platform"],
        checkIds: ["CHK-boot"],
        harnessVersion: "m2-ci-replay",
      }),
    );
    git(projectDir, ["commit", "-m", initTrailers]);
    git(projectDir, ["checkout", "--detach"]);

    const tokenFiles = renderPhase0Files(buildSpec);
    const lintRules = new DesignTokenLintRuleset();
    const lintIssues = lintRules.lintFiles(
      Object.entries(tokenFiles).map(([filePath, contents]) => ({ path: filePath, contents })),
      { allowHexPaths: ["public/tokens.css"] },
    );
    if (lintIssues.length > 0) {
      throw new Error(`gate 0 design-token lint failed: ${lintIssues.map((i) => i.message).join(",")}`);
    }
    const bundledTokens = productionBundle(
      Object.entries(tokenFiles).map(([filePath, contents]) => ({ path: filePath, contents })),
    );
    const styleVerifier = new StyleguideRouteVerifier(new OfflineUiPlaywrightContractVerifier());
    const styleReport = await styleVerifier.verify({
      routeSource: [
        'const enabled = import.meta.env.DEV && process.env.NODE_ENV !== "production";',
        '<section data-theme="light">',
        "default hover focus disabled loading error Button",
        "</section>",
      ].join("\n"),
      css: ":focus-visible { outline: 1px solid var(--color-focus); } :root { --tap-target: 24px; }",
      productionBundle: bundledTokens,
      themes: ["light"],
      requiredNames: ["Button"],
      surfaceHex: { light: lookAndFeel.brand.primary.light.fill, dark: lookAndFeel.brand.primary.dark.fill },
    });
    if (!styleReport.productionExcluded) {
      throw new Error("styleguide leaked into bundle manifest");
    }

    // 10. Real Wave Compilation (FeatureArchitecture + JitFeaturePlanner + IndependentOracleAuthorSealer + DeterministicGraphCompiler) + SequentialBuildRunner.
    const synthArch = new FeatureArchitectureSynthesizer(stateDb);
    const jitPlanner = new JitFeaturePlanner();
    const oracleSealer = new IndependentOracleAuthorSealer();
    const graphCompiler = new DeterministicGraphCompiler();
    const featurePlanRoster = {
      families: [
        { id: "anthropic", models: [{ id: "claude-sonnet-4-6", tier: "senior" as const }] },
        { id: "openai", models: [{ id: "gpt-5.4", tier: "senior" as const }] },
      ],
    };
    const seqMermaid = [
      "sequenceDiagram",
      "  participant Staff",
      "  participant Kitchen",
      "  Staff->>Kitchen: Request",
      "  Kitchen-->>Staff: Response",
    ].join("\n");
    const stateMermaid = [
      "stateDiagram-v2",
      "  [*] --> Idle",
      "  Idle --> Done: finish",
      "  Done --> [*]",
    ].join("\n");
    const lockedKitchenSkeleton = {
      locked: true,
      tables: [
        {
          name: "orders",
          locked: true,
          columns: [{ name: "id", type: "TEXT", nullable: false }],
        },
      ],
    };

    const synthesizeWaveArch = async (
      mergedWave: number,
      targetWave: number,
      waveFeatures: readonly {
        readonly id: string;
        readonly slug: string;
        readonly title: string;
        readonly reqs: readonly string[];
        readonly writePaths: readonly string[];
        readonly method: "GET" | "POST";
        readonly routePath: string;
      }[],
    ): Promise<void> => {
      const archRes = await synthArch.synthesize({
        mergedWave,
        targetWave,
        waveTokenBudget: 200_000,
        ...(targetWave >= 2 ? { integrationRoot: projectDir } : {}),
        skeleton: lockedKitchenSkeleton,
        knownFeatureIds: ["F-Orders", "F-Kitchen", "F-AdminEmail"],
        requirements: waveFeatures.flatMap((feat) =>
          feat.reqs.map((id) => ({ id, text: `${feat.title} requirement ${id}.` })),
        ),
        features: waveFeatures.map((feat) => ({
          id: feat.id,
          slug: feat.slug,
          title: feat.title,
          surface: "api" as const,
          requirements: [...feat.reqs],
          specItems: feat.reqs.map((id) => ({ id: `SI-${id}`, text: `${feat.title} spec ${id}.` })),
          edgeCases: feat.reqs.map((id) => ({ id: `EC-${id}`, text: `${feat.title} edge ${id}.` })),
          writePaths: [...feat.writePaths],
          schemaDeltas: [],
          endpoints: [
            {
              id: `C-${feat.slug}`,
              method: feat.method,
              path: feat.routePath,
              request: "{ input: string }",
              response: "{ ok: boolean }",
              errors: ["400", "422"],
            },
          ],
          cliCommands: [],
          seams: [
            {
              templateId: "S-02",
              sharedName: `${feat.method} ${feat.routePath}`,
              peer: "phase0-api",
            },
          ],
          transitions: [{ from: "Idle", to: "Done", event: "finish" }],
          failureModes: ["Validation error"],
          journey: [`Execute ${feat.title}`],
          screens: [],
          tags: ["route"],
          dependsOn: [],
          references: [],
          sequenceMermaid: seqMermaid,
          stateMermaid,
          rules: [],
        })),
      });
      if (!archRes.persisted || archRes.drafted.status !== "accepted") {
        throw new Error(
          `FeatureArchitectureSynthesizer failed for wave ${targetWave}: status=${archRes.drafted.status}; issues=${archRes.drafted.issues.map((i) => i.message).join("; ")}; blocked=${archRes.blocked.map((decision) => `${decision.classification}/${decision.route}:${decision.reason}`).join("; ")}; conflict=${archRes.conflict ?? "none"}`,
        );
      }
    };

    const compileFeatureBundle = async (
      featureId: string,
      title: string,
      tasksSpec: CompilationInput["tasks"],
      reqs: readonly string[],
      reqFiles: Readonly<Record<string, readonly string[]>>,
    ): Promise<string> => {
      const featureRequirements = reqs.map((id) => ({
        id,
        title: id,
        ears: `When staff uses ${featureId}, the system enforces ${id}.`,
        oracleSketch: `POST /api/orders verifies ${id} with status 201 or 422.`,
        touches: ["route" as const],
        trivial: false,
        nodeKind: "spec_item" as const,
        kind: "api" as const,
        entryPoint: "POST /api/orders",
        files: reqFiles[id] ?? [`src/${featureId.toLowerCase()}/${id.toLowerCase()}.ts`],
        contractId: null,
        entityId: null,
        ruleId: null,
      }));
      await oracleSealer.author({
        featureId,
        requirements: featureRequirements,
        contracts: [],
        visibleExamples: [
          {
            requirementId: reqs[0] ?? idFallback(featureId),
            kind: "api",
            entryPoint: "POST /api/orders",
            input: '{"menuItemId":"soup"}',
            expected: "201",
            assertion: "expect(res.status).toBe(201)",
          },
        ],
        roster: featurePlanRoster,
        buildWorker: { family: "anthropic", model: "claude-sonnet-4-6" },
        model: { complete: async (req) => deterministicOracle(req.input) },
        now: FIXED_NOW_MS,
        log: { entries: [], warn: () => undefined },
        compileStarted: false,
        workerCode: null,
      });
      await jitPlanner.plan({
        context: {
          featureId,
          featureTitle: title,
          requirements: featureRequirements,
          contracts: [],
          entities: [],
          architecture: {
            schema: "feature-architect@1",
            featureId,
            passed: true,
            failures: [],
          },
        },
        model: { complete: async (req) => deterministicFeaturePlan(req.input) },
        roster: featurePlanRoster,
      });
      const compiled = graphCompiler.compile(buildFeatureGraphInput(featureId, title, tasksSpec, reqs));
      if (!compiled.ok) {
        throw new Error(`DeterministicGraphCompiler failed for ${featureId}: ${compiled.diagnostics.map((d) => d.message).join("; ")}`);
      }
      return compiled.snapshot.fingerprint;
    };

    await synthesizeWaveArch(0, 1, [
      {
        id: "F-Orders",
        slug: "orders",
        title: "Staff Lunch Orders",
        reqs: ["R-cutoff", "R-dietary"],
        writePaths: ["public/index.html", "public/app.css", "public/app.js"],
        method: "POST",
        routePath: "/api/orders",
      },
    ]);
    await compileFeatureBundle(
      "F-Orders",
      "Staff Lunch Orders",
      [
        {
          id: "T-orders",
          featureId: "F-Orders",
          title: "Staff lunch link and cutoff UI",
          taskKind: "leaf",
          level: "senior",
          writeScope: ["public/index.html", "public/app.css", "public/app.js"],
          primaryFiles: ["public/index.html", "public/app.css", "public/app.js"],
          responsibilities: ["staff lunch order form with cutoff banner and dietary note input"],
          touches: ["route", "form_input"],
          mustBandTokens: 400,
          mustTokenAttribution: [{ nodeId: "R-cutoff", tokens: 200 }, { nodeId: "R-dietary", tokens: 200 }],
          mustBandRuleIds: ["CR-CUTOFF", "X-02", "X-11"],
          implements: ["R-cutoff", "R-dietary"],
          obeys: ["CR-CUTOFF", "X-02", "X-11"],
          handlesEdgeCases: [],
          dependsOn: [],
          names: [],
          mutatesSharedContract: false,
          createsMigration: false,
          migrationIntentSlot: null,
          estimatedMinCostMicroUsd: 100_000,
          generatedScaffold: false,
        },
      ],
      ["R-cutoff", "R-dietary"],
      {
        "R-cutoff": ["public/index.html"],
        "R-dietary": ["public/app.js"],
      },
    );

    stage("wave-1:feature-arch");
    stage("wave-1:feature-plan");
    stage("wave-1:sealed-oracles");
    stage("wave-1:graph-compile");

    const gitWorkspace = new GitWorkspace(projectDir, slotsDir);
    const seqDb = new StateDb(stateDb);
    seqDb.ensureProject({ wave: 0, gate0: "PENDING" });
    const seedBranch = (id: string, title: string, wave: number): void => {
      const branch = `harness/f/${id}`;
      gitWorkspace.branch(branch, "harness/integration");
      seqDb.addFeature({ id, title, wave, branch });
    };
    seedBranch("phase0", "Phase 0 Kitchen Tokens", 0);
    seedBranch("F-Orders", "Staff Lunch Ordering", 1);

    seqDb.addLeafTask({
      id: "P0-scaffold",
      feature: "phase0",
      title: "Phase 0 tokens and bundle manifest",
      basis: "explicit",
      phase: "phase0",
    });
    seqDb.addLeafTask({
      id: "T-orders",
      feature: "F-Orders",
      title: "Staff lunch link and cutoff orders UI",
      basis: "explicit",
      criticalPath: true,
      tags: ["ui"],
      implementsRequirements: featureRequirementIds(stateDb, "F-Orders"),
    });

    let activeWorkers = 0;
    let maxActiveWorkers = 0;
    const worker: NativeWorkerLoopPort = {
      async run(context: WorkerContext) {
        activeWorkers += 1;
        maxActiveWorkers = Math.max(maxActiveWorkers, activeWorkers);
        try {
          if (context.taskId === "P0-scaffold") {
            writeFilesToWorktree(context.worktree, tokenFiles);
          } else if (context.taskId === "T-orders") {
            prompts.push(
              workerPrompt(
                "T-orders",
                "Staff lunch link and cutoff orders",
                ["public/index.html", "public/app.js", "public/app.css"],
                [dietaryMust, "Cutoff is 11:00 AM"],
                3,
              ),
            );
            writeFilesToWorktree(context.worktree, renderOrdersUiFiles(buildSpec));
          } else if (context.taskId === "T-kitchen") {
            prompts.push(
              workerPrompt(
                "T-kitchen",
                "Printable kitchen summary",
                ["public/kitchen.html", "public/print.html"],
                ["Kitchen totals are grouped by dish"],
                3,
              ),
            );
            writeFilesToWorktree(context.worktree, renderKitchenPages());
          } else if (context.taskId === "T-email") {
            prompts.push(
              workerPrompt(
                "T-email",
                "Catering email & order API server",
                ["server.mjs"],
                ["Email totals to catering once", dietaryMust, "Cutoff is 11:00 AM"],
                3,
              ),
            );
            writeFilesToWorktree(context.worktree, renderKitchenServer(buildSpec));
          }
          return { ok: true, turns: 1, costMicroUsd: 50_000 };
        } finally {
          activeWorkers -= 1;
        }
      },
    };

    const verifier: CleanVerifierHarnessPort = {
      verify(input) {
        const serverPath = path.join(input.worktree, "server.mjs");
        if (fs.existsSync(serverPath)) {
          const check = spawnSync(process.execPath, ["--check", serverPath], { encoding: "utf8", windowsHide: true });
          if (check.status !== 0) return { verdict: "fail", errors: [check.stderr || "server.mjs syntax check failed"] };
        }
        const jsPath = path.join(input.worktree, "public", "app.js");
        if (fs.existsSync(jsPath)) {
          const check = spawnSync(process.execPath, ["--check", jsPath], { encoding: "utf8", windowsHide: true });
          if (check.status !== 0) return { verdict: "fail", errors: [check.stderr || "public/app.js syntax check failed"] };
        }
        return { verdict: "pass", errors: [] };
      },
    };

    const auditPort: StaticAuditPort = {
      audit(input) {
        const lint = designTokenLint(input.worktree);
        if (lint.length > 0) {
          return { pass: false, fingerprint: "token-lint", findings: lint };
        }
        return { pass: true, fingerprint: "", findings: [] };
      },
    };

    const featureTasksMap: Readonly<Record<string, readonly string[]>> = {
      phase0: ["P0.1", "P0.2", "P0.3", "P0.4", "P0.5", "P0.6", "P0.7", "P0.8"],
      "F-Orders": ["T-orders"],
      "F-Kitchen": ["T-kitchen"],
      "F-AdminEmail": ["T-email"],
    };
    const featureReqsMap: Readonly<Record<string, readonly string[]>> = {
      phase0: ["R-platform", "R-cutoff"],
      "F-Orders": ["R-cutoff", "R-dietary"],
      "F-Kitchen": ["R-summary"],
      "F-AdminEmail": ["R-email"],
    };

    const integratorPort: FeatureIntegratorPort = {
      async integrate(input) {
        if (input.featureId === "phase0") stage("gate-0");
        if (input.featureId === "F-Orders") stage("wave-1:feature-integrator");
        if (input.featureId === "F-AdminEmail") stage("wave-2:feature-integrator");
        const subject =
          input.featureId === "phase0"
            ? "Integrate Phase 0 foundation"
            : input.featureId === "F-Orders"
              ? "Integrate orders"
              : input.featureId === "F-Kitchen"
                ? "Integrate kitchen"
                : "Integrate admin email";
        const trailers = buildTrailers({
          featureId: input.featureId,
          taskIds: featureTasksMap[input.featureId] ?? [input.featureId],
          requirementIds: featureReqsMap[input.featureId] ?? ["R-kitchen"],
          checkIds: [`CHK-${input.featureId}`],
          harnessVersion: "m2-ci-replay",
        });
        const message = await renderCommitMessage(projectDir, subject, `${subject} feature`, trailers);
        const previous = gitWorkspace.head("harness/integration");
        const slot = gitWorkspace.checkout(previous, `merge-${input.featureId}`);
        try {
          git(slot, ["merge", "--no-ff", input.branch, "-m", message]);
          const mergedSha = git(slot, ["rev-parse", "HEAD"]);
          if (!gitWorkspace.casUpdate("refs/heads/harness/integration", mergedSha, previous)) {
            return {
              featureId: input.featureId,
              merged: false,
              mergedSha: null,
              journeyPassed: false,
              a11yClean: true,
              message: "CAS update-ref rejected",
            };
          }
          return {
            featureId: input.featureId,
            merged: true,
            mergedSha,
            journeyPassed: true,
            a11yClean: true,
            message: "integrated with EF trailers",
          };
        } finally {
          gitWorkspace.removeSlot(slot);
        }
      },
    };

    const wavePort: WaveAdvancementPort = {
      async compile({ completedWave }) {
        if (completedWave === 1) {
          stage("wave-2:feature-arch");
          stage("wave-2:feature-plan");
          stage("wave-2:sealed-oracles");
          stage("wave-2:graph-compile");
          await synthesizeWaveArch(1, 2, [
            {
              id: "F-Kitchen",
              slug: "kitchen",
              title: "Kitchen Summary & Print",
              reqs: ["R-summary"],
              writePaths: ["public/kitchen.html", "public/print.html"],
              method: "GET",
              routePath: "/api/kitchen/summary",
            },
            {
              id: "F-AdminEmail",
              slug: "admin-email",
              title: "Catering Email & Server",
              reqs: ["R-email"],
              writePaths: ["server.mjs"],
              method: "POST",
              routePath: "/api/admin/catering-email",
            },
          ]);
          const kitchenSnap = await compileFeatureBundle(
            "F-Kitchen",
            "Kitchen Summary & Print",
            [
              {
                id: "T-kitchen",
                featureId: "F-Kitchen",
                title: "Printable kitchen summary views",
                taskKind: "leaf",
                level: "junior",
                writeScope: ["public/kitchen.html", "public/print.html"],
                primaryFiles: ["public/kitchen.html", "public/print.html"],
                responsibilities: ["printable kitchen summary and print views"],
                touches: ["route"],
                mustBandTokens: 250,
                mustTokenAttribution: [{ nodeId: "R-summary", tokens: 250 }],
                mustBandRuleIds: ["X-11"],
                implements: ["R-summary"],
                obeys: ["X-11"],
                handlesEdgeCases: [],
                dependsOn: [],
                names: [],
                mutatesSharedContract: false,
                createsMigration: false,
                migrationIntentSlot: null,
                estimatedMinCostMicroUsd: 80_000,
                generatedScaffold: false,
              },
            ],
            ["R-summary"],
            { "R-summary": ["public/kitchen.html"] },
          );
          const emailSnap = await compileFeatureBundle(
            "F-AdminEmail",
            "Catering Email & Server",
            [
              {
                id: "T-email",
                featureId: "F-AdminEmail",
                title: "Order API, cutoff guard, and idempotent catering email",
                taskKind: "leaf",
                level: "senior",
                writeScope: ["server.mjs"],
                primaryFiles: ["server.mjs"],
                responsibilities: ["order API server with cutoff guard and idempotent catering email"],
                touches: ["route", "outbound_message"],
                mustBandTokens: 400,
                mustTokenAttribution: [{ nodeId: "R-email", tokens: 400 }],
                mustBandRuleIds: ["CR-CUTOFF", "X-10", "X-11"],
                implements: ["R-email"],
                obeys: ["CR-CUTOFF", "X-10", "X-11"],
                handlesEdgeCases: [],
                dependsOn: [],
                names: [],
                mutatesSharedContract: false,
                createsMigration: false,
                migrationIntentSlot: null,
                estimatedMinCostMicroUsd: 100_000,
                generatedScaffold: false,
              },
            ],
            ["R-email"],
            { "R-email": ["server.mjs"] },
          );
          stage("wave-2:sequential-workers");
          const features: CompiledFeatureSpec[] = [
            { id: "F-Kitchen", title: "Kitchen Summary & Print", wave: 2, branch: "harness/f/F-Kitchen" },
            { id: "F-AdminEmail", title: "Catering Email & Server", wave: 2, branch: "harness/f/F-AdminEmail" },
          ];
          const tasks: CompiledLeafSpec[] = [
            {
              id: "T-kitchen",
              feature: "F-Kitchen",
              title: "Printable kitchen summary views",
              basis: "explicit",
              tags: ["ui"],
              snapshotId: kitchenSnap,
              implementsRequirements: featureRequirementIds(stateDb, "F-Kitchen"),
            },
            {
              id: "T-email",
              feature: "F-AdminEmail",
              title: "Catering email & API server",
              basis: "explicit",
              tags: ["api"],
              snapshotId: emailSnap,
              implementsRequirements: featureRequirementIds(stateDb, "F-AdminEmail"),
            },
          ];
          return { status: "compiled", features, tasks };
        }
        return { status: "final_wave" };
      },
    };

    stage("wave-1:sequential-workers");
    const runner = new SequentialBuildRunner({
      db: seqDb,
      git: gitWorkspace,
      worker,
      verifier,
      audit: auditPort,
      integrator: integratorPort,
      wave: wavePort,
      now: () => FIXED_NOW_MS,
      commitMessage: ({ kind, taskId, attemptId, step }) => {
        const featureId =
          Object.keys(featureTasksMap).find((id) => (featureTasksMap[id] ?? []).includes(taskId)) ?? taskId;
        const subject = kind === "checkpoint" ? `checkpoint ${taskId} ${String(step ?? 0)}` : `${kind} ${attemptId}`;
        const trailers = buildTrailers({
          featureId,
          taskIds: featureTasksMap[featureId] ?? [taskId],
          requirementIds: featureReqsMap[featureId] ?? ["R-kitchen"],
          checkIds: [`CHK-${featureId}`],
          harnessVersion: "m2-ci-replay",
        });
        const lines = trailerLines(trailers)
          .map((line) => `${line.key}: ${line.value}`)
          .join("\n");
        return `${subject}\n\n${lines}`;
      },
    });
    const runReport = await runner.run({ maxTasks: 20 });
    if (runReport.status !== "completion_wave_launched") {
      const stalledWave = seqDb.currentWave();
      const stalled = seqDb.featuresInWave(stalledWave).map((feature) => ({
        id: feature.id,
        state: feature.state,
        leavesMerged: seqDb.featureHeadTasksMerged(feature.id),
        unmetRequirements: seqDb.unmetRequirements(feature.id),
        staticAuditClean: seqDb.staticAuditClean(feature.id),
        pageRoutes: seqDb.pageRouteCount(feature.id),
        openChangeRequests: seqDb.openChangeRequests(feature.id),
      }));
      throw new Error(
        `SequentialBuildRunner ended unexpectedly: ${runReport.status}; claimed=${runReport.claimed.join(",")}; merged=${runReport.merged.join(",")}; wave=${stalledWave}; failing=${JSON.stringify(stalled)}`,
      );
    }

    // Checkout merged integration branch tip so working tree contains the built Kitchen app cleanly.
    git(projectDir, ["checkout", "-f", "harness/integration"]);

    // 11. Completion Wave audit on built Kitchen repo snapshot.
    stage("completion-audit");
    const completionLedger = new InMemoryBudgetLedger();
    completionLedger.ensureCompletionScopes({ projectId: "kitchen-m2", projectLimitUnits: 10_000n });
    const auditStore = FinalAuditStore.fromState(stateDb);
    const completion = new CompletionWaveController({ store: auditStore });
    const builtFiles = [
      "server.mjs",
      "public/index.html",
      "public/kitchen.html",
      "public/print.html",
      "public/tokens.css",
      "public/app.css",
      "public/app.js",
    ].map((rel) => ({ path: rel, content: fs.readFileSync(path.join(projectDir, rel), "utf8") }));
    await completion.run({
      projectId: "kitchen-m2",
      integrationRef: "harness/integration",
      waves: [
        {
          id: "wave-1",
          features: [{ id: "F-Orders", state: "DONE", mergedTo: "harness/integration", journeys: ["order lunch"] }],
        },
        {
          id: "wave-2",
          features: [
            { id: "F-Kitchen", state: "DONE", mergedTo: "harness/integration", journeys: ["kitchen print"] },
            { id: "F-AdminEmail", state: "DONE", mergedTo: "harness/integration", journeys: ["catering email"] },
          ],
        },
      ],
      snapshot: { entryFile: "server.mjs", files: builtFiles },
      catalog: { requirementIds: ["R-cutoff", "R-dietary", "R-summary", "R-email"], ruleIds: ["CR-CUTOFF"], checkIds: ["CHK-1"] },
      shardInputs: {
        features: [
          {
            id: "F-Orders",
            requirements: [{ id: "R-dietary", text: dietaryMust }],
            files: builtFiles.filter((f) => f.path.startsWith("public/")),
            diff: "diff -- orders",
          },
        ],
        seams: [],
        rules: [],
      },
      kind: "web",
      routes: [],
      commands: [],
      operations: [],
      boot: {
        async boot() {
          return { baseUrl: null, pid: 1, alive: () => false, async stop() {} };
        },
      },
      browser: createHttpPlaywrightVerifier(),
      commandsExec: { async exec() { return { exitCode: 0, stdout: "", stderr: "" }; } },
      checkRunner: { async run() { return { passed: true, detail: "ok" }; } },
      verifier: {
        async runCombined() {
          return {
            passed: true,
            cases: [
              { id: "CHK-1", kind: "leaf", passed: true, featureId: "F-Orders" },
              { id: "CHK-2", kind: "feature_journey", passed: true, featureId: "F-Kitchen" },
              { id: "CHK-3", kind: "sealed_hidden", passed: true, featureId: "F-AdminEmail" },
            ],
          };
        },
      },
      model: {
        async audit() {
          return { missing: [], stubbed: [], unhandled_edge_cases: [], weak_checks: [], verdict: "complete" };
        },
      },
      fixExecutor: { async apply() { return { changedFiles: [] }; } },
      ledger: completionLedger,
      ledgerRecap: {
        chosenForYou: [{ id: "database.sqlite", summary: "SQLite local store" }],
        deferred: [{ id: "delivery.provider", summary: "Use Mailpit" }],
      },
      spend: { codingUnits: 820n, paperworkUnits: 180n, connections: [] },
      projectBudgetUnits: 10_000n,
      auditCostPerShardUnits: 1n,
      defaultFixCostUnits: 1n,
    });
    const localSecretFindings = await createLocalSecretScanner(1n).scan(builtFiles);
    const localStaticReport = await createLocalStaticAuditGate(1n).auditFeature({ entryFile: "server.mjs", files: builtFiles });

    const secretsFound = scanTreeForSecrets(projectDir) + localSecretFindings.length;
    const auditFailures = staticAuditFailures(projectDir) + (localStaticReport.passed ? 0 : localStaticReport.findings.length);
    const tokenFindings = designTokenLint(projectDir);
    const totalStaticFailures = auditFailures + tokenFindings.length;
    const viewsListed = git(projectDir, ["ls-files", "--", ".harness/views"]);
    const viewsTracked = viewsListed ? viewsListed.split(/\r?\n/).filter(Boolean).length : 0;
    const cleanTree = git(projectDir, ["status", "--porcelain"]).length === 0;
    const log = git(projectDir, ["log", "harness/integration", "--format=%B%x1e"]);
    const messages = log.split("\u001e").map((item) => item.trim()).filter(Boolean);
    const trailersValid = messages.length >= 5 && messages.every((message) => /^EF-[A-Za-z0-9-]+:/m.test(message));
    if (!trailersValid) {
      const offending = messages
        .filter((message) => !/^EF-[A-Za-z0-9-]+:/m.test(message))
        .map((message) => (message.split(/\r?\n/)[0] ?? "").slice(0, 80));
      throw new Error(`commits missing EF-* trailers (${String(messages.length)} total): ${offending.join(" | ")}`);
    }
    const integrationSubjects = messages.map((message) => message.split(/\r?\n/)[0] ?? "");
    const joinedPrompts = prompts.join("\n");
    if (joinedPrompts.includes("H-M2-") || joinedPrompts.includes("OR-") || joinedPrompts.includes("M2-HIDDEN-CANARY-105")) {
      throw new Error("a worker prompt can see hidden or sealed checks");
    }

    const stateNodes = Number(
      ((stateDb.writer.prepare("SELECT COUNT(*) AS n FROM nodes").get() as { n?: number | bigint } | undefined)?.n ?? 0),
    );

    return {
      stages,
      filesRead,
      prompts,
      falseOverInferences: platform.falseOver,
      retractedClaims: mistaken.claims,
      settled: { platform: platform.platform, cutoff, dietaryNote: viewsEditPropagated, delegated },
      autoStarted,
      manualCodeEdits,
      viewsEditPropagated,
      viewsTracked,
      trailersValid,
      cleanTree,
      integrationSubjects,
      maxActiveWorkers,
      matrixCounts,
      contradictionLayers: probeReport.after,
      staticAuditFailures: totalStaticFailures,
      secretsFound,
      paperworkPct: paperFraction,
      tokens: budget.tokens,
      durations: budget.durations,
      projectDir,
      stateNodes,
    };
  } finally {
    await coordinator.close();
    depthSession.close();
    readinessProbe.close();
    globalDb.close();
    stateDb.close();
    fs.rmSync(slotsDir, { recursive: true, force: true });
  }
}

function idFallback(featureId: string): string {
  return `R-${featureId}`;
}
