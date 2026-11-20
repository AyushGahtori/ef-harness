import type { AskValueInterrogationGuard } from "./ask-value-guard.js";
import type { CatalogIndex } from "./catalog.js";
import type { DecisionStore } from "./decision-store.js";
import { StageSwitchError } from "./errors.js";
import type { MustAskPolicyFloor } from "./must-ask-floor.js";
import { resolveStageRecommendation } from "./recommendations.js";
import type { ProjectStage, RecommendationResolution, StageChipModel, StageProfile, StageSwitchResult } from "./types.js";
import { PROJECT_STAGES, STAGE_LABEL, isProjectStage } from "./types.js";
import { stageProfile } from "./weights.js";

/**
 * Persists the project stage and reconciles criteria when the Discover stage chip changes.
 * Explicit decisions are left untouched. Previously defaulted criteria reopen only when the
 * new stage's ask_value crosses the stricter threshold, and open criteria that no longer
 * apply are recorded as prototype-weight defaults.
 */
export class StageDepthController {
  constructor(
    private readonly store: DecisionStore,
    private readonly guard: AskValueInterrogationGuard,
    private readonly catalog: CatalogIndex,
    private readonly floor: MustAskPolicyFloor,
  ) {}

  profile(): StageProfile {
    return stageProfile(this.store.persistedStage());
  }

  chip(): StageChipModel {
    const profile = this.profile();
    return {
      control: "discover-top-bar-stage-chip",
      stage: profile.stage,
      label: profile.label,
      choices: PROJECT_STAGES.map((stage) => ({ stage, label: STAGE_LABEL[stage] })),
      verification: profile.verification,
      askThreshold: profile.askThreshold,
      importanceThreshold: profile.importanceThreshold,
      visibleQuestionCap: profile.visibleQuestionCap,
    };
  }

  recommendationFor(criterionId: string): RecommendationResolution {
    return resolveStageRecommendation(this.catalog.get(criterionId), this.store.persistedStage());
  }

  switchStage(next: ProjectStage): StageSwitchResult {
    if (!isProjectStage(next)) {
      throw new StageSwitchError(`unknown project stage ${String(next)}`);
    }
    const current = this.store.persistedStage();
    if (current === next) {
      return {
        stage: next,
        changed: false,
        banner: null,
        defaulted: [],
        reopened: [],
        heldOpen: [],
        preservedExplicit: [],
      };
    }
    return this.store.run("chat", `switch stage to ${next}`, () => {
      this.store.writeStage(next);
      const reconciled = this.guard.reconcile(next);
      const banner =
        reconciled.reopened.length > 0
          ? `+${reconciled.reopened.length} criteria added for ${STAGE_LABEL[next]} stage`
          : null;
      this.store.appendScope(banner ?? `Stage set to ${STAGE_LABEL[next]}`, this.catalog, this.floor, next);
      return { ...reconciled, changed: true, banner };
    });
  }
}
