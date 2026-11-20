export class NameRegistryError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
  }
}

export class DuplicateLogicalNameError extends NameRegistryError {
  readonly kind: string;
  readonly value: string;
  readonly existingOwner: string;
  readonly attemptedOwner: string;

  constructor(
    kind: string,
    value: string,
    existingOwner: string,
    attemptedOwner: string,
    cause?: unknown,
  ) {
    super(
      `Duplicate logical name ${kind} ${value} is owned by ${existingOwner}; ${attemptedOwner} cannot register it.`,
      cause === undefined ? undefined : { cause },
    );
    this.kind = kind;
    this.value = value;
    this.existingOwner = existingOwner;
    this.attemptedOwner = attemptedOwner;
  }
}

export class InvalidNameKindError extends NameRegistryError {
  readonly kind: string;

  constructor(kind: string) {
    super(`Name kind ${JSON.stringify(kind)} is not in NAME_KINDS.`);
    this.kind = kind;
  }
}

export class InvalidNameValueError extends NameRegistryError {
  readonly kind: string;
  readonly value: string;

  constructor(kind: string, value: string) {
    super(`Name ${kind} value ${JSON.stringify(value)} is not a valid logical name.`);
    this.kind = kind;
    this.value = value;
  }
}

export class InvalidPublishInputError extends NameRegistryError {}

export class UnknownNodeError extends NameRegistryError {
  readonly id: string;

  constructor(id: string) {
    super(`Node ${id} does not exist.`);
    this.id = id;
  }
}

export class PrefixOverlapError extends NameRegistryError {
  readonly kind: string;
  readonly prefix: string;
  readonly feature: string;
  readonly existingPrefix: string;
  readonly existingFeature: string;

  constructor(input: {
    kind: string;
    prefix: string;
    feature: string;
    existingPrefix: string;
    existingFeature: string;
  }) {
    super(
      `Prefix ${input.kind} ${input.prefix} for ${input.feature} overlaps ${input.existingPrefix} owned by ${input.existingFeature}.`,
    );
    this.kind = input.kind;
    this.prefix = input.prefix;
    this.feature = input.feature;
    this.existingPrefix = input.existingPrefix;
    this.existingFeature = input.existingFeature;
  }
}

export class ForeignPrefixError extends NameRegistryError {
  readonly kind: string;
  readonly value: string;
  readonly feature: string;
  readonly prefix: string;
  readonly prefixFeature: string;

  constructor(input: {
    kind: string;
    value: string;
    feature: string;
    prefix: string;
    prefixFeature: string;
  }) {
    super(
      `${input.feature} cannot register ${input.kind} ${input.value} inside prefix ${input.prefix} owned by ${input.prefixFeature}.`,
    );
    this.kind = input.kind;
    this.value = input.value;
    this.feature = input.feature;
    this.prefix = input.prefix;
    this.prefixFeature = input.prefixFeature;
  }
}

export class UnallocatedPrefixError extends NameRegistryError {
  readonly kind: string;
  readonly value: string;
  readonly feature: string;

  constructor(kind: string, value: string, feature: string) {
    super(`${feature} has no ${kind} prefix covering ${value}.`);
    this.kind = kind;
    this.value = value;
    this.feature = feature;
  }
}

export interface RouteShadowSide {
  value: string;
  canonical: string;
  feature: string;
  ownerNode: string;
}

export type RouteShadowCode = "equivalent" | "shadow" | "case_or_slash";

export interface RouteShadowConflict {
  code: RouteShadowCode;
  kind: string;
  left: RouteShadowSide;
  right: RouteShadowSide;
  message: string;
}

export class RouteShadowError extends NameRegistryError {
  readonly conflicts: readonly RouteShadowConflict[];

  constructor(conflicts: readonly RouteShadowConflict[]) {
    super(conflicts.map((conflict) => conflict.message).join(" "));
    this.conflicts = conflicts;
  }
}

export interface WildcardOverlapSide {
  value: string;
  feature: string;
  ownerNode: string;
}

export interface WildcardOverlapConflict {
  kind: string;
  left: WildcardOverlapSide;
  right: WildcardOverlapSide;
  message: string;
}

export class WildcardOverlapError extends NameRegistryError {
  readonly conflicts: readonly WildcardOverlapConflict[];

  constructor(conflicts: readonly WildcardOverlapConflict[]) {
    super(conflicts.map((conflict) => conflict.message).join(" "));
    this.conflicts = conflicts;
  }
}

export type CodeNameAccess = "read" | "write" | "define";

export interface CodeNameAuditFailure {
  code: "unregistered" | "foreign_owned";
  kind: string;
  value: string;
  feature: string;
  access: CodeNameAccess;
  message: string;
  ownerNode?: string;
  ownerFeature?: string;
  source?: string;
}

export class CodeNameAuditError extends NameRegistryError {
  readonly failures: readonly CodeNameAuditFailure[];

  constructor(failures: readonly CodeNameAuditFailure[]) {
    super(failures.map((failure) => failure.message).join(" "));
    this.failures = failures;
  }
}

export class RelationsInFieldsError extends NameRegistryError {
  readonly nodeIds: readonly string[];

  constructor(nodeIds: readonly string[]) {
    super(
      `relations_in_fields returned ${String(nodeIds.length)} active node(s): ${nodeIds.join(", ")}. Relations belong in edges.`,
    );
    this.nodeIds = nodeIds;
  }
}

export class InvalidRelationError extends NameRegistryError {
  readonly field: string;

  constructor(field: string, detail: string) {
    super(`Relation ${field} is not a node id or a list of node ids (${detail}).`);
    this.field = field;
  }
}

export class DanglingRelationError extends NameRegistryError {
  readonly src: string;
  readonly field: string;
  readonly dst: string;

  constructor(src: string, field: string, dst: string) {
    super(`${src} ${field} references missing node ${dst}.`);
    this.src = src;
    this.field = field;
    this.dst = dst;
  }
}
