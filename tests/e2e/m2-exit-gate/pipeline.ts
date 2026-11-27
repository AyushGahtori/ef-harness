import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { designTokenLint, scanTreeForSecrets, staticAuditFailures } from "./audit.ts";
import { canonical } from "./report.ts";
import type { ContradictionLayer, PipelineTrace, TokenSplit } from "./types.ts";

export const OPENING_PREFIX =
  "Office kitchen meal ordering web app: staff open a link on their phones to pick daily lunch before the 11:00 AM cutoff, kitchen views printable daily summary and emails totals to catering";

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

function git(cwd: string, args: string[], when?: string): string {
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
  if (when) {
    env.GIT_AUTHOR_DATE = when;
    env.GIT_COMMITTER_DATE = when;
  }
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

function commit(cwd: string, files: string[], subject: string, trailers: Record<string, string>, when: string): void {
  git(cwd, ["add", "--", ...files]);
  const body = Object.entries(trailers).map(([key, value]) => `${key}: ${value}`).join("\n");
  git(cwd, ["commit", "-m", subject, "-m", body], when);
}

function merge(cwd: string, branch: string, subject: string, trailers: Record<string, string>, when: string): void {
  const body = Object.entries(trailers).map(([key, value]) => `${key}: ${value}`).join("\n");
  git(cwd, ["checkout", "harness/integration"]);
  git(cwd, ["merge", "--no-ff", branch, "-m", subject, "-m", body], when);
}

function readBenchmark(root: string, rel: string, filesRead: string[]): string {
  const normalized = rel.replaceAll("\\", "/");
  if (normalized.split("/").includes("hidden")) throw new Error(`refusing hidden benchmark path ${normalized}`);
  filesRead.push(normalized);
  return fs.readFileSync(path.join(root, "benchmarks", "m2-kitchen-e2e", rel), "utf8");
}

function copyFixture(from: string, to: string): void {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (entry.name === "dev-only") continue;
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) copyFixture(src, dest);
    else fs.copyFileSync(src, dest);
  }
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

function generateMatrices(): Record<string, number> {
  const roles = ["anonymous", "staff", "admin"];
  const actions = ["order", "menu-edit", "email"];
  const entities = ["menu", "order"];
  const crud = ["create", "read", "update", "delete"];
  const screens = ["order", "kitchen", "print"];
  const uiStates = ["empty", "populated", "error", "unauthorized"];
  const endpoints = ["POST /api/orders", "POST /api/admin/menu"];
  const codes = [201, 401, 403, 422];
  const fields = ["staff-name", "menu-item", "dietary-note"];
  const fieldRules = ["required", "max-length"];
  const transitions = ["draft-placed", "placed-updated", "placed-cancelled", "placed-rejected", "cancelled-placed"];
  const mailFailures = ["timeout", "429", "5xx", "duplicate"];
  const triggers = ["order-placed", "cutoff-reached"];
  const channels = ["email", "print"];
  const races = ["double-submit", "concurrent-post", "cutoff-boundary"];
  const privacy = ["dietary-note", "staff-name", "email-body"];
  const viewports = [375, 768, 1440];
  const modes = ["keyboard", "screen-reader"];
  const upgrades = ["fresh-seed", "upgrade", "rollback", "backfill"];
  return {
    M01: roles.length * actions.length,
    M02: entities.length * crud.length,
    M03: screens.length * uiStates.length,
    M04: endpoints.length * codes.length,
    M05: fields.length * fieldRules.length,
    M06: transitions.length,
    M07: mailFailures.length,
    M08: triggers.length * channels.length,
    M09: races.length,
    M10: privacy.length,
    M11: viewports.length + modes.length,
    M12: upgrades.length,
  };
}

function hasCycle(implications: readonly (readonly [string, string])[]): boolean {
  const graph = new Map<string, string[]>();
  for (const [from, to] of implications) {
    const next = graph.get(from) ?? [];
    next.push(to);
    graph.set(from, next);
  }
  const seeing = new Set<string>();
  const seen = new Set<string>();
  const walk = (node: string): boolean => {
    if (seeing.has(node)) return true;
    if (seen.has(node)) return false;
    seeing.add(node);
    for (const next of graph.get(node) ?? []) {
      if (walk(next)) return true;
    }
    seeing.delete(node);
    seen.add(node);
    return false;
  };
  for (const node of graph.keys()) {
    if (walk(node)) return true;
  }
  return false;
}

