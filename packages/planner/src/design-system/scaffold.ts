import fs from "node:fs";
import path from "node:path";
import { isUiProjectKind, normalizeProjectKind } from "@ef-harness/shared-contracts";
import { detectBrownfield } from "./brownfield.js";
import type { BrownfieldReport } from "./brownfield.js";
import { LookAndFeelInterviewFlow } from "./interview.js";
import { DesignTokenLintRuleset } from "./lint.js";
import { adoptedStyleguideSource, layoutSources, styleguideSource, uiSources } from "./sources.js";
import { productionBundle, StyleguideRouteVerifier, themesFor } from "./styleguide.js";
import type { StyleguideVerification } from "./styleguide.js";
import { pairingLines, W3cDesignTokenGenerator } from "./tokens.js";
import {
  LAYOUT_TEMPLATES,
  LOCAL_PORTS,
  LOCKED_PATHS,
  SHARED_PRIMITIVES,
  TOKEN_PATHS,
} from "./types.js";
import type {
  DesignKit,
  GeneratedFile,
  LintViolation,
  LookAndFeelDecision,
  OwnershipDecision,
  ScaffoldInput,
  ScreenComponentLike,
  ScreenSpecLike,
} from "./types.js";

export const PHASE0_P04_SLOT = {
  source: LOCAL_PORTS.phase0ExecutionController,
  slot: "P0.4",
} as const;

export const SCREEN_SPEC_SOURCE = LOCAL_PORTS.screenSpecGenerator;

const BANNED_STYLE_KEYS = ["style", "className", "color", "css", "sx", "pixels"] as const;
function skipsDesignSystem(kind: string): boolean {
  const canonical = normalizeProjectKind(kind);
  if (canonical) return !isUiProjectKind(canonical);
  return kind === "cli" || kind === "api" || kind === "headless";
}

const GREENFIELD_NAMES = [
  "Button",
  "Input",
  "Dialog",
  "Toast",
  "Card",
  "Table",
  "EmptyState",
  "ErrorState",
  "Form",
  "Nav",
  "Text",
  "Stack",
  "PageHeader",
  "AppShell",
  "ListPage",
  "DetailPage",
  "FormPage",
  "AuthPage",
] as const;

export class LockedTokenOwnership {
  readonly source = LOCAL_PORTS.featureWorkerOwnership;
  readonly readOnly = LOCKED_PATHS;

  decide(file: string, actor: "feature-worker" | "phase0" | "ccr"): OwnershipDecision {
    const rel = file.replaceAll("\\", "/");
    const locked = rel === "design/tokens.json" || rel.startsWith("src/components/ui/");
    if (!locked || actor !== "feature-worker") {
      return { ok: true, path: rel, message: "write allowed" };
    }
    return {
      ok: false,
      path: rel,
      message: `${rel} is read-only for feature workers. Add the shared primitive through an explicit P0 request.`,
      ccr: {
        task: "Task-112",
        slot: "P0",
        kind: rel.endsWith("tokens.json") ? "token-change" : "additive-primitive",
        path: rel,
      },
    };
  }
}

export function bindScreenSpec(spec: ScreenSpecLike): { ok: true } | { ok: false; issues: string[] } {
  const issues: string[] = [];
  if (!LAYOUT_TEMPLATES.some((template) => template.id === spec.templateId)) {
    issues.push(`templateId ${spec.templateId} is not a design-system layout template`);
  }
  walkComponents(spec.components ?? [], issues);
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true };
}

export interface ScaffoldPlan {
  readonly slot: typeof PHASE0_P04_SLOT.slot;
  readonly skipped: boolean;
  readonly reason: string;
  readonly ok: boolean;
  readonly issues: readonly string[];
  readonly files: readonly GeneratedFile[];
  readonly written: readonly string[];
  readonly brownfield: BrownfieldReport;
  readonly decision: LookAndFeelDecision | null;
  readonly contrastOk: boolean;
  readonly kit: DesignKit;
  readonly verification: StyleguideVerification | null;
  readonly packageJsonUntouched: boolean;
  readonly lintViolations: readonly LintViolation[];
  readonly preservedExisting: readonly string[];
}

