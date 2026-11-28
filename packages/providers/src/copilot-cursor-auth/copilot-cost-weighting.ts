import { NoAllowedCopilotModelError } from "./errors.js";
import type {
  CopilotModelMultiplier,
  CopilotWeightedModelChoice,
  RosterPreset,
  SignedProviderPolicyEnginePort,
  TaskDifficulty,
} from "./types.js";

export class CopilotPlanCostWeighting {
  constructor(private readonly policy: SignedProviderPolicyEnginePort) {}

  select(input: {
    readonly preset: RosterPreset;
    readonly difficulty: TaskDifficulty;
    readonly allowedModels: readonly string[];
  }): CopilotWeightedModelChoice {
    const allowed = new Set(input.allowedModels);
    const models = this.policy.copilotPremiumMultipliers().filter((model) => allowed.has(model.modelId));
    if (models.length === 0) throw new NoAllowedCopilotModelError();
    const routine = input.difficulty === "junior" || input.difficulty === "mid";
    const chosen = pick(models, preferenceFor(input.preset, routine));
    const savesPremiumRequests = chosen.multiplier < 3;
    return {
      modelId: chosen.modelId,
      multiplier: chosen.multiplier,
      kind: chosen.kind,
      preset: input.preset,
      difficulty: input.difficulty,
      routine,
      savesPremiumRequests,
      task106Roster: {
        connectionRoute: "copilot_sdk",
        modelId: chosen.modelId,
        premiumRequestMultiplier: chosen.multiplier,
      },
      task140Weight: {
        multiplier: chosen.multiplier,
        paceAsPremium: chosen.multiplier === 3,
      },
    };
  }
}

function preferenceFor(preset: RosterPreset, routine: boolean): readonly (0 | 1 | 3)[] {
  if (preset === "strongest") return [3, 1, 0];
  if (preset === "cheapest") return routine ? [0, 1] : [1, 0];
  return routine ? [0, 1] : [3, 1, 0];
}

function pick(
  models: readonly CopilotModelMultiplier[],
  preference: readonly (0 | 1 | 3)[],
): CopilotModelMultiplier {
  for (const multiplier of preference) {
    const found = models.find((model) => model.multiplier === multiplier);
    if (found) return found;
  }
  const fallback = models[0];
  if (!fallback) throw new NoAllowedCopilotModelError();
  return fallback;
}
