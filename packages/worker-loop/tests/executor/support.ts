import { LocalSixZoneContextBuilder } from "../../src/executor/context-builder.js";
import { MemoryAttemptCoordinator } from "../../src/executor/memory-coordinator.js";
import { NativeWorkerLoop } from "../../src/executor/native-worker-loop.js";
import type {
  BudgetLedgerPort,
  CheckpointCommit,
  CheckpointSnapshotPort,
  CrashInjectorPort,
  ModelInvokeOptions,
  ModelStreamPort,
  ModelTurnRequest,
} from "../../src/executor/ports.js";
import {
  LocalTurnFailure,
  NATIVE_TOOL_CATALOG,
  toolBody,
  type AttemptRecord,
  type CrashPoint,
  type ModelProfileView,
  type TaskPacketView,
  type ToolBody,
  type WorkingMemory,
} from "../../src/executor/types.js";
import { createHash } from "node:crypto";

export interface ScriptedTool {
  name: string;
  arguments: Record<string, unknown>;
  malformedError?: string;
}

export interface ScriptedTurn {
  text?: string;
  reasoning?: string;
  tools?: ScriptedTool[];
  tokensIn?: number;
  tokensOut?: number;
  error?: LocalTurnFailure;
}

export interface FixtureOptions {
  id?: string;
  level?: "junior" | "senior";
  maxSteps?: number | null;
  maxReserves?: number;
  contextWindow?: number;
  tools?: string[];
  must?: string[];
  files?: Record<string, string>;
  memory?: WorkingMemory;
  script: (call: number, request: ModelTurnRequest) => ScriptedTurn;
  crash?: CrashInjectorPort;
  onTool?: (name: string) => void;
  onStreamStart?: (call: number, signal: AbortSignal) => void;
  reconcile?: { action: "settle" | "release"; actualUnits: number };
  bindFiles?: (files: MemoryFiles) => void;
}

export interface LoopFixture {
  id: string;
  loop: NativeWorkerLoop;
  coordinator: MemoryAttemptCoordinator;
  model: ScriptedModel;
  budget: FakeBudget;
  files: MemoryFiles;
  events: string[];
  formatted: string[][];
  waits: number[];
  attempt: () => AttemptRecord;
}

