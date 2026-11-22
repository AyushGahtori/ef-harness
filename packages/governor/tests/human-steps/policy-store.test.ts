import { expect, it } from "vitest";

import {
  ATTESTED_BADGE_LABEL,
  AttestedVsVerifiedBadgePolicy,
  DATABASE_HARD_BYPASS_MESSAGE,
  HumanStepStateStore,
  PLAYWRIGHT_HARD_BYPASS_MESSAGE,
  WAITING_ON_HUMAN_STEP_REASON,
  maskDatabaseUrl,
  openHumanStepDatabase,
  openHumanSteps,
  type HumanStepRecord,
} from "../../src/human-steps/index.js";

const policy = new AttestedVsVerifiedBadgePolicy();

it("masks a database URL password and keeps the user and host", () => {
  expect(maskDatabaseUrl("postgresql://user:super-secret@host:5432/db")).toBe(
    "postgresql://user:***@host:5432/db",
  );
});

it("stamps a passing probe verified and a manual confirmation attested", () => {
  const db = openHumanStepDatabase();
  const runtime = openHumanSteps({
    database: db,
    now: () => 1_700,
    runner: runner({ exitCode: 0, stdout: "v22.1.0\n", stderr: "", errorCode: null, timedOut: false }),
  });
  const step = runtime.createStep(cliStep());
  const passed = runtime.store.commitProbeResult(step.stepId, {
    outcome: "pass",
    code: "PASS",
    diagnosis: "node is available",
    durationMs: 4,
    checkedAt: 1_700,
    evidence: { tool: "node" },
  });
  expect(passed.status).toBe("verified");
  expect(passed.verifiedAt).toBe(1_700);
  expect(policy.badge(passed)).toMatchObject({ label: "Verified", tone: "green", honest: true });
  expect(runtime.store.holdsFor("T-2")).toEqual([]);

  const manual = runtime.createStep({
    stepType: "account_attestation",
    title: "Turn on Stripe 2FA",
    plainEnglishInstructions: ["Open the Stripe dashboard and turn on 2FA."],
    probeSpec: { kind: "unprobeable" },
    blockingTaskIds: ["T-9"],
    hardLocal: false,
  });
  const attested = runtime.attest(manual.stepId, "I turned on 2FA in the Stripe dashboard");
  expect(attested.allowed).toBe(true);
  expect(attested.step.status).toBe("attested");
  expect(attested.step.verifiedAt).toBeUndefined();
  expect(attested.step.attestedAt).toBe(1_700);
  expect(attested.step.attestationNote).toBe("I turned on 2FA in the Stripe dashboard");
  expect(policy.badge(attested.step).label).toBe(ATTESTED_BADGE_LABEL);
  expect(runtime.store.holdsFor("T-9")).toEqual([]);
  const question = db.prepare(`SELECT status, kind FROM human_step_questions`).all() as { status: string; kind: string }[];
  expect(question.some((row) => row.kind === "human_step" && row.status === "retired")).toBe(true);
  db.close();
});

it("refuses to attest a missing Playwright browser or a broken database URL", () => {
  const runtime = openHumanSteps({ now: () => 5 });
  const playwright = runtime.createStep({
    stepType: "runtime_install",
    title: "Install Chromium",
    plainEnglishInstructions: ["Playwright tests need Chromium."],
    probeSpec: { kind: "playwright", projectRoot: "C:/app", requiredFor: "playwright_tests" },
    blockingTaskIds: ["T-4"],
  });
  const refused = runtime.attest(playwright.stepId, "I did this manually");
  expect(refused.allowed).toBe(false);
  expect(refused.decision.message).toBe(PLAYWRIGHT_HARD_BYPASS_MESSAGE);
  expect(refused.step.status).toBe("pending");
  expect(runtime.store.holdsFor("T-4").map((hold) => hold.reason)).toEqual([WAITING_ON_HUMAN_STEP_REASON]);

  const database = runtime.createStep({
    stepType: "database",
    title: "Provision Postgres",
    plainEnglishInstructions: ["Migrations need a reachable database."],
    probeSpec: { kind: "database_url", secretId: "db", engine: "postgres", requiredFor: "migrations" },
    blockingTaskIds: ["T-5"],
  });
  expect(runtime.attest(database.stepId, "I did this manually").decision.message).toBe(DATABASE_HARD_BYPASS_MESSAGE);
  expect(runtime.store.require(database.stepId).status).toBe("pending");
  runtime.close();
});

