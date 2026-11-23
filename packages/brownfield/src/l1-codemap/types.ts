export type SymbolKind =
  | "function"
  | "class"
  | "type"
  | "const"
  | "component"
  | "route"
  | "interface"
  | "route_handler"
  | "sql_table";

export interface ExtractedSymbol {
  readonly name: string;
  readonly kind: SymbolKind;
  readonly line: number;
  readonly endLine?: number;
  readonly signature?: string;
  readonly exported: boolean;
}

export interface ExtractedRef {
  readonly name: string;
  readonly line: number;
  readonly targetPath?: string;
}

export interface FileIndexRecord {
  readonly path: string;
  readonly hash: string;
  readonly size: number;
  readonly mtimeMs: number;
  readonly symbols: readonly ExtractedSymbol[];
  readonly refs: readonly ExtractedRef[];
}

export interface IndexedCommitMeta {
  readonly commitSha: string;
  readonly builtAt: number;
  readonly files: number;
}

export interface FileRankRow {
  readonly path: string;
  readonly score: number;
}

export interface GovernorSignal {
  readonly level: "green" | "orange" | "red";
}

export interface GovernorPort {
  readSignal(): GovernorSignal;
}

export const DEFAULT_GOVERNOR: GovernorPort = {
  readSignal() {
    return { level: "green" };
  },
};