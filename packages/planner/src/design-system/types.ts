/** Local stand-ins for sibling contracts that are not on this branch. */
export const LOCAL_PORTS = {
  uiPlaywrightContractVerifier: "local-port:task-057",
  screenSpecGenerator: "local-port:task-084",
  phase0ExecutionController: "local-port:task-093",
  casBlobStore: "local-port:task-028",
  brandAssetRegistry: "local-port:task-099",
  styleDictionary: "local-port:style-dictionary",
  featureWorkerOwnership: "local-port:task-092",
  additivePrimitiveCcr: "local-port:task-112",
  uiInteractionContractVerifier: "local-port:task-062",
} as const;

export const STYLE_DICTIONARY_SOURCE = LOCAL_PORTS.styleDictionary;

export const TOKEN_PATHS = {
  json: "design/tokens.json",
  css: "src/styles/tokens.css",
  tailwind: "src/styles/tailwind.theme.ts",
  typescript: "src/styles/tokens.ts",
  styleguide: "src/routes/__styleguide.tsx",
  ownership: "design/ownership.json",
  eslint: "eslint/ef-token-rules.mjs",
  stylelint: "stylelint/ef-token-rules.mjs",
} as const;

export const SEMANTIC_COLOR_KEYS = [
  "surface",
  "surface-raised",
  "text-primary",
  "text-muted",
  "border",
  "focus",
  "primary",
  "primary-foreground",
  "primary-text-strong",
  "accent",
  "accent-foreground",
  "accent-text-strong",
  "danger",
  "danger-foreground",
  "warning",
  "warning-foreground",
  "success",
  "success-foreground",
] as const;

export type SemanticColorName = (typeof SEMANTIC_COLOR_KEYS)[number];

export type SemanticPalette = Record<SemanticColorName, string>;

export const TEXT_PAIRS = [
  ["text-primary", "surface"],
  ["text-primary", "surface-raised"],
  ["text-muted", "surface"],
  ["text-muted", "surface-raised"],
  ["primary-foreground", "primary"],
  ["primary-text-strong", "surface"],
  ["primary-text-strong", "surface-raised"],
  ["accent-foreground", "accent"],
  ["accent-text-strong", "surface"],
  ["accent-text-strong", "surface-raised"],
  ["danger-foreground", "danger"],
  ["warning-foreground", "warning"],
  ["success-foreground", "success"],
] as const satisfies readonly (readonly [SemanticColorName, SemanticColorName])[];

export const UI_PAIRS = [
  ["border", "surface"],
  ["border", "surface-raised"],
  ["focus", "surface"],
  ["focus", "surface-raised"],
] as const satisfies readonly (readonly [SemanticColorName, SemanticColorName])[];

export const TEXT_CONTRAST_FLOOR = 4.5;
export const UI_CONTRAST_FLOOR = 3;

export const SPACING_SCALE_PX = [4, 8, 12, 16, 24, 32, 48, 64] as const;
export const TYPE_SCALE = [
  { id: "xs", px: 12 },
  { id: "sm", px: 14 },
  { id: "md", px: 16 },
  { id: "lg", px: 20 },
  { id: "xl", px: 24 },
  { id: "2xl", px: 32 },
] as const;

export const RADIUS_SCALE = [
  { id: "sm", px: 4 },
  { id: "md", px: 8 },
  { id: "lg", px: 12 },
  { id: "full", px: 9999 },
] as const;

export const MOTION_SCALE = [
  { id: "fast", ms: 120 },
  { id: "normal", ms: 200 },
  { id: "slow", ms: 320 },
] as const;

export const PRIMITIVE_STATES = ["default", "hover", "focus", "disabled", "loading", "error"] as const;
export type PrimitiveState = (typeof PRIMITIVE_STATES)[number];

export const MOOD_PRESETS = ["neutral", "editorial", "technical", "soft"] as const;
export type MoodPreset = (typeof MOOD_PRESETS)[number];

