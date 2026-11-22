/**
 * Local ports for sibling tasks that are not merged into this branch.
 *
 * - `KnowledgeGraphPort` matches Task 017 `KnowledgeGraphRepo` methods this
 *   package actually calls: `allocateEntityId`, `commitChangeSet`, `getNode`,
 *   `recordEvidence`.
 * - `WindowsJobSupervisor` is the visible-installer supervisor. Task 041 does
 *   not export that name; Task 040 `WindowsJobManager.runCommand` /
 *   `terminateJob` is the Job Object implementation to adapt.
 * - `SharedQuestionArbiter` matches Task 116 `submit` for `kind: "human_step"`
 *   plus a retire call. The sibling method is `retireByEdit`.
 * - `WindowsDpapiSecretsVault` matches Task 120's vault read. Only a secret id
 *   crosses this boundary; plaintext is used inside the probe and scrubbed.
 * - `TaskHoldPort` matches Task 021 `placeHold` / `releaseHold` rows
 *   `(task, reason, source, created_at)` with reason `waiting_on_human_step`.
 */

import type { ProbeResult } from "./types.js";

export interface GraphNodeRef {
  readonly id: string;
  readonly version: number;
  readonly kind: string;
  readonly title: string;
}

export interface GraphChangeSet {
  readonly origin: "kernel";
  readonly author: string;
  readonly summary: string;
  readonly nodes: readonly {
    readonly op: "create";
    readonly id: string;
    readonly kind: "comment";
    readonly title: string;
    readonly text: string;
    readonly status: "active";
    readonly fields: Readonly<Record<string, string | number | boolean>>;
  }[];
}

export interface GraphEvidenceInput {
  readonly node: string;
  readonly nodeVersion: number;
  readonly sourceKind: "repo";
  readonly sourceRef: string;
  readonly locator: { readonly stepId: string };
  readonly quote: string;
  readonly verified: boolean;
}

export interface KnowledgeGraphPort {
  allocateEntityId(prefix: string): string;
  commitChangeSet(proposal: GraphChangeSet): { readonly rev: number; readonly changeSetId: string };
  getNode(id: string): GraphNodeRef | null;
  recordEvidence(input: GraphEvidenceInput): { readonly id: number };
}

export interface HumanStepQuestionRequest {
  readonly buildId: string;
  readonly workerId: string;
  readonly waitingTaskId: string;
  readonly waitingRole: string;
  readonly text: string;
  readonly kind: "human_step";
}

export interface SharedQuestionArbiter {
  submit(request: HumanStepQuestionRequest): { readonly questionId: string };
  retireQuestion(questionId: string, source: string, answer: string): void;
}

export interface WindowsDpapiSecretsVault {
  readSecret(secretId: string): string | null | Promise<string | null>;
}

export interface TaskHoldDraft {
  readonly task: string;
  readonly reason: string;
  readonly source: string;
  readonly createdAt: number;
}

export interface TaskHoldPort {
  placeHold(hold: TaskHoldDraft): void;
  releaseHold(hold: Pick<TaskHoldDraft, "task" | "reason" | "source">): { readonly removed: boolean };
  listHolds(task?: string): readonly TaskHoldDraft[];
}

export interface CommandRunRequest {
  readonly file: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
}

export interface CommandRunResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly errorCode: "ENOENT" | "TIMEOUT" | "ABORTED" | null;
  readonly durationMs: number;
  readonly timedOut: boolean;
}

export interface CommandRunner {
  run(request: CommandRunRequest): Promise<CommandRunResult>;
}

export interface SupervisedCommandRequest {
  readonly file: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
  readonly onOutput?: (chunk: { readonly stream: "stdout" | "stderr"; readonly text: string }) => void;
}

export interface SupervisedCommandResult {
  readonly reason: "exited" | "timeout" | "terminated";
  readonly exitCode: number | null;
  readonly durationMs: number;
  readonly jobId: string;
}

export interface WindowsJobSupervisor {
  runCommand(request: SupervisedCommandRequest): Promise<SupervisedCommandResult>;
}

export interface ProbeLogger {
  write(event: string, fields: Readonly<Record<string, string | number | boolean>>): void;
}

export const silentProbeLogger: ProbeLogger = {
  write(): void {
    return undefined;
  },
};

export interface ProbeRecheck {
  checkAgain(stepId: string): Promise<ProbeResult>;
}

export interface DnsResolver {
  resolveTxt(hostname: string): Promise<readonly string[]>;
  resolveCname(hostname: string): Promise<readonly string[]>;
}

export interface HttpProbeResponse {
  readonly status: number;
}

export interface HttpProbeRequest {
  readonly url: string;
  readonly method: "GET" | "HEAD";
  readonly headers: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
}

export interface HttpProbe {
  request(input: HttpProbeRequest): Promise<HttpProbeResponse>;
}
