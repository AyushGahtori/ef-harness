import type {
  BrownfieldL0RepoScannerPort,
  CompactCodeMapQueryServicePort,
  DiscoverySessionCoordinatorPort,
  ModuleCardCacheEnginePort,
  RepoFileReaderPort,
  StaleDocsDetectorPort,
  WorkItemPersistencePort,
} from "./contracts.js";
import { AntiRewriteScopeFence } from "./scope-fence.js";
import { ContributorDocIngestion } from "./contributor-doc-ingestion.js";
import { ExistingConventionsExtractor } from "./existing-conventions-extractor.js";
import type { GitLogPort } from "./contracts.js";
import {
  dbKindForDraft,
  MixedRequestWorkItemSplitter,
} from "./mixed-request-work-item-splitter.js";
import { ObservedStackPresettler } from "./observed-stack-presettler.js";
import { TodayVsChangeConfirmationBuilder } from "./today-vs-change-confirmation-builder.js";
import {
  BROWNFIELD_QUICK_PROMPTS,
  type BrownfieldOpeningSummary,
  type BrownfieldQuickPromptId,
  type BrownfieldWorkItemRow,
  type TodayChangeCanvasProjection,
} from "./types.js";

export interface BrownfieldOpeningControllerDeps {
  readonly l0: BrownfieldL0RepoScannerPort;
  readonly codeMap: CompactCodeMapQueryServicePort;
  readonly moduleCards: ModuleCardCacheEnginePort;
  readonly staleDocs: StaleDocsDetectorPort;
  readonly discovery: DiscoverySessionCoordinatorPort;
  readonly workItems: WorkItemPersistencePort;
  readonly files: RepoFileReaderPort;
  readonly git: GitLogPort;
  readonly conventionBrief?: {
    setBrownfieldConventions(markdown: string): void;
  };
}

export interface OpenBrownfieldRepoInput {
  readonly repoRoot: string;
  readonly openingMessage?: string;
  readonly quickPromptId?: BrownfieldQuickPromptId;
  readonly focusPaths?: readonly string[];
}

export interface OpenBrownfieldRepoResult {
  readonly summary: BrownfieldOpeningSummary;
  readonly workItems: readonly BrownfieldWorkItemRow[];
  readonly confirmation: TodayChangeCanvasProjection;
  readonly redundantGreenfieldStackQuestions: 0;
}

export class BrownfieldOpeningController {
  private readonly splitter = new MixedRequestWorkItemSplitter();
  private readonly presettler = new ObservedStackPresettler();
  private readonly scopeFence = new AntiRewriteScopeFence();
  private readonly confirmationBuilder = new TodayVsChangeConfirmationBuilder();
  private readonly contributorIngestion: ContributorDocIngestion;
  private readonly conventions: ExistingConventionsExtractor;

  constructor(private readonly deps: BrownfieldOpeningControllerDeps) {
    this.contributorIngestion = new ContributorDocIngestion(deps.files);
    this.conventions = new ExistingConventionsExtractor({ files: deps.files, git: deps.git });
  }

  listQuickPrompts() {
    return BROWNFIELD_QUICK_PROMPTS;
  }

  open(input: OpenBrownfieldRepoInput): OpenBrownfieldRepoResult {
    const snapshot = this.deps.l0.scanSummary(input.repoRoot);
    const settlements = this.presettler.buildSettlements(snapshot);
    const contributorHints =
      snapshot.contributorDocPaths.length > 0
        ? this.contributorIngestion.ingest({ paths: snapshot.contributorDocPaths })
        : this.contributorIngestion.ingest();

    const focusPaths = input.focusPaths ?? this.inferFocusPaths(input.openingMessage);
    const modules = this.deps.codeMap.listModulesForPaths(focusPaths);
    const allModules = this.deps.codeMap.listModulesForPaths(["src", "packages", "apps"]);

    let split = input.openingMessage
      ? this.splitter.split(input.openingMessage)
      : { drafts: [], combinedPrompt: "" };

    if (input.quickPromptId && split.drafts.length === 0) {
      const prompt = BROWNFIELD_QUICK_PROMPTS.find((p) => p.id === input.quickPromptId);
      if (prompt) {
        split = {
          combinedPrompt: prompt.label,
          drafts: [
            {
              ordinal: 1,
              kind: prompt.defaultWorkKind,
              title: prompt.label,
              userPrompt: input.openingMessage ?? prompt.label,
              recommendedOrder: 1,
            },
          ],
        };
      }
    }

    const createdAtMs = Date.now();
    for (const draft of split.drafts) {
      const id = `wi-${draft.ordinal}-${createdAtMs}`;
      this.deps.workItems.insertWorkItem({
        id,
        dbKind: dbKindForDraft(draft),
        kind: draft.kind,
        title: draft.title,
        status: "discovering",
        createdAtMs: createdAtMs + draft.recommendedOrder,
      });
      this.deps.discovery.preSettleObservedCriteria({
        workItemId: id,
        settlements,
      });
    }

    const scopeFence = this.scopeFence.buildFence({
      focusModuleIds: modules.map((m) => m.id),
      allModules,
    });

    const conventionsCard = this.conventions.extract(snapshot);
    if (conventionsCard.estimatedTokens <= 600) {
      this.deps.conventionBrief?.setBrownfieldConventions(conventionsCard.markdown);
    }
    const confirmation = this.confirmationBuilder.build({
      stackSummary: snapshot.stackSummaryLine,
      focusModules: modules,
      allModules,
      staleDocs: this.deps.staleDocs,
      moduleCards: this.deps.moduleCards,
      contributorHints,
    });

    if (settlements.length > 0 && split.drafts.length === 0) {
      this.deps.discovery.preSettleObservedCriteria({
        workItemId: "project",
        settlements,
      });
    }

    const summary: BrownfieldOpeningSummary = {
      isNonemptyRepo: true,
      skipsGreenfieldStackQuestions: true,
      quickPrompts: BROWNFIELD_QUICK_PROMPTS,
      l0StackSummary: snapshot.stackSummaryLine,
      testCount: snapshot.testFileCount,
      zeroTestSafetyNetRecommended: snapshot.testFileCount === 0,
      observedSettlements: settlements,
      scopeFence,
      conventions: conventionsCard,
      contributorHints,
    };

    return {
      summary,
      workItems: this.deps.workItems.listWorkItems(),
      confirmation,
      redundantGreenfieldStackQuestions: 0,
    };
  }

  private inferFocusPaths(message?: string): readonly string[] {
    if (!message) return ["src"];
    const paths: string[] = [];
    if (/login|auth|redirect/i.test(message)) paths.push("src/auth", "src/app/login");
    if (/order|dashboard|table|query/i.test(message)) paths.push("src/app/dashboard", "src/db");
    if (/export|csv/i.test(message)) paths.push("src/features/export", "src/api");
    if (paths.length === 0) paths.push("src");
    return paths;
  }
}