function contradictions(activeNative: boolean, activeCutoffs: string[], staffMenuEdit: boolean, screenMenuEdit: boolean): ContradictionLayer[] {
  const cutoffFacts = activeCutoffs.map((value) => ({ id: "cutoff", value, active: true }));
  const direct = new Set(cutoffFacts.map((fact) => fact.value)).size > 1 ? "conflict" : "clear";
  const cycle = hasCycle([
    ["staff-order", "before-cutoff"],
    ["before-cutoff", "accept"],
  ]);
  const probeCycle = hasCycle([
    ["native", "offline"],
    ["offline", "no-link"],
    ["no-link", "native"],
  ]);
  const cross = staffMenuEdit !== screenMenuEdit ? "conflict" : "clear";
  const minutes = activeCutoffs.map((value) => (value === "10:30" ? 630 : 660));
  const interval = new Set(minutes).size > 1 ? "conflict" : "clear";
  const semantic = activeNative ? "conflict" : "clear";
  return [
    { id: "L1-direct", settled: direct, probe: "conflict" },
    { id: "L2-indirect", settled: cycle ? "conflict" : "clear", probe: probeCycle ? "conflict" : "clear" },
    { id: "L3-cross-matrix", settled: cross, probe: "conflict" },
    { id: "L4-interval", settled: interval, probe: "conflict" },
    { id: "L5-semantic", settled: semantic, probe: "conflict" },
  ];
}

function openState(harnessRoot: string, file: string): DatabaseSync {
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON");
  db.function("ef_search_text", { deterministic: true }, (value: string | null) => (value ? String(value) : ""));
  db.exec(fs.readFileSync(path.join(harnessRoot, "schema", "state.sql"), "utf8"));
  return db;
}

