import type { ModelFamilyProfile } from "./ports.js";

export type JudgeSelection = "requested" | "auto_cross_family" | "single_family";

export interface JudgeSelectionResult {
  readonly judge: ModelFamilyProfile;
  readonly warnings: readonly string[];
  readonly selection: JudgeSelection;
}

export function selectJudgeProfile(
  generator: ModelFamilyProfile,
  requestedJudge: ModelFamilyProfile,
  connectedFamilies: readonly ModelFamilyProfile[],
): JudgeSelectionResult {
  const families: ModelFamilyProfile[] = [];
  const seen = new Set<string>();
  for (const profile of connectedFamilies) {
    if (seen.has(profile.family)) continue;
    seen.add(profile.family);
    families.push(profile);
  }
  if (families.length < 2) {
    return {
      judge: requestedJudge,
      warnings: ["single_family_judge_warning"],
      selection: "single_family",
    };
  }
  if (requestedJudge.family === generator.family) {
    const alternate = families.find((profile) => profile.family !== generator.family);
    if (!alternate) {
      return {
        judge: requestedJudge,
        warnings: ["single_family_judge_warning"],
        selection: "single_family",
      };
    }
    return { judge: alternate, warnings: [], selection: "auto_cross_family" };
  }
  return { judge: requestedJudge, warnings: [], selection: "requested" };
}
