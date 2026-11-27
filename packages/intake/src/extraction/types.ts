/**
 * Local shapes for intake extraction.
 * Sibling packages are not on this branch. The handoff names the swap.
 */

export type Json =
  | null
  | string
  | number
  | boolean
  | readonly Json[]
  | { readonly [key: string]: Json };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type BlockKind = "heading" | "paragraph" | "table" | "page_break" | "list";

export interface NormalizedBlock {
  readonly id: string;
  readonly kind: BlockKind;
  readonly level: number | null;
  readonly text: string;
  readonly page: number;
  readonly paragraph: number | null;
  readonly line: number;
  readonly section: string | null;
  readonly charStart: number;
  readonly charEnd: number;
}

/** Task 097 document, kept here until that package is on the base. */
export interface NormalizedDocument {
  readonly sourceId: string;
  readonly sourceName: string;
  readonly sourceHash: string;
  readonly mimeType: string;
  readonly pageCount: number;
  readonly text: string;
  readonly blocks: readonly NormalizedBlock[];
  readonly ocrDerived: boolean;
}

export type IntakeLocator =
  | {
      readonly kind: "pdf";
      readonly page: number;
      readonly char_start: number;
      readonly char_end: number;
      readonly paragraph?: number;
      readonly section?: string;
    }
  | {
      readonly kind: "docx";
      readonly paragraph: number;
      readonly char_start: number;
      readonly char_end: number;
    }
  | {
      readonly kind: "text";
      readonly line_start: number;
      readonly line_end: number;
      readonly char_start: number;
      readonly char_end: number;
    }
  | {
      readonly kind: "image";
      readonly x: number;
      readonly y: number;
      readonly w: number;
      readonly h: number;
      readonly ocr_text: string | null;
    }
  | {
      readonly kind: "spec";
      readonly pointer: string;
    };

export type StatementKind = "decision" | "requirement" | "entity" | "rule" | "question";

export interface IntakeStatement {
  readonly text: string;
  readonly locator: IntakeLocator;
  readonly kind: StatementKind;
  readonly criterion_id: string | null;
  readonly value: string | null;
}

export interface SuspiciousInstruction {
  readonly text: string;
  readonly locatorLabel: string;
  readonly reason: string;
  readonly executed: false;
}

export interface IntakeExtractorSuccess {
  readonly statements: readonly IntakeStatement[];
  readonly suspicious_instructions: readonly {
    readonly text: string;
    readonly locator: IntakeLocator;
    readonly reason: string;
  }[];
}

export interface BlockedExit {
  readonly blocked: true;
  readonly reason: string;
  readonly missing_ids?: readonly string[];
}

export type IntakeExtractorV1 = IntakeExtractorSuccess | BlockedExit;

export type QuoteDecisionCode =
  | "accepted"
  | "quote_mismatch"
  | "out_of_bounds"
  | "digit_altered"
  | "negation_dropped"
  | "currency_altered"
  | "locator_mismatch"
  | "injection_not_evidence"
  | "outside_chunk";

export interface QuoteValidationResult {
  readonly accepted: boolean;
  readonly code: QuoteDecisionCode;
  readonly message: string;
  readonly quote: string;
  readonly locatorLabel: string;
}

export interface SentenceSpan {
  readonly text: string;
  readonly charStart: number;
  readonly charEnd: number;
  readonly page: number;
  readonly paragraph: number | null;
  readonly line: number;
  readonly section: string | null;
  readonly headingPath: readonly string[];
  readonly blockId: string;
  readonly blockKind: BlockKind;
  readonly sectionId: string;
  readonly sectionKey: string;
  readonly overlap: boolean;
}

export interface StructuralChunk {
  readonly id: string;
  readonly index: number;
  readonly headingPath: readonly string[];
  readonly headingPaths: readonly (readonly string[])[];
  readonly tokenCount: number;
  readonly overlapTokenCount: number;
  readonly sentences: readonly SentenceSpan[];
  readonly text: string;
  readonly primaryText: string;
  readonly pageStart: number;
  readonly pageEnd: number;
  readonly sectionIds: readonly string[];
}

export interface TocSection {
  readonly id: string;
  readonly heading: string;
  readonly headingPath: readonly string[];
  readonly pageStart: number;
  readonly pageEnd: number;
  readonly pageCount: number;
  readonly tokenCount: number;
}

export interface ChunkPlan {
  readonly requiresSectionSelection: boolean;
  readonly pageCount: number;
  readonly toc: readonly TocSection[];
  readonly message: string;
}

export interface ChunkOptions {
  readonly sectionIds?: readonly string[];
  readonly sectionKeys?: readonly string[];
}

export type ChunkResult =
  | { readonly status: "needs_selection"; readonly plan: ChunkPlan; readonly chunks: readonly [] }
  | { readonly status: "ready"; readonly plan: ChunkPlan; readonly chunks: readonly StructuralChunk[] };

export type CanonicalKind = "decision" | "requirement" | "entity" | "constraint" | "open_question";

export type ClaimBasis = "explicit" | "derived" | "observed";

export interface CanonicalClaim {
  readonly id: string;
  readonly kind: CanonicalKind;
  readonly text: string;
  readonly quote: string;
  readonly locatorLabel: string;
  readonly locatorLabels: readonly string[];
  readonly pages: readonly number[];
  readonly paragraph: number | null;
  readonly section: string | null;
  readonly charStart: number;
  readonly charEnd: number;
  readonly criterionId: string | null;
  readonly value: string | null;
  readonly chunkIds: readonly string[];
  readonly headingPath: readonly string[];
  readonly basis: ClaimBasis;
  readonly ambiguous: boolean;
  readonly costly: boolean;
  readonly mustAsk: boolean;
  readonly commitAllowed: boolean;
  readonly disposition: "active" | "pending_entailment" | "superseded";
}