export function createFixture(options: FixtureOptions): LoopFixture {
  const id = options.id ?? "A1";
  const events: string[] = [];
  const formatted: string[][] = [];
  const waits: number[] = [];
  const files = new MemoryFiles(options.files ?? { "src/app.ts": "export const value = 1;\n" });
  options.bindFiles?.(files);
  const snapshots = new MemorySnapshots(files);
  const coordinator = new MemoryAttemptCoordinator();
  const budget = new FakeBudget(options.maxReserves ?? 100, events, options.reconcile);
  const model = new ScriptedModel(options.script, events, options.onStreamStart);
  const onTool = options.onTool ?? (() => undefined);
  const packet = packetFor(options.tools ?? [...NATIVE_TOOL_CATALOG], options.must);
  const attempt = attemptFor(id, options.level ?? "junior", options.maxSteps ?? null, packet, options.memory, options.contextWindow);
  coordinator.registerAttempt(attempt);
  const loop = new NativeWorkerLoop({
    coordinator,
    model,
    context: new LocalSixZoneContextBuilder(),
    budget,
    snapshots,
    reader: {
      async readFile(path): Promise<ToolBody> {
        onTool("read_file");
        return toolBody({ ok: true, summary: `read ${path}`, output: files.read(path) ?? "(missing)" });
      },
      async listFiles(glob): Promise<ToolBody> {
        onTool("list");
        return toolBody({ ok: true, summary: `list ${glob}`, output: glob });
      },
      async grepFiles(pattern): Promise<ToolBody> {
        onTool("grep");
        return toolBody({ ok: true, summary: `grep ${pattern}`, output: pattern });
      },
    },
    edits: {
      availableTools: () => ["str_replace", "write_new_file"],
      async applyPatch(patch) {
        onTool("apply_patch");
        events.push("edit");
        files.write("src/app.ts", patch);
        return { filesWritten: ["src/app.ts"] };
      },
      async strReplace(path, _oldText, newText) {
        onTool("str_replace");
        if (path === "stuck") {
          const error = new Error("ladder exhausted");
          error.name = "EditStuckEscalation";
          throw error;
        }
        events.push("edit");
        files.write(path, newText);
        return { filesWritten: [path] };
      },
      async searchReplace(input) {
        onTool("search_replace");
        events.push("edit");
        files.write("src/app.ts", input);
        return { filesWritten: ["src/app.ts"] };
      },
      async writeNewFile(path, content) {
        onTool("write_new_file");
        events.push("edit");
        files.write(path, content);
        return { filesWritten: [path] };
      },
      async replaceLines(path, _start, _end, text) {
        onTool("replace_lines");
        events.push("edit");
        files.write(path, text);
        return { filesWritten: [path] };
      },
    },
    runner: {
      async run(command): Promise<ToolBody> {
        onTool("harness.run");
        events.push("run");
        const fingerprint = /fingerprint=([^\s]+)/.exec(command)?.[1] ?? null;
        const fail = /fail=([^\s]+)/.exec(command)?.[1] ?? null;
        return toolBody({
          ok: fail === null,
          summary: `test ${command}`,
          output: command,
          failingCheckFingerprint: fingerprint,
          checkResults: fail
            ? [{ id: fail, status: "fail" }]
            : [{ id: "AC-1", status: "pass" }],
        });
      },
    },
    readLog: {
      async readLog(artifactId): Promise<ToolBody> {
        onTool("harness.read_log");
        return toolBody({ ok: true, summary: `log ${artifactId}`, output: artifactId });
      },
    },
    kb: {
      async call(name): Promise<ToolBody> {
        onTool(name);
        return toolBody({ ok: true, summary: name, output: "kb node" });
      },
    },
    notes: {
      apply(current, patch) {
        onTool("notes.update");
        return {
          planSteps: stringList(patch.planSteps) ?? [...current.planSteps],
          doneByMustId: stringRecord(patch.doneByMustId) ?? { ...current.doneByMustId },
          openProblems: stringList(patch.openProblems) ?? [...current.openProblems],
          learnedFacts: stringList(patch.learnedFacts) ?? [...current.learnedFacts],
        };
      },
    },
    askOwner: {
      async ask(question): Promise<ToolBody> {
        onTool("harness.ask_owner");
        return toolBody({
          ok: true,
          summary: `ask: ${question}`,
          output: question,
          terminal: {
            type: "waiting_input",
            candidateId: null,
            reason: null,
            question,
            checkId: null,
          },
        });
      },
    },
    flagBlocked: {
      async flag(reason): Promise<ToolBody> {
        onTool("harness.flag_blocked");
        events.push("flag");
        return toolBody({
          ok: true,
          summary: `blocked: ${reason}`,
          output: reason,
          terminal: { type: "blocked", candidateId: null, reason, question: null, checkId: null },
        });
      },
    },
    disputeTest: {
      async dispute(checkId): Promise<ToolBody> {
        onTool("harness.dispute_test");
        return toolBody({
          ok: true,
          summary: `dispute ${checkId}`,
          output: checkId,
          terminal: {
            type: "disputed",
            candidateId: null,
            reason: null,
            question: null,
            checkId,
          },
        });
      },
    },
    submit: {
      async submit(input): Promise<ToolBody> {
        events.push("submit");
        return toolBody({
          ok: true,
          summary: "submitted",
          output: input.commitSha ?? "",
          terminal: {
            type: "submitted",
            candidateId: "cand-1",
            reason: null,
            question: null,
            checkId: null,
          },
        });
      },
    },
    formatter: {
      async format(paths) {
        events.push("format");
        formatted.push([...paths]);
        for (const path of paths) {
          const current = files.read(path);
          if (current === null || current.includes("/*formatted*/")) continue;
          const suffix = current.endsWith("\n") ? "/*formatted*/\n" : "\n/*formatted*/\n";
          files.write(path, `${current}${suffix}`);
        }
        return paths;
      },
    },
    pacing: {
      async waitForRateLimit(ms) {
        waits.push(ms);
        events.push(`wait:${ms}`);
      },
    },
    clock: { now: () => 1_700_000_000_000 },
    ...(options.crash === undefined ? {} : { crash: options.crash }),
  });
  return {
    id,
    loop,
    coordinator,
    model,
    budget,
    files,
    events,
    formatted,
    waits,
    attempt: () => coordinator.getAttempt(id),
  };
}

