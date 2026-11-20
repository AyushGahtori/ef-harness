import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  bindScreenSpec,
  contrastRatio,
  DesignSystemError,
  DesignSystemScaffoldBuilder,
  DesignTokenLintRuleset,
  FIX_HINTS,
  LAYOUT_TEMPLATES,
  LOCAL_PORTS,
  LockedTokenOwnership,
  LookAndFeelInterviewFlow,
  MemoryCasBlobStore,
  OfflineUiPlaywrightContractVerifier,
  PHASE0_P04_SLOT,
  productionBundle,
  runPhase0DesignSystem,
  SCREEN_SPEC_SOURCE,
  SPACING_SCALE_PX,
  STYLE_DICTIONARY_SOURCE,
  STYLEGUIDE_VIEWPORTS,
  StyleguideRouteVerifier,
  TEXT_CONTRAST_FLOOR,
  TYPE_SCALE,
  UI_CONTRAST_FLOOR,
  W3cDesignTokenGenerator,
} from "../../src/design-system/index.js";

const ORDERS_BROKEN = [
  'export function OrdersPage() {',
  '  return <button className="bg-[#7C3AED] text-white">Save</button>;',
  "}",
].join("\n");

const ORDERS_OK = [
  'import { Button } from "@/components/ui/button";',
  "export function OrdersPage() {",
  '  return <Button variant="primary">Save</Button>;',
  "}",
].join("\n");

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ef-ds-"));
}

describe("design system interview", () => {
  const flow = new LookAndFeelInterviewFlow();

  it("asks at most four visual choices and accepts the recommended defaults", () => {
    expect(flow.questions.length).toBeLessThanOrEqual(4);
    expect(flow.questions.map((question) => question.id)).toEqual(["mood", "brand", "density", "theme"]);
    const decision = flow.acceptAll();
    expect(decision.visualChoices).toBe(4);
    expect(decision.mood).toBe("neutral");
    expect(decision.density).toBe("balanced");
    expect(decision.theme).toBe("both");
    expect(decision.typography.loading).toBe("system");
    expect(decision.typography.heading).toContain("system-ui");
    expect(decision.componentLibrary).toBe("shadcn/ui");
    expect(decision.gradients).toBe("none");
    expect(decision.brand.primary.input).toBe("#0F172A");
    expect(decision.brand.accent.input).toBe("#3730A3");
  });

  it("accepts comfortable and compact density and locks typography to the mood", () => {
    const comfortable = flow.capture({ density: "comfortable", mood: "editorial" });
    expect(comfortable.pagePaddingPx).toBe(32);
    expect(comfortable.typography.heading).toContain("ui-serif");
    const compact = flow.capture({ density: "compact", mood: "technical" });
    expect(compact.stackGapPx).toBe(8);
    expect(compact.typography.body).toContain("ui-monospace");
    expect(compact.typography.loading).toBe("system");
  });

  it("suggests brand-asset colors without applying them until accepted", () => {
    const shown = flow.capture({
      brandAssets: [
        { assetId: "logo-1", role: "logo_light", dominantColorsHex: ["#FF7A45", "#312E81"] },
      ],
    });
    expect(shown.brand.source).toBe("preset");
    expect(shown.brand.assetIds).toEqual(["logo-1"]);
    expect(shown.brand.suggestions[0]?.primary).toBe("#FF7A45");
    const applied = flow.capture({
      brandAssets: [
        { assetId: "logo-1", role: "logo_light", dominantColorsHex: ["#FF7A45", "#312E81"] },
      ],
      useBrandAssetColors: true,
    });
    expect(applied.brand.source).toBe("brand-asset");
    expect(applied.brand.accent.input).toBe("#312E81");
    expect(applied.brand.primary.light.foregroundOnFill).toBeGreaterThanOrEqual(TEXT_CONTRAST_FLOOR);
  });

  it("rejects an invalid brand color", () => {
    expect(() => flow.capture({ primary: "#GGGGGG" })).toThrow(DesignSystemError);
  });
});