export const DENSITIES = ["comfortable", "balanced", "compact"] as const;
export type Density = (typeof DENSITIES)[number];

export const THEME_SUPPORTS = ["light", "dark", "both"] as const;
export type ThemeSupport = (typeof THEME_SUPPORTS)[number];

export const PROJECT_KINDS = ["web", "cli", "api", "headless"] as const;
export type ProjectKind = (typeof PROJECT_KINDS)[number];

export const LAYOUT_TEMPLATES = [
  { id: "app-shell", name: "App shell (nav + header + content)" },
  { id: "page-header", name: "Page header with an actions slot" },
  { id: "list-detail", name: "List / detail" },
  { id: "form-page", name: "Form page" },
  { id: "empty-state", name: "Empty state" },
  { id: "error-state", name: "Error state" },
  { id: "detail-page", name: "Detail page" },
  { id: "auth-page", name: "Auth page" },
  { id: "print-layout", name: "Print layout" },
] as const;

export type LayoutTemplateId = (typeof LAYOUT_TEMPLATES)[number]["id"];

export const SHARED_PRIMITIVES = [
  "AppShell",
  "PageHeader",
  "Button",
  "Card",
  "Input",
  "Table",
  "Dialog",
  "Toast",
  "EmptyState",
  "ErrorState",
  "Form",
  "Nav",
  "Text",
  "Stack",
  "ListPage",
  "DetailPage",
  "FormPage",
  "AuthPage",
  "PrintLayout",
] as const;

export type SharedPrimitive = (typeof SHARED_PRIMITIVES)[number];

export const UI_CONVENTIONS = [
  "Page titles use the page header template.",
  "Primary actions sit in the header actions slot.",
  "Lists use Table, not custom grids.",
] as const;

