import type { CatalogIndex } from "./catalog.js";
import { explicitFields } from "./decision-fields.js";
import type { DecisionStore } from "./decision-store.js";
import { BasisHonestyError, RecommendationError } from "./errors.js";
import type { PremiseSupersessionReopener } from "./premise-reopener.js";
import { optionLabel } from "./recommendations.js";
import type { AutomaticBasis, DepthDecision, LedgerEntry, LedgerView, OverrideResult, RiskTier } from "./types.js";
import { AUTOMATIC_BASES } from "./types.js";

const IMPACT_RANK: Readonly<Record<RiskTier, number>> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/**
 * Every delegated or defaulted decision. Nothing in this set is left only in chat scrollback.
 * Plan Preview reads `forPlanPreview` before Start Build. Change and Override route into
 * the Task 087 revision flow; Override here records the explicit supersession.
 */
export class ChosenForYouLedger {
  constructor(
    private readonly store: DecisionStore,
    private readonly catalog: CatalogIndex,
  ) {}

  view(): LedgerView {
    const entries = this.store
      .list()
      .filter(
        (decision) =>
          decision.status === "settled" &&
          (decision.basis === "delegated" || decision.basis === "defaulted"),
      )
      .map((decision) => this.toEntry(decision))
      .sort(compareEntries);
    const groups = AUTOMATIC_BASES.map((basis) => ({
      basis,
      entries: entries.filter((entry) => entry.basis === basis),
    })).filter((group) => group.entries.length > 0);
    return { groups, entries, planPreviewEntries: entries };
  }

  forPlanPreview(): readonly LedgerEntry[] {
    return this.view().planPreviewEntries;
  }

  private toEntry(decision: DepthDecision): LedgerEntry {
    if (decision.basis !== "delegated" && decision.basis !== "defaulted") {
      throw new BasisHonestyError(`${decision.criterionId} is not a Chosen for you basis`);
    }
    const entry = this.catalog.get(decision.criterionId);
    const optionId = decision.value ?? "";
    return {
      criterionId: decision.criterionId,
      criterionLabel: decision.label,
      chosenValue: optionLabel(entry, optionId),
      optionId,
      basis: decision.basis,
      rationale: decision.rationale ?? "",
      impactLevel: decision.impactLevel,
      downstreamTaskCount: decision.downstreamTaskCount,
      decisionId: decision.nodeId,
      change: toRoute("Change", decision.nodeId, decision.criterionId),
      override: toRoute("Override", decision.nodeId, decision.criterionId),
      planPreview: {
        surface: "plan-preview",
        task: "Task-108",
        visibleBeforeStartBuild: true,
      },
    };
  }

  override(criterionId: string, optionId: string, reopener: PremiseSupersessionReopener): OverrideResult {
    return this.store.run("chat", `override ${criterionId}`, () => {
      const current = this.store.require(criterionId);
      if (current.basis !== "delegated" && current.basis !== "defaulted") {
        throw new BasisHonestyError(`${criterionId} is not in Chosen for you`);
      }
      const entry = this.catalog.get(criterionId);
      if (!entry.options.some((option) => option.id === optionId)) {
        throw new RecommendationError(`${criterionId} has no option ${optionId}`);
      }
      const previousValue = current.value ?? "";
      const saved = this.store.save(
        explicitFields({
          current,
          optionId,
          rationale: "Overridden from Chosen for you.",
          supersession: {
            previousBasis: current.basis,
            previousValue,
            previousVersion: current.version,
          },
        }),
      );
      const reopenedDependents = reopener.reopenDependents(saved.nodeId);
      return {
        criterionId,
        decisionId: saved.nodeId,
        basis: "explicit",
        value: optionId,
        reopenedDependents,
      };
    });
  }
}

function compareEntries(left: LedgerEntry, right: LedgerEntry): number {
  const basisOrder = rankBasis(left.basis) - rankBasis(right.basis);
  if (basisOrder !== 0) return basisOrder;
  const impactOrder = IMPACT_RANK[left.impactLevel] - IMPACT_RANK[right.impactLevel];
  if (impactOrder !== 0) return impactOrder;
  return left.criterionLabel.localeCompare(right.criterionLabel);
}

function rankBasis(basis: AutomaticBasis): number {
  return basis === "delegated" ? 0 : 1;
}

function toRoute(label: "Change" | "Override", decisionId: string, criterionId: string): LedgerEntry["change"] {
  return { label, route: "revision", task: "Task-087", decisionId, criterionId };
}