describe("W3C tokens and contrast", () => {
  const flow = new LookAndFeelInterviewFlow();
  const generator = new W3cDesignTokenGenerator();

  it("compiles one token source into css, tailwind, and typescript", () => {
    const decision = flow.acceptAll();
    const first = generator.compile(generator.generate(decision));
    const second = generator.compile(generator.generate(decision));
    expect(first.source).toBe(STYLE_DICTIONARY_SOURCE);
    expect(first.tokensJson).toBe(second.tokensJson);
    expect(first.css).toBe(second.css);
    expect(first.tailwind).toBe(second.tailwind);
    expect(first.typescript).toBe(second.typescript);
    const parsed = JSON.parse(first.tokensJson) as {
      color: { light: { surface: { $type: string; $value: string } } };
      spacing: Record<string, { $value: string }>;
    };
    expect(parsed.color.light.surface.$type).toBe("color");
    expect(parsed.color.light.surface.$value.startsWith("#")).toBe(true);
    for (const step of SPACING_SCALE_PX) {
      expect(parsed.spacing[String(step)]?.$value).toBe(`${step}px`);
      expect(first.css).toContain(`--spacing-${step}: ${step}px;`);
    }
    for (const step of TYPE_SCALE) {
      expect(first.css).toContain(`--font-size-${step.id}: ${step.px}px;`);
    }
    expect(first.css).toContain("--color-surface:");
    expect(first.css).toContain('--color-surface-raised:');
    expect(first.css).toContain("--color-text-primary:");
    expect(first.css).toContain("--color-text-muted:");
    expect(first.css).toContain("--color-border:");
    expect(first.css).toContain("--color-primary:");
    expect(first.css).toContain("--color-accent:");
    expect(first.css).toContain("--color-danger:");
    expect(first.css).toContain("--color-warning:");
    expect(first.css).toContain("--color-success:");
    expect(first.css).toContain(':root[data-theme="dark"]');
    expect(first.css).not.toContain("linear-gradient");
    expect(first.css).not.toContain("radial-gradient");
    expect(first.tailwind).toContain('"surface": "var(--color-surface)"');
    expect(first.typescript).toContain("export const tokens");
    expect(first.contrast.ok).toBe(true);
    expect(first.contrast.pairs.length).toBeGreaterThan(0);
    expect(first.contrast.pairs.every((pair) => pair.ok)).toBe(true);
    const text = first.contrast.pairs.filter((pair) => pair.kind === "text");
    const ui = first.contrast.pairs.filter((pair) => pair.kind === "ui");
    expect(text.every((pair) => pair.ratio >= TEXT_CONTRAST_FLOOR)).toBe(true);
    expect(ui.every((pair) => pair.ratio >= UI_CONTRAST_FLOOR)).toBe(true);
    expect(new Set(first.contrast.pairs.map((pair) => pair.theme))).toEqual(new Set(["light", "dark"]));
  });

  it("keeps a crisp dark border and a separate dark elevation", () => {
    const compiled = generator.compile(generator.generate(flow.acceptAll()));
    const document = generator.generate(flow.acceptAll());
    const light = String(document.elevation.light.raised.$value);
    const dark = String(document.elevation.dark.raised.$value);
    expect(dark).toContain("1px");
    expect(dark).not.toBe(light);
    expect(dark).not.toContain("rgb(15 23 42");
    expect(String(document.elevation.dark.overlay.$value)).toContain("rgb(0 0 0 /");
    expect(compiled.css).toContain(`--elevation-raised: ${dark}`);
    const borderOnSurface = contrastRatio(document.palettes.dark.border, document.palettes.dark.surface);
    const borderOnRaised = contrastRatio(document.palettes.dark.border, document.palettes.dark["surface-raised"]);
    expect(borderOnSurface).toBeGreaterThanOrEqual(UI_CONTRAST_FLOOR);
    expect(borderOnRaised).toBeGreaterThanOrEqual(UI_CONTRAST_FLOOR);
  });

  it("derives an accessible pairing for bright yellow and orange", () => {
    const yellow = flow.capture({ primary: "#FACC15" });
    const light = yellow.brand.primary.light;
    expect(light.fill).toBe("#FACC15");
    expect(light.foreground).toBe("#0F172A");
    expect(light.textStrong).toBe("#854D0E");
    expect(light.whiteOnFill).toBeCloseTo(1.53, 1);
    expect(light.whiteOnFill).toBeLessThan(TEXT_CONTRAST_FLOOR);
    expect(light.foregroundOnFill).toBeGreaterThanOrEqual(TEXT_CONTRAST_FLOOR);
    expect(contrastRatio("#0F172A", "#FACC15")).toBeCloseTo(light.foregroundOnFill, 5);
    expect(light.textStrongOnSurface).toBeGreaterThanOrEqual(TEXT_CONTRAST_FLOOR);
    expect(contrastRatio("#854D0E", "#FFFFFF")).toBeGreaterThanOrEqual(TEXT_CONTRAST_FLOOR);
    const yellowBuild = generator.compile(generator.generate(yellow));
    expect(yellowBuild.contrast.ok).toBe(true);
    expect(yellowBuild.tokensJson).toContain("#854D0E");
    expect(yellowBuild.tokensJson).toContain("#0F172A");
    expect(yellowBuild.css).not.toContain("linear-gradient");

    const orange = flow.capture({ accent: "#FF7A45" });
    expect(orange.brand.accent.light.foreground).toBe("#0F172A");
    expect(orange.brand.accent.light.textStrong).toBe("#B23C0C");
    expect(orange.brand.accent.light.whiteOnFill).toBeLessThan(TEXT_CONTRAST_FLOOR);
    expect(orange.brand.accent.light.textStrongOnSurface).toBeGreaterThanOrEqual(TEXT_CONTRAST_FLOOR);
    expect(contrastRatio("#0F172A", "#FF7A45")).toBeGreaterThanOrEqual(TEXT_CONTRAST_FLOOR);
    expect(generator.compile(generator.generate(orange)).contrast.ok).toBe(true);
  });
});

