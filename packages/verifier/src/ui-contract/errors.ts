import type { CopyLintCode, CopyLintIssue } from "./types.js";

export class ContractSchemaError extends Error {
  readonly code = "contract_schema" as const;

  constructor(message: string) {
    super(message);
    this.name = "ContractSchemaError";
  }
}

export class CopyCatalogLintError extends Error {
  readonly code: CopyLintCode;

  constructor(
    message: string,
    code: CopyLintCode,
    readonly issues: readonly CopyLintIssue[],
  ) {
    super(message);
    this.name = "CopyCatalogLintError";
    this.code = code;
  }
}

/** Planning-time failure when one screen repeats an accessible name with no region or test id. */
export class DuplicateControlNameError extends CopyCatalogLintError {
  constructor(message: string, issues: readonly CopyLintIssue[]) {
    super(message, "duplicate_accessible_name", issues);
    this.name = "DuplicateControlNameError";
  }
}

export class BrittleLocatorError extends Error {
  readonly code = "brittle_locator" as const;

  constructor(message: string) {
    super(message);
    this.name = "BrittleLocatorError";
  }
}

/**
 * Chromium is not installed. Surfaces `HumanStepRequired('install_playwright_chromium')`
 * instead of an opaque browser stack.
 */
export class HumanStepRequired extends Error {
  readonly code: "install_playwright_chromium";

  constructor(code: "install_playwright_chromium") {
    super(`HumanStepRequired('${code}')`);
    this.name = "HumanStepRequired";
    this.code = code;
  }
}