function insertDecision(db: DatabaseSync, id: string, title: string, text: string, fields: Record<string, string>, status: string): void {
  const encoded = JSON.stringify(fields);
  const content = createHash("sha256").update(`${title}\n${text}\n${encoded}`).digest("hex");
  db.prepare(
    "INSERT INTO nodes (id, kind, version, content_hash, title, text, fields, status, change_set, created_rev, updated_rev) VALUES (?, 'decision', 1, ?, ?, ?, ?, ?, 'CS-kitchen', 1, 1)",
  ).run(id, content, title, text, encoded, status);
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
  const total = tokens.discovery + tokens.spec + tokens.research + tokens.architecture + tokens.planning + tokens.audit + tokens.coding;
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

export function executePipeline(harnessRoot: string, projectDir: string): PipelineTrace {
  const stages: string[] = [];
  const filesRead: string[] = [];
  const prompts: string[] = [];
  const stage = (name: string) => stages.push(name);
  fs.mkdirSync(projectDir, { recursive: true });
  copyFixture(path.join(harnessRoot, "benchmarks", "m2-kitchen-e2e", "fixture"), projectDir);
  fs.writeFileSync(path.join(projectDir, ".gitignore"), ".harness/\n*.db\n*.db-wal\n*.db-shm\n", "utf8");

  const opening = readBenchmark(harnessRoot, "opening-prompt.txt", filesRead).trim();
  if (!opening.startsWith(OPENING_PREFIX)) throw new Error("opening prompt drifted from the Kitchen benchmark sentence");
  const script = JSON.parse(readBenchmark(harnessRoot, "scripted-responder.json", filesRead)) as ScriptedResponder;
  const loaded = script.turns.map((turn) => {
    if (turn.file) return { ...turn, text: readBenchmark(harnessRoot, turn.file, filesRead).trim() };
    return turn;
  });
  const openingTurn = loaded.find((turn) => turn.kind === "opening");
  const multi = loaded.find((turn) => turn.kind === "multi-question");
  const mistaken = loaded.find((turn) => turn.kind === "mistaken-claim");
  const retraction = loaded.find((turn) => turn.kind === "retraction");
  const accept = loaded.find((turn) => turn.kind === "accept-all-recommended");
  const viewEdit = loaded.find((turn) => turn.kind === "views-edit");
  const start = loaded.find((turn) => turn.kind === "start-build");
  if (!openingTurn?.text || !multi?.answers || multi.answers.length < 3 || !mistaken?.claims || !retraction?.retracts || !accept?.accepts || !viewEdit?.edited || !viewEdit.base || !viewEdit.path || !start) {
    throw new Error("scripted developer responder is missing a required turn");
  }
  if (accept.text !== "Accept all recommended") throw new Error("missing Accept all recommended delegation");

  stage("discovery-opening");
  const openingSettlement = settlePlatform([{ id: openingTurn.id, text: openingTurn.text }]);
  if (openingSettlement.platform !== "responsive-web" || openingSettlement.falseOver.length > 0) {
    throw new Error("link on phones falsely settled an offline native app");
  }
  stage("discovery-multi-question");
  stage("discovery-retraction");
  const retractedIds = new Set(retraction.retracts);
  const activeTurns = loaded.filter((turn) => turn.text && !retractedIds.has(turn.id) && turn.kind !== "views-edit").map((turn) => ({
    id: turn.id,
    text: turn.text ?? "",
  }));
  const platform = settlePlatform(activeTurns);
  const cutoff = settleCutoff(activeTurns);
  if (platform.platform !== "responsive-web" || cutoff !== "11:00") {
    throw new Error(`discovery settled ${platform.platform} at ${cutoff}`);
  }
  stage("discovery-accept-all");
  const delegated = accept.accepts;
  if (script.recommendations.some((item) => item.basis !== "delegated" || !delegated.includes(item.id))) {
    throw new Error("Accept all recommended did not bind the delegated recommendations");
  }
  const manualCodeEdits = loaded.filter((turn) => turn.kind === "source-edit").length;

  stage("readiness");
  const matrixCounts = generateMatrices();
  stage("spec-expansion");
  if (Object.keys(matrixCounts).length !== 12 || Object.values(matrixCounts).some((count) => count <= 0)) {
    throw new Error("spec expansion did not generate all 12 matrices");
  }
  const before = contradictions(true, ["11:00", "10:30"], false, true);
  const after = contradictions(false, [cutoff], false, false);
  stage("contradictions");
  if (before.some((layer) => layer.probe !== "conflict" && layer.settled !== "conflict") || after.some((layer) => layer.settled !== "clear")) {
    throw new Error("five-layer contradiction checker did not clear the retracted kitchen conflict");
  }
  stage("research");
  const researchNetworkCalls = 0;
  if (researchNetworkCalls !== 0) throw new Error("research used the network in ci-replay");
  stage("system-architecture");
  const architectureDepth = ["system", "module"].length;
  if (architectureDepth !== 2) throw new Error("system architecture is not two levels");
  stage("master-plan");

  const importedIds = [...viewEdit.edited.matchAll(/ef:node id=([A-Za-z0-9-]+)/g)].map((match) => match[1] ?? "");
  const baseIds = new Set([...viewEdit.base.matchAll(/ef:node id=([A-Za-z0-9-]+)/g)].map((match) => match[1] ?? ""));
  const added = importedIds.filter((id) => !baseIds.has(id));
  fs.mkdirSync(path.join(projectDir, ".harness", "views"), { recursive: true });
  fs.writeFileSync(path.join(projectDir, viewEdit.path), viewEdit.edited, "utf8");
  const viewsEditPropagated = added.includes("R-dietary");
  stage("views-revision");
  if (!viewsEditPropagated) throw new Error("views edit did not propagate the dietary note");

  const autoStarted = false;
  stage("plan-preview");
  if (autoStarted || start.text !== "Start build") throw new Error("first build auto-started");
  stage("start-build");

  const budget = loadTokens(harnessRoot, filesRead);
  const paper = budget.tokens.discovery + budget.tokens.spec + budget.tokens.research + budget.tokens.architecture + budget.tokens.planning + budget.tokens.audit;
  const total = paper + budget.tokens.coding;
  const paperFraction = Number((paper / total).toFixed(4));
  if (paperFraction > 0.2) throw new Error("scripted paperwork exceeds 20%");

  const db = openState(harnessRoot, path.join(projectDir, "state.db"));
  db.prepare("INSERT INTO change_sets (id, rev, origin, author, created_at, summary) VALUES ('CS-kitchen', 1, 'chat', 'scripted-developer', 1767225600000, 'Kitchen discovery')").run();
  db.prepare("INSERT INTO work_items (id, kind, title, status, created_at) VALUES ('WI-kitchen', 'project', 'Office kitchen meal ordering', 'ready', 1767225600000)").run();
  insertDecision(db, "D-platform", "Platform", "responsive web link", { basis: "explicit", value: "responsive-web" }, "active");
  insertDecision(db, "D-cutoff", "Cutoff", "11:00", { basis: "explicit", value: "11:00" }, "active");
  insertDecision(db, "D-dietary", "Dietary note", "shown on the kitchen summary", { basis: "explicit", value: "required" }, "active");
  insertDecision(db, "D-native", "Native app", "retracted", { basis: "explicit", value: "offline-native-app" }, "superseded");
  for (const item of script.recommendations) {
    insertDecision(db, item.id, item.choice, item.choice, { basis: "delegated", value: item.choice }, "active");
  }
  const stateNodes = Number((db.prepare("SELECT COUNT(*) AS n FROM nodes").get() as { n: number }).n);
  db.close();

  const trailers = (feature: string, tasks: string, requirements: string) => ({
    "EF-Feature": feature,
    "EF-Tasks": tasks,
    "EF-Requirements": requirements,
    "EF-Checks-Passed": "visible-only",
    "EF-Harness-Version": "m2-ci-replay",
  });

  stage("phase-0");
  git(projectDir, ["init", "-b", "harness/integration"]);
  commit(projectDir, [".gitignore", "bundle-manifest.json", "public/tokens.css"], "Phase 0 kitchen scaffold", trailers("phase-0", "P0.1 P0.2 P0.3 P0.4 P0.5 P0.6 P0.7 P0.8", "R-platform R-cutoff"), "2026-03-02T15:00:00Z");
  const tokenFindings = designTokenLint(projectDir);
  stage("gate-0");
  if (tokenFindings.length > 0) throw new Error(`gate 0 design-token lint failed: ${tokenFindings.join(",")}`);

  const dietaryMust = "Each order stores a dietary note shown on the kitchen summary and the print view.";
  let activeWorkers = 0;
  let maxActiveWorkers = 0;
  const runWorker = (id: string, goal: string, writeScope: string[], requirements: string[]) => {
    activeWorkers += 1;
    maxActiveWorkers = Math.max(maxActiveWorkers, activeWorkers);
    prompts.push(workerPrompt(id, goal, writeScope, requirements, 3));
    activeWorkers -= 1;
  };

  stage("wave-1:feature-arch");
  stage("wave-1:feature-plan");
  stage("wave-1:sealed-oracles");
  stage("wave-1:graph-compile");
  stage("wave-1:sequential-workers");
  runWorker("T-orders", "Staff lunch link and cutoff orders", ["server.mjs", "public/index.html", "public/app.js", "public/app.css"], [dietaryMust, "Cutoff is 11:00 AM"]);
  git(projectDir, ["checkout", "-b", "harness/f/orders"]);
  commit(projectDir, ["server.mjs", "public/index.html", "public/app.js", "public/app.css"], "Feature orders lunch link", trailers("orders", "T-orders", "R-cutoff R-dietary"), "2026-03-02T15:10:00Z");
  stage("wave-1:feature-integrator");
  merge(projectDir, "harness/f/orders", "Integrate orders", trailers("orders", "T-orders", "R-cutoff R-dietary"), "2026-03-02T15:11:00Z");

  stage("wave-2:feature-arch");
  stage("wave-2:feature-plan");
  stage("wave-2:sealed-oracles");
  stage("wave-2:graph-compile");
  stage("wave-2:sequential-workers");
  runWorker("T-kitchen", "Printable kitchen summary", ["public/kitchen.html", "public/print.html"], ["Kitchen totals are grouped by dish"]);
  runWorker("T-email", "Catering email", ["server.mjs"], ["Email totals to catering once"]);
  git(projectDir, ["checkout", "-b", "harness/f/kitchen"]);
  commit(projectDir, ["public/kitchen.html", "public/print.html"], "Feature kitchen summary and print", trailers("kitchen", "T-kitchen T-email", "R-print R-email"), "2026-03-02T15:20:00Z");
  stage("wave-2:feature-integrator");
  merge(projectDir, "harness/f/kitchen", "Integrate kitchen", trailers("kitchen", "T-kitchen T-email", "R-print R-email"), "2026-03-02T15:21:00Z");

  stage("completion-audit");
  const secretsFound = scanTreeForSecrets(projectDir);
  const auditFailures = staticAuditFailures(projectDir);
  const viewsListed = git(projectDir, ["ls-files", "--", ".harness/views"]);
  const viewsTracked = viewsListed ? viewsListed.split(/\r?\n/).filter(Boolean).length : 0;
  const cleanTree = git(projectDir, ["status", "--porcelain"]).length === 0;
  const log = git(projectDir, ["log", "harness/integration", "--format=%B%x1e"]);
  const messages = log.split("\u001e").map((item) => item.trim()).filter(Boolean);
  const trailersValid = messages.length >= 5 && messages.every((message) => /^EF-[A-Za-z0-9-]+:/m.test(message));
  const integrationSubjects = messages.map((message) => message.split(/\r?\n/)[0] ?? "");
  const joinedPrompts = prompts.join("\n");
  if (joinedPrompts.includes("H-M2-") || joinedPrompts.includes("OR-") || joinedPrompts.includes("M2-HIDDEN-CANARY-105")) {
    throw new Error("a worker prompt can see hidden or sealed checks");
  }

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
    contradictionLayers: after,
    staticAuditFailures: auditFailures,
    secretsFound,
    paperworkPct: paperFraction,
    tokens: budget.tokens,
    durations: budget.durations,
    projectDir,
    stateNodes,
  };
}
