import type { BaselineApprovalState, CrossViewportCheckResult, PreviewViewportWidth } from "./types.js";

export interface VisualBaselineStore {
  putApprovedBaseline(key: string, pngRef: string): void;
  getBaseline(key: string): string | null;
  deleteBaseline(key: string): void;
}

export class BeforeAfterBaselineApprover {
  readonly #store: VisualBaselineStore;
  #state: BaselineApprovalState | null = null;

  constructor(store: VisualBaselineStore) {
    this.#store = store;
  }

  get state(): BaselineApprovalState | null {
    return this.#state;
  }

  present(input: {
    readonly baselineKey: string;
    readonly beforeCropRef: string;
    readonly afterCropRef: string;
    readonly viewportWidth: PreviewViewportWidth;
    readonly crossViewport: CrossViewportCheckResult;
  }): BaselineApprovalState | { blocked: true; reason: string } {
    if (!input.crossViewport.passed) {
      return {
        blocked: true,
        reason: `Cross-viewport check failed: ${input.crossViewport.notes.join("; ")}`,
      };
    }
    this.#state = {
      baselineKey: input.baselineKey,
      beforeCropRef: input.beforeCropRef,
      afterCropRef: input.afterCropRef,
      viewportWidth: input.viewportWidth,
      status: "pending",
    };
    return this.#state;
  }

  approveAndUpdateBaseline(): BaselineApprovalState | null {
    if (!this.#state) return null;
    this.#store.putApprovedBaseline(this.#state.baselineKey, this.#state.afterCropRef);
    this.#state = { ...this.#state, status: "approved" };
    return this.#state;
  }

  tweakAgain(): BaselineApprovalState | null {
    if (!this.#state) return null;
    this.#state = { ...this.#state, status: "tweak_again" };
    return this.#state;
  }

  revertFix(): BaselineApprovalState | null {
    if (!this.#state) return null;
    this.#store.deleteBaseline(this.#state.baselineKey);
    this.#state = { ...this.#state, status: "reverted" };
    return this.#state;
  }
}

export function verifyCrossViewportAfterFix(input: {
  readonly pickedViewport: PreviewViewportWidth;
  readonly desktopOk: boolean;
  readonly mobileOk: boolean;
}): CrossViewportCheckResult {
  const notes: string[] = [];
  let passed = true;
  if (!input.desktopOk) {
    passed = false;
    notes.push("1440px desktop regression");
  }
  if (input.pickedViewport === 375 && !input.mobileOk) {
    passed = false;
    notes.push("375px picked viewport regression");
  }
  if (passed) {
    notes.push("375px and 1440px checks passed with 0 regressions");
  }
  return {
    pickedViewport: input.pickedViewport,
    desktopViewport: 1440,
    passed,
    notes,
  };
}

export class InMemoryVisualBaselineStore implements VisualBaselineStore {
  readonly #map = new Map<string, string>();

  putApprovedBaseline(key: string, pngRef: string): void {
    this.#map.set(key, pngRef);
  }

  getBaseline(key: string): string | null {
    return this.#map.get(key) ?? null;
  }

  deleteBaseline(key: string): void {
    this.#map.delete(key);
  }
}