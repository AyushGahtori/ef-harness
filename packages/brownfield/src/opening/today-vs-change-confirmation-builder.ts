import type { ModuleCardCacheEnginePort, StaleDocsDetectorPort } from "./contracts.js";
import type { CodeMapModule } from "./contracts.js";
import type {
  BrownfieldConfirmationCard,
  CanvasModuleOverlay,
  TodayChangeCanvasProjection,
} from "./types.js";
import { isHostileContributorDoc } from "./contributor-doc-ingestion.js";
import type { ContributorDocHint } from "./types.js";

export interface ConfirmationBuilderInput {
  readonly stackSummary: string;
  readonly focusModules: readonly CodeMapModule[];
  readonly allModules: readonly CodeMapModule[];
  readonly staleDocs: StaleDocsDetectorPort;
  readonly moduleCards: ModuleCardCacheEnginePort;
  readonly contributorHints: readonly ContributorDocHint[];
  readonly userFocusOverride?: readonly string[];
}

export class TodayVsChangeConfirmationBuilder {
  build(input: ConfirmationBuilderInput): TodayChangeCanvasProjection {
    const stale = input.staleDocs.detectStaleDocs();
    const focusIds = new Set(
      input.userFocusOverride ?? input.focusModules.map((m) => m.id),
    );

    const affectedModules = input.focusModules.map((m) => m.label);
    const untouched = input.allModules
      .filter((m) => !focusIds.has(m.id))
      .map((m) => m.label);

    const staleDocNotes = stale.map((s) => `${s.path}: ${s.reason}`);

    const todayOverlays: CanvasModuleOverlay[] = input.allModules.map((mod) => ({
      id: `today:${mod.id}`,
      label: mod.label,
      layer: "today",
      emphasis: "dimmed_slate",
      paths: mod.paths,
    }));

    const changeOverlays: CanvasModuleOverlay[] = input.focusModules.map((mod) => ({
      id: `change:${mod.id}`,
      label: mod.label,
      layer: "change",
      emphasis: "highlighted_delta",
      paths: mod.paths,
    }));

    const docNotes = isHostileContributorDoc(input.contributorHints)
      ? [
          ...staleDocNotes,
          "Untrusted AGENTS.md hints fenced; security invariants remain authoritative",
        ]
      : staleDocNotes;

    const confirmation: BrownfieldConfirmationCard = {
      headline: "Confirm observed repo reality before planning",
      observedStackSummary: input.stackSummary,
      affectedModules,
      staleDocsIgnored: stale.map((s) => s.path),
      untouchedSubsystems: untouched,
      staleDocNotes: docNotes,
    };

    input.moduleCards.cardsForModuleIds(input.focusModules.map((m) => m.id));

    return {
      confirmation,
      overlays: [...todayOverlays, ...changeOverlays],
    };
  }

  applyFocusOverride(
    projection: TodayChangeCanvasProjection,
    focusModuleIds: readonly string[],
    allModules: readonly CodeMapModule[],
  ): TodayChangeCanvasProjection {
    const focus = allModules.filter((m) => focusModuleIds.includes(m.id));
    const todayOverlays = allModules.map((mod) => ({
      id: `today:${mod.id}`,
      label: mod.label,
      layer: "today" as const,
      emphasis: "dimmed_slate" as const,
      paths: mod.paths,
    }));
    const changeOverlays = focus.map((mod) => ({
      id: `change:${mod.id}`,
      label: mod.label,
      layer: "change" as const,
      emphasis: "highlighted_delta" as const,
      paths: mod.paths,
    }));

    return {
      confirmation: {
        ...projection.confirmation,
        affectedModules: focus.map((m) => m.label),
        untouchedSubsystems: allModules.filter((m) => !focusModuleIds.includes(m.id)).map((m) => m.label),
      },
      overlays: [...todayOverlays, ...changeOverlays],
    };
  }
}