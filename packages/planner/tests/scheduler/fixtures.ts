import type { DifficultyTier, ScheduleGraph, ScheduleTask } from "../../src/scheduler/index.js";

export function task(overrides: Partial<ScheduleTask> & Pick<ScheduleTask, "id">): ScheduleTask {
  return {
    featureId: overrides.featureId ?? overrides.id,
    featureSlug: overrides.featureSlug ?? "leaf",
    waveIndex: overrides.waveIndex ?? 1,
    writeScope: overrides.writeScope ?? [`src/${overrides.id}/**`],
    avgExecTimeMs: overrides.avgExecTimeMs ?? 60_000,
    successors: overrides.successors ?? [],
    explicit: overrides.explicit ?? true,
    optionalPolish: overrides.optionalPolish ?? false,
    difficulty: overrides.difficulty ?? "standard",
    riskTags: overrides.riskTags ?? [],
    role: overrides.role ?? null,
    hintStep: overrides.hintStep ?? 0,
    briefVersion: overrides.briefVersion ?? 1,
    baseCommit: overrides.baseCommit ?? "pinned",
    ...overrides,
  };
}

export function link(graph: ScheduleTask[], from: string, to: string, commDelayMs = 0): void {
  const source = graph.find((item) => item.id === from);
  if (!source) throw new Error(`missing ${from}`);
  source.successors.push({ to, commDelayMs });
}

export function kitchenGraph(phase0Count: number, featureCount: number, perFeature: number): ScheduleGraph {
  const tasks: ScheduleTask[] = [];
  const slugs = ["menu", "orders", "payments", "admin", "catering", "inventory"];
  let previous: string | null = null;
  for (let index = 0; index < phase0Count; index += 1) {
    const id = `P0-${index}`;
    tasks.push(
      task({
        id,
        featureId: "foundation",
        featureSlug: "foundation",
        waveIndex: 0,
        writeScope: ["src/foundation/**"],
        avgExecTimeMs: 10 * 60_000,
        successors: [],
      }),
    );
    if (previous) link(tasks, previous, id);
    previous = id;
  }
  for (let feature = 0; feature < featureCount; feature += 1) {
    const slug = slugs[feature] ?? `feature-${feature}`;
    let pred = previous;
    for (let index = 0; index < perFeature; index += 1) {
      const id = `F${feature}-T${index}`;
      tasks.push(
        task({
          id,
          featureId: slug,
          featureSlug: slug,
          waveIndex: 1,
          writeScope: [`src/${slug}/**`],
          avgExecTimeMs: 10 * 60_000,
          successors: [],
        }),
      );
      if (pred) link(tasks, pred, id);
      pred = id;
    }
  }
  return { tasks };
}

export function independent(ids: readonly string[], execMs: number, difficulty: DifficultyTier = "standard"): ScheduleGraph {
  return {
    tasks: ids.map((id) =>
      task({
        id,
        featureId: id,
        featureSlug: id,
        writeScope: [`src/${id}/**`],
        avgExecTimeMs: execMs,
        difficulty,
        successors: [],
      }),
    ),
  };
}
