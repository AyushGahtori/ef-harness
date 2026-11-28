import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertAgentRuntimeAdapter } from "../../src/core/interface.js";
import { AGENT_RUNTIME_ADAPTER_METHODS } from "../../src/cursor/constants.js";
import { CursorRuntimeAdapter } from "../../src/cursor/adapter.js";
import {
  InMemoryCursorAcp,
  InMemoryCursorSdk,
  createCursorRuntimeDeps,
} from "../../src/cursor/local-ports.js";
import type { WindowsJobSupervisorPort } from "../../src/cursor/ports.js";
import { SupervisedCursorRuntime } from "../../src/cursor/runtime.js";
import { CursorLocalSdkBridge } from "../../src/cursor/sdk-bridge.js";
import type { CursorRuntimeDeps } from "../../src/cursor/ports.js";
import type { CursorSessionSpec, NormalizedRuntimeEvent } from "../../src/cursor/types.js";

class RecordingCursorJob implements WindowsJobSupervisorPort {
  failToReap = false;
  private readonly jobs = new Map<string, Set<number>>();

  create(sessionId: string): { readonly jobId: string } {
    const jobId = `job-${sessionId}`;
    this.jobs.set(jobId, new Set());
    return { jobId };
  }

  attach(jobId: string, pid: number): void {
    this.jobs.get(jobId)?.add(pid);
  }

  list(jobId: string): readonly number[] {
    return [...(this.jobs.get(jobId) ?? [])];
  }

  kill(jobId: string, reason: string): readonly number[] {
    void reason;
    const pids = [...(this.jobs.get(jobId) ?? [])];
    if (!this.failToReap) this.jobs.set(jobId, new Set());
    return pids;
  }
}

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function worktree(name: string): string {
  const root = mkdtempSync(path.join(tmpdir(), "cursor-contract-"));
  roots.push(root);
  const dir = path.join(root, name);
  mkdirSync(path.join(dir, "src"), { recursive: true });
  mkdirSync(path.join(dir, ".git", "info"), { recursive: true });
  writeFileSync(path.join(dir, "src", "orders.ts"), "export const ready = true;\n");
  return dir;
}

function spec(dir: string, attemptId: string): CursorSessionSpec {
  return {
    attemptId,
    connectionId: "cursor-connection",
    worktree: dir,
    brief: "Implement the owned write scope.",
    briefVersion: "brief-1",
    writeScope: ["src/**/*.ts"],
    wipDiff: "diff --git a/src/orders.ts",
  };
}

const scripted = [
  { type: "assistant" as const, text: "editing orders" },
  {
    type: "tool" as const,
    requestId: "edit-1",
    kind: "edit" as const,
    toolName: "edit",
    path: "src/orders.ts",
  },
  { type: "shell" as const, requestId: "sh-1", command: "pnpm test" },
  { type: "file_edited" as const, paths: ["src/orders.ts"] },
];

function comparable(events: readonly NormalizedRuntimeEvent[]): unknown[] {
  return events.map((event) => {
    if (event.type === "permission_decided") {
      return { type: event.type, effect: event.effect, reason: event.reason };
    }
    if (event.type === "usage_reported") {
      return { type: event.type, usage: event.usage };
    }
    const rest: Record<string, unknown> = { ...event };
    delete rest.sessionId;
    return rest;
  });
}

async function collect(events: AsyncIterable<NormalizedRuntimeEvent>): Promise<NormalizedRuntimeEvent[]> {
  const collected: NormalizedRuntimeEvent[] = [];
  for await (const event of events) {
    collected.push(event);
    if (event.type === "turn_completed") break;
  }
  return collected;
}

