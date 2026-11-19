export type CanonicalizationErrorCode =
  | "non_finite_number"
  | "bigint"
  | "circular"
  | "lone_surrogate"
  | "unsupported_type"
  | "nfc_key_collision"
  | "invalid_input";

export class CanonicalizationError extends Error {
  readonly code: CanonicalizationErrorCode;

  constructor(code: CanonicalizationErrorCode, message: string) {
    super(message);
    this.name = "CanonicalizationError";
    this.code = code;
  }
}

export class EntityIdError extends Error {
  readonly code = "invalid_entity_id" as const;

  constructor(message: string) {
    super(message);
    this.name = "EntityIdError";
  }
}
