import { SecretRedactor } from "@ef-harness/shared-observability";
import { scanRedactorSecrets } from "./secrets.js";
import { ResidualSecretError, type SecretFinding } from "./types.js";

/**
 * Intake scrubber gate over `@ef-harness/shared-observability` `SecretRedactor`.
 * Header, cookie, and OAuth residuals stay in `scanRedactorSecrets` because the
 * shared scanner does not treat those header names as secrets by themselves.
 */
export class PacketSecurityRedactor {
  private readonly secrets = new SecretRedactor();

  scan(text: string): SecretFinding[] {
    const shared = this.secrets.scanForSecrets(text).map((hit) => ({
      label: hit.label,
      ruleId: hit.label,
    }));
    return [...shared, ...scanRedactorSecrets(text)];
  }

  redact(text: string): string {
    return this.secrets.redact(text);
  }

  assertClean(text: string): void {
    if (this.scan(text).length > 0) throw new ResidualSecretError();
  }
}
