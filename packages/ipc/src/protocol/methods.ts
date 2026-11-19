import type { ZodTypeAny } from "zod";
import type { WritePriority } from "./ports.js";
import { rpcParamSchemas, type RpcMethodName } from "./schemas.js";

export interface RpcMethodSpec {
  readonly name: RpcMethodName;
  readonly namespace: string;
  readonly mutating: boolean;
  readonly priority: WritePriority | null;
  readonly schema: ZodTypeAny;
}

const READ = { mutating: false, priority: null } as const;

function method(
  name: RpcMethodName,
  mutating: boolean,
  priority: WritePriority | null,
): RpcMethodSpec {
  const namespace = name.slice(0, name.indexOf("."));
  return {
    name,
    namespace,
    mutating,
    priority,
    schema: rpcParamSchemas[name],
  };
}

export const RPC_METHODS: readonly RpcMethodSpec[] = [
  method("session.hello", false, null),
  method("session.ping", false, null),
  method("project.list", READ.mutating, READ.priority),
  method("project.open", true, "interactive"),
  method("project.close", true, "interactive"),
  method("chat.send", true, "interactive"),
  method("question.answer", true, "interactive"),
  method("batch.accept", true, "knowledge_barrier"),
  method("node.get", false, null),
  method("node.search", false, null),
  method("graph.view", false, null),
  method("impact.preview", false, null),
  method("plan.preview", false, null),
  method("build.start", true, "runtime"),
  method("build.pauseAll", true, "interactive"),
  method("build.stop", true, "interactive"),
  method("task.retry", true, "runtime"),
  method("task.takeOver", true, "runtime"),
  method("inbox.list", false, null),
  method("inbox.resolve", true, "interactive"),
  method("artifact.open", true, "runtime"),
  method("diff.get", false, null),
  method("preview.start", true, "runtime"),
  method("preview.url", false, null),
  method("settings.get", false, null),
  method("settings.set", true, "interactive"),
  method("diag.export", false, null),
  method("events.subscribe", false, null),
  method("snapshot.get", false, null),
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
