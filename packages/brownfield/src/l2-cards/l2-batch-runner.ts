import { MAX_L2_CONCURRENCY } from "./types.js";
import type { L2RuntimeContext } from "./ports.js";
import { ModuleCardCacheEngine } from "./module-card-cache-engine.js";
import { L2PreSpendEstimator } from "./pre-spend-estimator.js";
import { RequestDrivenFocusSelector } from "./focus-selector.js";
import type { PreSpendSummaryText } from "./types.js";

export interface L2BatchRunInput {
  readonly request: string;
  readonly readFile: (path: string) => string;
  readonly ctx: L2RuntimeContext;
  readonly confirmed?: boolean;
}

export interface L2BatchRunResult {
  readonly focusPaths: readonly string[];
  readonly preSpend: PreSpendSummaryText;
  readonly skippedCloud: boolean;
  readonly cards: readonly { path: string; cacheHit: boolean }[];
  readonly modelCalls: number;
}

export class L2BrownfieldSummarizer {
  private readonly focus = new RequestDrivenFocusSelector();
  private readonly preSpend = new L2PreSpendEstimator();
  private readonly cache = new ModuleCardCacheEngine();

  async run(input: L2BatchRunInput): Promise<L2BatchRunResult> {
    const selection = this.focus.select(input.request, {
      commitSha: input.ctx.commitSha,
      codeMap: input.ctx.codeMap,
      churnByPath: input.ctx.l0.churnByPath(),
    });
    const preSpend = this.preSpend.estimate({
      repoId: input.ctx.repoId,
      selectedFiles: selection.selected,
      readFile: input.readFile,
      store: input.ctx.store,
      firstCloudEgress: !input.ctx.egressLedger.hasSentCodeFromRepo(input.ctx.repoId),
    });

    if (input.ctx.egress.kind === "l0_l1_only" || input.ctx.egress.userDeclinedCloud) {
      return {
        focusPaths: selection.selected,
        preSpend,
        skippedCloud: true,
        cards: [],
        modelCalls: 0,
      };
    }

    if (preSpend.breakdown.requiresConfirmation && input.confirmed !== true) {
      return {
        focusPaths: selection.selected,
        preSpend,
        skippedCloud: true,
        cards: [],
        modelCalls: 0,
      };
    }

    const uncached = preSpend.breakdown.uncachedFiles;
    const cards: { path: string; cacheHit: boolean }[] = [];
    let modelCalls = 0;
    await mapPool(uncached, MAX_L2_CONCURRENCY, async (filePath) => {
      const source = input.readFile(filePath);
      const resolved = await this.cache.resolve({
        commitSha: input.ctx.commitSha,
        filePath,
        source,
        store: input.ctx.store,
        codeMap: input.ctx.codeMap,
        model: input.ctx.model,
      });
      modelCalls += resolved.modelCalls;
      cards.push({ path: filePath, cacheHit: resolved.cacheHit });
      input.ctx.graph.upsertBrownfieldModule({
        filePath,
        fileRank: input.ctx.codeMap.fileRank(input.ctx.commitSha, filePath),
        card: resolved.card,
      });
    });

    if (input.ctx.egress.kind === "cloud") {
      input.ctx.egressLedger.markSentCodeFromRepo(input.ctx.repoId);
    }

    return {
      focusPaths: selection.selected,
      preSpend,
      skippedCloud: false,
      cards,
      modelCalls,
    };
  }
}

async function mapPool<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const current = items[index]!;
      index += 1;
      await worker(current);
    }
  });
  await Promise.all(runners);
}