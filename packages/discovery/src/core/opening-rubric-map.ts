import { InvalidRubricMapError } from "./errors.js";
import { OPENING_RUBRIC_IDS, type OpeningRubricId } from "./opening-prompts.js";

export const OPENING_RUBRIC_MAP_VERSION = "opening-rubric-map@1" as const;

export type RubricCoverageKind = "full" | "partial" | "acceptance_examples" | "inferred_confirmed";

export interface RubricTarget {
  readonly criterionId: string;
  readonly coverage: RubricCoverageKind;
}

export interface OpeningRubricEntry {
  readonly targets: readonly RubricTarget[];
  readonly recordsDelegations?: boolean;
}

export interface OpeningRubricMap {
  readonly version: typeof OPENING_RUBRIC_MAP_VERSION;
  readonly rubrics: Record<OpeningRubricId, OpeningRubricEntry>;
}

export interface CatalogCriterion {
  readonly id: string;
  readonly active: boolean;
  readonly mustAsk?: boolean;
}

export interface ActiveCatalog {
  readonly criteria: readonly CatalogCriterion[];
}

/**
 * opening-rubric-map@1 from opening-prompts.md.
 * Opening rubric IDs are presentation-only. Targets are catalog criterion IDs.
 */
export const OPENING_RUBRIC_MAP_V1: OpeningRubricMap = {
  version: OPENING_RUBRIC_MAP_VERSION,
  rubrics: {
    "opening.1": {
      targets: [
        { criterionId: "product.purpose", coverage: "full" },
        { criterionId: "delivery.platform", coverage: "full" },
      ],
    },
    "opening.2": {
      targets: [
        { criterionId: "product.audience", coverage: "full" },
        { criterionId: "actors.roles", coverage: "full" },
      ],
    },
    "opening.3": {
      targets: [
        { criterionId: "workflows.primary", coverage: "full" },
        { criterionId: "data.entities", coverage: "partial" },
      ],
    },
    "opening.4": {
      targets: [
        { criterionId: "workflows.primary", coverage: "acceptance_examples" },
        { criterionId: "product.stage", coverage: "inferred_confirmed" },
      ],
    },
    "opening.5": {
      recordsDelegations: true,
      targets: [
        { criterionId: "constraints.stack_preferences", coverage: "full" },
        { criterionId: "deploy.target", coverage: "full" },
        { criterionId: "constraints.deadline_budget", coverage: "full" },
      ],
    },
  },
};

export class OpeningRubricMapper {
  constructor(private readonly map: OpeningRubricMap = OPENING_RUBRIC_MAP_V1) {}

  get version(): typeof OPENING_RUBRIC_MAP_VERSION {
    return this.map.version;
  }

  targetsFor(rubricId: OpeningRubricId): readonly RubricTarget[] {
    return this.map.rubrics[rubricId].targets;
  }

  mappedCriterionIds(): string[] {
    return mappedCriterionIds(this.map);
  }

  validate(catalog: ActiveCatalog): void {
    validateOpeningRubricMap(this.map, catalog);
  }
}

export function mappedCriterionIds(map: OpeningRubricMap = OPENING_RUBRIC_MAP_V1): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const rubricId of OPENING_RUBRIC_IDS) {
    for (const target of map.rubrics[rubricId].targets) {
      if (seen.has(target.criterionId)) continue;
      seen.add(target.criterionId);
      ids.push(target.criterionId);
    }
  }
  return ids;
}

export function defaultOpeningCatalog(): ActiveCatalog {
  const mustAsk = new Set(["product.purpose", "product.audience", "workflows.primary"]);
  return {
    criteria: mappedCriterionIds().map((id) => ({
      id,
      active: true,
      mustAsk: mustAsk.has(id),
    })),
  };
}

export function validateOpeningRubricMap(map: OpeningRubricMap, catalog: ActiveCatalog): void {
  if (map.version !== OPENING_RUBRIC_MAP_VERSION) {
    throw new InvalidRubricMapError([String(map.version)]);
  }
  const active = new Set(catalog.criteria.filter((item) => item.active).map((item) => item.id));
  const missing: string[] = [];
  for (const rubricId of OPENING_RUBRIC_IDS) {
    const entry = map.rubrics[rubricId];
    if (!entry || entry.targets.length === 0) {
      missing.push(rubricId);
      continue;
    }
    for (const target of entry.targets) {
      if (!active.has(target.criterionId)) {
        missing.push(target.criterionId);
      }
    }
  }
  if (missing.length > 0) {
    throw new InvalidRubricMapError([...new Set(missing)]);
  }
}
