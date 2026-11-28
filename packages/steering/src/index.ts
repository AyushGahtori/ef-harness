export const packageName = "@ef-harness/steering" as const;
export const layer = 3 as const;

export function packageIdentity(): {
  readonly name: typeof packageName;
  readonly layer: typeof layer;
} {
  return { name: packageName, layer };
}

export * as router from "./router/index.js";
export * as dispatcher from "./dispatcher/index.js";
export * as holds from "./holds/index.js";
export * as questionArbiter from "./question-arbiter/index.js";
export * as reentry from "./reentry/index.js";
export * as budgetStops from "./budget-stops/index.js";

export type { AllowanceWindowPort } from "./budget-stops/index.js";
export {
  AtomicBudgetReservationLedger,
  BudgetWindDownController,
  StopEventStore,
  WipBranchHandoffExporter,
  createBudgetWindDownController,
} from "./budget-stops/index.js";

export {
  createGitEngineInspector,
  createPlannerViewScanner,
  durableTaskHolds,
  inboxQuestionPort,
  openColdOpenReconciler,
} from "./chain.js";
