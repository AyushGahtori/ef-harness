export { RedTeamSecuritySuiteRunner, runRedTeamSuite } from "./runner.js";
export { VaultCanaryLeakDetector } from "./vault-canary-leak-detector.js";
export { runRedTeamGate, promotionVetoed } from "./gate.js";
export {
  formatScorecardJson,
  formatScorecardMarkdown,
  RED_TEAM_TIME_BUDGET_MS,
} from "./scorecard.js";
export { withLabSession, LabSession } from "./lab-session.js";
export { TrapServer } from "./trap-server.js";
export { createVaultCanaries } from "./tokens.js";
export type {
  AttackId,
  AttackResult,
  DefenseLayerResult,
  ProbeId,
  ProbeResult,
  RedTeamGateDecision,
  RedTeamRunOptions,
  SecurityScorecard,
  CanaryToken,
  LeakHit,
  LeakReport,
} from "./types.js";
export { ATTACK_IDS, PROBE_IDS } from "./types.js";