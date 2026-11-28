import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { ContractChangeRequestEngine } from "../../src/ccr/engine.js";
import { CcrLedger } from "../../src/ccr/ledger.js";
import {
  LocalContradictionCounter,
  LocalProjectMergeQueue,
  LocalRegressionChecks,
  LocalReverseImpactWalker,
  LocalSkeletonLock,
  MapContractOwners,
  MapFeatureRuntime,
} from "../../src/ccr/ports.js";
import { parseCcrV1 } from "../../src/ccr/ccr-v1.js";
import type { ContractChangeProposal, ContractOwner, ImpactGraph } from "../../src/ccr/types.js";
import { APPROVE_BREAKING, KEEP_ORIGINAL, LOCKED_ADAPTER_INSTRUCTION } from "../../src/ccr/types.js";

const FIXED = new Date("2026-11-22T00:00:00.000Z");

function owner(contractNodeId: string, ownerTaskId: string, ownerFeatureId: string): ContractOwner {
  return { contractNodeId, ownerTaskId, ownerFeatureId, ownerRole: "contract-owner", phase0: false };
}

const owners = new MapContractOwners(
  new Map([
    ["entity:Order", owner("entity:Order", "owner(entity:Order)", "F-OrderData")],
    ["entity:MenuItem", owner("entity:MenuItem", "owner(entity:MenuItem)", "F-MenuItem")],
    ["contract:A", owner("contract:A", "W-A", "F-A")],
    ["contract:B", owner("contract:B", "W-B", "F-B")],
  ]),
);

const features = new MapFeatureRuntime(
  new Map([
    ["F-Menu", "RUNNING"],
    ["F-Email", "RUNNING"],
    ["F-Orders", "RUNNING"],
    ["F-Reports", "RUNNING"],
    ["F-OrderData", "RUNNING"],
    ["F-MenuItem", "HOLD"],
    ["F-A", "RUNNING"],
    ["F-B", "RUNNING"],
  ]),
  ["F-Menu", "F-Email", "F-Orders", "F-Reports", "F-OrderData", "F-A", "F-B"],
);

const orderImpact: ImpactGraph = {
  nodes: [
    { id: "entity:Order", kind: "contract" },
    { id: "F-Orders", kind: "feature", featureId: "F-Orders" },
    { id: "Screen-Kitchen", kind: "screen" },
    { id: "W-Orders", kind: "task", state: "WORKING" },
    { id: "T-Merged", kind: "task", state: "MERGED_TO_FEATURE" },
    { id: "M04", kind: "check" },
  ],
  edges: [
    { from: "F-Orders", to: "entity:Order" },
    { from: "Screen-Kitchen", to: "entity:Order" },
    { from: "W-Orders", to: "entity:Order" },
    { from: "T-Merged", to: "entity:Order" },
    { from: "M04", to: "entity:Order" },
  ],
};

function harness(options?: {
  readonly landMode?: "immediate" | "queued";
  readonly contradictions?: ReadonlyMap<string, number>;
  readonly failChecks?: readonly string[];
  readonly ledger?: CcrLedger;
}) {
  const mergeQueue = new LocalProjectMergeQueue();
  const engine = new ContractChangeRequestEngine({
    owners,
    features,
    landMode: options?.landMode ?? "immediate",
    now: () => FIXED,
    locks: new LocalSkeletonLock(new Set(["entity:Order", "entity:MenuItem"])),
    contradictions: new LocalContradictionCounter(options?.contradictions ?? new Map()),
    impact: new LocalReverseImpactWalker(orderImpact),
    mergeQueue,
    regression: new LocalRegressionChecks(new Set(options?.failChecks ?? [])),
    ...(options?.ledger ? { ledger: options.ledger } : {}),
  });
  return { engine, mergeQueue };
}

function proposal(patch: Partial<ContractChangeProposal> & Pick<ContractChangeProposal, "proposedDelta">): ContractChangeProposal {
  return {
    requestingTaskId: "W-Orders",
    requestingFeatureId: "F-Orders",
    targetContractNodeId: "entity:Order",
    rationale: patch.rationale ?? "The worker needs this contract change.",
    urgency: "normal",
    ...patch,
  };
}

const orderBefore = "CREATE TABLE orders ( id INTEGER PRIMARY KEY, price_cents INTEGER NOT NULL );";

