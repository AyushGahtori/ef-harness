import {
  LiveKeyPreviewBlockedError,
  TestKeyProductionBlockedError,
} from "./errors.js";
import { diffSecretNameHashes, formatApprovalLines } from "./name-diff.js";
import { looksLikeStripeLiveSecret, looksLikeStripeTestSecret } from "./patterns.js";
import type { VaultNameHashPort } from "./contracts.js";
import type {
  DeployTargetEnv,
  EnvDiffPlan,
  NameOnlyEnvDiff,
  SecretNameHash,
  VaultEnvSecret,
} from "./types.js";

export interface SyncEnvGuardResult {
  readonly allowed: boolean;
  readonly blockers: readonly string[];
}

export class NameOnlySyncEnvController {
  constructor(private readonly vault: VaultNameHashPort) {}

  buildDiff(
    projectId: string,
    envScope: string,
    remote: readonly SecretNameHash[],
  ): NameOnlyEnvDiff {
    const local = this.vault.listSecretNamesAndHashes(projectId, envScope);
    return diffSecretNameHashes(local, remote);
  }

  plan(projectId: string, envScope: string, remote: readonly SecretNameHash[]): EnvDiffPlan {
    const diff = this.buildDiff(projectId, envScope, remote);
    return { diff, approvalLines: formatApprovalLines(diff) };
  }

  async guardSecrets(
    targetEnv: DeployTargetEnv,
    secrets: readonly VaultEnvSecret[],
  ): Promise<SyncEnvGuardResult> {
    const blockers: string[] = [];
    for (const secret of secrets) {
      if (targetEnv === "preview" && looksLikeStripeLiveSecret(secret.value)) {
        blockers.push(`Refused: live credential blocked from preview (${secret.name})`);
        throw new LiveKeyPreviewBlockedError(secret.name);
      }
      if (targetEnv === "production" && looksLikeStripeTestSecret(secret.value)) {
        blockers.push(`Warning: test credential on production (${secret.name})`);
        throw new TestKeyProductionBlockedError(secret.name);
      }
    }
    return { allowed: true, blockers };
  }

  assertNoSecretBytesInLines(lines: readonly string[]): void {
    for (const line of lines) {
      const parts = line.split("=");
      if (parts.length > 1 && parts[1] && parts[1].length > 8 && !/^\(.*\)$/.test(parts[1])) {
        throw new Error("name_only_violation");
      }
    }
  }
}