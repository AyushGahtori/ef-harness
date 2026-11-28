import { l1Codemap } from "@ef-harness/brownfield";
import type { ProjectStateDb } from "@ef-harness/db";
import { BugIntakePipeline, type SymptomCard as IntakeSymptomCard } from "@ef-harness/intake";
import { SqliteInvestigationStore } from "./investigation-store.js";
import {
  MysteryBugInvestigationPipeline,
  type MysteryBugInvestigationPipelineOptions,
} from "./pipeline.js";
import type { CleanVerifierHarnessPort, SymptomCardStorePort, TestEnvOrchestratorPort, WorktreeSlotPoolPort } from "./ports.js";
import type { CodeMapHit, SymptomCard } from "./types.js";

export function symptomCardFromIntake(card: IntakeSymptomCard): SymptomCard {
  const notes = card.missingReproInfo.join("; ").trim();
  const mapped: SymptomCard = {
    title: card.title,
    observedBehavior: card.observedBehavior,
    expectedBehavior: card.expectedBehavior,
    reproductionSteps: card.reproductionSteps,
    affectedUrlsOrRoutes: card.affectedUrlsOrRoutes,
  };
  if (notes.length === 0) return mapped;
  return { ...mapped, environmentNotes: notes };
}

export class BugIntakeSymptomAdapter implements SymptomCardStorePort {
  constructor(private readonly intake: BugIntakePipeline) {}

  load(cardId: string): SymptomCard | null {
    const card = this.intake.getSymptomCard(cardId);
    if (!card) return null;
    return symptomCardFromIntake(card);
  }
}

export class CompactCodeMapRouteAdapter {
  constructor(private readonly service: l1Codemap.CompactCodeMapQueryService) {}

  queryAroundRoutes(routes: readonly string[], symbols: readonly string[] = []): readonly CodeMapHit[] {
    const hits: CodeMapHit[] = [];
    for (const route of routes) {
      const rendered = this.service.renderPersonalizedMap({ query: route, maxTokens: 400 });
      const symbol = symbols[0] ?? route;
      const path = firstMappedPath(rendered) ?? route;
      hits.push({ path, symbol, route });
    }
    const route = routes[0];
    for (const symbol of symbols) {
      for (const path of this.service.findCallers(symbol)) {
        hits.push(route ? { path, symbol, route } : { path, symbol });
      }
    }
    return hits;
  }
}

export function wireMysteryBugPipeline(input: {
  readonly state: ProjectStateDb;
  readonly intake: BugIntakePipeline;
  readonly codeMap: l1Codemap.CompactCodeMapQueryService;
  readonly worktrees: WorktreeSlotPoolPort;
  readonly testEnv: TestEnvOrchestratorPort;
  readonly verifier: CleanVerifierHarnessPort;
  readonly now?: () => number;
  readonly localization?: MysteryBugInvestigationPipelineOptions["localization"];
}): MysteryBugInvestigationPipeline {
  return new MysteryBugInvestigationPipeline({
    store: new SqliteInvestigationStore({
      state: input.state,
      ...(input.now ? { now: input.now } : {}),
    }),
    symptomCards: new BugIntakeSymptomAdapter(input.intake),
    codeMap: new CompactCodeMapRouteAdapter(input.codeMap),
    worktrees: input.worktrees,
    testEnv: input.testEnv,
    verifier: input.verifier,
    ...(input.now ? { now: input.now } : {}),
    ...(input.localization ? { localization: input.localization } : {}),
  });
}

function firstMappedPath(rendered: string): string | undefined {
  const match = /^([A-Za-z0-9_./-]+\.[A-Za-z0-9]+)/m.exec(rendered);
  return match?.[1];
}