export const STYLEGUIDE_VIEWPORTS = [
  { name: "mobile", width: 375, height: 667 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
] as const;

export const LOCKED_PATHS = ["design/tokens.json", "src/components/ui/**"] as const;

export const BRAND_ASSET_ROLES = [
  "logo_light",
  "logo_dark",
  "favicon",
  "hero",
  "avatar_fallback",
  "font",
] as const;

export type BrandAssetRole = (typeof BRAND_ASSET_ROLES)[number];

export interface BrandAssetRef {
  readonly assetId: string;
  readonly role: BrandAssetRole;
  readonly dominantColorsHex: readonly string[];
}

export interface InterviewQuestion {
  readonly id: "mood" | "brand" | "density" | "theme";
  readonly prompt: string;
  readonly recommended: string;
}

export interface TypographyPairing {
  readonly heading: string;
  readonly body: string;
  readonly loading: "system";
}

export interface AccessibleColorPairing {
  readonly fill: string;
  readonly foreground: string;
  readonly textStrong: string;
  readonly whiteOnFill: number;
  readonly foregroundOnFill: number;
  readonly textStrongOnSurface: number;
  readonly publishedTextStrong: boolean;
}

export interface BrandRoleDecision {
  readonly input: string;
  readonly light: AccessibleColorPairing;
  readonly dark: AccessibleColorPairing;
}

export interface LookAndFeelDecision {
  readonly visualChoices: 4;
  readonly mood: MoodPreset;
  readonly moodLabel: string;
  readonly density: Density;
  readonly theme: ThemeSupport;
  readonly typography: TypographyPairing;
  readonly componentLibrary: "shadcn/ui";
  readonly gradients: "none";
  readonly radiusControlPx: 4 | 8 | 12;
  readonly pagePaddingPx: 16 | 24 | 32;
  readonly stackGapPx: 8 | 12 | 16;
  readonly brand: {
    readonly source: "preset" | "user" | "brand-asset";
    readonly primary: BrandRoleDecision;
    readonly accent: BrandRoleDecision;
    readonly assetIds: readonly string[];
    readonly suggestions: readonly {
      readonly assetId: string;
      readonly primary: string;
      readonly accent: string;
    }[];
  };
}

export interface LookAndFeelInput {
  readonly mood?: MoodPreset;
  readonly density?: Density;
  readonly theme?: ThemeSupport;
  readonly primary?: string;
  readonly accent?: string;
  readonly brandAssets?: readonly BrandAssetRef[];
  readonly useBrandAssetColors?: boolean;
}

export interface W3cLeaf {
  readonly $type: "color" | "dimension" | "duration" | "fontFamily" | "number" | "shadow";
  readonly $value: string | number | readonly string[];
}

export interface DesignTokenDocument {
  readonly $description: string;
  readonly color: {
    readonly light: Record<SemanticColorName, W3cLeaf>;
    readonly dark: Record<SemanticColorName, W3cLeaf>;
  };
  readonly spacing: Record<string, W3cLeaf>;
  readonly font: {
    readonly family: { readonly heading: W3cLeaf; readonly body: W3cLeaf };
    readonly size: Record<string, W3cLeaf>;
    readonly weight: { readonly regular: W3cLeaf; readonly semibold: W3cLeaf };
  };
  readonly radius: Record<string, W3cLeaf>;
  readonly elevation: {
    readonly light: { readonly raised: W3cLeaf; readonly overlay: W3cLeaf };
    readonly dark: { readonly raised: W3cLeaf; readonly overlay: W3cLeaf };
  };
  readonly motion: Record<string, W3cLeaf>;
  readonly border: { readonly width: W3cLeaf };
  readonly density: { readonly page: W3cLeaf; readonly gap: W3cLeaf };
  readonly palettes: { readonly light: SemanticPalette; readonly dark: SemanticPalette };
}

export interface ContrastPair {
  readonly theme: "light" | "dark";
  readonly kind: "text" | "ui";
  readonly foreground: SemanticColorName;
  readonly background: SemanticColorName;
  readonly ratio: number;
  readonly floor: number;
  readonly ok: boolean;
}

export interface ContrastReport {
  readonly ok: boolean;
  readonly pairs: readonly ContrastPair[];
}

export interface StyleDictionaryBuild {
  readonly source: typeof STYLE_DICTIONARY_SOURCE;
  readonly tokensJson: string;
  readonly css: string;
  readonly tailwind: string;
  readonly typescript: string;
  readonly contrast: ContrastReport;
  readonly tokenHexes: readonly string[];
}

export interface GeneratedFile {
  readonly path: string;
  readonly contents: string;
}

export interface ScreenComponentLike {
  readonly primitive: string;
  readonly style?: unknown;
  readonly className?: unknown;
  readonly color?: unknown;
  readonly css?: unknown;
  readonly sx?: unknown;
  readonly pixels?: unknown;
  readonly children?: readonly ScreenComponentLike[];
}

export interface ScreenSpecLike {
  readonly templateId: string;
  readonly components?: readonly ScreenComponentLike[];
  readonly tags?: readonly string[];
}

export type DesignKit = "shadcn" | "local-ui" | "mui" | "chakra" | "tailwind";

export interface LintViolation {
  readonly rule:
    | "ef/no-raw-color"
    | "ef/no-arbitrary-color"
    | "ef/no-magic-spacing"
    | "ef/no-raw-primitive"
    | "ef/no-dark-inversion";
  readonly line: number;
  readonly message: string;
}

export interface OwnershipDecision {
  readonly ok: boolean;
  readonly path: string;
  readonly message: string;
  readonly ccr?: {
    readonly task: "Task-112";
    readonly slot: "P0";
    readonly kind: "additive-primitive" | "token-change";
    readonly path: string;
  };
}

export interface ScaffoldInput {
  readonly projectRoot: string;
  readonly projectKind: ProjectKind;
  readonly decision?: LookAndFeelDecision;
  readonly tags?: readonly string[];
  readonly screenSpecs?: readonly ScreenSpecLike[];
  readonly confirmAdjustments?: boolean;
}

export class DesignSystemError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(issues.join("\n"));
    this.name = "DesignSystemError";
    this.issues = issues;
  }
}
