import { compareText } from "./tokens.js";
import { KB_PULL_TOOL_IDS, type CompiledBrief, type SliceItem, type WorkerBriefPacket } from "./types.js";

export function buildWorkerBriefPacket(brief: {
  readonly level: CompiledBrief["level"];
  readonly must: CompiledBrief["must"];
  readonly should: CompiledBrief["should"];
  readonly could: CompiledBrief["could"];
  readonly taskId: string;
  readonly attemptId: string | null;
  readonly epoch: number;
  readonly briefVersion: number;
  readonly baseBranch: string;
  readonly baseCommit: string;
  readonly goal: string;
  readonly writeScope: readonly string[];
  readonly readScope: readonly string[];
  readonly hiddenChecks: number;
}): WorkerBriefPacket {
  const must = brief.must.filter((item) => item.kind !== "scope" && item.kind !== "task");
  return {
    schema: "task-packet@1",
    task: brief.taskId,
    attempt: brief.attemptId,
    epoch: brief.epoch,
    brief_version: brief.briefVersion,
    base: { branch: brief.baseBranch, commit: brief.baseCommit },
    goal: brief.goal,
    write_scope: brief.writeScope,
    read_boundary: brief.readScope,
    must: must.map((item) => ({ id: item.id, v: item.version, text: item.text })),
    contracts: must
      .filter((item) => item.contractRole)
      .map((item) => ({ id: item.id, v: item.version, role: item.contractRole ?? "consume" })),
    checks_visible: must.filter((item) => item.kind === "check").map((item) => item.id).sort(compareText),
    checks_hidden_count: brief.hiddenChecks,
    should: brief.should.map((item) => ({ id: item.id, v: item.version, text: item.text })),
    could: brief.could.map((item) => ({ id: item.id, pointer: item.pointer ?? item.id })),
    skills: brief.should
      .filter((item) => item.kind === "skill")
      .map((item) => ({ id: item.id, digest: item.contentHash })),
    tools: ["edit", "harness.run", "kb.*", "harness.ask_owner", "harness.flag_blocked", ...KB_PULL_TOOL_IDS],
    budget: { usd: 0, allowance: {}, slots: 0 },
    limits: { wall_min: 0, max_steps: 0 },
    level: brief.level,
  };
}

export function assertWorkerBriefPacket(packet: WorkerBriefPacket): void {
  if (packet.schema !== "task-packet@1") throw new Error("WorkerBriefSchema: schema must be task-packet@1");
  if (!packet.task) throw new Error("WorkerBriefSchema: task is required");
  if (!packet.goal) throw new Error("WorkerBriefSchema: goal is required");
  if (!Array.isArray(packet.write_scope)) throw new Error("WorkerBriefSchema: write_scope is required");
  if (!Number.isInteger(packet.budget.usd) || packet.budget.usd < 0) {
    throw new Error("WorkerBriefSchema: budget.usd must be a non-negative integer");
  }
  if (!Number.isInteger(packet.checks_hidden_count) || packet.checks_hidden_count < 0) {
    throw new Error("WorkerBriefSchema: checks_hidden_count must be a non-negative integer");
  }
  const ids = [
    ...packet.must.map((item) => item.id),
    ...packet.should.map((item) => item.id),
    ...packet.could.map((item) => item.id),
  ];
  for (const id of ids) {
    if (id.startsWith("sealed_oracle") || id.startsWith("hidden_check")) {
      throw new Error(`WorkerBriefSchema: sealed id ${id} entered the packet`);
    }
  }
}

export function skillDigest(item: SliceItem): string {
  return item.contentHash;
}
