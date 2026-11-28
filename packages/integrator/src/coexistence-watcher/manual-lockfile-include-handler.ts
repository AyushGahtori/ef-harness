import { lockfileBasename } from "./path-utils.js";
import type { CoexistenceEventStorePort, CoexistenceUiPort, LockfileDecision } from "./ports.js";

export interface ManualLockfileIncludeHandlerOptions {
  readonly ui: CoexistenceUiPort;
  readonly events: CoexistenceEventStorePort;
}

/**
 * Surfaces the calm lockfile card when the developer edits dependency manifests.
 * Never mutates the developer checkout or git index.
 */
export class ManualLockfileIncludeHandler {
  private readonly pending = new Set<string>();
  private readonly touched = new Set<string>();
  private cardShown = false;

  constructor(private readonly options: ManualLockfileIncludeHandlerOptions) {}

  noteFileEdit(repoRelative: string): void {
    const base = lockfileBasename(repoRelative);
    if (!base) return;
    this.touched.add(base);
    this.pending.add(repoRelative);
    this.maybeShowCard();
  }

  private maybeShowCard(): void {
    if (this.cardShown) return;
    const hasPackage = this.touched.has("package.json");
    const hasLock =
      this.touched.has("pnpm-lock.yaml") ||
      this.touched.has("package-lock.json") ||
      this.touched.has("yarn.lock");
    if (!hasPackage || !hasLock) return;
    this.cardShown = true;
    this.options.ui.showLockfileIncludeCard({
      files: [...this.pending],
      choices: ["commit_and_include", "keep_separate"],
    });
  }

  recordDecision(decision: LockfileDecision): void {
    this.options.events.append({
      kind: "lockfile_include",
      payload: { choice: decision.choice, files: [...decision.files] },
    });
  }

  reset(): void {
    this.pending.clear();
    this.touched.clear();
    this.cardShown = false;
  }
}