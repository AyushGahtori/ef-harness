import type { RouterStore } from "./database.js";
import { LocalDualFtsSearch } from "./fts.js";
import type { CatalogNodeInput, GraphNodeView } from "./types.js";

/** In-memory view of catalog rows, indexed into the local FTS port. */
export class LocalCandidateCatalog {
  private readonly nodes = new Map<string, GraphNodeView & { readonly nid: number }>();

  constructor(
    private readonly store: RouterStore,
    private readonly fts: LocalDualFtsSearch,
  ) {
    for (const node of store.listCatalog()) {
      this.nodes.set(node.id, node);
      this.fts.upsert(node.nid, node.id, node.title, `${node.text}\n${node.aliases.join(" ")}`);
    }
  }

  upsert(input: CatalogNodeInput): GraphNodeView {
    const existing = this.nodes.get(input.id);
    const nid = existing?.nid ?? this.store.nextCatalogNid();
    const node: GraphNodeView & { readonly nid: number } = {
      nid,
      id: input.id,
      kind: input.kind,
      title: input.title,
      text: input.text,
      status: input.status ?? "active",
      featureId: input.featureId ?? null,
      aliases: input.aliases ?? [],
      working: input.working ?? false,
      ownerRole: input.ownerRole ?? null,
    };
    this.store.upsertCatalog(node);
    this.fts.upsert(nid, node.id, node.title, `${node.text}\n${node.aliases.join(" ")}`);
    this.nodes.set(node.id, node);
    return node;
  }

  getNode(id: string): GraphNodeView | null {
    return this.nodes.get(id) ?? null;
  }

  listActiveNodes(): readonly GraphNodeView[] {
    return [...this.nodes.values()].filter((node) => node.status !== "retired");
  }
}
