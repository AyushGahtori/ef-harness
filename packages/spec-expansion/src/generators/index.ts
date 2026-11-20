export { ScopedRuleCollapser, type CollapsedMatrices, type UniversalRule } from "./collapse.js";
export { evaluateApplicability } from "./applicability.js";
export {
  addAxisNode,
  backendApiGraph,
  headlessCliGraph,
  kitchenManagerRole,
  kitchenMealOrderingGraph,
  renameAxisNode,
  stressGraph,
  withProposedRole,
} from "./fixtures.js";
export { cellIdentityJcs, cellKey, jcs } from "./jcs.js";
export { LocalKnowledgeGraphPort, type KnowledgeNodeRecord } from "./knowledge-graph-port.js";
export { MatrixCellPersistenceRepo, type PersistStats, type PersistedRecord } from "./persistence.js";
export { LocalReadinessCalculator, readyReadiness, type ReadinessCounts, type ReadinessSnapshot } from "./readiness-port.js";
export { MatrixGeneratorRegistry } from "./registry.js";
export { TOUCHES_TAGS, isTouchesTag, type TouchesTag } from "./touches.js";
export {
  M01_ACTIONS,
  M02_OPS,
  M03_PRINT_STATE,
  M03_UI_STATES,
  M04_STATUSES,
  M05_CHECKS,
  M07_FAILURES,
  M08_AXES,
  M09_FILE_LOCK,
  M09_RACES,
  M10_AXES,
  M11_AXES,
  M12_AXES,
  MATRIX_CATALOG,
  MATRIX_IDS,
  SETTLED_BASES,
  endpointStatusAxis,
  entityActionAxis,
  entityEndpointAxis,
  screenStateAxis,
  type ApplicabilityDecision,
  type AxisNode,
  type GenerationRun,
  type MatrixId,
  type RawMatrixCell,
  type SettledProjectGraph,
} from "./types.js";
