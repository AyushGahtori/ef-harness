import { JsonRpcRequestSchema, MUTATING_RPC_METHODS } from "@ef-harness/shared-contracts";
import type { ZodTypeAny } from "zod";
import type { WritePriority } from "./ports.js";

export const RPC_METHOD_NAMES = [
  "session.hello",
  "session.ping",
  "project.list",
  "project.open",
  "project.close",
  "chat.send",
  "question.answer",
  "batch.accept",
  "node.get",
  "node.search",
  "graph.view",
  "impact.preview",
  "plan.preview",
  "build.start",
  "build.pauseAll",
  "build.stop",
  "task.retry",
  "task.takeOver",
  "inbox.list",
  "inbox.resolve",
  "artifact.open",
  "diff.get",
  "preview.start",
  "preview.url",
  "settings.get",
  "settings.set",
  "diag.export",
  "events.subscribe",
  "snapshot.get",
] as const;

export type RpcMethodName = (typeof RPC_METHOD_NAMES)[number];

export interface RpcMethodSpec {
  readonly name: RpcMethodName;
  readonly namespace: string;
  readonly mutating: boolean;
  readonly priority: WritePriority | null;
  readonly schema: ZodTypeAny;
}

const MUTATING = new Set<string>(MUTATING_RPC_METHODS);

function method(name: RpcMethodName, priority: WritePriority | null): RpcMethodSpec {
  const namespace = name.slice(0, name.indexOf("."));
  const mutating = MUTATING.has(name);
  return {
    name,
    namespace,
    mutating,
    priority: mutating ? priority : null,
    schema: JsonRpcRequestSchema,
  };
}

export const RPC_METHODS: readonly RpcMethodSpec[] = [
  method("session.hello", null),
  method("session.ping", null),
  method("project.list", null),
  method("project.open", "interactive"),
  method("project.close", "interactive"),
  method("chat.send", "interactive"),
  method("question.answer", "interactive"),
  method("batch.accept", "knowledge_barrier"),
  method("node.get", null),
  method("node.search", null),
  method("graph.view", null),
  method("impact.preview", null),
  method("plan.preview", null),
  method("build.start", "runtime"),
  method("build.pauseAll", "interactive"),
  method("build.stop", "interactive"),
  method("task.retry", "runtime"),
  method("task.takeOver", "runtime"),
  method("inbox.list", null),
  method("inbox.resolve", "interactive"),
  method("artifact.open", null),
  method("diff.get", null),
  method("preview.start", "runtime"),
  method("preview.url", null),
  method("settings.get", null),
  method("settings.set", "interactive"),
  method("diag.export", "runtime"),
  method("events.subscribe", null),
  method("snapshot.get", null),
];

const BY_NAME = new Map<string, RpcMethodSpec>(RPC_METHODS.map((spec) => [spec.name, spec]));

export function getRpcMethod(name: string): RpcMethodSpec | undefined {
  return BY_NAME.get(name);
}

export function listRpcMethodNames(): readonly string[] {
  return RPC_METHODS.map((spec) => spec.name);
}

export const RPC_NAMESPACES = [
  "project",
  "chat",
  "question",
  "batch",
  "node",
  "graph",
  "impact",
  "plan",
  "build",
  "task",
  "inbox",
  "artifact",
  "diff",
  "preview",
  "settings",
  "diag",
] as const;