describe("ContractChangeRequestEngine", async () => {
  it("routes a nullable column to the contract owner and wakes only the consumer", async () => {
    const { engine, mergeQueue } = harness();
    const result = await engine.submit(
      proposal({
        proposedDelta: {
          before: { sql: orderBefore },
          after: { sql: "CREATE TABLE orders ( id INTEGER PRIMARY KEY, price_cents INTEGER NOT NULL, dietary_note TEXT NULL );" },
        },
        rationale: "Kitchen needs a dietary note.",
      }),
    );
    expect(result.classification).toBe("ADDITIVE");
    expect(result.fastPath).toBe(true);
    expect(result.lifecycle).toBe("LANDED");
    expect(result.ownerTaskId).toBe("owner(entity:Order)");
    expect(result.ownerTask?.mutatedBy).toBe("owner(entity:Order)");
    expect(result.ownerTask?.mutatedBy).not.toBe("W-Orders");
    expect(result.ownerTask?.consumerMayEdit).toBe(false);
    expect(result.consumerEditedContract).toBe(false);
    expect(result.wokenTaskIds).toEqual(["W-Orders"]);
    expect(result.unrelatedRunning).toEqual(expect.arrayContaining(["F-Menu", "F-Email"]));
    expect(result.unrelatedRunning).not.toContain("F-Orders");
    expect(result.migrationName).toMatch(/^migrations\/20261122000000_[0-9a-f]{6}_dietary_note\.sql$/);
    expect(result.ownerTask?.backwardCompatibilityTestId).toBe("compat:entity:Order");
    expect(mergeQueue.landings).toHaveLength(1);
    expect(result.ownerCommitSha).toBe(mergeQueue.landings[0]?.commitSha ?? null);
    const audit = engine.ledger.audit(result.ccrId ?? "");
    expect(audit.map((event) => event.lifecycle)).toEqual(["PROPOSED", "CLASSIFIED", "APPROVED", "LANDED"]);
  });

  it("overrides a false additive claim and blocks the fast path", async () => {
    const { engine, mergeQueue } = harness();
    const result = await engine.submit(
      proposal({
        proposedDelta: {
          before: { sql: orderBefore },
          after: { sql: "CREATE TABLE orders ( id INTEGER PRIMARY KEY, price TEXT );" },
        },
        claimedClass: "additive",
        claimedAdditive: true,
        rationale: "Rename price for display.",
      }),
    );
    expect(result.classification).toBe("BREAKING");
    expect(result.overridden).toBe(true);
    expect(result.fastPath).toBe(false);
    expect(result.autoExecutionBlocked).toBe(true);
    expect(result.lifecycle).toBe("CLASSIFIED");
    expect(result.decision?.autoExecutionBlocked).toBe(true);
    expect(result.decision?.alternatives).toEqual(expect.arrayContaining([
      "Prefer additive expand-then-contract field instead",
      "Approve breaking revision",
    ]));
    expect(mergeQueue.landings).toHaveLength(0);
  });

  it("dedupes concurrent identical CCRs into one owner task and wakes both", async () => {
    const { engine, mergeQueue } = harness();
    const delta = {
      before: { sql: orderBefore },
      after: { sql: "CREATE TABLE orders ( id INTEGER PRIMARY KEY, price_cents INTEGER NOT NULL, submitted_at TEXT NULL );" },
    };
    const [first, second] = await engine.submitMany([
      proposal({ requestingTaskId: "W-Orders", requestingFeatureId: "F-Orders", proposedDelta: delta, rationale: "Orders needs submitted_at." }),
      proposal({ requestingTaskId: "W-Reports", requestingFeatureId: "F-Reports", proposedDelta: delta, rationale: "Reports needs submitted_at." }),
    ]);
    expect(first?.ccrId).toBe(second?.ccrId);
    expect(second?.deduped).toBe(true);
    expect(first?.wokenTaskIds).toEqual(["W-Orders", "W-Reports"]);
    expect(second?.wokenTaskIds).toEqual(["W-Orders", "W-Reports"]);
    expect(first?.ownerTask?.ccrIds).toEqual([first?.ccrId]);
    expect(mergeQueue.landings).toHaveLength(1);
  });

  it("breaks a mutual CCR wait and lands both additive fields in one coordinator commit", async () => {
    const { engine, mergeQueue } = harness({ landMode: "queued" });
    const waiting = await engine.submit(
      proposal({
        requestingTaskId: "W-B",
        requestingFeatureId: "F-B",
        targetContractNodeId: "contract:A",
        proposedDelta: {
          before: { sql: "CREATE TABLE alpha ( id INTEGER PRIMARY KEY );" },
          after: { sql: "CREATE TABLE alpha ( id INTEGER PRIMARY KEY, a_note TEXT NULL );" },
        },
      }),
    );
    expect(waiting.queueState).toBe("waiting_on_ccr");
    expect(waiting.waitingOnCcr).toBe(true);
    expect(engine.ledger.listEdges()).toHaveLength(1);
    const broken = await engine.submit(
      proposal({
        requestingTaskId: "W-A",
        requestingFeatureId: "F-A",
        targetContractNodeId: "contract:B",
        proposedDelta: {
          before: { sql: "CREATE TABLE beta ( id INTEGER PRIMARY KEY );" },
          after: { sql: "CREATE TABLE beta ( id INTEGER PRIMARY KEY, b_note TEXT NULL );" },
        },
      }),
    );
    expect(broken.cycleBroken).toBe(true);
    expect(broken.escalation).toBe("project-integrator@1");
    expect(broken.lifecycle).toBe("LANDED");
    expect(broken.wokenTaskIds).toEqual(expect.arrayContaining(["W-A", "W-B"]));
    expect(broken.ownerTask?.mutatedBy).toBe("project-integrator@1");
    expect(broken.ownerTask?.consumerMayEdit).toBe(false);
    expect(engine.ledger.get(waiting.ccrId ?? "")?.lifecycle).toBe("LANDED");
    expect(engine.ledger.get(waiting.ccrId ?? "")?.ownerCommitSha).toBe(broken.ownerCommitSha);
    expect(mergeQueue.landings).toHaveLength(1);
    expect(engine.ledger.listEdges()).toHaveLength(0);
    expect(engine.ledger.notices().some((notice) => notice.reason === "wait_graph_deadlock")).toBe(true);
  });

  it("sends a semantic sort change through review when the JSON schema is unchanged", async () => {
    const { engine, mergeQueue } = harness();
    const jsonSchema = JSON.stringify({
      title: "OrderList",
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    });
    const result = await engine.submit(
      proposal({
        proposedDelta: {
          before: { jsonSchema },
          after: { jsonSchema },
          behaviorBefore: { endpoint: "GET /api/orders", defaultSort: "created_at DESC" },
          behaviorAfter: { endpoint: "GET /api/orders", defaultSort: "created_at ASC" },
        },
        claimedClass: "additive",
        claimedAdditive: true,
        rationale: "Flip the default order list sort.",
      }),
    );
    expect(result.classification).toBe("BREAKING");
    expect(result.semanticBreaking).toBe(true);
    expect(result.overridden).toBe(true);
    expect(result.fastPath).toBe(false);
    expect(result.decision?.semantic).toBe(true);
    expect(result.decision?.affectedChecks).toEqual(expect.arrayContaining(["M04", "UI tests"]));
    expect(result.decision?.alternatives.join(" ")).toContain("created_at DESC");
    expect(mergeQueue.landings).toHaveLength(0);
  });

  it("rejects a breaking CCR and tells the worker to adapt inside its scope", async () => {
    const { engine } = harness();
    const opened = await engine.submit(
      proposal({
        proposedDelta: {
          before: { sql: orderBefore },
          after: { sql: "CREATE TABLE orders ( id INTEGER PRIMARY KEY, price TEXT );" },
        },
        rationale: "Display price as text.",
      }),
    );
    const rejected = engine.reject(opened.ccrId ?? "", KEEP_ORIGINAL);
    expect(rejected.lifecycle).toBe("REJECTED");
    expect(rejected.wokenTaskIds).toEqual(["W-Orders"]);
    const wake = engine.mailbox.wakes.find((item) => item.taskId === "W-Orders");
    expect(wake?.resolution.instruction).toBe(LOCKED_ADAPTER_INSTRUCTION);
    expect(engine.ledger.audit(opened.ccrId ?? "").map((event) => event.lifecycle)).toContain("REJECTED");
  });

  it("approves a breaking CCR into Task 087 holds without auto-start", async () => {
    const { engine, mergeQueue } = harness();
    const opened = await engine.submit(
      proposal({
        proposedDelta: {
          before: { sql: orderBefore },
          after: { sql: "CREATE TABLE orders ( id INTEGER PRIMARY KEY );" },
        },
        rationale: "Drop price_cents.",
      }),
    );
    expect(opened.decision?.affectedFeatures).toContain("F-Orders");
    expect(opened.decision?.affectedScreens).toContain("Screen-Kitchen");
    expect(opened.decision?.affectedTasks).toEqual(expect.arrayContaining(["W-Orders", "T-Merged"]));
    const approved = engine.approve(opened.ccrId ?? "", APPROVE_BREAKING);
    expect(approved.lifecycle).toBe("APPROVED");
    expect(approved.queueState).toBe("revision_task_087");
    expect(approved.autoExecutionBlocked).toBe(true);
    expect(engine.holds.rows.map((row) => row.taskId)).toEqual(["W-Orders"]);
    expect(engine.holds.rows.map((row) => row.taskId)).not.toContain("T-Merged");
    const audit = engine.ledger.audit(opened.ccrId ?? "");
    const approvedEvent = audit.find((event) => event.lifecycle === "APPROVED");
    expect(approvedEvent?.payload.autoStart).toBe(false);
    expect(approvedEvent?.payload.trigger).toBe("breaking_contract");
    expect(approvedEvent?.payload.revisionTask).toBe("Task-087");
    expect(mergeQueue.landings).toHaveLength(0);
  });

  it("queues a CCR when the owner feature is on hold and notifies the coordinator", async () => {
    const { engine, mergeQueue } = harness();
    const result = await engine.submit(
      proposal({
        requestingTaskId: "W-Menu",
        requestingFeatureId: "F-Menu",
        targetContractNodeId: "entity:MenuItem",
        proposedDelta: {
          before: { sql: "CREATE TABLE menu_items ( id INTEGER PRIMARY KEY );" },
          after: { sql: "CREATE TABLE menu_items ( id INTEGER PRIMARY KEY, badge TEXT NULL );" },
        },
        rationale: "Add a badge to menu items.",
      }),
    );
    expect(result.queueState).toBe("blocked_by_owner_hold");
    expect(result.fastPath).toBe(false);
    expect(result.lifecycle).toBe("CLASSIFIED");
    expect(result.escalation).toBe("project-integrator@1");
    expect(mergeQueue.landings).toHaveLength(0);
    expect(engine.ledger.notices().some((notice) => notice.reason === "blocked_by_owner_hold" && notice.targetRole === "project-integrator@1")).toBe(true);
  });

  it("halts the fourth CCR from one task and escalates for architectural review", async () => {
    const { engine } = harness();
    const results = [];
    for (const name of ["one", "two", "three", "four"]) {
      results.push(
        await engine.submit(
          proposal({
            proposedDelta: {
              before: { sql: orderBefore },
              after: { sql: `CREATE TABLE orders ( id INTEGER PRIMARY KEY, price_cents INTEGER NOT NULL, ${name} TEXT NULL );` },
            },
            rationale: `Add ${name}.`,
          }),
        ),
      );
    }
    expect(results.slice(0, 3).every((result) => result.lifecycle === "LANDED")).toBe(true);
    expect(results[3]?.spamHalted).toBe(true);
    expect(results[3]?.ccrId).toBeNull();
    expect(results[3]?.haltedTaskId).toBe("W-Orders");
    expect(results[3]?.escalation).toContain("architecture decomposition");
    const notices = engine.ledger.notices().filter((notice) => notice.reason === "ccr_spam_cap");
    expect(notices.map((notice) => notice.targetRole).sort()).toEqual(["planner", "project-integrator@1"]);
  });

  it("refuses to land an additive CCR when compatibility checks fail", async () => {
    const { engine, mergeQueue } = harness({ failChecks: ["compat:entity:Order"] });
    const result = await engine.submit(
      proposal({
        proposedDelta: {
          before: { sql: orderBefore },
          after: { sql: "CREATE TABLE orders ( id INTEGER PRIMARY KEY, price_cents INTEGER NOT NULL, dietary_note TEXT NULL );" },
        },
      }),
    );
    expect(result.queueState).toBe("regression_failed");
    expect(result.lifecycle).toBe("CLASSIFIED");
    expect(result.ownerCommitSha).toBeNull();
    expect(mergeQueue.landings).toHaveLength(0);
  });

  it("keeps the audit ledger when the database is reopened", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "ccr-ledger-"));
    const file = path.join(directory, "state.db");
    const ledger = CcrLedger.open(file);
    const { engine } = harness({ ledger });
    const result = await engine.submit(
      proposal({
        proposedDelta: {
          before: { sql: orderBefore },
          after: { sql: "CREATE TABLE orders ( id INTEGER PRIMARY KEY, price_cents INTEGER NOT NULL, dietary_note TEXT NULL );" },
        },
      }),
    );
    const before = engine.ledger.audit(result.ccrId ?? "").map((event) => ({ ...event, payload: { ...event.payload } }));
    ledger.close();
    const reopened = CcrLedger.open(file);
    const after = reopened.audit(result.ccrId ?? "");
    expect(after.map((event) => event.lifecycle)).toEqual(before.map((event) => event.lifecycle));
    expect(after[0]?.payload).toEqual(before[0]?.payload);
    expect(after.at(-1)?.payload.ownerCommitSha).toBe(result.ownerCommitSha);
    reopened.close();
  });

  it("rejects extra fields on ccr@1", async () => {
    expect(() => parseCcrV1({ schema: "ccr@1", id: "CCR-1", from_feature: "F-Orders", target: "entity:Order", change: { add_column: { name: "note", type: "text", nullable: true } }, reason: "need it", class: "additive", status: "open", bypass: true })).toThrow(/unknown field/);
  });
});
