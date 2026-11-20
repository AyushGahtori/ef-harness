import { afterEach, describe, expect, it } from "vitest";
import { AttemptCheckpointRepo, type LeaseDatabase, type LeaseStatement } from "../../src/leases/index.js";
import { openState, type LeaseFixture } from "./harness.js";

const open: LeaseFixture[] = [];

afterEach(() => {
  while (open.length > 0) open.pop()?.close();
});

describe("attempt checkpoints", () => {
  it("round-trips wip, session, contract versions, and pending effects", () => {
    const fixture = openState();
    open.push(fixture);
    fixture.seed.addTask("T1");
    expect(fixture.manager.claimTask(fixture.seed.claimInput("T1", "A1")).claimed).toBe(true);
    const repo = new AttemptCheckpointRepo(fixture.db);
    const checkpoint = {
      attemptId: "A1",
      step: 3,
      wipRef: "refs/harness/checkpoints/A1/3",
      sessionRef: "thread-9",
      contractVersions: { "kitchen-totals": 2, print: 1 },
      pendingEffects: [{ id: "E1", kind: "migrate", nested: { ready: true } }],
      handoffArtifact: "resume the print dialog",
      updatedAt: 1_000_000,
    };
    repo.write(checkpoint);
    expect(repo.read("A1")).toEqual(checkpoint);

    repo.write({
      ...checkpoint,
      step: 4,
      wipRef: null,
      sessionRef: "thread-10",
      contractVersions: { print: 2 },
      pendingEffects: [],
      handoffArtifact: null,
      updatedAt: 1_000_100,
    });
    expect(repo.read("A1")).toEqual({
      attemptId: "A1",
      step: 4,
      wipRef: null,
      sessionRef: "thread-10",
      contractVersions: { print: 2 },
      pendingEffects: [],
      handoffArtifact: null,
      updatedAt: 1_000_100,
    });
    expect(repo.read("missing")).toBeNull();
  });

  it("keeps the previous checkpoint when a later write rolls back", () => {
    const fixture = openState({
      wrap(inner) {
        return failNth(inner, "attempt_checkpoints", 2);
      },
    });
    open.push(fixture);
    fixture.seed.addTask("T1");
    expect(fixture.manager.claimTask(fixture.seed.claimInput("T1", "A1")).claimed).toBe(true);
    const repo = new AttemptCheckpointRepo(fixture.db);
    const first = {
      attemptId: "A1",
      step: 1,
      wipRef: "refs/harness/checkpoints/A1/1",
      sessionRef: "thread-1",
      contractVersions: { print: 1 },
      pendingEffects: [{ id: "E1" }],
      handoffArtifact: "first",
      updatedAt: 10,
    };
    repo.write(first);
    expect(() => repo.write({ ...first, step: 2, updatedAt: 11 })).toThrow(/checkpoint write failed/);
    expect(repo.read("A1")).toEqual(first);
  });

  it("rejects a checkpoint for an attempt that does not exist", () => {
    const fixture = openState();
    open.push(fixture);
    const repo = new AttemptCheckpointRepo(fixture.db);
    expect(() =>
      repo.write({
        attemptId: "NOPE",
        step: 1,
        wipRef: null,
        sessionRef: null,
        contractVersions: {},
        pendingEffects: [],
        handoffArtifact: null,
        updatedAt: 1,
      }),
    ).toThrow(/FOREIGN KEY/i);
    expect(repo.read("NOPE")).toBeNull();
  });
});

function failNth(inner: LeaseDatabase, needle: string, failAt: number): LeaseDatabase {
  let runs = 0;
  return {
    exec(sql: string): void {
      inner.exec(sql);
    },
    prepare(sql: string): LeaseStatement {
      const prepared = inner.prepare(sql);
      return {
        all: (params) => prepared.all(params),
        get: (params) => prepared.get(params),
        run: (params) => {
          if (sql.includes(needle)) {
            runs += 1;
            if (runs === failAt) throw new Error("checkpoint write failed");
          }
          return prepared.run(params);
        },
      };
    },
  };
}
