export interface CorpusDiagnosticDetails {
  readonly filePath?: string | undefined;
  readonly questionId?: string | undefined;
  readonly line?: number | undefined;
  readonly validTags?: readonly string[] | undefined;
}

export class CorpusDiagnosticError extends Error {
  readonly filePath: string;
  readonly questionId: string | null;
  readonly line: number | null;
  readonly validTags: readonly string[] | null;

  constructor(message: string, details: CorpusDiagnosticDetails = {}) {
    super(message);
    this.name = new.target.name;
    this.filePath = details.filePath ?? "";
    this.questionId = details.questionId ?? null;
    this.line = details.line ?? null;
    this.validTags = details.validTags ?? null;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class YamlParseError extends CorpusDiagnosticError {}

export class JsonParseError extends CorpusDiagnosticError {}

export class InsufficientExamplesError extends CorpusDiagnosticError {}

export class UnrecognizedTouchesTagError extends CorpusDiagnosticError {}

export class DuplicateQuestionIdError extends CorpusDiagnosticError {}

export class PrerequisiteCycleError extends CorpusDiagnosticError {}

export class MustAskPolicyFloorError extends CorpusDiagnosticError {}

export class AsymmetricConflictError extends CorpusDiagnosticError {}

export class OrphanCriterionError extends CorpusDiagnosticError {}

export class CorpusShapeError extends CorpusDiagnosticError {}

export class CorpusPinIntegrityError extends CorpusDiagnosticError {}
