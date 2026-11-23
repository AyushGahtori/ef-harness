export interface ObservedNodeInput {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly text: string;
  readonly fields: Readonly<Record<string, unknown>>;
}

/** Local port of Task 017 `KnowledgeGraphRepo` for observed L0 facts only. */
export interface KnowledgeGraphRepoPort {
  upsertObservedNode(input: ObservedNodeInput): void;
  listObserved(): readonly ObservedNodeInput[];
}

export class InMemoryKnowledgeGraphRepo implements KnowledgeGraphRepoPort {
  private readonly nodes = new Map<string, ObservedNodeInput>();

  upsertObservedNode(input: ObservedNodeInput): void {
    this.nodes.set(input.id, input);
  }

  listObserved(): readonly ObservedNodeInput[] {
    return [...this.nodes.values()];
  }
}

export interface StateMetaStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export class InMemoryStateMetaStore implements StateMetaStore {
  private readonly data = new Map<string, string>();

  get(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  set(key: string, value: string): void {
    this.data.set(key, value);
  }
}