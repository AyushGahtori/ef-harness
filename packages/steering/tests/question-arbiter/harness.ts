import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect } from "vitest";
import {
  MemoryOwnerDirectory,
  MemoryRoleMailbox,
  openQuestionArbiter,
  type QuestionArbiterRuntime,
  type QuestionKind,
  type WorkerQuestionRequest,
} from "../../src/question-arbiter/index.js";

const openRuntimes: QuestionArbiterRuntime[] = [];
const directories: string[] = [];

export function openArbiter(now: () => number = () => 0): QuestionArbiterRuntime {
  const dir = mkdtempSync(join(tmpdir(), "qa-116-"));
  directories.push(dir);
  const runtime = openQuestionArbiter({
    stateDbPath: join(dir, "state.db"),
    telemetryDbPath: join(dir, "telemetry.db"),
    now,
  });
  openRuntimes.push(runtime);
  return runtime;
}

afterEach(() => {
  while (openRuntimes.length > 0) openRuntimes.pop()?.close();
  while (directories.length > 0) {
    const dir = directories.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

export function request(overrides: Partial<WorkerQuestionRequest> & Pick<WorkerQuestionRequest, "text" | "waitingTaskId">): WorkerQuestionRequest {
  return {
    buildId: "build-1",
    workerId: `worker-${overrides.waitingTaskId}`,
    waitingRole: "worker",
    kind: "product",
    ...overrides,
  };
}

export function ownersOf(runtime: QuestionArbiterRuntime): MemoryOwnerDirectory {
  expect(runtime.owners).toBeInstanceOf(MemoryOwnerDirectory);
  return runtime.owners as MemoryOwnerDirectory;
}

export function mailboxOf(runtime: QuestionArbiterRuntime): MemoryRoleMailbox {
  expect(runtime.mailbox).toBeInstanceOf(MemoryRoleMailbox);
  return runtime.mailbox as MemoryRoleMailbox;
}

export function submitKind(runtime: QuestionArbiterRuntime, kind: QuestionKind, taskId: string): void {
  runtime.filter.intercept(
    request({
      text: `Question for ${kind} ${taskId}`,
      waitingTaskId: taskId,
      kind,
    }),
  );
}
