import type { ModuleCardStorePort } from "./ports.js";
import {
  MODULE_CARD_PROMPT_VERSION,
  PRE_SPEND_TOKEN_THRESHOLD,
  PRE_SPEND_USD_THRESHOLD,
  type PreSpendBreakdown,
  type PreSpendSummaryText,
} from "./types.js";
import { estimateTokens, microUsdForInputTokens, planWindowPercentFromMicroUsd } from "./tokens.js";
import { sha256Hex } from "./hash.js";

export interface PreSpendEstimatorInput {
  readonly repoId: string;
  readonly selectedFiles: readonly string[];
  readonly readFile: (path: string) => string;
  readonly store: ModuleCardStorePort;
  readonly firstCloudEgress?: boolean;
}

export class L2PreSpendEstimator {
  estimate(input: PreSpendEstimatorInput): PreSpendSummaryText {
    const uncachedFiles: string[] = [];
    const cachedFiles: string[] = [];
    let uncachedInputTokens = 0;

    for (const filePath of input.selectedFiles) {
      const content = input.readFile(filePath);
      const hash = sha256Hex(content);
      const hit = input.store.get({
        filePath,
        fileContentSha256: hash,
        promptVersion: MODULE_CARD_PROMPT_VERSION,
      });
      if (hit) {
        cachedFiles.push(filePath);
      } else {
        uncachedFiles.push(filePath);
        uncachedInputTokens += estimateTokens(content);
      }
    }

    const estimatedMicroUsd = microUsdForInputTokens(uncachedInputTokens);
    const planWindowPercent = planWindowPercentFromMicroUsd(estimatedMicroUsd);
    const reasons: string[] = [];
    if (uncachedInputTokens > PRE_SPEND_TOKEN_THRESHOLD) {
      reasons.push("token_threshold");
    }
    if (estimatedMicroUsd > PRE_SPEND_USD_THRESHOLD * 1_000_000) {
      reasons.push("cost_threshold");
    }
    if (input.firstCloudEgress) {
      reasons.push("first_repo_cloud_egress");
    }

    const requiresConfirmation = reasons.length > 0;
    const breakdown: PreSpendBreakdown = {
      uncachedFiles,
      cachedFiles,
      uncachedInputTokens,
      estimatedMicroUsd,
      planWindowPercent,
      requiresConfirmation,
      reasons,
    };

    const estUsd = (estimatedMicroUsd / 1_000_000).toFixed(2);
    const headline =
      `Reading ${uncachedFiles.length} uncached files (~${uncachedInputTokens.toLocaleString()} tokens, est. ~$${estUsd} / ${planWindowPercent}% window)` +
      (cachedFiles.length > 0
        ? ` — ${cachedFiles.length} other relevant files already cached`
        : "");

    return { headline, breakdown };
  }
}