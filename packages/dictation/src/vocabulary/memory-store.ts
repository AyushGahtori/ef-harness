import { entryKey, type ProjectStateIdCatalog, type VocabularyEntry, type VocabularyStore } from "./types.js";

export class MemoryVocabularyStore implements VocabularyStore {
  private readonly rows = new Map<string, VocabularyEntry>();

  get(projectId: string, term: string): VocabularyEntry | null {
    return this.rows.get(entryKey(projectId, term)) ?? null;
  }

  list(): readonly VocabularyEntry[] {
    return [...this.rows.values()];
  }

  upsert(entry: VocabularyEntry): void {
    this.rows.set(entryKey(entry.project_id, entry.term), entry);
  }

  delete(projectId: string, term: string): void {
    this.rows.delete(entryKey(projectId, term));
  }
}

type CatalogKind = "rule" | "task" | "worker" | "requirement";

/** In-memory `state.db` ID catalog for tests and for running before Task 017 lands. */
export class MemoryProjectStateCatalog implements ProjectStateIdCatalog {
  private readonly rules = new Set<string>();
  private readonly tasks = new Set<string>();
  private readonly workers = new Set<string>();
  private readonly requirements = new Set<string>();

  add(projectId: string, kind: CatalogKind, id: string): void {
    this.bucket(kind).add(this.key(projectId, id));
  }

  hasActiveRule(projectId: string, ruleId: string): boolean {
    return this.rules.has(this.key(projectId, ruleId));
  }

  hasTask(projectId: string, taskId: string): boolean {
    return this.tasks.has(this.key(projectId, taskId));
  }

  hasActiveWorker(projectId: string, workerId: string): boolean {
    return this.workers.has(this.key(projectId, workerId));
  }

  hasRequirement(projectId: string, requirementId: string): boolean {
    return this.requirements.has(this.key(projectId, requirementId));
  }

  private bucket(kind: CatalogKind): Set<string> {
    switch (kind) {
      case "rule":
        return this.rules;
      case "task":
        return this.tasks;
      case "worker":
        return this.workers;
      case "requirement":
        return this.requirements;
    }
  }

  private key(projectId: string, id: string): string {
    return `${projectId}\u0000${id}`;
  }
}

export const emptyProjectStateCatalog: ProjectStateIdCatalog = {
  hasActiveRule: () => false,
  hasTask: () => false,
  hasActiveWorker: () => false,
  hasRequirement: () => false,
};