export class ScriptedModel implements ModelStreamPort {
  readonly calls: ModelTurnRequest[] = [];
  lastOptions: ModelInvokeOptions | null = null;

  constructor(
    private readonly next: (call: number, request: ModelTurnRequest) => ScriptedTurn,
    private readonly events: string[],
    private readonly onStart?: (call: number, signal: AbortSignal) => void,
  ) {}

  async *stream(
    request: ModelTurnRequest,
    options: ModelInvokeOptions,
  ): AsyncIterable<import("../../src/executor/ports.js").LoopStreamEvent> {
    const call = this.calls.length;
    this.calls.push(structuredClone(request));
    this.lastOptions = options;
    this.events.push("stream");
    this.onStart?.(call, options.signal);
    if (options.signal.aborted) {
      const error = new Error("The operation was aborted");
      error.name = "AbortError";
      throw error;
    }
    const scripted = this.next(call, request);
    if (scripted.error) throw scripted.error;
    if (scripted.reasoning) {
      yield {
        type: "reasoning_item",
        encryptedContent: scripted.reasoning,
        canonicalJson: JSON.stringify({ encrypted_content: scripted.reasoning }),
      };
    }
    if (scripted.text) yield { type: "text_delta", text: scripted.text };
    for (const [index, tool] of (scripted.tools ?? []).entries()) {
      if (tool.malformedError) {
        yield {
          type: "malformed_tool_args",
          callId: `c${call}-${index}`,
          name: tool.name,
          rawArguments: tool.malformedError,
          error: tool.malformedError,
        };
      } else {
        yield {
          type: "tool_call",
          callId: `c${call}-${index}`,
          name: tool.name,
          arguments: tool.arguments,
          rawArguments: JSON.stringify(tool.arguments),
        };
      }
    }
    yield { type: "usage", inputTokens: scripted.tokensIn ?? 10, outputTokens: scripted.tokensOut ?? 5 };
    yield { type: "stop", stopReason: (scripted.tools?.length ?? 0) > 0 ? "tool_use" : "end_turn" };
  }
}

export class FakeBudget implements BudgetLedgerPort {
  spent = 0;
  private seq = 0;
  private successes = 0;
  private readonly reservations = new Map<
    string,
    { state: "held" | "settled" | "released" | "unknown"; attemptId: string }
  >();

  constructor(
    private readonly maxReserves: number,
    private readonly events: string[],
    private readonly reconcilePlan: { action: "settle" | "release"; actualUnits: number } = {
      action: "release",
      actualUnits: 0,
    },
  ) {}

  async reserveAcrossScopes(input: {
    attemptId: string;
    amountUnits: number;
    purpose: "model_call";
  }): Promise<{ ok: true; reservationId: string } | { ok: false; blockingScopes: string[] }> {
    if (this.successes >= this.maxReserves) {
      this.events.push("reserve-fail");
      return { ok: false, blockingScopes: ["task"] };
    }
    this.successes += 1;
    const reservationId = `res-${this.seq + 1}`;
    this.seq += 1;
    this.reservations.set(reservationId, { state: "held", attemptId: input.attemptId });
    this.events.push("reserve-ok");
    return { ok: true, reservationId };
  }

  async settleReservation(reservationId: string, actualUnits: number) {
    const row = this.reservations.get(reservationId);
    if (!row || (row.state !== "held" && row.state !== "unknown")) {
      throw new Error(`cannot settle ${reservationId}`);
    }
    row.state = "settled";
    this.spent += actualUnits;
    return { spentUnits: this.spent, overrunUnits: Math.max(0, actualUnits - 1_000) };
  }

  async releaseReservation(reservationId: string): Promise<void> {
    const row = this.reservations.get(reservationId);
    if (!row || row.state !== "held") throw new Error(`cannot release ${reservationId}`);
    row.state = "released";
  }

  async markReservationUnknown(reservationId: string): Promise<void> {
    const row = this.reservations.get(reservationId);
    if (!row || row.state !== "held") throw new Error(`cannot mark unknown ${reservationId}`);
    row.state = "unknown";
    this.events.push("unknown");
  }

