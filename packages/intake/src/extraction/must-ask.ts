import { isInjectionText, isMustAskProse } from "./text-rules.js";

/**
 * Local port of Task 073 `MustAskPolicyFloor`.
 * Auth and payment questions cannot be switched off by text inside an upload.
 */
export class MustAskPolicyFloor {
  isMustAsk(text: string, criterion: string | null): boolean {
    return isMustAskProse(`${criterion ?? ""} ${text}`);
  }

  rejectsBypass(text: string): boolean {
    return isInjectionText(text);
  }
}
