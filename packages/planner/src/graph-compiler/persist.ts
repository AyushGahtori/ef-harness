import { bindKnowledgeGraph, type ProjectStateDb } from "@ef-harness/db";

import { DeterministicGraphCompiler } from "./compiler.js";
import type { CompilationInput, CompilationResult } from "./types.js";

/**
 * Compiles one wave and writes features, tasks, dependencies, and checks
 * into `ProjectStateDb`. Sealed checks keep an empty body on the node.
 */
export function persistCompiledGraph(state: ProjectStateDb, input: CompilationInput): CompilationResult {
  const result = new DeterministicGraphCompiler().compileFeatureWave(input);
  if (!result.ok) return result;
  const graph = bindKnowledgeGraph(state);
  const nodes = [
    ...input.features.map((feature) => ({
      op: "create" as const,
      id: feature.id,
      kind: "feature",
      title: feature.title,
      text: feature.title,
      status: "active" as const,
      fields: { feature: feature.id },
    })),
    ...input.requirements
      .filter((requirement) => requirement.active)
      .map((requirement) => ({
        op: "create" as const,
        id: requirement.id,
        kind: requirement.kind,
        title: requirement.title,
        text: requirement.title,
        status: "active" as const,
        fields: { feature: requirement.featureId, risk: requirement.risk },
      })),
    ...input.tasks.map((task) => ({
      op: "create" as const,
      id: task.id,
      kind: "task",
      title: task.title,
      text: task.title,
      status: "active" as const,
      fields: { feature: task.featureId, level: task.level, write_scope: task.writeScope },
    })),
    ...input.checks.map((check) => ({
      op: "create" as const,
      id: check.id,
      kind: "check",
      title: check.id,
      text: check.visibility === "sealed" ? "" : check.id,
      status: "active" as const,
      fields: {
        feature: check.featureId,
        visibility: check.visibility === "sealed" ? "held_back" : "visible",
        sealed: check.visibility === "sealed",
      },
    })),
  ].filter((node) => graph.getNode(node.id) === null);
  const known = new Set(nodes.map((node) => node.id));
  for (const feature of input.features) {
    if (graph.getNode(feature.id)) known.add(feature.id);
  }
  for (const task of input.tasks) {
    if (graph.getNode(task.id)) known.add(task.id);
  }
  for (const requirement of input.requirements) {
    if (graph.getNode(requirement.id)) known.add(requirement.id);
  }
  for (const check of input.checks) {
    if (graph.getNode(check.id)) known.add(check.id);
  }
  const edges = [
    ...input.features.flatMap((feature) =>
      feature.dependsOn
        .filter((dependency) => known.has(dependency))
        .map((dependency) => ({ op: "create" as const, src: feature.id, type: "depends_on", dst: dependency })),
    ),
    ...input.tasks.flatMap((task) => [
      ...task.dependsOn
        .filter((dependency) => known.has(dependency))
        .map((dependency) => ({ op: "create" as const, src: task.id, type: "depends_on", dst: dependency })),
      ...task.implements.map((requirementId) => ({
        op: "create" as const,
        src: task.id,
        type: "implements",
        dst: requirementId,
      })),
    ]),
    ...input.checks.flatMap((check) =>
      check.requirementIds.map((requirementId) => ({
        op: "create" as const,
        src: check.id,
        type: "verifies",
        dst: requirementId,
      })),
    ),
  ].filter((edge, index, all) => known.has(edge.src) && known.has(edge.dst) && all.findIndex((item) => item.src === edge.src && item.type === edge.type && item.dst === edge.dst) === index);
  const committed = graph.commitChangeSet({
    origin: "planner",
    author: "graph-compiler@1",
    summary: `compiled wave ${String(input.planEpoch)}`,
    nodes,
    edges,
  });
  state.writer.transaction(() => {
    for (const feature of input.features) {
      state.writer.run(
        `INSERT INTO feature_runtime(feature, state, epoch, updated_rev)
         VALUES (?, 'PLANNED', 0, ?)
         ON CONFLICT(feature) DO NOTHING`,
        [feature.id, committed.rev],
      );
    }
    for (const task of input.tasks) {
      state.writer.run(
        `INSERT INTO task_runtime(task, feature, state, level, epoch, submission_pending, updated_rev)
         VALUES (?, ?, 'DRAFTED', ?, 0, 0, ?)
         ON CONFLICT(task) DO NOTHING`,
        [task.id, task.featureId, task.level, committed.rev],
      );
    }
  });
  return result;
}