  async reconcileUnknownReservation(reservationId: string) {
    this.events.push("reconcile");
    const row = this.reservations.get(reservationId);
    if (!row || row.state !== "unknown") throw new Error(`not unknown ${reservationId}`);
    if (this.reconcilePlan.action === "release") {
      row.state = "held";
      await this.releaseReservation(reservationId);
      return { action: "release" as const, actualUnits: 0 };
    }
    await this.settleReservation(reservationId, this.reconcilePlan.actualUnits);
    return { action: "settle" as const, actualUnits: this.reconcilePlan.actualUnits };
  }

  async listUnknownReservations(attemptId: string): Promise<readonly string[]> {
    return [...this.reservations.entries()]
      .filter(([, row]) => row.attemptId === attemptId && row.state === "unknown")
      .map(([reservationId]) => reservationId);
  }

  async getSpentUnits(): Promise<number> {
    return this.spent;
  }
}

export class MemoryFiles {
  private readonly files = new Map<string, string>();
  private readonly base = new Map<string, string>();

  constructor(initial: Record<string, string>) {
    for (const [path, content] of Object.entries(initial)) {
      this.files.set(path, content);
      this.base.set(path, content);
    }
  }

  read(path: string): string | null {
    return this.files.get(path) ?? null;
  }

  write(path: string, content: string): void {
    this.files.set(path, content);
  }

  snapshot(): Map<string, string> {
    return new Map(this.files);
  }

  restore(saved: Map<string, string>): void {
    this.files.clear();
    for (const [path, content] of saved) this.files.set(path, content);
  }

  baseCopy(): Map<string, string> {
    return new Map(this.base);
  }

  dump(): Record<string, string> {
    return Object.fromEntries([...this.files.entries()].sort(([a], [b]) => a.localeCompare(b)));
  }
}

class MemorySnapshots implements CheckpointSnapshotPort {
  private readonly refs = new Map<string, Map<string, string>>();

  constructor(private readonly files: MemoryFiles) {}

  async createCheckpointWipCommit(input: {
    attemptId: string;
    step: number;
    taskId: string;
    previousWipRef: string | null;
  }): Promise<CheckpointCommit> {
    const previous = input.previousWipRef ? this.refs.get(input.previousWipRef) ?? null : null;
    const baseline = previous ?? this.files.baseCopy();
    const changed = diffKeys(baseline, this.files.snapshot());
    const treeSha = hashTree(this.files.snapshot());
    if (changed.length === 0) {
      return {
        ref: null,
        wipRef: input.previousWipRef,
        commitSha: input.previousWipRef,
        treeSha,
        noChanges: true,
        reused: true,
        changedFiles: [],
      };
    }
    const ref = `refs/harness/checkpoints/${input.attemptId}/${input.step}`;
    this.refs.set(ref, this.files.snapshot());
    return {
      ref,
      wipRef: ref,
      commitSha: `commit-${input.step}`,
      treeSha,
      noChanges: false,
      reused: false,
      changedFiles: changed,
    };
  }

  async resetWorktreeToRef(ref: string | null): Promise<{ treeSha: string }> {
    this.files.restore(ref ? this.refs.get(ref) ?? this.files.baseCopy() : this.files.baseCopy());
    return { treeSha: hashTree(this.files.snapshot()) };
  }

  async treeSha(): Promise<string> {
    return hashTree(this.files.snapshot());
  }

  async diffFromRef(ref: string | null): Promise<string> {
    const saved = ref ? this.refs.get(ref) ?? this.files.baseCopy() : this.files.baseCopy();
    const changed = diffKeys(saved, this.files.snapshot());
    if (changed.length === 0) return "(no file delta against the checkpoint)";
    return changed
      .map((path) => `--- ${path}\n+++ ${path}\n${this.files.read(path) ?? ""}`)
      .join("\n");
  }

  async changedPathsSinceBase(): Promise<string[]> {
    return diffKeys(this.files.baseCopy(), this.files.snapshot());
  }
}

