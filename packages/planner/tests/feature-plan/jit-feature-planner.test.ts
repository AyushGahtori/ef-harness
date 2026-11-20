import { describe, expect, it } from "vitest";

import {
  FeaturePlanDatabase,
  FeaturePlanError,
  FeaturePlanningSession,
  FakeModelAdapter,
  TOUCH_TAGS,
  assertTaskBounds,
  buildPlannerModelInput,
  deterministicFeaturePlan,
  scopesOverlap,
  sealedPathIsOutsideWorktree,
} from "../../src/feature-plan/index.js";
import type { PlannedTask, SessionInput } from "../../src/feature-plan/index.js";
import { architecture, cutoffRequirement, noteRequirement, openSession, sessionInput } from "./fixture.js";

describe("JitFeaturePlanner and sealed oracles", () => {
  it("decomposes a feature into bounded disjoint leaves plus the Task 096 slot", () => {
    const { db, session, input } = openSession();
    const receipt = session.planAndSeal(input);
    const plan = session.currentPlan();
    expect(plan.integration.integrationSlot).toBe("096");
    expect(plan.integration.taskType).toBe("feature_integration");
    expect(plan.tasks).toHaveLength(2);
    for (const task of plan.tasks) {
      expect(task.taskType).toBe("leaf");
      expect(task.files.length).toBeGreaterThanOrEqual(1);
      expect(task.files.length).toBeLessThanOrEqual(5);
      expect(task.behaviors).toHaveLength(1);
      expect(task.checks.length).toBeGreaterThan(0);
      expect(task.checks.every((check) => check.visibility === "visible")).toBe(true);
    }
    const scopes = [...plan.tasks, plan.integration];
    expect(new Set(scopes.flatMap((task) => task.files.map((file) => file.toLowerCase()))).size).toBe(
      scopes.flatMap((task) => task.files).length,
    );
    const cutoff = plan.tasks.find((task) => task.requirementIds.includes("REQ-cutoff"));
    expect(cutoff?.touches).toEqual(expect.arrayContaining(["route", "scheduling", "personal_data"]));
    expect(db.relationsInFields()).toEqual([]);
    expect(db.listEdges()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ src: cutoff?.id, type: "implements", dst: "REQ-cutoff" }),
        expect.objectContaining({ src: cutoff?.id, type: "consumes_contract", dst: "C-orders" }),
        expect.objectContaining({ src: cutoff?.id, type: "touches_entity", dst: "ENT-order" }),
        expect.objectContaining({ src: plan.integration.id, type: "depends_on", dst: cutoff?.id }),
      ]),
    );
    const stored = db.getNode(cutoff?.id ?? "");
    expect(stored?.fields).not.toHaveProperty("implements");
    expect(stored?.fields).not.toHaveProperty("depends_on");
    expect(receipt.sealedBeforeCompile).toBe(true);
    expect(receipt.oracleIndependence).toBe("cross_family");
    expect(receipt.selectedFamily).toBe("anthropic");
    expect(receipt.buildWorkerFamily).toBe("openai");
    expect(receipt.warnings).toEqual([]);
    expect(TOUCH_TAGS).toHaveLength(28);
  });

  it("seals an independent pool before compile and keeps it out of worker briefs", () => {
    const model = new FakeModelAdapter();
    const { session, input } = openSession(sessionInput({ model }));
    expect(() => session.beginGraphCompile(1)).toThrow(FeaturePlanError);
    expect(() => session.authorizeWorker("task-F-orders-REQ-cutoff")).toThrow(FeaturePlanError);
    const receipt = session.planAndSeal(input);
    const oracleCall = model.calls.find((call) => call.role === "oracle-author@1" && call.repair === null);
    expect(oracleCall?.family).toBe("anthropic");
    expect(oracleCall?.model).toBe("claude-senior");
    const oracleInput = JSON.stringify(oracleCall?.input);
    expect(oracleInput).not.toContain("write_scope");
    expect(oracleInput).not.toContain("task_type");
    expect(oracleInput).not.toContain("wiring.ts");
    expect(oracleInput).not.toContain("worker_code");
    const permit = session.beginGraphCompile(receipt.sealedAt + 5);
    expect(permit.sealedAt).toBeLessThanOrEqual(permit.compileStartedAt);
    const brief = session.authorizeWorker("task-F-orders-REQ-cutoff");
    expect(brief.schema).toBe("task-packet@1");
    expect(brief.checks_visible.length).toBeGreaterThan(0);
    expect(brief.checks_hidden_count).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(brief)).not.toContain("sealed-");
    expect(JSON.stringify(brief)).not.toContain("11:01");
    expect(JSON.stringify(brief)).toContain("expect(res.status).toBe(201)");
    const sealed = session.store.listForRequirements(["REQ-cutoff"]);
    expect(sealed.map((row) => row.diversity).sort()).toEqual(["boundary", "happy", "negative"]);
    const negative = sealed.find((row) => row.diversity === "negative");
    expect(negative?.contentJson).toContain("11:01");
    expect(session.store.readForCleanVerifier(negative?.id ?? "").expected).toBe("422");
    expect(session.store.kbGet(negative?.id ?? "")).toEqual({ found: false });
    expect(session.store.kbGet("missing-check")).toEqual({ found: false });
    expect(session.store.kbSearch("11:01").ids).toEqual([]);
    expect(session.store.kbSearch("Cutoff").ids).toContain("REQ-cutoff");
    const storagePath = session.store.storagePath(negative?.id ?? "sealed-REQ-cutoff-negative");
    expect(storagePath.startsWith("kernel://state.db/hidden_checks/")).toBe(true);
    expect(sealedPathIsOutsideWorktree(storagePath, input.worktree)).toBe(true);
    expect(() => session.store.readAsWorker(`${input.worktree}/checks-sealed/F-orders.age`, input.worktree)).toThrow(
      FeaturePlanError,
    );
    expect(session.store.exportIntent()).toMatchObject({ algorithm: "age-x25519", table: "hidden_checks", cas: true });
    expect(sealed.every((row) => row.encryptedAtRest === false)).toBe(true);
  });

  it("refuses to plan before feature architecture passes consistency", () => {
    const model = new FakeModelAdapter();
    const { db, session } = openSession();
    const input = sessionInput({ model, architecture: architecture(false) });
    expect(() => session.planAndSeal(input)).toThrow(FeaturePlanError);
    try {
      session.planAndSeal(input);
    } catch (error) {
      expect((error as FeaturePlanError).code).toBe("architecture_not_ready");
    }
    expect(model.calls).toHaveLength(0);
    expect(db.listNodes()).toEqual([]);
  });

  it("flags an 18-file mega-task and overlapping write scopes", () => {
    const files = Array.from({ length: 18 }, (_, index) => `src/mega/file-${index}.ts`);
    const model = new FakeModelAdapter();
    const { db, session } = openSession();
    expect(() =>
      session.planAndSeal(
        sessionInput({
          model,
          requirements: [cutoffRequirement(files)],
        }),
      ),
    ).toThrow(FeaturePlanError);
    try {
      session.planAndSeal(sessionInput({ model, requirements: [cutoffRequirement(files)] }));
    } catch (error) {
      expect((error as FeaturePlanError).code).toBe("oversized_task");
      expect((error as FeaturePlanError).message).toContain("18");
    }
    expect(db.listNodes()).toEqual([]);

    const overlap = new FakeModelAdapter();
    const shared = sessionInput({
      model: overlap,
      requirements: [
        cutoffRequirement(["src/f-orders/shared.ts"]),
        { ...noteRequirement(), files: ["src/f-orders/shared.ts"] },
      ],
    });
    expect(() => new FeaturePlanningSession(FeaturePlanDatabase.memory()).planAndSeal(shared)).toThrow(FeaturePlanError);
    try {
      new FeaturePlanningSession(FeaturePlanDatabase.memory()).planAndSeal(shared);
    } catch (error) {
      expect((error as FeaturePlanError).code).toBe("write_scope_overlap");
    }
  });

  it("rejects a planner reference to REQ-999 before any task row is committed", () => {
    const model = new FakeModelAdapter();
    const input = sessionInput({ model, requirements: [cutoffRequirement()] });
    const raw = deterministicFeaturePlan(buildPlannerModelInput(contextOf(input), input.requirements)) as {
      tasks: { requirements: string[] }[];
    };
    raw.tasks[0]?.requirements.push("REQ-999");
    model.pushPlanner(raw);
    const db = FeaturePlanDatabase.memory();
    const session = new FeaturePlanningSession(db);
    expect(() => session.planAndSeal(input)).toThrow(FeaturePlanError);
    try {
      model.pushPlanner(raw);
      session.planAndSeal(input);
    } catch (error) {
      expect((error as FeaturePlanError).code).toBe("dangling_node");
      expect((error as FeaturePlanError).message).toContain("REQ-999");
    }
    expect(db.listEdges()).toEqual([]);
    expect(db.getNode("task-F-orders-REQ-cutoff")).toBeNull();
  });

  it("rejects unbounded globs and windows path-case collisions", () => {
    expect(() =>
      assertTaskBounds(leaf("T-wild", ["src/**"], ["src/a.ts"])),
    ).toThrow(FeaturePlanError);
    expect(
      scopesOverlap(
        leaf("T-a", ["src/Order.ts"], ["src/Order.ts"]),
        leaf("T-b", ["src/order.ts"], ["src/order.ts"]),
      ),
    ).toBe(true);
    expect(
      scopesOverlap(
        leaf("T-a", ["src/api/*"], ["src/api/orders.ts"]),
        leaf("T-b", ["src/api/*"], ["src/api/refunds.ts"]),
      ),
    ).toBe(true);
  });
});

function contextOf(input: SessionInput) {
  return {
    featureId: input.featureId,
    featureTitle: input.featureTitle,
    architecture: input.architecture,
    requirements: input.requirements,
    contracts: input.contracts,
    entities: input.entities,
  };
}

function leaf(id: string, writeScope: string[], files: string[]): PlannedTask {
  return {
    id,
    goal: "One behavior",
    writeScope,
    files,
    touches: ["route"],
    requirementIds: [],
    dependsOn: [],
    level: "Junior",
    behaviors: ["One behavior"],
    taskType: "leaf",
    integrationSlot: null,
    contractIds: [],
    entityIds: [],
    checks: [],
  };
}
