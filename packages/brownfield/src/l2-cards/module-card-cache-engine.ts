import type { CodeMapQueryPort, ModelAdapterPort, ModuleCardStorePort } from "./ports.js";
import {
  MODULE_CARD_PROMPT_VERSION,
  type ModuleCardWriterV1Output,
  type StoredModuleCard,
} from "./types.js";
import { sha256Hex } from "./hash.js";
import { repairHallucinatedExports } from "./symbol-parity.js";
import { CodeEgressSecretMasker } from "./code-egress-secret-masker.js";

export interface CacheResolveInput {
  readonly commitSha: string;
  readonly filePath: string;
  readonly source: string;
  readonly store: ModuleCardStorePort;
  readonly codeMap: CodeMapQueryPort;
  readonly model: ModelAdapterPort | null;
  readonly masker?: CodeEgressSecretMasker;
}

export interface CacheResolveResult {
  readonly card: ModuleCardWriterV1Output;
  readonly cacheHit: boolean;
  readonly modelCalls: number;
}

export class ModuleCardCacheEngine {
  private readonly masker = new CodeEgressSecretMasker();

  async resolve(input: CacheResolveInput): Promise<CacheResolveResult> {
    const hash = sha256Hex(input.source);
    const key = {
      filePath: input.filePath,
      fileContentSha256: hash,
      promptVersion: MODULE_CARD_PROMPT_VERSION,
    };
    const cached = input.store.get(key);
    if (cached) {
      return { card: cached.card, cacheHit: true, modelCalls: 0 };
    }

    if (!input.model) {
      throw new Error(`No model adapter for uncached module card: ${input.filePath}`);
    }

    const masker = input.masker ?? this.masker;
    const masked = masker.maskFile(input.filePath, input.source);
    const raw = await input.model.generateModuleCard({
      filePath: input.filePath,
      maskedSource: masked.maskedContent,
    });
    const repaired = repairHallucinatedExports(input.commitSha, input.filePath, raw, input.codeMap);
    const stored: StoredModuleCard = {
      key,
      card: repaired,
      createdAtMs: Date.now(),
    };
    input.store.put(stored);
    return { card: repaired, cacheHit: false, modelCalls: 1 };
  }

  invalidateOnEdit(
    filePath: string,
    previousSource: string,
    nextSource: string,
    store: ModuleCardStorePort,
  ): boolean {
    const prev = sha256Hex(previousSource);
    const next = sha256Hex(nextSource);
    if (prev === next) return false;
    store.deleteForPath(filePath);
    return true;
  }
}