it("skips a hard browser requirement without labeling it verified or attested", () => {
  const runtime = openHumanSteps({ now: () => 8 });
  const step = runtime.createStep({
    stepType: "runtime_install",
    title: "Install Chromium",
    plainEnglishInstructions: ["Chromium is required."],
    probeSpec: { kind: "playwright", projectRoot: "C:/app" },
    blockingTaskIds: ["T-6"],
  });
  const skipped = runtime.skipFeature(step.stepId);
  expect(skipped.status).not.toBe("verified");
  expect(skipped.status).not.toBe("attested");
  expect(skipped.resolution).toBe("feature_skipped");
  expect(policy.badge(skipped).label).toBe("Browser checks disabled");
  expect(runtime.store.holdsFor("T-6")).toEqual([]);
  runtime.close();
});

it("withholds a verified badge when no probe passed", () => {
  const dishonest = {
    stepId: "HS-1",
    stepType: "runtime_install",
    title: "Docker",
    plainEnglishInstructions: ["Start Docker."],
    probeSpec: { kind: "docker" },
    status: "verified",
    lastProbeResult: {
      outcome: "fail",
      code: "INSTALLED_NOT_RUNNING",
      diagnosis: "down",
      durationMs: 1,
      checkedAt: 1,
      evidence: {},
    },
    blockingTaskIds: ["T-1"],
    hardLocal: true,
  } satisfies HumanStepRecord;
  expect(policy.badge(dishonest).label).toBe("Not verified — no passing probe");
});

it("rolls back verification when recording evidence fails", async () => {
  const db = openHumanStepDatabase();
  const store = new HumanStepStateStore(db, () => 20);
  const innerGraph = {
    allocateEntityId: (prefix: string) => prefix + "1",
    commitChangeSet: () => ({ rev: 1, changeSetId: "CS-1" }),
    getNode: () => ({ id: "S-1", version: 1, kind: "comment", title: "node" }),
    recordEvidence: () => {
      throw new Error("disk");
    },
  };
  const runtime = openHumanSteps({
    database: db,
    now: () => 20,
    graph: innerGraph,
    questions: {
      submit: () => ({ questionId: "Q-1" }),
      retireQuestion: () => undefined,
    },
    runner: runner({ exitCode: 0, stdout: "v22.0.0\n", stderr: "", errorCode: null, timedOut: false }),
  });
  const step = runtime.createStep(cliStep());
  store.holds.placeHold({ task: "T-2", reason: "user_pause", source: "msg-1", createdAt: 20 });
  await expect(runtime.checkAgain(step.stepId)).rejects.toThrow("disk");
  expect(runtime.store.require(step.stepId).status).toBe("pending");
  expect(runtime.store.require(step.stepId).verifiedAt).toBeUndefined();
  const holds = runtime.store.holdsFor("T-2").map((hold) => hold.reason).sort();
  expect(holds).toEqual(["user_pause", WAITING_ON_HUMAN_STEP_REASON]);
  db.close();
});

function cliStep() {
  return {
    stepType: "cli_auth" as const,
    title: "Node is installed",
    plainEnglishInstructions: ["Install Node.js 18 or newer."],
    probeSpec: { kind: "cli_tool" as const, tool: "node" as const, minimumVersion: "18.0.0", checkAuth: false },
    blockingTaskIds: ["T-2"],
  };
}

function runner(result: {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  errorCode: "ENOENT" | "TIMEOUT" | "ABORTED" | null;
  timedOut: boolean;
}) {
  return {
    async run() {
      return { ...result, durationMs: 1 };
    },
  };
}
