export const PICK_MESSAGE_TYPE = "ef-pick-result" as const;

export const VIEWPORT_WIDTHS = [375, 768, 1440] as const;

export type ViewportWidth = (typeof VIEWPORT_WIDTHS)[number];

export type ThemeName = "light" | "dark";

export type SteerKind = "style" | "copy" | "layout" | "behavior";

export type PickGesture = "hover" | "click" | "gap" | "escape";

export type SourceResolution = "data-ef-source" | "fiber" | "code-index" | "unresolved";

export interface LayoutBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface TokenStyles {
  readonly font: string;
  readonly color: string;
  readonly padding: string;
  readonly gap: string;
  readonly position: string;
}

export interface SourceLocation {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly raw: string;
}

export interface FiberDebugSource {
  readonly fileName: string;
  readonly lineNumber: number;
  readonly columnNumber: number;
}

export interface IntersectingElement {
  readonly source: string | null;
  readonly tag: string;
  readonly name: string;
  readonly box: LayoutBox;
}

export interface PreviewNode {
  readonly tag: string;
  readonly componentName: string | null;
  readonly source: string | null;
  readonly role: string | null;
  readonly name: string | null;
  readonly text: string;
  readonly snippet: string;
  readonly box: LayoutBox;
  readonly styles: TokenStyles;
  readonly children: readonly PreviewNode[];
  readonly shadowChildren: readonly PreviewNode[];
  readonly fiberSource: FiberDebugSource | null;
  readonly portal: boolean;
}

export interface CropArtifact {
  readonly rect: LayoutBox;
  readonly png: Uint8Array;
  readonly casId: string;
  readonly paddingPx: 40;
  readonly scrubbed: true;
  readonly synthetic: true;
}

export interface GroundedContextBundle {
  readonly kind: "element" | "gap";
  readonly elementId: string;
  readonly source: SourceLocation | null;
  readonly resolvedFile: string | null;
  readonly resolution: SourceResolution;
  readonly ancestorStack: readonly SourceLocation[];
  readonly role: string | null;
  readonly name: string | null;
  readonly textExcerpt: string;
  readonly domPath: string;
  readonly domSnippet: string;
  readonly box: LayoutBox;
  readonly styles: TokenStyles;
  readonly viewportWidth: number;
  readonly viewportPreset: ViewportWidth | null;
  readonly route: string;
  readonly theme: ThemeName;
  readonly componentName: string | null;
  readonly crop: CropArtifact;
  readonly bundleCasId: string;
  readonly intersecting: readonly IntersectingElement[];
  readonly gapPx: number | null;
  readonly gapAxis: "vertical" | "horizontal" | null;
  readonly label: string;
  readonly pillSource: string;
  readonly pill: string;
}

export interface ValidatedPick {
  readonly gesture: Exclude<PickGesture, "escape">;
  readonly source: string | null;
  readonly ancestorSources: readonly string[];
  readonly role: string | null;
  readonly name: string | null;
  readonly text: string;
  readonly domPath: string;
  readonly snippet: string;
  readonly box: LayoutBox;
  readonly styles: TokenStyles;
  readonly viewportWidth: number;
  readonly route: string;
  readonly theme: ThemeName;
  readonly componentName: string | null;
  readonly fiberSource: FiberDebugSource | null;
  readonly cropRect: LayoutBox;
  readonly intersecting: readonly IntersectingElement[];
  readonly gapPx: number | null;
  readonly gapAxis: "vertical" | "horizontal" | null;
}

export const VIOLET_OUTLINE = "#7C3AED";

export const TEXT_EXCERPT_LIMIT = 200;

export const SNIPPET_BYTE_LIMIT = 2048;

export const CROP_PADDING_PX = 40;

export const AUTO_START_MAX_TASKS = 2;

export const AUTO_START_MAX_COST_USD = 0.3;

export const ONLY_HERE_VS_EVERYWHERE = "Only here vs Everywhere";

export const SHARED_BUTTON_WARNING =
  "This changes shared Button across 8 screens — Change only here or update shared design system?";

export const SUBMIT_COLOR_QUESTION =
  "Change only the Submit button in OrderForm, or update the primary color token everywhere?";

/** Aliases and test-facing contracts for Point-to-Fix integration barrels. */
export const EF_PICK_RESULT_TYPE = PICK_MESSAGE_TYPE;

export const PICKER_SHORTCUT = "Ctrl+Shift+C" as const;

export type PreviewTheme = ThemeName;

export type PreviewViewportWidth = ViewportWidth;

export type VisualSteerTargetKind = SteerKind;

export type PointToFixMode = "off" | "picking";

export interface ParsedEfSource {
  readonly file: string;
  readonly line: number;
  readonly column: number;
}

export interface ElementPickContext {
  readonly kind: "element";
  readonly efSource: ParsedEfSource | null;
  readonly ancestorSources: readonly ParsedEfSource[];
  readonly role: string | null;
  readonly accessibleName: string;
  readonly textExcerpt: string;
  readonly domPath: string;
  readonly domSnippet: string;
  readonly layoutBox: LayoutBox;
  readonly styles: Readonly<Record<string, string>>;
  readonly viewportWidth: PreviewViewportWidth;
  readonly route: string;
  readonly theme: PreviewTheme;
  readonly cropPngRef: string;
}

export interface GapPickContext {
  readonly kind: "gap";
  readonly regionBox: LayoutBox;
  readonly cropPngRef: string;
  readonly intersectingElements: readonly ElementPickContext[];
  readonly gapPx: number;
  readonly viewportWidth: PreviewViewportWidth;
  readonly route: string;
  readonly theme: PreviewTheme;
}

export type PickContextBundle = ElementPickContext | GapPickContext;

export interface EfPickResultMessage {
  readonly type: typeof EF_PICK_RESULT_TYPE;
  readonly pick: PickContextBundle;
}

export interface ComposerElementTarget {
  readonly targetKey: string;
  readonly label: string;
  readonly thumbnailCropRef: string;
  readonly sourceFile: string | null;
  readonly sourceLine: number | null;
}

export interface HoverOutlineState {
  readonly visible: boolean;
  readonly tag: string;
}

export interface VisualSteerV1Output {
  readonly target: {
    readonly kind: VisualSteerTargetKind;
    readonly node_id: string;
    readonly file: string;
    readonly component: string;
  };
  readonly intent: string;
  readonly needs_question: boolean;
  readonly conflict: string | null;
}

export interface VisualSteerRouteResult {
  readonly accepted: boolean;
  readonly reason?: string;
  readonly steer?: VisualSteerV1Output;
  readonly writeScope: readonly string[];
  readonly scopePrompt?: string;
}

export interface CrossViewportCheckResult {
  readonly pickedViewport: PreviewViewportWidth;
  readonly desktopViewport: PreviewViewportWidth;
  readonly passed: boolean;
  readonly notes: readonly string[];
}

export type BaselineApprovalStatus = "pending" | "approved" | "tweak_again" | "reverted";

export interface BaselineApprovalState {
  readonly baselineKey: string;
  readonly beforeCropRef: string;
  readonly afterCropRef: string;
  readonly viewportWidth: PreviewViewportWidth;
  readonly status: BaselineApprovalStatus;
}
