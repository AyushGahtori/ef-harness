/** Ensures hidden persona specs never reach harness-visible state. */

export type HarnessLeakTarget = "state.db" | "worktree" | "worker_prompt";

export class PersonaIsolationVault {
  private readonly hiddenSpec: string;
  private leakAttempts: HarnessLeakTarget[] = [];

  constructor(hiddenSpec: string) {
    this.hiddenSpec = hiddenSpec;
  }

  /** Persona model reads hidden spec; harness never does. */
  readForPersonaOnly(): string {
    return this.hiddenSpec;
  }

  assertHarnessRequest(target: HarnessLeakTarget): void {
    this.leakAttempts.push(target);
    throw new HiddenSpecLeakageError(
      `hidden spec access denied for harness target: ${target}`,
    );
  }

  exportVisibleToHarness(): { readonly hasHiddenSpec: false } {
    return { hasHiddenSpec: false };
  }

  leakAttemptsRecorded(): readonly HarnessLeakTarget[] {
    return [...this.leakAttempts];
  }
}

export class HiddenSpecLeakageError extends Error {
  override readonly name = "HiddenSpecLeakageError";
}

export function assertHarnessPromptClean(prompt: string, forbiddenNeedle: string): void {
  if (prompt.includes(forbiddenNeedle)) {
    throw new HiddenSpecLeakageError("hidden spec needle found in harness prompt");
  }
}