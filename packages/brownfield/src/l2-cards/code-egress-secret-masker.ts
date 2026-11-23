import { LEGACY_SECRET_PLACEHOLDER } from "./types.js";
import type { MaskedSourceExcerpt, SecurityMaskNotice } from "./types.js";
import { PacketSecurityRedactor } from "./packet-security-redactor.js";

export class CodeEgressSecretMasker {
  private readonly redactor = new PacketSecurityRedactor();

  maskFile(filePath: string, source: string): MaskedSourceExcerpt {
    const { text, hits } = this.redactor.redact(source);
    const notices: SecurityMaskNotice[] = hits.map((hit) => ({
      filePath,
      line: hit.line,
      message: `Found a possible hardcoded credential in ${filePath}:${hit.line} — masked before sending to model`,
    }));
    const maskedContent = text.includes("[REDACTED_LEGACY_SECRET]")
      ? text
      : text.replaceAll(LEGACY_SECRET_PLACEHOLDER, "[REDACTED_LEGACY_SECRET]");
    return { filePath, maskedContent, notices };
  }

  static containsRawLegacySecret(outbound: string, secret: string): boolean {
    return outbound.includes(secret);
  }
}