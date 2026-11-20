import { UnscriptedModelError } from "./fake-model.js";
import type { ModelCall, SpecialistModel } from "./types.js";

export function consultModel(model: SpecialistModel | null, call: ModelCall): unknown | null {
  if (!model) return null;
  try {
    return model.complete(call);
  } catch (error) {
    if (error instanceof UnscriptedModelError) return null;
    throw error;
  }
}

export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

const LEVEL_RANK: Readonly<Record<string, number>> = {
  Manager: 4,
  Senior: 3,
  Mid: 2,
  Junior: 1,
};

export function selectFamily(
  roster: readonly { family: string; vision: boolean; level: string }[],
  workerFamily: string,
  needVision: boolean,
): { family: string; vision: boolean; degraded: boolean } | null {
  const pool = needVision ? roster.filter((entry) => entry.vision) : roster;
  if (pool.length === 0) return null;
  const ranked = [...pool].sort((a, b) => (LEVEL_RANK[b.level] ?? 0) - (LEVEL_RANK[a.level] ?? 0));
  const independent = ranked.find((entry) => entry.family !== workerFamily);
  const chosen = independent ?? ranked[0];
  if (!chosen) return null;
  return {
    family: chosen.family,
    vision: chosen.vision,
    degraded: chosen.family === workerFamily,
  };
}
