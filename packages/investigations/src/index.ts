export const packageName = "@ef-harness/investigations" as const;
export const layer = 4 as const;

export function packageIdentity(): {
  readonly name: typeof packageName;
  readonly layer: typeof layer;
} {
  return { name: packageName, layer };
}

export * as pipeline from "./pipeline/index.js";
export * as localization from "./localization/index.js";

export {
  MysteryBugInvestigationPipeline,
  SqliteInvestigationStore,
  BugIntakeSymptomAdapter,
  CompactCodeMapRouteAdapter,
  wireMysteryBugPipeline,
} from "./pipeline/index.js";
export {
  FlakeSafeGitBisector,
  DeltaDebuggingInputShrinker,
  SymptomPatchDetector,
} from "./localization/index.js";
