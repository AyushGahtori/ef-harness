export const packageName = "@ef-harness/ship-deploy" as const;
export const layer = 4 as const;

export function packageIdentity(): {
  readonly name: typeof packageName;
  readonly layer: typeof layer;
} {
  return { name: packageName, layer };
}

export * as effects from "./effects/index.js";
export * as github from "./github/index.js";
export * as ciLoop from "./ci-loop/index.js";
export * as deployAdapters from "./deploy-adapters/index.js";
export * as liveMigrations from "./live-migrations/index.js";
export * as postDeploy from "./post-deploy/index.js";

export const shipDeployModules = [
  "effects",
  "github",
  "ci-loop",
  "deploy-adapters",
  "live-migrations",
  "post-deploy",
] as const;

export {
  adaptLedgerForCi,
  bindShipDeploy,
  createGitSafetyScannerPort,
  createMinGitRepoInspector,
  landingParagraph,
  type ShipDeployBindings,
} from "./wire.js";
export { deployCanonicalPayloadHash } from "./deploy-adapters/payload-hash.js";
export { bindMigrationState, PayloadHashMismatchError } from "./live-migrations/state-store.js";
export { createPostDeployCleanVerifier } from "./post-deploy/clean-verifier.js";
export { openShipStateFile } from "./state-file.js";
