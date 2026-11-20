/** Text comparison mode from the interaction contract. `normalized` is the default. */
export type MatchMode = "normalized" | "exact" | "contains";

export type LandmarkRole = "heading" | "table" | "navigation" | "main" | "form";

export type ActionRole = "button" | "link" | "textbox" | "combobox";

export type ContractStateName = "empty" | "loading" | "error" | "unauthorized" | "populated";

export type HintFailureType =
  | "wrong_value"
  | "missing_item"
  | "extra_item"
  | "wrong_order"
  | "exception"
  | "timeout";

export type VerificationAttribution = "pass" | "contract_mismatch" | "implementation";

export type VerificationDisposition = "pass" | "plain_message" | "hint_ladder";

export interface TextSpec {
  readonly text: string;
  readonly matchMode: MatchMode;
  readonly copyKey?: string;
}

export interface RegionScope {
  readonly role: string;
  readonly name?: TextSpec;
}

export interface LandmarkSpec {
  readonly role: LandmarkRole;
  readonly name?: TextSpec;
  readonly columns?: readonly TextSpec[];
  readonly within?: RegionScope;
}

export type ActionInteraction = "click" | "fill" | "select";

export interface ActionSpec {
  readonly role: ActionRole;
  readonly name?: TextSpec;
  readonly testid?: string;
  readonly within?: RegionScope;
  readonly interaction?: ActionInteraction;
  readonly value?: string;
}

export interface StateSpec {
  readonly name: ContractStateName;
  readonly text?: TextSpec;
  readonly role?: string;
  readonly accessibleName?: TextSpec;
  /** Identity used only while asserting this state. Defaults to `contract.as.role`. */
  readonly viewAs?: string;
}

export interface UiInteractionContract {
  readonly contract: string;
  readonly route: string;
  readonly as: { readonly role: string };
  readonly landmarks: readonly LandmarkSpec[];
  readonly actions: readonly ActionSpec[];
  readonly states: readonly StateSpec[];
  readonly testids: readonly string[];
}

export interface CopyCatalogEntry {
  readonly key: string;
  readonly text: string;
  readonly screen: string;
  readonly role?: string;
  readonly matchMode: MatchMode;
  readonly within?: RegionScope;
  readonly testid?: string;
}

export interface CopyCatalog {
  readonly entries: readonly CopyCatalogEntry[];
}

export type CopyLintCode =
  | "duplicate_accessible_name"
  | "generic_label"
  | "empty_label"
  | "button_not_named_by_action"
  | "role_name_mismatch";

export interface CopyLintIssue {
  readonly code: CopyLintCode;
  readonly message: string;
  readonly key: string;
  readonly screen: string;
}

export type LocatorMethod = "getByRole" | "getByLabel" | "getByText" | "getByTestId";

export interface GeneratedCheck {
  readonly method: LocatorMethod;
  readonly role?: string;
  readonly name?: string;
  readonly text?: string;
  readonly testid?: string;
  readonly matchMode?: MatchMode;
  readonly within?: RegionScope;
}

export interface HiddenUiExpectation {
  readonly rows?: readonly string[];
  readonly ariaSnapshot?: string;
  readonly matchMode?: MatchMode;
}

export interface HiddenCheckFailure {
  readonly checkId: string;
  readonly route: string;
  readonly ruleId: string | null;
  readonly failureType: HintFailureType;
  readonly expected: unknown;
  readonly observed: unknown;
}

export interface StoredArtifact {
  readonly label: "playwright-trace" | "playwright-screenshot" | "aria-tree";
  readonly digest: string;
  readonly retention: "diagnostic" | "evidence";
  readonly byteLength: number;
}

export interface UiVerificationResult {
  readonly passed: boolean;
  readonly attribution: VerificationAttribution;
  readonly message: string;
  readonly disposition: VerificationDisposition;
  readonly ladderAdvanced: boolean;
  readonly hiddenCheckFailure: boolean;
  readonly sealedHint: HiddenCheckFailure | null;
  readonly artifacts: readonly StoredArtifact[];
  readonly pageErrors: readonly string[];
  readonly consoleErrors: readonly string[];
  readonly hostAriaTree: string;
  readonly contractRoute: string;
  readonly keyboardActivated: readonly string[];
  readonly traceBytes: Uint8Array;
}

export interface AriaNode {
  readonly role: string;
  readonly name?: string;
  readonly pattern?: string;
  readonly children: readonly AriaNode[];
}

export interface AriaSnapshotComparison {
  readonly ok: boolean;
  readonly actual: string;
}
