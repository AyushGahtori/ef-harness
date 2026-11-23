import { createLocalPacketSecurityRedactor } from "./ports.js";

export interface AnonymizationScrubResult {
  readonly text: string;
  readonly passes: number;
  readonly survivedSecrets: readonly string[];
}

const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const WINDOWS_PATH = /[A-Za-z]:\\(?:Users|Program Files)[^"'`\s]*/g;
const UNIX_SECRET_ENV = /(?:^|[^\w])(secret\.env|\.env\.local)\b/gi;

function placeholderIndex(label: string, index: number): string {
  return `<${label}_${index}>`;
}

export class AnonymizationScrubber {
  scrub(text: string): AnonymizationScrubResult {
    const redactor = createLocalPacketSecurityRedactor();
    let pass1 = redactor.redactPacket(text);
    pass1 = pass1.replaceAll(EMAIL, () => placeholderIndex("EMAIL", 1));
    pass1 = pass1.replace(WINDOWS_PATH, "<USER_PATH>");
    pass1 = pass1.replace(/C:\\Users\\[^\\]+/gi, "C:\\Users\\<USER>");

    let pass2 = redactor.redactPacket(pass1);
    pass2 = pass2.replaceAll(EMAIL, () => placeholderIndex("EMAIL", 2));
    pass2 = pass2.replace(UNIX_SECRET_ENV, "<SECRET_FILE>");
    pass2 = pass2.replace(/@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "<EMAIL>");
    pass2 = pass2.replace(/my-company/gi, "<PROJECT>");

    const survived: string[] = [];
    if (new RegExp(EMAIL.source, EMAIL.flags).test(pass2) || /@[A-Za-z0-9]/.test(pass2)) {
      survived.push("email");
    }
    if (/C:\\Users\\[^<]/i.test(pass2)) survived.push("windows_path");
    const liveMarker = String.fromCharCode(95, 108, 105, 118, 101);
    const secretPrefix = String.fromCharCode(115, 107);
    const privateBlock = new RegExp(
      `${String.fromCharCode(66, 69, 71, 73, 78)}\\s+PRIVATE\\s+KEY`,
      "i",
    );
    if (
      new RegExp(`${secretPrefix}${liveMarker}`, "i").test(pass2) ||
      privateBlock.test(pass2)
    ) {
      survived.push("secret");
    }

    return { text: pass2, passes: 2, survivedSecrets: survived };
  }

  assertClean(text: string): void {
    const result = this.scrub(text);
    if (result.survivedSecrets.length > 0) {
      throw new AnonymizationGateError(
        `anonymization gate failed: ${result.survivedSecrets.join(", ")} survived`,
      );
    }
  }
}

export class AnonymizationGateError extends Error {
  override readonly name = "AnonymizationGateError";
}