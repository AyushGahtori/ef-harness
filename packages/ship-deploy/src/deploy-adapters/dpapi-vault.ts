import { WindowsDpapiSecretsVault } from "@ef-harness/governor";
import type { VaultNameHashPort } from "./contracts.js";
import type { VaultEnvSecret } from "./types.js";

type VaultEnvScope = "test" | "dev" | "staging" | "prod";

function toEnvScope(envScope: string): VaultEnvScope {
  if (envScope === "production" || envScope === "prod") return "prod";
  if (envScope === "preview" || envScope === "test") return "test";
  if (envScope === "dev") return "dev";
  if (envScope === "staging") return "staging";
  return "prod";
}

/** Name-only deploy port over the Task 120 DPAPI vault. Secret values stay off approval cards. */
export function vaultNameHashPort(vault: WindowsDpapiSecretsVault): VaultNameHashPort {
  return {
    listSecretNamesAndHashes(projectId, envScope) {
      return vault.listSecretNamesAndHashes(projectId, toEnvScope(envScope));
    },
    async listSecretsForDeploy(projectId, envScope) {
      const entries = await vault.materializeEnvEntries(projectId, toEnvScope(envScope), true);
      const secrets: VaultEnvSecret[] = [];
      for (const [name, value] of Object.entries(entries)) {
        secrets.push({ secretId: name, name, value, envScope });
      }
      return secrets;
    },
  };
}