export class DesignSystemScaffoldBuilder {
  async plan(input: ScaffoldInput): Promise<Omit<ScaffoldPlan, "written" | "packageJsonUntouched" | "preservedExisting">> {
    const brownfield = detectBrownfield(input.projectRoot);
    if (skipsDesignSystem(input.projectKind)) {
      return emptyPlan(brownfield, "pure CLI or headless REST API", true);
    }
    const specIssues = (input.screenSpecs ?? []).flatMap((spec) => {
      const bound = bindScreenSpec(spec);
      return bound.ok ? [] : bound.issues;
    });
    if (specIssues.length > 0) {
      return { ...emptyPlan(brownfield, "screen spec rejected", false), issues: specIssues, ok: false };
    }
    const decision =
      input.decision ??
      new LookAndFeelInterviewFlow().capture(
        brownfield.detected && brownfield.extractedHex[0]
          ? {
              primary: brownfield.extractedHex[0],
              ...(brownfield.extractedHex[1] ? { accent: brownfield.extractedHex[1] } : {}),
            }
          : {},
      );
    const generator = new W3cDesignTokenGenerator();
    const document = generator.generate(decision);
    const compiled = generator.compile(document);
    const includePrint = wantsPrint(input);
    const adopted = brownfield.detected;
    const kit = adopted ? brownfield.kit : "shadcn";
    const route = adopted
      ? adoptedStyleguideSource(decision, pairingLines(decision), kit)
      : styleguideSource(decision, pairingLines(decision), includePrint);
    const files: GeneratedFile[] = [
      { path: TOKEN_PATHS.json, contents: compiled.tokensJson },
      { path: TOKEN_PATHS.css, contents: compiled.css },
      { path: TOKEN_PATHS.tailwind, contents: compiled.tailwind },
      { path: TOKEN_PATHS.typescript, contents: compiled.typescript },
      { path: TOKEN_PATHS.ownership, contents: ownershipDocument(kit) },
      { path: TOKEN_PATHS.eslint, contents: new DesignTokenLintRuleset().emit().eslint },
      { path: TOKEN_PATHS.stylelint, contents: new DesignTokenLintRuleset().emit().stylelint },
      { path: TOKEN_PATHS.styleguide, contents: route },
    ];
    if (!adopted) {
      files.push(...uiSources(), ...layoutSources(includePrint));
    }
    const lintViolations = new DesignTokenLintRuleset().lintFiles(files, {
      knownTokenHexes: compiled.tokenHexes,
      kit,
    });
    const requiredNames = adopted
      ? ["Styleguide"]
      : [...GREENFIELD_NAMES, ...(includePrint ? ["PrintLayout"] : [])];
    const verification = await new StyleguideRouteVerifier().verify({
      routeSource: route,
      css: compiled.css,
      productionBundle: productionBundle(files),
      themes: themesFor(decision.theme),
      requiredNames,
      surfaceHex: {
        light: document.palettes.light.surface,
        dark: document.palettes.dark.surface,
      },
    });
    const issues = [
      ...specIssues,
      ...(compiled.contrast.ok ? [] : ["semantic token contrast failed WCAG AA"]),
      ...lintViolations.map((violation) => violation.message),
      ...verification.issues,
    ];
    return {
      slot: "P0.4",
      skipped: false,
      reason: adopted ? "adopted existing design system" : "greenfield design system",
      ok: issues.length === 0,
      issues,
      files,
      brownfield,
      decision,
      contrastOk: compiled.contrast.ok,
      kit,
      verification,
      lintViolations,
    };
  }

  async build(input: ScaffoldInput): Promise<ScaffoldPlan> {
    const before = readPackage(input.projectRoot);
    const planned = await this.plan(input);
    const written: string[] = [];
    const preservedExisting: string[] = [];
    if (planned.ok && !planned.skipped) {
      for (const file of planned.files) {
        if (file.path === "package.json" || file.path.endsWith("/package.json")) continue;
        if (planned.brownfield.detected && exists(input.projectRoot, file.path)) {
          preservedExisting.push(file.path);
          continue;
        }
        writeRel(input.projectRoot, file.path, file.contents);
        written.push(file.path);
      }
    }
    const after = readPackage(input.projectRoot);
    const packageJsonUntouched = sameBytes(before, after);
    return { ...planned, written, preservedExisting, packageJsonUntouched };
  }
}

export function runPhase0DesignSystem(input: ScaffoldInput): Promise<ScaffoldPlan> {
  return new DesignSystemScaffoldBuilder().build(input);
}

function emptyPlan(brownfield: BrownfieldReport, reason: string, skipped: boolean): Omit<
  ScaffoldPlan,
  "written" | "packageJsonUntouched" | "preservedExisting"
> {
  return {
    slot: "P0.4",
    skipped,
    reason,
    ok: skipped,
    issues: [],
    files: [],
    brownfield,
    decision: null,
    contrastOk: true,
    kit: brownfield.kit,
    verification: null,
    lintViolations: [],
  };
}

function wantsPrint(input: ScaffoldInput): boolean {
  if ((input.tags ?? []).includes("print")) return true;
  return (input.screenSpecs ?? []).some(
    (spec) => spec.templateId === "print-layout" || (spec.tags ?? []).includes("print"),
  );
}

function walkComponents(components: readonly ScreenComponentLike[], issues: string[]): void {
  for (const component of components) {
    if (!(SHARED_PRIMITIVES as readonly string[]).includes(component.primitive)) {
      issues.push(`primitive ${component.primitive} is not a shared primitive`);
    }
    for (const key of BANNED_STYLE_KEYS) {
      if (component[key] !== undefined) issues.push(`raw styling ${key} is not allowed`);
    }
    if (component.children) walkComponents(component.children, issues);
  }
}

function ownershipDocument(kit: DesignKit): string {
  return `${JSON.stringify(
    {
      readOnlyForFeatureWorkers: LOCKED_PATHS,
      featureWorkers: "Task-092",
      changeRequest: "Task-112",
      slot: "P0",
      kit,
    },
    null,
    2,
  )}\n`;
}

function exists(root: string, rel: string): boolean {
  return fs.existsSync(path.join(root, ...rel.split("/")));
}

function writeRel(root: string, rel: string, contents: string): void {
  if (rel.startsWith("/") || rel.includes("..")) {
    throw new Error(`refusing to write ${rel}`);
  }
  const full = path.join(root, ...rel.split("/"));
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents.replaceAll("\r\n", "\n"), "utf8");
}

function readPackage(root: string): Buffer | null {
  const full = path.join(root, "package.json");
  if (!fs.existsSync(full)) return null;
  return fs.readFileSync(full);
}

function sameBytes(before: Buffer | null, after: Buffer | null): boolean {
  if (before === null && after === null) return true;
  if (before === null || after === null) return false;
  return before.equals(after);
}
