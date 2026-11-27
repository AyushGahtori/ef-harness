import { StructuralDocumentChunker } from "./extraction/chunker.js";
import type { ChunkOptions, ChunkResult } from "./extraction/types.js";
import { extractionDocumentFrom, type NormalizedDocument } from "./normalized-document.js";

/** Chunks the unified `NormalizedDocument` produced by `SandboxedDocumentConverter`. */
export class IntakeSemanticChunker {
  private readonly chunker = new StructuralDocumentChunker();

  chunk(document: NormalizedDocument, options?: ChunkOptions): ChunkResult {
    return this.chunker.chunk(extractionDocumentFrom(document), options);
  }

  formatSelection(document: NormalizedDocument, sectionIds: readonly string[]): string {
    return this.chunker.formatSelection(extractionDocumentFrom(document), sectionIds);
  }
}
