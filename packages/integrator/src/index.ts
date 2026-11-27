export const packageName = "@ef-harness/integrator" as const;
export const layer = 3 as const;

export function packageIdentity(): {
  readonly name: typeof packageName;
  readonly layer: typeof layer;
} {
  return { name: packageName, layer };
}

export { FeatureIntegratorEngine } from "./feature-integrator/index.js";
export {
  CompletionWaveController,
  FinalAuditStore,
  InMemoryBudgetLedger,
  LandingSummaryGenerator,
  ProjectStateBudgetLedger,
} from "./final-audit/index.js";
export type { CompletionWaveRequest, CompletionWaveResult } from "./final-audit/index.js";
