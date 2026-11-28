import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FeatureUndoEngine } from "../../src/undo/engine.js";
import { HistoryRewriteError } from "../../src/undo/errors.js";
import { GitRepo, renderTrailers } from "../../src/undo/git.js";

const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

function write(root: string, relative: string, text: string): void {
  const full = path.join(root, ...relative.split("/"));
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, text.replaceAll("\r\n", "\n"), "utf8");
}

function initRepo(): { root: string; repo: string; git: GitRepo } {
  const root = mkdtempSync(path.join(tmpdir(), "ef-undo-"));
  roots.push(root);
  const repo = path.join(root, "repo");
  mkdirSync(repo);
  const git = new GitRepo(repo);
  git.ok(["init", "--initial-branch=harness/integration"]);
  write(repo, "README.md", "base\n");
  git.ok(["add", "-A"]);
  git.ok(["commit", "-m", "base"]);
  return { root, repo, git };
}

function mergeFeature(git: GitRepo, id: string, files: Record<string, string>): string {
  const branch = `harness/f/${id}`;
  git.ok(["branch", branch, "harness/integration"]);
  const slot = path.join(tmpdir(), `ef-feat-${id}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  git.ok(["worktree", "add", slot, branch]);
  try {
    for (const [relative, text] of Object.entries(files)) write(slot, relative, text);
    const slotGit = git.child(slot);
    slotGit.ok(["add", "-A"]);
    slotGit.ok(["commit", "-m", `feature ${id}`]);
  } finally {
    git.run(["worktree", "remove", "--force", slot]);
    rmSync(slot, { recursive: true, force: true });
  }
  const message = renderTrailers(`merge ${id}`, `${id} canonical spec`, {
    feature: id,
    tasks: [`T-${id}`],
    requirements: [`R-${id}`],
    checksPassed: "pass",
    harnessVersion: "0.0.0",
  });
  git.ok(["merge", "--no-ff", "-m", message, branch]);
  return git.revParse("HEAD");
}

function engineFor(root: string, repo: string, beforeCas?: (info: { newSha: string; oldSha: string }) => void): FeatureUndoEngine {
  return new FeatureUndoEngine({
    repo,
    stateFile: path.join(root, "state.db"),
    now: () => Date.parse("2026-11-22T00:00:00.000Z"),
    ...(beforeCas ? { beforeCas } : {}),
  });
}

function show(git: GitRepo, spec: string): string {
  const result = git.run(["show", spec]);
  return result.status === 0 ? result.stdout : "";
}

function passingTest(id: string): string {
  return `process.stdout.write(${JSON.stringify(id)} + "\\n");\n`;
}

describe("planned feature undo", { timeout: 30_000 }, () => {
  it("partitions exclusive files, shared imports and graph edges, and persistent schema", () => {
    const { root, repo, git } = initRepo();
    const engine = engineFor(root, repo);
    try {
      const kitchen = mergeFeature(git, "F-Kitchen", {
        "features/F-Kitchen/only.tsx": "export const only = true;\n",
        "features/F-Kitchen/journey.test.mjs": passingTest("F-Kitchen"),
        "src/lib/formatDate.ts": "export function formatDate(value: string): string { return value; }\n",
        "src/lib/graph-only.ts": "export const graphOnly = true;\n",
        "migrations/001_dietary.sql": "CREATE TABLE dietary_tags (\n  id INTEGER PRIMARY KEY\n);\n",
      });
      mergeFeature(git, "F-Later", {
        "features/F-Later/use.ts": 'import { formatDate } from "../../src/lib/formatDate.ts";\nexport const used = formatDate("Monday");\n',
        "features/F-Later/journey.test.mjs": passingTest("F-Later"),
        "features/F-Later/migrations/002_later.sql":
          "CREATE TABLE later_orders (\n  id INTEGER PRIMARY KEY,\n  tag_id INTEGER REFERENCES dietary_tags(id)\n);\n",
      });
      engine.graph.registerFeature({
        featureId: "F-Kitchen",
        title: "Kitchen menu",
        lifecycle: "DONE",
        branch: "harness/f/F-Kitchen",
        mergeSha: kitchen,
        specs: "Menu spec",
        decisions: ["Show dietary tags"],
        taskIds: ["T-F-Kitchen"],
        landed: true,
      });
      engine.graph.registerFeature({
        featureId: "F-Later",
        title: "Later",
        lifecycle: "DONE",
        branch: "harness/f/F-Later",
        landed: true,
      });
      engine.graph.registerFeature({
        featureId: "F-Other",
        title: "Other",
        lifecycle: "DONE",
        branch: "harness/f/F-Other",
        landed: true,
      });
      engine.graph.addEdge({
        src: "F-Other",
        type: "consumes",
        dst: "F-Kitchen",
        artifactPath: "src/lib/graph-only.ts",
      });
      engine.graph.addEdge({
        src: "F-Later",
        type: "implements",
        dst: "F-Kitchen",
        artifactPath: "src/lib/formatDate.ts",
      });
      const before = git.revParse("harness/integration");
      const inventory = engine.analyzer.analyze("F-Kitchen");
      const preview = engine.dialog.present(inventory, engine.ownership.plan(inventory));
      expect(git.revParse("harness/integration")).toBe(before);
      expect(git.ok(["status", "--porcelain"]).stdout).toBe("");
      expect(inventory.exclusive.map((item) => item.path)).toEqual(
        expect.arrayContaining(["features/F-Kitchen/only.tsx", "features/F-Kitchen/journey.test.mjs"]),
      );
      expect(inventory.shared.map((item) => item.path)).toEqual(
        expect.arrayContaining(["src/lib/formatDate.ts", "src/lib/graph-only.ts"]),
      );
      expect(inventory.shared.find((item) => item.path === "src/lib/formatDate.ts")?.reasons).toEqual(
        expect.arrayContaining(["import"]),
      );
      expect(inventory.shared.find((item) => item.path === "src/lib/graph-only.ts")?.referencedBy).toContain("F-Other");
      const table = inventory.persistentData.find((item) => item.symbol === "dietary_tags");
      expect(table?.bucket).toBe("persistent_data");
      expect(table?.referencedBy).toContain("F-Later");
      expect(inventory.persistentData.some((item) => item.path === "migrations/001_dietary.sql")).toBe(true);
      expect(inventory.exclusiveRatio).toBeLessThan(1);
      expect(inventory.fastPathCandidate).toBe(false);
      expect(inventory.llmTokens).toBe(0);
      expect(preview.plainEnglish).toContain("Keep schema/data dormant (Safe default — expand-then-contract)");
      expect(preview.dataChoiceDefault).toBe("keep_dormant");
      expect(preview.executionMode).toBe("surgical_removal");
      expect(preview.transfers.some((item) => item.path === "src/lib/formatDate.ts" && item.toFeatureId === "F-Later")).toBe(
        true,
      );
      expect(preview.transfers.some((item) => item.path === "src/lib/graph-only.ts" && item.toFeatureId === "F-Other")).toBe(
        true,
      );
    } finally {
      engine.close();
    }
  });

  it("reverts an exclusive non-ff merge at 0 LLM tokens and keeps history forward", () => {
    const { root, repo, git } = initRepo();
    const engine = engineFor(root, repo);
    try {
      mergeFeature(git, "F-Home", {
        "features/F-Home/journey.test.mjs": passingTest("F-Home"),
      });
      const mergeSha = mergeFeature(git, "F-Print", {
        "features/F-Print/page.tsx": "export const route = { path: \"/print\" };\n",
        "features/F-Print/journey.test.mjs": "process.exit(1);\n",
      });
      const before = git.revParse("harness/integration");
      engine.graph.registerFeature({
        featureId: "F-Print",
        title: "Kitchen print",
        lifecycle: "DONE",
        branch: "harness/f/F-Print",
        mergeSha,
        specs: "Canonical print view spec",
        decisions: ["Show the print view"],
        taskIds: ["T-F-Print"],
        landed: true,
      });
      engine.graph.registerFeature({
        featureId: "F-Home",
        title: "Home",
        lifecycle: "DONE",
        branch: "harness/f/F-Home",
        landed: true,
      });
      const inventory = engine.analyzer.analyze("F-Print");
      expect(inventory.fastPathCandidate).toBe(true);
      expect(inventory.exclusiveRatio).toBe(1);
      expect(inventory.llmTokens).toBe(0);
      const result = engine.execute("F-Print", { apply: true });
      expect(result.landed).toBe(true);
      expect(result.mode).toBe("fast_path_revert");
      expect(result.llmTokens).toBe(0);
      expect(result.historyRewritten).toBe(false);
      expect(result.commands.some((command) => command.startsWith("revert -m 1 "))).toBe(true);
      expect(result.commands.join("\n")).not.toMatch(/(^|\n)\s*reset(\s|$)/);
      expect(result.integrationSha).not.toBe(before);
      expect(git.parents(result.commitSha)[0]).toBe(before);
      expect(git.isAncestor(mergeSha, "harness/integration")).toBe(true);
      expect(git.isAncestor(before, result.commitSha)).toBe(true);
      expect(show(git, "harness/integration:features/F-Print/page.tsx")).toBe("");
      expect(show(git, "harness/integration:features/F-Home/journey.test.mjs")).toContain("F-Home");
      expect(git.commitMessage(result.commitSha)).toContain("EF-Llm-Tokens: 0");
      expect(engine.graph.getFeature("F-Print")?.nodeStatus).toBe("undone");
      expect(engine.graph.getFeature("F-Print")?.featureId).toBe("F-Print");
      expect(() => engine.git.run(["reset", "--hard", "HEAD"])).toThrow(HistoryRewriteError);
      const revived = engine.revive({ text: "Add the print page back" });
      expect(revived.featureId).toBe("F-Print");
      expect(revived.specs).toBe("Canonical print view spec");
      expect(revived.decisions).toEqual(["Show the print view"]);
      expect(revived.mergeSha).toBe(mergeSha);
      expect(revived.nodeStatus).toBe("active");
      expect(revived.revived).toBe(true);
    } finally {
      engine.close();
    }
  });

  it("transfers currency.ts to the consuming feature and leaves that feature green", () => {
    const { root, repo, git } = initRepo();
    const engine = engineFor(root, repo);
    try {
      const mergeSha = mergeFeature(git, "F-Menu", {
        "src/lib/currency.ts": "export function formatMoney(cents: number): string { return String(cents); }\n",
        "features/F-Menu/menu.tsx": "import { formatMoney } from \"../../src/lib/currency.ts\";\nexport const price = formatMoney(1);\n",
        "features/F-Menu/journey.test.mjs": "process.exit(1);\n",
      });
      mergeFeature(git, "F-CateringEmail", {
        "features/F-CateringEmail/email.tsx":
          "import { formatMoney } from \"../../src/lib/currency.ts\";\nexport const body = formatMoney(2);\n",
        "features/F-CateringEmail/journey.test.mjs": [
          "import { readFileSync } from 'node:fs';",
          "import path from 'node:path';",
          "import { fileURLToPath } from 'node:url';",
          "const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/lib/currency.ts');",
          "const text = readFileSync(file, 'utf8');",
          "if (!text.includes('formatMoney')) process.exit(1);",
          "",
        ].join("\n"),
      });
      engine.graph.registerFeature({
        featureId: "F-Menu",
        title: "Menu",
        lifecycle: "DONE",
        branch: "harness/f/F-Menu",
        mergeSha,
        specs: "Menu prices",
        decisions: ["Format money once"],
        taskIds: ["T-F-Menu"],
        landed: true,
      });
      engine.graph.registerFeature({
        featureId: "F-CateringEmail",
        title: "Catering email",
        lifecycle: "DONE",
        branch: "harness/f/F-CateringEmail",
        landed: true,
      });
      engine.graph.addEdge({
        src: "F-CateringEmail",
        type: "consumes",
        dst: "F-Menu",
        artifactPath: "src/lib/currency.ts",
      });
      const result = engine.execute("F-Menu", { apply: true });
      expect(result.landed).toBe(true);
      expect(result.mode).toBe("surgical_removal");
      expect(result.regression?.ok).toBe(true);
      expect(result.regression?.passed.some((script) => script.includes("F-CateringEmail"))).toBe(true);
      expect(show(git, "harness/integration:src/lib/currency.ts")).toContain("formatMoney");
      expect(show(git, "harness/integration:features/F-Menu/menu.tsx")).toBe("");
      expect(result.transfers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: "src/lib/currency.ts", fromFeatureId: "F-Menu", toFeatureId: "F-CateringEmail" }),
        ]),
      );
      expect(engine.graph.listOwnership()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: "src/lib/currency.ts", ownerFeatureId: "F-CateringEmail" }),
        ]),
      );
      expect(engine.graph.getFeature("F-Menu")?.nodeStatus).toBe("undone");
      expect(engine.graph.getFeature("F-CateringEmail")?.nodeStatus).toBe("active");
    } finally {
      engine.close();
    }
  });

  it("falls back to surgical removal when merge-tree reports a nav-line conflict", () => {
    const { root, repo, git } = initRepo();
    const engine = engineFor(root, repo);
    try {
      write(repo, "src/App.tsx", "export const nav = [\n  \"home\",\n];\n");
      git.ok(["add", "-A"]);
      git.ok(["commit", "-m", "nav shell"]);
      const printSha = mergeFeature(git, "F-Print", {
        "src/App.tsx": "export const nav = [\n  \"home\",\n  \"print\",\n];\n",
        "features/F-Print/journey.test.mjs": "process.exit(1);\n",
      });
      mergeFeature(git, "F-Email", {
        "src/App.tsx": "export const nav = [\n  \"home\",\n  \"print\",\n  \"email\",\n];\n",
        "features/F-Email/journey.test.mjs": [
          "import { readFileSync } from 'node:fs';",
          "import path from 'node:path';",
          "import { fileURLToPath } from 'node:url';",
          "const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/App.tsx');",
          "const text = readFileSync(file, 'utf8');",
          "if (!text.includes('\"email\"')) process.exit(1);",
          "if (text.includes('\"print\"')) process.exit(1);",
          "",
        ].join("\n"),
      });
      engine.graph.registerFeature({
        featureId: "F-Print",
        title: "Print",
        lifecycle: "DONE",
        branch: "harness/f/F-Print",
        mergeSha: printSha,
        specs: "Print nav",
        decisions: [],
        taskIds: ["T-F-Print"],
        landed: true,
      });
      engine.graph.registerFeature({
        featureId: "F-Email",
        title: "Email",
        lifecycle: "DONE",
        branch: "harness/f/F-Email",
        landed: true,
      });
      const inventory = engine.analyzer.analyze("F-Print");
      expect(inventory.fastPathCandidate).toBe(false);
      expect(inventory.revertConflicts.length).toBeGreaterThan(0);
      expect(inventory.laterOverlapPaths).toContain("src/App.tsx");
      const result = engine.execute("F-Print", { apply: true });
      expect(result.landed).toBe(true);
      expect(result.mode).toBe("surgical_removal");
      expect(result.commands.some((command) => command.startsWith("merge-tree "))).toBe(true);
      expect(result.commands.some((command) => command.startsWith("revert "))).toBe(false);
      const app = show(git, "harness/integration:src/App.tsx");
      expect(app).toContain('"email"');
      expect(app).not.toContain('"print"');
      expect(result.regression?.ok).toBe(true);
    } finally {
      engine.close();
    }
  });

  it("cancels an in-flight feature without moving harness/integration", () => {
    const { root, repo, git } = initRepo();
    const engine = engineFor(root, repo);
    try {
      const before = git.revParse("harness/integration");
      git.ok(["branch", "harness/f/F-Reports", "harness/integration"]);
      const slot = path.join(tmpdir(), `ef-reports-${Date.now()}`);
      git.ok(["worktree", "add", slot, "harness/f/F-Reports"]);
      try {
        write(slot, "features/F-Reports/draft.ts", "export const draft = true;\n");
        const slotGit = git.child(slot);
        slotGit.ok(["add", "-A"]);
        slotGit.ok(["commit", "-m", "wip reports"]);
        const sha = slotGit.revParse("HEAD");
        git.ok(["update-ref", "refs/harness/checkpoints/F-Reports/1", sha]);
      } finally {
        git.run(["worktree", "remove", "--force", slot]);
        rmSync(slot, { recursive: true, force: true });
      }
      engine.graph.registerFeature({
        featureId: "F-Reports",
        title: "Reports",
        lifecycle: "WORKING",
        branch: "harness/f/F-Reports",
        specs: "Reports spec",
        decisions: ["Nightly report"],
        landed: false,
      });
      for (const id of ["w1", "w2", "w3"]) {
        engine.graph.addWorker({ id, featureId: "F-Reports", pid: 1000 + id.length });
      }
      engine.graph.addInbox({
        id: "Q-Reports",
        featureId: "F-Reports",
        exclusive: true,
        status: "open",
        text: "Which columns?",
      });
      const result = engine.execute("F-Reports", { apply: true });
      expect(result.mode).toBe("in_flight_cancel");
      expect(result.landed).toBe(false);
      expect(result.integrationUnchanged).toBe(true);
      expect(git.revParse("harness/integration")).toBe(before);
      expect(result.elapsedMs).toBeLessThan(2000);
      expect(result.haltedWorkerIds).toEqual(["w1", "w2", "w3"]);
      expect(engine.graph.listWorkers("F-Reports").every((worker) => worker.halted)).toBe(true);
      expect(result.retiredQuestionIds).toEqual(["Q-Reports"]);
      expect(engine.graph.listInbox("F-Reports")[0]?.status).toBe("retired");
      expect(engine.graph.getFeature("F-Reports")?.nodeStatus).toBe("undone");
      expect(git.run(["rev-parse", "--verify", "refs/heads/harness/f/F-Reports"]).status).not.toBe(0);
      expect(git.run(["rev-parse", "--verify", "refs/harness/archive/f/F-Reports"]).status).toBe(0);
      expect(git.run(["rev-parse", "--verify", "refs/harness/checkpoints/F-Reports/1"]).status).not.toBe(0);
      expect(git.run(["rev-parse", "--verify", "refs/harness/archive/checkpoints/F-Reports/1"]).status).toBe(0);
      expect(show(git, "harness/integration:README.md")).toContain("base");
    } finally {
      engine.close();
    }
  });

  it("keeps loyalty schema dormant unless a new drop migration is explicitly confirmed", () => {
    const { root, repo, git } = initRepo();
    const engine = engineFor(root, repo);
    const migration = "migrations/20240101_loyalty.sql";
    const sql = "CREATE TABLE loyalty_ledger (\n  id INTEGER PRIMARY KEY\n);\n";
    try {
      const mergeSha = mergeFeature(git, "F-LoyaltyPoints", {
        [migration]: sql,
        "features/F-LoyaltyPoints/points.ts": "export const points = 1;\n",
        "features/F-LoyaltyPoints/journey.test.mjs": "process.exit(1);\n",
      });
      mergeFeature(git, "F-Home", { "features/F-Home/journey.test.mjs": passingTest("F-Home") });
      engine.graph.registerFeature({
        featureId: "F-LoyaltyPoints",
        title: "Loyalty",
        lifecycle: "DONE",
        branch: "harness/f/F-LoyaltyPoints",
        mergeSha,
        specs: "Loyalty ledger",
        decisions: ["Keep points"],
        taskIds: ["T-F-LoyaltyPoints"],
        landed: true,
      });
      engine.graph.registerFeature({
        featureId: "F-Home",
        title: "Home",
        lifecycle: "DONE",
        branch: "harness/f/F-Home",
        landed: true,
      });
      const beforeHash = createHash("sha256").update(show(git, `harness/integration:${migration}`)).digest("hex");
      const preview = engine.dialog.present(
        engine.analyzer.analyze("F-LoyaltyPoints"),
        engine.ownership.plan(engine.analyzer.analyze("F-LoyaltyPoints")),
      );
      expect(preview.plainEnglish).toContain("loyalty_ledger");
      expect(preview.plainEnglish).toContain("Keep schema/data dormant (Safe default — expand-then-contract)");
      expect(preview.dataChoiceDefault).toBe("keep_dormant");
      expect(() => engine.execute("F-LoyaltyPoints", { apply: true, dataHandling: "drop_in_new_migration" })).toThrow(
        /explicit destructive confirmation/,
      );
      expect(createHash("sha256").update(show(git, `harness/integration:${migration}`)).digest("hex")).toBe(beforeHash);
      const dormant = engine.execute("F-LoyaltyPoints", { apply: true });
      expect(dormant.landed).toBe(true);
      expect(dormant.mode).toBe("surgical_removal");
      expect(show(git, `harness/integration:${migration}`)).toBe(sql);
      expect(createHash("sha256").update(show(git, `harness/integration:${migration}`)).digest("hex")).toBe(beforeHash);
      expect(show(git, "harness/integration:features/F-LoyaltyPoints/points.ts")).toBe("");
      expect(git.ok(["ls-tree", "-r", "--name-only", "harness/integration"]).stdout).not.toContain("_drop_");
    } finally {
      engine.close();
    }
  });

  it("writes a new drop migration and does not edit the historical loyalty migration", () => {
    const { root, repo, git } = initRepo();
    const engine = engineFor(root, repo);
    const migration = "migrations/20240101_loyalty.sql";
    const sql = "CREATE TABLE loyalty_ledger (\n  id INTEGER PRIMARY KEY\n);\n";
    try {
      const mergeSha = mergeFeature(git, "F-LoyaltyPoints", {
        [migration]: sql,
        "features/F-LoyaltyPoints/points.ts": "export const points = 1;\n",
      });
      engine.graph.registerFeature({
        featureId: "F-LoyaltyPoints",
        title: "Loyalty",
        lifecycle: "DONE",
        branch: "harness/f/F-LoyaltyPoints",
        mergeSha,
        specs: "Loyalty ledger",
        decisions: [],
        taskIds: ["T-F-LoyaltyPoints"],
        landed: true,
      });
      const beforeHash = createHash("sha256").update(show(git, `harness/integration:${migration}`)).digest("hex");
      const result = engine.execute("F-LoyaltyPoints", {
        apply: true,
        dataHandling: "drop_in_new_migration",
        destructiveConfirmation: true,
      });
      expect(result.landed).toBe(true);
      expect(show(git, `harness/integration:${migration}`)).toBe(sql);
      expect(createHash("sha256").update(show(git, `harness/integration:${migration}`)).digest("hex")).toBe(beforeHash);
      const tree = git.ok(["ls-tree", "-r", "--name-only", "harness/integration"]).stdout;
      const drop = tree.split(/\r?\n/).find((line) => line.includes("_drop_loyalty_ledger.sql"));
      expect(drop).toBeTruthy();
      expect(show(git, `harness/integration:${drop ?? ""}`)).toContain("DROP TABLE IF EXISTS loyalty_ledger;");
      expect(show(git, `harness/integration:${drop ?? ""}`)).toContain("historical migration files are unchanged");
    } finally {
      engine.close();
    }
  });

  it("blocks undo of a hard dependency unless the dependent features are undone together", () => {
    const { root, repo, git } = initRepo();
    const engine = engineFor(root, repo);
    try {
      const auth = mergeFeature(git, "F-Auth", {
        "features/F-Auth/login.tsx": "export const login = true;\n",
        "features/F-Auth/journey.test.mjs": "process.exit(1);\n",
      });
      const admin = mergeFeature(git, "F-AdminDashboard", {
        "features/F-AdminDashboard/dashboard.tsx": "export const dashboard = true;\n",
        "features/F-AdminDashboard/journey.test.mjs": "process.exit(1);\n",
      });
      mergeFeature(git, "F-Home", { "features/F-Home/journey.test.mjs": passingTest("F-Home") });
      engine.graph.registerFeature({
        featureId: "F-Auth",
        title: "Auth",
        lifecycle: "DONE",
        branch: "harness/f/F-Auth",
        mergeSha: auth,
        specs: "Auth spec",
        decisions: ["Session cookie"],
        taskIds: ["T-F-Auth"],
        landed: true,
      });
      engine.graph.registerFeature({
        featureId: "F-AdminDashboard",
        title: "Admin",
        lifecycle: "DONE",
        branch: "harness/f/F-AdminDashboard",
        mergeSha: admin,
        specs: "Admin spec",
        decisions: ["Requires auth"],
        taskIds: ["T-F-AdminDashboard"],
        landed: true,
      });
      engine.graph.registerFeature({
        featureId: "F-Home",
        title: "Home",
        lifecycle: "DONE",
        branch: "harness/f/F-Home",
        landed: true,
      });
      engine.graph.addEdge({ src: "F-AdminDashboard", type: "depends_on", dst: "F-Auth", artifactPath: "" });
      engine.graph.registerFeature({
        featureId: "F-Billing",
        title: "Billing",
        lifecycle: "DONE",
        branch: "harness/f/F-Billing",
        landed: true,
      });
      engine.graph.addEdge({ src: "F-Billing", type: "depends_on", dst: "F-AdminDashboard", artifactPath: "" });
      expect(engine.impact.hardDependents("F-Auth")).toEqual(["F-AdminDashboard", "F-Billing"]);
      const before = git.revParse("harness/integration");
      const blocked = engine.execute("F-Auth", { apply: true });
      expect(blocked.mode).toBe("blocked");
      expect(blocked.landed).toBe(false);
      expect(blocked.integrationUnchanged).toBe(true);
      expect(blocked.preview.dependentChoices).toEqual([
        "Undo F-Auth + F-AdminDashboard + F-Billing together",
        "Cancel undo",
      ]);
      expect(git.revParse("harness/integration")).toBe(before);
      const cancelled = engine.execute("F-Auth", { apply: true, dependents: "cancel" });
      expect(cancelled.mode).toBe("cancelled");
      expect(git.revParse("harness/integration")).toBe(before);
      expect(show(git, "harness/integration:features/F-Auth/login.tsx")).toContain("login");
    } finally {
      engine.close();
    }
  });

  it("undoes a feature and its hard dependents in one forward commit", () => {
    const { root, repo, git } = initRepo();
    const engine = engineFor(root, repo);
    try {
      const auth = mergeFeature(git, "F-Auth", {
        "features/F-Auth/login.tsx": "export const login = true;\n",
      });
      const admin = mergeFeature(git, "F-AdminDashboard", {
        "features/F-AdminDashboard/dashboard.tsx": "export const dashboard = true;\n",
      });
      engine.graph.registerFeature({
        featureId: "F-Auth",
        title: "Auth",
        lifecycle: "DONE",
        branch: "harness/f/F-Auth",
        mergeSha: auth,
        specs: "Auth spec",
        decisions: ["Session cookie"],
        taskIds: ["T-F-Auth"],
        landed: true,
      });
      engine.graph.registerFeature({
        featureId: "F-AdminDashboard",
        title: "Admin",
        lifecycle: "DONE",
        branch: "harness/f/F-AdminDashboard",
        mergeSha: admin,
        specs: "Admin spec",
        decisions: ["Requires auth"],
        taskIds: ["T-F-AdminDashboard"],
        landed: true,
      });
      engine.graph.addEdge({ src: "F-AdminDashboard", type: "depends_on", dst: "F-Auth", artifactPath: "" });
      const before = git.revParse("harness/integration");
      const result = engine.execute("F-Auth", { apply: true, dependents: "undo_together" });
      expect(result.landed).toBe(true);
      expect(result.featureIds).toEqual(["F-Auth", "F-AdminDashboard"]);
      expect(git.parents(result.commitSha)[0]).toBe(before);
      expect(git.isAncestor(auth, "harness/integration")).toBe(true);
      expect(git.isAncestor(admin, "harness/integration")).toBe(true);
      expect(show(git, "harness/integration:features/F-Auth/login.tsx")).toBe("");
      expect(show(git, "harness/integration:features/F-AdminDashboard/dashboard.tsx")).toBe("");
      expect(engine.graph.getFeature("F-Auth")?.nodeStatus).toBe("undone");
      expect(engine.graph.getFeature("F-AdminDashboard")?.nodeStatus).toBe("undone");
      expect(engine.graph.getFeature("F-Auth")?.featureId).toBe("F-Auth");
    } finally {
      engine.close();
    }
  });

  it("refuses to land while a dangling print link or orphan permission remains", () => {
    const { root, repo, git } = initRepo();
    const engine = engineFor(root, repo);
    try {
      write(repo, "src/Header.tsx", 'export function Header() { return <Link to="/print">Print</Link>; }\ncan("print.view");\n');
      git.ok(["add", "-A"]);
      git.ok(["commit", "-m", "header"]);
      const mergeSha = mergeFeature(git, "F-Print", {
        "src/routes/print.tsx": 'export const route = { path: "/print" };\ndefinePermission("print.view");\n',
      });
      const before = git.revParse("harness/integration");
      engine.graph.registerFeature({
        featureId: "F-Print",
        title: "Print",
        lifecycle: "DONE",
        branch: "harness/f/F-Print",
        mergeSha,
        specs: "Print route",
        decisions: [],
        taskIds: ["T-F-Print"],
        landed: true,
      });
      const result = engine.execute("F-Print", { apply: true });
      expect(result.landed).toBe(false);
      expect(result.audit.deadNav.some((item) => item.includes("/print"))).toBe(true);
      expect(result.audit.orphanPermissions.some((item) => item.includes("print.view"))).toBe(true);
      expect(result.blockedReason).toContain("STATIC_AUDIT");
      expect(git.revParse("harness/integration")).toBe(before);
      expect(show(git, "harness/integration:src/routes/print.tsx")).toContain("/print");
      expect(engine.graph.getFeature("F-Print")?.nodeStatus).toBe("active");
    } finally {
      engine.close();
    }
  });

  it("does not move harness/integration when the compare-and-swap loses", () => {
    const { root, repo, git } = initRepo();
    const engine = engineFor(root, repo, () => {
      git.ok(["commit", "--allow-empty", "-m", "integration moved during undo"]);
    });
    try {
      const mergeSha = mergeFeature(git, "F-Print", {
        "features/F-Print/page.tsx": "export const page = true;\n",
      });
      engine.graph.registerFeature({
        featureId: "F-Print",
        title: "Print",
        lifecycle: "DONE",
        branch: "harness/f/F-Print",
        mergeSha,
        specs: "Print",
        decisions: ["Print"],
        taskIds: ["T-F-Print"],
        landed: true,
      });
      const result = engine.execute("F-Print", { apply: true });
      expect(result.landed).toBe(false);
      expect(result.blockedReason).toBe("cas_mismatch");
      expect(engine.graph.getFeature("F-Print")?.nodeStatus).toBe("active");
      expect(git.commitMessage("harness/integration")).toContain("integration moved during undo");
      expect(show(git, "harness/integration:features/F-Print/page.tsx")).toContain("page");
    } finally {
      engine.close();
    }
  });
});