describe("token lint rules", () => {
  const rules = new DesignTokenLintRuleset();

  it("flags raw hex, arbitrary colors, bg-white, and a raw button", () => {
    const violations = rules.lintFile("src/features/orders/OrdersPage.tsx", ORDERS_BROKEN);
    expect(violations.some((violation) => violation.rule === "ef/no-raw-color" && violation.message.includes("#7C3AED"))).toBe(true);
    expect(violations.some((violation) => violation.rule === "ef/no-arbitrary-color")).toBe(true);
    expect(violations.some((violation) => violation.message === FIX_HINTS.button)).toBe(true);
    const inversion = rules.lintFile(
      "src/features/orders/Card.tsx",
      '<div className="bg-white text-black">Card</div>',
    );
    expect(inversion.some((violation) => violation.rule === "ef/no-dark-inversion")).toBe(true);
    const spacing = rules.lintFile(
      "src/features/orders/Spacing.tsx",
      '<div className="p-[13px] text-[15px]" style={{ margin: "7px", fontSize: "13px" }} />',
    );
    expect(spacing.filter((violation) => violation.rule === "ef/no-magic-spacing").length).toBeGreaterThanOrEqual(3);
  });

  it("passes token-backed primitives and compliant screens", () => {
    expect(rules.lintFile("src/features/orders/OrdersPage.tsx", ORDERS_OK)).toEqual([]);
    expect(
      rules.lintFile(
        "src/components/ui/button.tsx",
        'export function Button() { return <button type="button">Save</button>; }',
      ),
    ).toEqual([]);
    expect(
      rules.lintFile("src/styles/tokens.css", ":root { --color-primary: #3730A3; background: rgb(15 23 42 / 0.12); }"),
    ).toEqual([]);
    const echoed = rules.lintFile(
      "src/routes/__styleguide.tsx",
      "<p>Small text uses #854D0E on #F8FAFC.</p>",
      { knownTokenHexes: ["#854D0E", "#F8FAFC"] },
    );
    expect(echoed).toEqual([]);
    expect(
      rules.lintFile("src/routes/__styleguide.tsx", "<p>#7C3AED</p>", { knownTokenHexes: ["#854D0E"] }).length,
    ).toBeGreaterThan(0);
  });

  it("ships an eslint module that catches the same button bypass", async () => {
    const root = tempRoot();
    try {
      const file = path.join(root, "ef-token-rules.mjs");
      fs.writeFileSync(file, rules.emit().eslint, "utf8");
      const loaded = (await import(pathToFileURL(file).href)) as {
        lintSource: (source: string, filePath: string) => { rule: string; message: string }[];
      };
      const violations = loaded.lintSource(ORDERS_BROKEN, "src/features/orders/OrdersPage.tsx");
      expect(violations.some((violation) => violation.message === FIX_HINTS.button)).toBe(true);
      expect(loaded.lintSource(ORDERS_OK, "src/features/orders/OrdersPage.tsx")).toEqual([]);
      const style = path.join(root, "ef-stylelint.mjs");
      fs.writeFileSync(style, rules.emit().stylelint, "utf8");
      const css = (await import(pathToFileURL(style).href)) as {
        lintCss: (source: string, filePath: string) => { rule: string }[];
      };
      expect(css.lintCss(".card { color: #7C3AED; margin: 7px; }", "src/features/card.css").length).toBeGreaterThan(0);
      expect(css.lintCss(":root { color: #7C3AED; }", "src/styles/tokens.css")).toEqual([]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("points a brownfield kit at the existing button", () => {
    const violations = new DesignTokenLintRuleset().lintFile(
      "src/orders/OrdersPage.tsx",
      "<button>Save</button>",
      { kit: "mui" },
    );
    expect(violations[0]?.message).toContain("@mui/material");
  });
});

describe("scaffold, styleguide, brownfield, and ownership", () => {
  const builder = new DesignSystemScaffoldBuilder();

  it("writes a locked greenfield kit and strips the styleguide from production", () => {
    const root = tempRoot();
    const packageJson = JSON.stringify({ name: "app", private: true, dependencies: { react: "19.0.0" } });
    fs.writeFileSync(path.join(root, "package.json"), packageJson);
    try {
      const plan = builder.build({
        projectRoot: root,
        projectKind: "web",
        tags: ["print"],
        screenSpecs: [
          {
            templateId: "list-detail",
            components: [{ primitive: "Table" }, { primitive: "Button" }],
          },
        ],
      });
      expect(plan.ok).toBe(true);
      expect(plan.skipped).toBe(false);
      expect(plan.packageJsonUntouched).toBe(true);
      expect(fs.readFileSync(path.join(root, "package.json"), "utf8")).toBe(packageJson);
      expect(plan.contrastOk).toBe(true);
      expect(plan.verification?.ok).toBe(true);
      expect(plan.verification?.consoleErrors).toEqual([]);
      expect(plan.verification?.pageErrors).toEqual([]);
      expect(plan.verification?.axeSerious).toEqual([]);
      expect(plan.verification?.productionExcluded).toBe(true);
      expect(plan.verification?.guardPresent).toBe(true);
      expect(plan.verification?.viewports).toEqual(expect.arrayContaining([375, 1440]));
      expect(plan.verification?.screenshotCasIds.length).toBe(STYLEGUIDE_VIEWPORTS.length * 2);
      expect(new Set(plan.verification?.screenshotCasIds).size).toBeGreaterThan(0);
      const route = fs.readFileSync(path.join(root, "src/routes/__styleguide.tsx"), "utf8");
      expect(route).toContain("import.meta.env.DEV");
      expect(route).toContain("NODE_ENV !== 'production'");
      expect(route).toContain('data-ef-styleguide="root"');
      expect(route).toContain("PrintLayout");
      expect(fs.existsSync(path.join(root, "src/components/layouts/print-layout.tsx"))).toBe(true);
      expect(fs.existsSync(path.join(root, "src/components/ui/button.tsx"))).toBe(true);
      const button = fs.readFileSync(path.join(root, "src/components/ui/button.tsx"), "utf8");
      expect(button).not.toMatch(/#[0-9A-Fa-f]{6}/);
      const css = fs.readFileSync(path.join(root, "src/styles/tokens.css"), "utf8");
      expect(css).not.toContain("linear-gradient");
      expect(css).not.toContain("@font-face");
      const bundled = productionBundle(plan.files);
      expect(bundled).not.toContain("data-ef-styleguide");
      const leaked = plan.files.map((file) => file.contents).join("\n");
      expect(new StyleguideRouteVerifier().verify({
        routeSource: route,
        css,
        productionBundle: leaked,
        themes: ["light", "dark"],
        requiredNames: ["Button"],
        surfaceHex: { light: "#F8FAFC", dark: "#0F172A" },
      }).productionExcluded).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("skips a pure CLI or headless API without touching package.json", () => {
    const root = tempRoot();
    const packageJson = '{"name":"cli","bin":{"cli":"index.js"}}\n';
    fs.writeFileSync(path.join(root, "package.json"), packageJson);
    try {
      for (const projectKind of ["cli", "api", "headless"] as const) {
        const plan = builder.build({ projectRoot: root, projectKind });
        expect(plan.skipped).toBe(true);
        expect(plan.ok).toBe(true);
        expect(plan.files).toEqual([]);
        expect(plan.written).toEqual([]);
        expect(plan.packageJsonUntouched).toBe(true);
        expect(plan.reason).toContain("CLI");
      }
      expect(fs.readFileSync(path.join(root, "package.json"), "utf8")).toBe(packageJson);
      expect(fs.readdirSync(root)).toEqual(["package.json"]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("adopts a brownfield kit without overwriting css or primitives", () => {
    const root = tempRoot();
    const button = "export const EXISTING_BUTTON = true;\n";
    const css = ":root { --color-primary: #312E81; }\n";
    fs.mkdirSync(path.join(root, "src/components/ui"), { recursive: true });
    fs.mkdirSync(path.join(root, "src/styles"), { recursive: true });
    fs.writeFileSync(path.join(root, "src/components/ui/button.tsx"), button);
    fs.writeFileSync(path.join(root, "src/styles/globals.css"), css);
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ dependencies: { tailwindcss: "3.4.0" } }),
    );
    fs.writeFileSync(path.join(root, "tailwind.config.ts"), "export default { theme: { colors: { brand: '#312E81' } } };\n");
    try {
      const plan = builder.build({ projectRoot: root, projectKind: "web" });
      expect(plan.ok).toBe(true);
      expect(plan.brownfield.detected).toBe(true);
      expect(plan.kit).not.toBe("shadcn");
      expect(fs.readFileSync(path.join(root, "src/components/ui/button.tsx"), "utf8")).toBe(button);
      expect(fs.readFileSync(path.join(root, "src/styles/globals.css"), "utf8")).toBe(css);
      expect(fs.existsSync(path.join(root, "src/components/ui/card.tsx"))).toBe(false);
      expect(fs.existsSync(path.join(root, "eslint/ef-token-rules.mjs"))).toBe(true);
      expect(plan.preservedExisting).toEqual([]);
      expect(plan.files.some((file) => file.path.startsWith("src/components/ui/"))).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps tokens and shared primitives read-only for feature workers", () => {
    const ownership = new LockedTokenOwnership();
    const denied = ownership.decide("src/components/ui/badge.tsx", "feature-worker");
    expect(denied.ok).toBe(false);
    expect(denied.ccr?.task).toBe("Task-112");
    expect(denied.ccr?.slot).toBe("P0");
    expect(denied.ccr?.kind).toBe("additive-primitive");
    expect(ownership.decide("design/tokens.json", "feature-worker").ok).toBe(false);
    expect(ownership.decide("src/features/orders/OrdersPage.tsx", "feature-worker").ok).toBe(true);
    expect(ownership.decide("src/components/ui/badge.tsx", "ccr").ok).toBe(true);
    expect(ownership.decide("design/tokens.json", "phase0").ok).toBe(true);
  });

  it("rejects unknown templates, unknown primitives, and raw screen styling", () => {
    expect(bindScreenSpec({ templateId: "list-detail", components: [{ primitive: "Table" }] }).ok).toBe(true);
    expect(LAYOUT_TEMPLATES.map((template) => template.id)).toEqual(
      expect.arrayContaining(["app-shell", "page-header", "list-detail", "form-page", "empty-state", "error-state"]),
    );
    const unknown = bindScreenSpec({ templateId: "neon-grid", components: [{ primitive: "OrdersTable" }] });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) {
      expect(unknown.issues.some((issue) => issue.includes("neon-grid"))).toBe(true);
      expect(unknown.issues.some((issue) => issue.includes("OrdersTable"))).toBe(true);
    }
    const styled = bindScreenSpec({
      templateId: "form-page",
      components: [{ primitive: "Button", className: "bg-white" }],
    });
    expect(styled.ok).toBe(false);
  });

  it("fails closed when the styleguide clips, loads a remote font, or reports axe errors", () => {
    const verifier = new StyleguideRouteVerifier();
    const css = ":root { --tap-target: var(--spacing-24); } .ui-button:focus-visible { outline: 1px solid transparent; }";
    const base = {
      css,
      productionBundle: "",
      themes: ["light", "dark"] as const,
      requiredNames: ["Button"],
      surfaceHex: { light: "#F8FAFC", dark: "#0F172A" },
    };
    const healthy = `
      const styleguideEnabled = import.meta.env.DEV && process.env.NODE_ENV !== 'production';
      export function Page() {
        return <main data-theme="light"><section data-theme="dark"><Button>Save</Button></section></main>;
      }
    `;
    expect(verifier.verify({ ...base, routeSource: `${healthy} default hover focus disabled loading error` }).ok).toBe(true);
    const clipped = verifier.verify({
      ...base,
      routeSource: `${healthy} default hover focus disabled loading error <Button>${"Label".repeat(30)}</Button>`,
    });
    expect(clipped.ok).toBe(false);
    expect(clipped.clipped.some((issue) => issue.includes("375px"))).toBe(true);
    const font = verifier.verify({
      ...base,
      routeSource: `${healthy} default hover focus disabled loading error`,
      css: `${css}\n@font-face { font-family: Remote; src: url(https://fonts.googleapis.com/css?family=Remote); }`,
    });
    expect(font.fontLoadingBroken).toBe(true);
    const noisy = verifier.verify({
      ...base,
      routeSource: `${healthy} default hover focus disabled loading error\nconsole.error("boom");`,
    });
    expect(noisy.consoleErrors).toContain("console.error");
    const playwright = new OfflineUiPlaywrightContractVerifier();
    const custom = verifier.verify({
      ...base,
      routeSource: `${healthy} default hover focus disabled loading error`,
      playwright: {
        source: LOCAL_PORTS.uiPlaywrightContractVerifier,
        audit() {
          return playwright.audit({
            routeSource: "",
            css,
            themes: ["light"],
            surfaceHex: base.surfaceHex,
          }).map((report) => ({
            ...report,
            axeViolations: [{ impact: "serious" as const, id: "color-contrast", help: "contrast" }],
          }));
        },
      },
    });
    expect(custom.axeSerious.join(" ")).toContain("color-contrast");
  });

  it("stores styleguide screenshots in the local CAS port", () => {
    const cas = new MemoryCasBlobStore();
    const css = ".ui-button:focus-visible { outline: 1px solid transparent; } :root { --tap-target: 24px; }";
    const route = [
      "const styleguideEnabled = import.meta.env.DEV && process.env.NODE_ENV !== 'production';",
      "export function Page() { return <main data-theme=\"light\"><section data-theme=\"dark\"><Button>Save</Button></section></main>; }",
      "default hover focus disabled loading error",
    ].join("\n");
    const result = new StyleguideRouteVerifier().verify({
      routeSource: route,
      css,
      productionBundle: "var app = true;",
      themes: ["light", "dark"],
      requiredNames: ["Button"],
      surfaceHex: { light: "#F8FAFC", dark: "#0F172A" },
      cas,
    });
    expect(result.ok).toBe(true);
    expect(result.screenshotCasIds.every((id) => cas.blobs.has(id))).toBe(true);
    const png = cas.blobs.get(result.screenshotCasIds[0] ?? "");
    expect(png?.[0]).toBe(137);
    expect(png?.[1]).toBe(80);
    expect(LOCAL_PORTS.casBlobStore).toBe("local-port:task-028");
    expect(PHASE0_P04_SLOT.slot).toBe("P0.4");
    expect(SCREEN_SPEC_SOURCE).toBe("local-port:task-084");
  });

  it("exposes the phase 0 slot through the same builder", () => {
    const root = tempRoot();
    try {
      const plan = runPhase0DesignSystem({ projectRoot: root, projectKind: "web" });
      expect(plan.slot).toBe("P0.4");
      expect(plan.ok).toBe(true);
      expect(plan.verification?.screenshotCasIds.length).toBeGreaterThan(0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