export interface RejectedClaim {
  readonly quote: string;
  readonly code: QuoteDecisionCode;
  readonly message: string;
  readonly chunkId: string;
}

export interface InternalConflictCard {
  readonly id: string;
  readonly topic: string;
  readonly message: string;
  readonly left: { readonly quote: string; readonly locatorLabel: string; readonly page: number | null };
  readonly right: { readonly quote: string; readonly locatorLabel: string; readonly page: number | null };
  readonly claimIds: readonly string[];
  readonly chunkIds: readonly string[];
}

export interface LiveUtterance {
  readonly turnId: string;
  readonly turnLabel: string;
  readonly text: string;
}

export interface SettledLiveDecision {
  readonly id: string;
  readonly criterion: string;
  readonly value: string;
  readonly quote: string;
  readonly turnId: string;
  readonly turnLabel: string;
  readonly basis: "explicit";
  readonly status: "settled";
}

export interface DocClause {
  readonly id: string;
  readonly text: string;
  readonly quote: string;
  readonly locatorLabel: string;
  readonly page: number | null;
  readonly criterion: string | null;
  readonly value: string | null;
  readonly kind: CanonicalKind;
}

export interface ConflictCard {
  readonly id: string;
  readonly message: string;
  readonly liveQuote: string;
  readonly liveTurnLabel: string;
  readonly docQuote: string;
  readonly docLocatorLabel: string;
  readonly options: readonly ["keep_yours", "adopt_doc"];
  readonly clauseId: string;
  readonly decisionId: string;
}

export interface SupersededClause {
  readonly clauseId: string;
  readonly status: "superseded";
  readonly supersededBy: string;
  readonly quote: string;
  readonly locatorLabel: string;
}

export interface PrecedenceResult {
  readonly settledLive: readonly SettledLiveDecision[];
  readonly archived: readonly SupersededClause[];
  readonly conflicts: readonly ConflictCard[];
  readonly survivingClauses: readonly DocClause[];
  readonly tasks: readonly DocClause[];
  readonly subscriptionTaskCount: number;
}

export interface ImportedField {
  readonly name: string;
  readonly type: string;
  readonly required: boolean;
  readonly enumValues: readonly string[];
  readonly nullable: boolean;
  readonly ref: string | null;
  readonly circular: boolean;
}

export interface ImportedEntity {
  readonly role: "entity";
  readonly name: string;
  readonly basis: "observed";
  readonly fields: readonly ImportedField[];
  readonly enumValues: readonly string[];
  readonly pointer: string;
  readonly draft: string | null;
  readonly sourceName: string;
}

export interface ImportedContract {
  readonly role: "contract";
  readonly name: string;
  readonly basis: "observed";
  readonly method: string;
  readonly path: string;
  readonly statusCodes: readonly string[];
  readonly parameters: readonly ImportedField[];
  readonly requestFields: readonly ImportedField[];
  readonly responseType: string | null;
  readonly pointer: string;
  readonly sourceName: string;
}

export type SchemaFormat = "openapi" | "json-schema" | "sql" | "prisma" | "graphql";

export interface SchemaImportError {
  readonly filename: string;
  readonly line: number | null;
  readonly message: string;
}

export interface SchemaImportResult {
  readonly ok: boolean;
  readonly filename: string;
  readonly format: SchemaFormat | null;
  readonly entities: readonly ImportedEntity[];
  readonly contracts: readonly ImportedContract[];
  readonly errors: readonly SchemaImportError[];
  readonly llmTokens: 0;
  readonly modelCalls: 0;
}

export interface RevisionDelta {
  readonly sectionKey: string;
  readonly headingPath: readonly string[];
  readonly change: "added" | "modified" | "removed";
  readonly previousText: string | null;
  readonly nextText: string | null;
  readonly locatorLabel: string;
}

export interface HybridRevisionFeed {
  readonly target: "task-087";
  readonly contract: "hybrid-revision";
  readonly previousSourceName: string;
  readonly sourceName: string;
  readonly deltas: readonly RevisionDelta[];
}

export interface BatchEntry {
  readonly sourceName: string;
  readonly kind: "prose" | "openapi" | "json-schema" | "sql" | "prisma" | "graphql" | "brand" | "wireframe" | "notes";
  readonly endpointCount: number;
  readonly requirementCount: number;
  readonly conflictCount: number;
  readonly exact: boolean;
  readonly risky: boolean;
}

export interface AcceptanceCard {
  readonly summary: string;
  readonly documents: readonly BatchEntry[];
  readonly reviewBeforeCommit: true;
  readonly riskyItemCount: number;
}

export interface EntailmentPacket {
  readonly criterion: string;
  readonly proposedValue: string;
  readonly citedExcerptsWithSurroundingParagraph: readonly {
    readonly quote: string;
    readonly surroundingParagraph: string;
  }[];
  readonly rule: string | null;
  readonly premises: readonly string[];
}

export type EntailmentVerdict = "establishes" | "contradicts" | "leaves_open";

export interface EntailmentOutcome {
  readonly outcome: "settled" | "pending_verification" | "conflict" | "rejected";
  readonly verdict: EntailmentVerdict | null;
  readonly basis: ClaimBasis | null;
  readonly credit: boolean;
  readonly reason: string;
  readonly modelInvoked: boolean;
}

export const EXCLUDED_BY_LIVE_INSTRUCTION = "Excluded by your live instruction";

export function overriddenByTurn(turnLabel: string): string {
  return `Overridden by your note on ${turnLabel}`;
}

export const EM_DASH = "\u2014";
