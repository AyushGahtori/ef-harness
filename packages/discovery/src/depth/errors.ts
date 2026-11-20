export class DepthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class BasisHonestyError extends DepthError {}

export class UnknownCriterionError extends DepthError {}

export class StaleDecisionError extends DepthError {}

export class StageSwitchError extends DepthError {}

export class RecommendationError extends DepthError {}

export class CatalogError extends DepthError {}

/** Automatic writers refuse `explicit`. User override and direct answers use a separate writer. */
export function assertAutomaticBasis(basis: string): asserts basis is "delegated" | "defaulted" {
  if (basis !== "delegated" && basis !== "defaulted") {
    throw new BasisHonestyError(
      `automatic settlement cannot write basis ${basis}; only delegated or defaulted are allowed`,
    );
  }
}
