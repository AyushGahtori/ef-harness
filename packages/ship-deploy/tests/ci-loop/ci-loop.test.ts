import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BoundedCiRepairLoop,
  FailedCiLogFetcher,
  FiveClassCiTriager,
  GraphGeneratedPrBuilder,
  InMemoryShipRunStore,
  LinuxCaseSensitivityAutoRepair,
  MAX_PUSHES_PER_FINGERPRINT,
  PrePushSafetyGate,
  ShipRunStateMachine,
  createShipRunRecord,
  stripAnsi,
  twoStepCaseRename,
} from "../../src/ci-loop/index.js";
import type { CiFailureInput, ExternalEffectLedger, GitleaksFinding, LocalVerifier, SafetyScanner } from "../../src/ci-loop/index.js";
import { initRepo, makeSandbox, removeSandbox, writeAndCommit } from "./helpers.js";

function regressionFailure(): CiFailureInput {
  return {
    jobName: "unit",
    logExcerpt: ["AssertionError: expected 1 to be 2", " at orders.test.ts:14"],
    commitSha: "abc",
    baseBranch: "main",
    localVerificationPassed: false,
  };
}

describe("ci-loop Task 178", () => {
  it("GraphGeneratedPrBuilder builds graph-sourced PR bodies without secret values", () => {
    const builder = new GraphGeneratedPrBuilder();
    const draft = builder.build({
      featureTitle: "Kitchen orders API",
      requirementRefs: [{ nid: 12, kind: "requirement", title: "Persist orders" }],
      landingSummaryParagraph: "Adds order persistence with idempotent create.",
      verificationReceipts: [
        { gate: "unit", result: "pass" },
        { gate: "gitleaks", result: "pass" },
        { gate: "STATIC_AUDIT", result: "pass" },
      ],
      migrationNotes: ["20251123_orders.sql"],
      envVarNames: ["ORDERS_DB_URL"],
      humanFixedNotes: ["Adjusted copy on receipt card"],
      delegatedDecisions: [],
      deferredNotes: ["Rate limit UI polish"],
      effectId: "eff-ship-178-demo",
    });
    expect(draft.title).toBe("Kitchen orders API");
    expect(draft.bodyMarkdown).toContain("Verification receipts");
    expect(draft.bodyMarkdown).toContain("EF-Effect-Id: eff-ship-178-demo");
    expect(draft.bodyMarkdown).toContain("`ORDERS_DB_URL`");
    expect(draft.bodyMarkdown).not.toMatch(new RegExp(["sk", "_live_"].join("")));
  });

  it("pre-push gitleaks gate blocks git_push when secrets appear in range", async () => {
    const scanner: SafetyScanner = {
      async scanCommitRange() {
        return [{ ruleId: "generic-api-key", file: ".env.test", line: 3 }] satisfies readonly GitleaksFinding[];
      },
    };
    const gate = new PrePushSafetyGate({ scanner });
    const blocked = await gate.evaluate({
      baseRef: "origin/main",
      trackedFiles: ["src/a.ts"],
      localChecksPassed: true,
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.blockedEffect).toBe("git_push");
      expect(blocked.reason).toContain("gitleaks");
    }
  });

  it("ship_runs resume cleanly at CI_WATCHING after restart", () => {
    const store = new InMemoryShipRunStore();
    const machine = new ShipRunStateMachine(store);
    const record = createShipRunRecord({ id: "ship-1", feature: "F12", repo: "ef/demo" });
    store.upsert(record);
    machine.transition("ship-1", "PUSH_APPROVAL");
    machine.transition("ship-1", "PUSHING");
    machine.attachPr("ship-1", 42, "https://github.com/ef/demo/pull/42");
    machine.markCiWatching("ship-1", "gh-run-9001");
    const resumed = machine.resumeAfterCrash("ship-1");
    expect(resumed?.resumedAt).toBe("CI_WATCHING");
    expect(resumed?.record.prNumber).toBe(42);
    expect(resumed?.record.runId).toBe("gh-run-9001");
  });

  it("FiveClassCiTriager classifies all five operational classes", () => {
    const triager = new FiveClassCiTriager();
    const class1 = triager.classify(regressionFailure());
    expect(class1.operationalClass).toBe("class_1_regression");
    expect(class1.allowsAutomatedCodeRepair).toBe(true);

    const class2 = triager.classify({
      jobName: "linux",
      logExcerpt: ["TS2307: Cannot find module './Header'"],
      commitSha: "abc",
      baseBranch: "main",
      localVerificationPassed: true,
    });
    expect(class2.operationalClass).toBe("class_2_portability");
    expect(class2.allowsAutomatedCodeRepair).toBe(true);

    const class3 = triager.classify({
      jobName: "ci",
      logExcerpt: ["npm ERR! 503 Service Unavailable"],
      commitSha: "abc",
      baseBranch: "main",
      localVerificationPassed: true,
    });
    expect(class3.operationalClass).toBe("class_3_transient");
    expect(class3.allowsAutomatedCodeRepair).toBe(false);
    expect(class3.allowsBoundedRerun).toBe(true);

    const class4 = triager.classify({
      jobName: "ci",
      logExcerpt: ["Error: secret STRIPE_TEST_KEY not set in GitHub Actions"],
      commitSha: "abc",
      baseBranch: "main",
      localVerificationPassed: true,
    });
    expect(class4.operationalClass).toBe("class_4_missing_secret");

    const class5 = triager.classify(
      {
        jobName: "lint",
        logExcerpt: ["eslint failed"],
        commitSha: "abc",
        baseBranch: "main",
        localVerificationPassed: true,
      },
      { failingCheckNames: ["lint"], checkUrl: "https://github.com/ef/demo/actions/runs/1" },
    );
    expect(class5.operationalClass).toBe("class_5_preexisting_main");
    expect(class5.allowsAutomatedCodeRepair).toBe(false);
  });

  it("LinuxCaseSensitivityAutoRepair fixes import casing and CRLF/bash issues", () => {
    const repair = new LinuxCaseSensitivityAutoRepair({
      listTrackedFiles() {
        return ["src/components/header.tsx", ".github/scripts/migrate.sh"];
      },
    });
    const actions = repair.planRepairs(["TS2307: Cannot find module './Header'"], {
      "src/app.tsx": "import { Header } from './Header';\n",
    });
    expect(actions.some((a) => a.kind === "rewrite_import")).toBe(true);

    const crlfActions = repair.planRepairs(["/bin/bash^M: bad interpreter"], {});
    expect(crlfActions.some((a) => a.kind === "normalize_crlf")).toBe(true);
    expect(crlfActions.some((a) => a.kind === "chmod_executable")).toBe(true);

    const rewritten = repair.applyImportRewrite(
      "import { Header } from './Header';",
      "./Header",
      "src/components/header.tsx",
    );
    expect(rewritten).toContain("./header");
  });

  it("performs two-step git mv on Windows for case-only rename", () => {
    const sandbox = makeSandbox();
    const repo = initRepo(sandbox);
    try {
      writeAndCommit(repo, "src/Header.tsx", "export const Header = 1;\n", "seed");
      const tracked = fs.readFileSync(path.join(repo, "src/Header.tsx"), "utf8");
      expect(tracked).toContain("Header");
      twoStepCaseRename(repo, "src/Header.tsx", "src/header.tsx");
      const listing = fs.readdirSync(path.join(repo, "src"));
      expect(listing).toContain("header.tsx");
      expect(listing).not.toContain("Header.tsx");
    } finally {
      removeSandbox(sandbox.root);
    }
  });

  it("BoundedCiRepairLoop halts after three pushes for the same fingerprint", () => {
    const store = new InMemoryShipRunStore();
    const shipRunId = "ship-repair-1";
    store.upsert({
      ...createShipRunRecord({ id: shipRunId }),
      repairPushesByFingerprint: {},
      totalRepairPushes: 0,
    });
    const machine = new ShipRunStateMachine(store);

    const verifier: LocalVerifier = {
      async runFullSuite() {
        return { ok: true };
      },
    };
    const scanner: SafetyScanner = {
      async scanCommitRange() {
        return [];
      },
    };
    const ledger: ExternalEffectLedger = {
      recordGitPush() {},
    };
    const loop = new BoundedCiRepairLoop({ store, verifier, scanner, ledger });
    const failure = {
      jobName: "playwright",
      logExcerpt: ["TimeoutError: page.waitForURL login"],
      commitSha: "abc",
      baseBranch: "main",
      localVerificationPassed: true,
    };

    for (let i = 0; i < MAX_PUSHES_PER_FINGERPRINT; i += 1) {
      const decision = loop.decideNext({ shipRunId, failure, prNumber: 7 });
      expect(decision.kind).toBe("push_repair");
      machine.recordRepairPush(shipRunId, decision.kind === "push_repair" ? decision.fingerprint : "x");
    }

    const halted = loop.decideNext({ shipRunId, failure, prNumber: 7 });
    expect(halted.kind).toBe("escalate_human");
    if (halted.kind === "escalate_human") {
      expect(halted.reason).toContain("3 attempts");
    }

    const fourthAttempt = loop.decideNext({ shipRunId, failure, prNumber: 7 });
    expect(fourthAttempt.kind).toBe("escalate_human");
  });

  it("never auto-merges: green CI waits for explicit approval", () => {
    const store = new InMemoryShipRunStore();
    const loop = new BoundedCiRepairLoop({
      store,
      verifier: { async runFullSuite() { return { ok: true }; } },
      scanner: { async scanCommitRange() { return []; } },
      ledger: { recordGitPush() {} },
    });
    const decision = loop.decideNext({
      shipRunId: "ship-green",
      failure: regressionFailure(),
      prNumber: 42,
      greenCheckCount: 4,
    });
    expect(decision.kind).toBe("celebrate_green");
    if (decision.kind === "celebrate_green") {
      expect(decision.message).toContain("Ready to merge PR #42");
    }
  });

  it("FailedCiLogFetcher strips ANSI and redacts secrets", async () => {
    const fetcher = new FailedCiLogFetcher({
      source: {
        async fetchFailedStepLogs() {
          return "\u001b[31mError: token=SAMPLE_OAUTH_TOKEN\u001b[0m\nsecond line";
        },
      },
      redactor: {
        redactSecrets(text: string) {
          return text.replace(/SAMPLE_OAUTH_TOKEN/g, "[REDACTED]");
        },
      },
    });
    const log = await fetcher.fetchRedacted("run-1");
    expect(log.lines.join("\n")).not.toMatch(/\u001b\[/);
    expect(log.lines.join("\n")).toContain("[REDACTED]");
    expect(stripAnsi("\u001b[0m")).toBe("");
  });
});