import { scanRedactorSecrets } from "./secrets.js";
import { ResidualSecretError, type SecretFinding } from "./types.js";

/**
 * Local port of Task 011 `PacketSecurityRedactor`.
 * Swap to `@ef-harness/shared-contracts` once that package exports the real class.
 */
export class PacketSecurityRedactor {
  scan(text: string): SecretFinding[] {
    return scanRedactorSecrets(text);
  }

  assertClean(text: string): void {
    if (this.scan(text).length > 0) throw new ResidualSecretError();
  }
}