export function crashOnce(
  point: CrashPoint,
  files: MemoryFiles,
  toolIndex: number | null = null,
): CrashInjectorPort {
  let armed = true;
  return {
    shouldCrash(candidate, site) {
      if (!armed || candidate !== point) return false;
      if (toolIndex !== null && site.toolIndex !== toolIndex) return false;
      armed = false;
      return true;
    },
    onCrash(candidate) {
      if (candidate === "during_tool" || candidate === "after_tool_before_log") {
        files.write("src/app.ts", "GARBAGE");
        files.write("src/trash.ts", "trash");
      }
    },
  };
}

export function editThenSubmit(call: number): ScriptedTurn {
  if (call === 0) {
    return {
      reasoning: "opaque-reasoning-blob",
      tools: [
        {
          name: "str_replace",
          arguments: { path: "src/app.ts", content: "export const value = 2;\n" },
        },
      ],
    };
  }
  if (call === 1) {
    return { text: "submitting", tools: [{ name: "harness.submit_candidate", arguments: {} }] };
  }
  throw new Error(`unexpected model call ${call}`);
}

export function assertReserveBeforeStream(events: readonly string[]): void {
  let reserves = 0;
  let streams = 0;
  for (const event of events) {
    if (event === "reserve-ok") reserves += 1;
    if (event === "reserve-fail") {
      if (streams !== reserves) throw new Error("failed reserve was not aligned with streams");
    }
    if (event === "stream") {
      if (reserves <= streams) throw new Error("model stream ran without a held reservation");
      streams += 1;
    }
  }
}

function packetFor(tools: string[], must: string[] | undefined): TaskPacketView {
  return {
    taskId: "T1",
    goal: "Update the value",
    must: must ?? ["MUST-1 change the value"],
    should: ["keep the diff small"],
    writeScope: ["src/**"],
    tools,
    checks: ["AC-1"],
    contractVersions: { "task-packet": "1" },
    kernelRules: "No subagents. Checkpoint every tool step.",
  };
}

function attemptFor(
  id: string,
  level: "junior" | "senior",
  maxSteps: number | null,
  packet: TaskPacketView,
  memory: WorkingMemory | undefined,
  contextWindow: number | undefined,
): AttemptRecord {
  const profile: ModelProfileView = {
    family: "test",
    contextWindow: contextWindow ?? 128_000,
    maxOutputTokens: 4_000,
    editFormat: "str_replace",
    supportsParallelToolCalls: true,
    supportsReasoningReplay: true,
    supportsStreamingToolArgs: true,
    toolCallReliabilityTier: 1,
    supportsPromptCaching: true,
    supportsToolCalling: true,
    smallContext: (contextWindow ?? 128_000) <= 32_768,
  };
  return {
    id,
    task: "T1",
    n: 1,
    epoch: 3,
    liveEpoch: 3,
    briefVersion: 4,
    briefChangedContradiction: false,
    contradictionApplied: false,
    historyFloorStep: 0,
    runtime: "native",
    model: "fake-model",
    connection: "local",
    worktreeSlot: "slot-a",
    baseCommit: "base",
    state: "running",
    startedAt: 1_700_000_000_000,
    endedAt: null,
    outcome: null,
    level,
    maxSteps,
    packet,
    profile,
    workingMemory: memory ?? {
      planSteps: ["edit the file", "submit"],
      doneByMustId: { "MUST-1": "edit the file" },
      openProblems: [],
      learnedFacts: [],
    },
    changedFiles: [],
    lastCheckResults: [],
    failureCalibrationIncrements: 0,
    routedTo: null,
    holds: [],
    hardSteer: null,
    additiveSteer: null,
    stallsByDigest: {},
    overflowRetried: false,
    progressStreak: 0,
    progressTree: null,
    progressFingerprint: null,
  };
}

function diffKeys(left: Map<string, string>, right: Map<string, string>): string[] {
  const keys = new Set([...left.keys(), ...right.keys()]);
  return [...keys].filter((key) => left.get(key) !== right.get(key)).sort();
}

function hashTree(files: Map<string, string>): string {
  const hash = createHash("sha256");
  for (const key of [...files.keys()].sort()) hash.update(`${key}\0${files.get(key) ?? ""}\0`);
  return hash.digest("hex");
}

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) return null;
  return [...value];
}

function stringRecord(value: unknown): Record<string, string> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string") return null;
    record[key] = item;
  }
  return record;
}