describe("Cursor SDK and ACP adapter contract", () => {
  it("implements all 10 methods on both transports with identical normalized events", async () => {
    const sdkDir = worktree("sdk");
    const acpDir = worktree("acp");
    const sdk = new InMemoryCursorSdk();
    const acp = new InMemoryCursorAcp();
    sdk.scriptedEvents = scripted.map((event) =>
      event.type === "tool" ? { ...event, path: path.join(sdkDir, "src", "orders.ts") } : event,
    );
    acp.scriptedEvents = scripted.map((event) =>
      event.type === "tool" ? { ...event, path: path.join(acpDir, "src", "orders.ts") } : event,
    );
    const sdkDeps = createCursorRuntimeDeps({ sdk, usage: sdk });
    const acpDeps = createCursorRuntimeDeps({ acp, usage: sdk });
    const sdkBridge = new CursorLocalSdkBridge(sdkDeps);
    const acpBridge = new SupervisedCursorRuntime(acpDeps, "acp");
    assertAgentRuntimeAdapter(new CursorRuntimeAdapter(sdkDeps));
    assertAgentRuntimeAdapter(new CursorRuntimeAdapter(acpDeps));

    for (const bridge of [sdkBridge, acpBridge]) {
      for (const method of AGENT_RUNTIME_ADAPTER_METHODS) {
        expect(typeof bridge[method]).toBe("function");
      }
    }

    const sdkRef = await sdkBridge.startSession(spec(sdkDir, "sdk"));
    const acpRef = await acpBridge.startSession(spec(acpDir, "acp"));
    const sdkTurn = await sdkBridge.sendTurn(sdkRef.sessionId, "implement");
    const acpTurn = await acpBridge.sendTurn(acpRef.sessionId, "implement");
    expect(sdkTurn.dispatched).toBe(true);
    expect(acpTurn.dispatched).toBe(true);
    expect(sdkTurn.usage).toEqual(acpTurn.usage);

    const sdkPermission = await sdkBridge.respondPermission(sdkRef.sessionId, "edit-1", { effect: "allow" });
    const acpPermission = await acpBridge.respondPermission(acpRef.sessionId, "edit-1", { effect: "allow" });
    expect(sdkPermission.effect).toBe("allow");
    expect(acpPermission.effect).toBe("allow");
    expect(await sdkBridge.usage(sdkRef.sessionId)).toEqual(sdkTurn.usage);
    expect(await acpBridge.usage(acpRef.sessionId)).toEqual(acpTurn.usage);

    const sdkSteer = await sdkBridge.steer(sdkRef.sessionId, "keep the public types");
    const acpSteer = await acpBridge.steer(acpRef.sessionId, "keep the public types");
    expect(sdkSteer.mode).toBe("additive");
    expect(acpSteer.mode).toBe("additive");

    const sdkEvents = await collect(sdkBridge.events(sdkRef.sessionId));
    const acpEvents = await collect(acpBridge.events(acpRef.sessionId));
    expect(comparable(sdkEvents)).toEqual(comparable(acpEvents));
    expect(sdkEvents.map((event) => event.type)).toContain("turn_started");
    expect(sdkEvents.map((event) => event.type)).toContain("usage_reported");
    expect(sdkEvents.map((event) => event.type)).toContain("permission_decided");

    const probe = await sdkBridge.probe();
    const auth = await sdkBridge.authStatus("cursor-connection");
    expect(probe.transport).toBe("sdk");
    expect(probe.modes).toEqual(["wrapped", "stripped"]);
    expect(auth.signedIn).toBe(true);
    expect(auth.readsPersonalCursorHome).toBe(false);
    expect((await acpBridge.probe()).transport).toBe("acp");

    const contradiction = await sdkBridge.resume(sdkRef.sessionId, { contradictory: true });
    expect(contradiction.supported).toBe(false);
    expect(contradiction.fallback).toBe("fresh_session");
    expect(contradiction.labeledWip).toContain("diff --git a/src/orders.ts");
    expect(contradiction.rebuiltBrief).toContain("Labeled WIP:");
    const resumed = await acpBridge.resume(acpRef.sessionId, { briefVersion: "brief-1" });
    expect(resumed.supported).toBe(true);
    expect(resumed.fallback).toBe("native");
  });

  it("aborts a hung SDK run and reaps the job in under 500 ms", async () => {
    const dir = worktree("interrupt");
    const sdk = new InMemoryCursorSdk();
    const jobs = new RecordingCursorJob();
    sdk.hangSend = true;
    sdk.hangAbort = true;
    const deps: CursorRuntimeDeps = createCursorRuntimeDeps({ sdk, usage: sdk, jobs });
    const bridge = new CursorLocalSdkBridge(deps);
    const ref = await bridge.startSession(spec(dir, "interrupt"));
    const pending = bridge.sendTurn(ref.sessionId, "tsc --noEmit");
    await new Promise((resolve) => setTimeout(resolve, 20));
    const receipt = await bridge.interrupt(ref.sessionId);
    const turn = await pending;
    expect(receipt.elapsedMs).toBeLessThan(500);
    expect(receipt.lingeringPids).toEqual([]);
    expect(receipt.killedPids.length).toBeGreaterThan(0);
    expect(receipt.sdkAbortInvoked).toBe(true);
    expect(sdk.abortCalls).toBe(1);
    expect(turn.stopReason).toBe("interrupted");
    expect(turn.usage.partialInterrupted).toBe(true);
    expect(jobs.list(bridge.describeLaunch(ref.sessionId).jobId)).toEqual([]);
  });

  it("fails closed when the job cannot reap children", async () => {
    const dir = worktree("reap");
    const jobs = new RecordingCursorJob();
    jobs.failToReap = true;
    const bridge = new CursorLocalSdkBridge(createCursorRuntimeDeps({ jobs }));
    const ref = await bridge.startSession(spec(dir, "reap"));
    await expect(bridge.interrupt(ref.sessionId)).rejects.toMatchObject({ code: "lingering_children" });
  });

  it("redacts the Cursor key if a vendor event echoes it", async () => {
    const dir = worktree("redact");
    const sdk = new InMemoryCursorSdk();
    sdk.scriptedEvents = [{ type: "assistant", text: "cursor-user-key-90day-dpapi" }];
    const bridge = new CursorLocalSdkBridge(createCursorRuntimeDeps({ sdk, usage: sdk }));
    const ref = await bridge.startSession(spec(dir, "redact"));
    await bridge.sendTurn(ref.sessionId, "hello");
    const events = await collect(bridge.events(ref.sessionId));
    const text = JSON.stringify(events);
    expect(text).not.toContain("cursor-user-key-90day-dpapi");
    expect(text).toContain("[redacted]");
  });
});
