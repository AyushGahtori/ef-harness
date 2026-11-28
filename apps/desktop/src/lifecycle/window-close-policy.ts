import type { ClosePrompt } from "./types.js";
import { MINIMIZE_TO_TRAY_PREFERENCE_KEY } from "./types.js";
import type { PreferenceStore } from "./ports.js";

export type WindowCloseDecision =
  | { readonly kind: "quit-idle" }
  | { readonly kind: "minimize"; readonly prompted: false }
  | { readonly kind: "prompt"; readonly prompt: ClosePrompt };

const CLOSE_PROMPT: ClosePrompt = {
  title: "Minimize to tray",
  body: "A build is still running. Closing the window keeps it building in the tray.",
  confirmLabel: "Minimize to tray",
  rememberLabel: "Don't ask again",
  cancelLabel: "Stay open",
};

export class WindowClosePolicy {
  constructor(private readonly preferences: PreferenceStore) {}

  decide(input: { readonly buildActive: boolean }): WindowCloseDecision {
    if (!input.buildActive) return { kind: "quit-idle" };
    if (this.preferences.get(MINIMIZE_TO_TRAY_PREFERENCE_KEY) === "1") {
      return { kind: "minimize", prompted: false };
    }
    return { kind: "prompt", prompt: CLOSE_PROMPT };
  }

  confirm(remember: boolean): { readonly kind: "minimize" } {
    if (remember) this.preferences.set(MINIMIZE_TO_TRAY_PREFERENCE_KEY, "1");
    return { kind: "minimize" };
  }

  stayOpen(): { readonly kind: "stay-open" } {
    return { kind: "stay-open" };
  }
}
