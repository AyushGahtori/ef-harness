import type {
  CodeMapQueryPort,
  ModelAdapterPort,
  ModuleCardStorePort,
  ObservedModuleGraphPort,
  RepoCloudEgressLedgerPort,
} from "./ports.js";
import type {
  CodeIndexSymbol,
  ModuleCardWriterV1Output,
  StoredModuleCard,
} from "./types.js";
import type { ModuleCardCacheKey } from "./types.js";

export class InMemoryModuleCardStore implements ModuleCardStorePort {
  private readonly cards = new Map<string, StoredModuleCard>();

  private keyString(key: ModuleCardCacheKey): string {
    return `${key.filePath}\0${key.fileContentSha256}\0${key.promptVersion}`;
  }

  get(key: ModuleCardCacheKey): StoredModuleCard | null {
    return this.cards.get(this.keyString(key)) ?? null;
  }

  put(card: StoredModuleCard): void {
    this.cards.set(this.keyString(card.key), card);
  }

  deleteForPath(filePath: string): void {
    for (const existing of [...this.cards.keys()]) {
      if (existing.startsWith(`${filePath}\0`)) {
        this.cards.delete(existing);
      }
    }
  }
}

export class InMemoryCodeMap implements CodeMapQueryPort {
  constructor(
    private readonly files: readonly string[],
    private readonly ranks: ReadonlyMap<string, number> = new Map(),
    private readonly symbolsByPath: ReadonlyMap<string, readonly CodeIndexSymbol[]> = new Map(),
    private readonly symbolSearch: ReadonlyMap<string, readonly string[]> = new Map(),
    private readonly hashes: ReadonlyMap<string, string> = new Map(),
    private readonly commitSha = "deadbeef",
  ) {}

  listFiles(commitSha: string): readonly string[] {
    void commitSha;
    return this.files;
  }

  fileRank(_commitSha: string, filePath: string): number | null {
    return this.ranks.get(filePath) ?? null;
  }

  searchSymbols(query: string): readonly { readonly path: string; readonly name: string }[] {
    const q = query.toLowerCase();
    const out: { path: string; name: string }[] = [];
    for (const [name, paths] of this.symbolSearch.entries()) {
      if (name.toLowerCase().includes(q) || q.includes(name.toLowerCase())) {
        for (const path of paths) out.push({ path, name });
      }
    }
    return out;
  }

  symbolsForPath(_commitSha: string, filePath: string): readonly CodeIndexSymbol[] {
    return this.symbolsByPath.get(filePath) ?? [];
  }

  fileHash(_commitSha: string, filePath: string): string | null {
    return this.hashes.get(filePath) ?? null;
  }
}

export class FakeModelAdapter implements ModelAdapterPort {
  readonly outbound: { filePath: string; maskedSource: string }[] = [];
  private readonly responder: (input: { filePath: string; maskedSource: string }) => ModuleCardWriterV1Output;

  constructor(
    responder: (input: { filePath: string; maskedSource: string }) => ModuleCardWriterV1Output,
  ) {
    this.responder = responder;
  }

  async generateModuleCard(input: {
    filePath: string;
    maskedSource: string;
  }): Promise<ModuleCardWriterV1Output> {
    this.outbound.push({ ...input });
    return this.responder(input);
  }
}

export class InMemoryObservedModuleGraph implements ObservedModuleGraphPort {
  readonly nodes: {
    filePath: string;
    fileRank: number | null;
    card: ModuleCardWriterV1Output;
    id: string;
  }[] = [];

  upsertBrownfieldModule(input: {
    filePath: string;
    fileRank: number | null;
    card: ModuleCardWriterV1Output;
  }): string {
    const id = `mod:${input.filePath}`;
    const existing = this.nodes.findIndex((n) => n.id === id);
    const row = { ...input, id };
    if (existing >= 0) this.nodes[existing] = row;
    else this.nodes.push(row);
    return id;
  }
}

export class InMemoryRepoCloudEgressLedger implements RepoCloudEgressLedgerPort {
  private readonly repos = new Set<string>();

  hasSentCodeFromRepo(repoId: string): boolean {
    return this.repos.has(repoId);
  }

  markSentCodeFromRepo(repoId: string): void {
    this.repos.add(repoId);
  }
}