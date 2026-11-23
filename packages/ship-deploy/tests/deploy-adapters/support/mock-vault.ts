import { createHash } from "node:crypto";
import type { VaultNameHashPort } from "../../../src/deploy-adapters/contracts.js";
import type { SecretNameHash, VaultEnvSecret } from "../../../src/deploy-adapters/types.js";

export class MockVault implements VaultNameHashPort {
  constructor(private readonly secrets: VaultEnvSecret[]) {}

  listSecretNamesAndHashes(projectId: string, envScope: string): readonly SecretNameHash[] {
    void projectId;
    void envScope;
    return this.secrets.map((item) => ({
      name: item.name,
      hmac: createHash("sha256").update(`${item.name}:${item.value}`).digest("hex"),
    }));
  }

  async listSecretsForDeploy(projectId: string, envScope: string): Promise<readonly VaultEnvSecret[]> {
    void projectId;
    void envScope;
    return this.secrets;
  }
}