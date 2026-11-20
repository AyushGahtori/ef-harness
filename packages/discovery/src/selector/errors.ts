/**
 * Logged when a catalog prerequisite cycle blocks every eligible question.
 * The user-facing `warning` stays plain English. Cycle ids stay on fields for diagnostics.
 */
export class CatalogPrereqCycleError extends Error {
  readonly cycle: readonly string[];
  readonly brokenOnId: string;
  readonly warning: string;

  constructor(cycle: readonly string[], brokenOnId: string) {
    const warning = "A catalog prerequisite loop was opened so the next question can be asked.";
    super(warning);
    this.name = "CatalogPrereqCycleError";
    this.cycle = cycle;
    this.brokenOnId = brokenOnId;
    this.warning = warning;
  }
}

export class SelectorInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SelectorInvariantError";
  }
}
