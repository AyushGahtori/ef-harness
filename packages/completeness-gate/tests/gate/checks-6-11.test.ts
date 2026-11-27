import { describe, expect, it } from "vitest";
import { added, auditLeaf, ruleIds } from "./support.js";

function records(count: number): string {
  const rows = Array.from({ length: count }, (_, index) => {
    return `  { id: "${index}", name: "Order ${index}", status: "draft" }`;
  });
  return `export const orders = [\n${rows.join(",\n")}\n];\n`;
}

describe("static audit checks 6-11", () => {
  it("hard-fails arrays of more than five structured records", () => {
    const report = auditLeaf({
      files: [added("src/kitchen/orders.ts", records(6))],
      entryPoints: ["src/kitchen/orders.ts"],
    });
    expect(report.passed).toBe(false);
    expect(ruleIds(report)).toContain("check6.hardcoded-records");
  });

  it("allows five structured records and status maps under 20 entries", () => {
    const few = auditLeaf({
      files: [added("src/kitchen/few.ts", records(5))],
      entryPoints: ["src/kitchen/few.ts"],
    });
    expect(few.passed).toBe(true);
    expect(few.findings).toEqual([]);

    const labels = auditLeaf({
      files: [
        added(
          "src/kitchen/status.ts",
          `export const ORDER_STATUS_LABELS = {
  draft: "Draft",
  queued: "Queued",
  cooking: "Cooking",
  ready: "Ready",
  served: "Served",
  cancelled: "Cancelled",
  refunded: "Refunded",
  voided: "Void",
};
`,
        ),
      ],
      entryPoints: ["src/kitchen/status.ts"],
    });
    expect(labels.passed).toBe(true);
    expect(labels.findings).toEqual([]);
  });

  it("still hard-fails an undeclared src/data file of fake order rows", () => {
    const report = auditLeaf({
      files: [added("src/data/orders.ts", records(10))],
      entryPoints: ["src/data/orders.ts"],
      staticData: [
        { id: "iso-4217", pathGlob: "src/data/currencies.ts", source: "ISO 4217" },
      ],
    });
    expect(report.passed).toBe(false);
    expect(ruleIds(report)).toContain("check6.hardcoded-records");
  });

  it("allows a plan-declared static_data currency list", () => {
    const codes = Array.from({ length: 50 }, (_, index) => `"C${String(index).padStart(2, "0")}"`);
    const report = auditLeaf({
      files: [added("src/data/currencies.ts", `export const CURRENCY_CODES = [${codes.join(", ")}];\n`)],
      entryPoints: ["src/data/currencies.ts"],
      staticData: [
        { id: "iso-4217", pathGlob: "src/data/currencies.ts", source: "ISO 4217" },
      ],
    });
    expect(report.passed).toBe(true);
    expect(report.findings).toEqual([]);
  });

  it("hard-fails fake-data strings outside fixtures", () => {
    const report = auditLeaf({
      files: [
        added(
          "src/kitchen/people.ts",
          `export const sample = {
  primary: "John Doe",
  secondary: "Jane Doe",
  email: "foo@example.com",
  other: "test@test.com",
};
`,
        ),
      ],
      entryPoints: ["src/kitchen/people.ts"],
    });
    expect(report.passed).toBe(false);
    const messages = report.findings.map((finding) => finding.message).join("\n");
    expect(messages).toContain("John Doe");
    expect(messages).toContain("Jane Doe");
    expect(messages).toContain("foo@example.com");
    expect(messages).toContain("test@test.com");
  });

  it("hard-fails mock libraries in production and allows them in tests", () => {
    for (const specifier of ["@faker-js/faker", "msw", "sinon", "vitest"]) {
      const binding = specifier.includes("/") ? "faker" : "lib";
      const report = auditLeaf({
        files: [
          added(
            "src/kitchen/factory.ts",
            `import { ${binding} } from "${specifier}";\nexport function build() {\n  return ${binding};\n}\n`,
          ),
        ],
        entryPoints: ["src/kitchen/factory.ts"],
      });
      expect(ruleIds(report), specifier).toContain("check6.mock-import");
    }

    const fixture = auditLeaf({
      files: [
        added(
          "tests/kitchen/factory.test.ts",
          `import { faker } from "@faker-js/faker";\nexport function build() {\n  return faker;\n}\n`,
        ),
      ],
      entryPoints: ["tests/kitchen/factory.test.ts"],
      protectedTestPaths: [],
      protectedTestConfigPaths: [],
      lockedSnapshotPaths: [],
    });
    expect(ruleIds(fixture)).not.toContain("check6.mock-import");
    expect(fixture.passed).toBe(true);
  });

  it("hard-fails skip, only, fixme, and commented expectations", () => {
    const skip = auditLeaf({
      files: [
        added(
          "src/kitchen/debug.ts",
          `export function hidden() {\n  it.skip("later", () => {\n    return true;\n  });\n  return "hidden";\n}\n`,
        ),
      ],
      entryPoints: ["src/kitchen/debug.ts"],
    });
    expect(ruleIds(skip)).toContain("check7.skip-or-only");

    const only = auditLeaf({
      files: [
        added(
          "src/kitchen/focus.ts",
          `export function focus() {\n  describe.only("case", () => {\n    return true;\n  });\n  return "focus";\n}\n`,
        ),
      ],
      entryPoints: ["src/kitchen/focus.ts"],
    });
    expect(ruleIds(only)).toContain("check7.skip-or-only");

    const commented = auditLeaf({
      files: [
        added(
          "src/kitchen/totals.ts",
          `export function totals() {\n  // expect(total).toBe(2)\n  return 2;\n}\n`,
        ),
      ],
      entryPoints: ["src/kitchen/totals.ts"],
    });
    expect(ruleIds(commented)).toContain("check7.skip-or-only");

    const xit = auditLeaf({
      files: [
        added(
          "src/kitchen/xit-case.ts",
          `export function skipped() {\n  xit("hidden", () => {\n    return true;\n  });\n  test.fixme("later", () => {\n    return false;\n  });\n  return "skipped";\n}\n`,
        ),
      ],
      entryPoints: ["src/kitchen/xit-case.ts"],
    });
    expect(ruleIds(xit)).toContain("check7.skip-or-only");
  });

  it("hard-fails protected test-config edits unless a verification grant exists", () => {
    const source = `export default {\n  test: { exclude: ["src/failing.test.ts"], coverage: { lines: 10 } },\n};\n`;
    const blocked = auditLeaf({
      files: [added("vitest.config.ts", source)],
      entryPoints: ["vitest.config.ts"],
    });
    expect(ruleIds(blocked)).toContain("check7.protected-path");

    const granted = auditLeaf({
      files: [added("vitest.config.ts", source)],
      entryPoints: ["vitest.config.ts"],
      verificationScopeGrant: true,
    });
    expect(ruleIds(granted)).not.toContain("check7.protected-path");
    expect(granted.passed).toBe(true);
  });

  it("hard-fails every type-escape and lint-bypass token", () => {
    const snippets = [
      "// @ts-ignore\nexport const ready = true;\n",
      "// @ts-expect-error\nexport const ready = true;\n",
      "// @ts-nocheck\nexport const ready = true;\n",
      "export const value: any = 1;\n",
    ];
    for (const source of snippets) {
      const report = auditLeaf({
        files: [added("src/kitchen/escape.ts", source)],
        entryPoints: ["src/kitchen/escape.ts"],
      });
      expect(ruleIds(report)).toContain("check8.type-escape");
      expect(report.receipt.lintEscapesCount).toBe(0);
    }
  });

  it("hard-fails a missing contract route", () => {
    const report = auditLeaf({
      files: [
        added(
          "src/kitchen/screen.tsx",
          `export function Screen() {\n  return <main>Ready</main>;\n}\n`,
        ),
      ],
      entryPoints: ["src/kitchen/screen.tsx"],
      produces: [{ kind: "route", name: "/api/kitchen/orders" }],
    });
    expect(report.passed).toBe(false);
    expect(ruleIds(report)).toContain("check9.missing-contract");
  });

  it("hard-fails bare type and lint escapes", () => {
    const cast = auditLeaf({
      files: [added("src/kitchen/cast.ts", `export const value = payload as any;\n`)],
      entryPoints: ["src/kitchen/cast.ts"],
    });
    expect(cast.passed).toBe(false);
    expect(ruleIds(cast)).toContain("check8.type-escape");
    expect(cast.receipt.lintEscapesCount).toBe(0);

    const disable = auditLeaf({
      files: [
        added(
          "src/kitchen/quiet.ts",
          `// eslint-disable-next-line no-console\nexport const ready = true;\n`,
        ),
      ],
      entryPoints: ["src/kitchen/quiet.ts"],
    });
    expect(disable.passed).toBe(false);
    expect(ruleIds(disable)).toContain("check8.type-escape");
    expect(disable.receipt.lintEscapesCount).toBe(0);
  });

  it("counts a justified eslint-disable and allows the noted escape", () => {
    const report = auditLeaf({
      files: [
        added(
          "src/kitchen/quiet.ts",
          `// eslint-disable-next-line no-console -- T07-note-2\nexport const ready = true;\n`,
        ),
      ],
      entryPoints: ["src/kitchen/quiet.ts"],
      justifiedTaskNotes: ["T07-note-2"],
    });
    expect(report.passed).toBe(true);
    expect(report.findings).toEqual([]);
    expect(report.receipt.lintEscapesCount).toBe(1);
    expect(report.receipt.allowedEscapes[0]?.noteId).toBe("T07-note-2");
  });

  it("allows a task-note on the previous line for as any", () => {
    const report = auditLeaf({
      files: [
        added(
          "src/kitchen/cast.ts",
          `// reason: T07-note-1\nexport const value = payload as any;\n`,
        ),
      ],
      entryPoints: ["src/kitchen/cast.ts"],
      justifiedTaskNotes: ["T07-note-1"],
    });
    expect(report.passed).toBe(true);
    expect(report.receipt.lintEscapesCount).toBe(1);
  });

  it("hard-fails unregistered and foreign names and allows shared env vars", () => {
    const missingEnv = auditLeaf({
      files: [
        added(
          "src/kitchen/env.ts",
          `export function load() {\n  const value = process.env.SECRET_X;\n  if (!value) {\n    throw new Error("missing required key");\n  }\n  return value;\n}\n`,
        ),
      ],
      entryPoints: ["src/kitchen/env.ts"],
    });
    expect(ruleIds(missingEnv)).toContain("check10.unregistered-name");

    const missingRoute = auditLeaf({
      files: [
        added(
          "src/kitchen/routes.ts",
          `export function register(app: { get: (path: string, handler: () => string) => void }) {\n  app.get("/api/kitchen/export", () => "ready");\n  return "registered";\n}\n`,
        ),
      ],
      entryPoints: ["src/kitchen/routes.ts"],
    });
    expect(ruleIds(missingRoute)).toContain("check10.unregistered-name");
    expect(missingRoute.findings.some((finding) => finding.message.includes("/api/kitchen/export"))).toBe(true);

    const foreign = auditLeaf({
      files: [
        added(
          "src/kitchen/routes.ts",
          `export function register(app: { get: (path: string, handler: () => string) => void }) {\n  app.get("/api/kitchen/export", () => "ready");\n  return "registered";\n}\n`,
        ),
      ],
      entryPoints: ["src/kitchen/routes.ts"],
      registry: {
        names: [
          {
            kind: "http_route",
            value: "/api/kitchen/export",
            feature: "F99",
            owner: "F99",
          },
        ],
      },
    });
    expect(ruleIds(foreign)).toContain("check10.foreign-name");

    const shared = auditLeaf({
      files: [
        added(
          "src/kitchen/env.ts",
          `export function connectionString() {\n  const value = process.env.DATABASE_URL;\n  if (!value) {\n    throw new Error("missing database url");\n  }\n  return value;\n}\n`,
        ),
      ],
      entryPoints: ["src/kitchen/env.ts"],
      registry: {
        names: [
          {
            kind: "env_var",
            value: "DATABASE_URL",
            feature: "project_integrator",
            owner: "project_integrator",
          },
        ],
      },
    });
    expect(shared.passed).toBe(true);
    expect(shared.findings).toEqual([]);
  });

  it("hard-fails a missing asset path and allows a public or registered asset", () => {
    const source = `export function Hero() {\n  return <img src="/images/hero-banner.png" alt="Hero banner" />;\n}\n`;
    const missing = auditLeaf({
      files: [added("src/kitchen/hero.tsx", source)],
      entryPoints: ["src/kitchen/hero.tsx"],
    });
    expect(missing.passed).toBe(false);
    expect(missing.findings.some((finding) => finding.message.includes("/images/hero-banner.png"))).toBe(true);

    const present = auditLeaf({
      files: [added("src/kitchen/hero.tsx", source)],
      entryPoints: ["src/kitchen/hero.tsx"],
      publicFiles: ["public/images/hero-banner.png"],
    });
    expect(present.passed).toBe(true);
  });

  it("hard-fails a secret leak without copying the raw value into the report", () => {
    const secret = ["sk", "_live_", "syntheticTest000000000000"].join("");
    const report = auditLeaf({
      files: [added("src/kitchen/keys.ts", `export const key = "${secret}";\n`)],
      entryPoints: ["src/kitchen/keys.ts"],
      vaultSecrets: [secret],
    });
    expect(report.passed).toBe(false);
    expect(ruleIds(report)).toContain("check11.secret");
    expect(JSON.stringify(report).includes(secret)).toBe(false);
    expect(report.receipt.secretHitCount).toBeGreaterThan(0);
  });

  it("hard-fails edits outside write scope", () => {
    const report = auditLeaf({
      files: [added("src/menu/api.ts", `export const api = 1;\n`)],
      entryPoints: ["src/menu/api.ts"],
      writeScope: ["src/kitchen/**"],
    });
    expect(ruleIds(report)).toContain("check11.out-of-scope");
  });

  it("blocks stubbed contract functions and keeps identical fingerprints stable", () => {
    const source = `export function groupKitchenOrders() {\n  return [];\n}\n`;
    const first = auditLeaf({
      taskId: "T02",
      files: [added("src/kitchen/group.ts", source)],
      produces: [
        { kind: "function", name: "groupKitchenOrders", plannedConsumerTaskId: "T03" },
      ],
    });
    const second = auditLeaf({
      taskId: "T02",
      files: [added("src/kitchen/group.ts", source)],
      produces: [
        { kind: "function", name: "groupKitchenOrders", plannedConsumerTaskId: "T03" },
      ],
    });
    expect(first.passed).toBe(false);
    expect(ruleIds(first)).toContain("ast.stub");
    expect(first.fingerprint).toBe(second.fingerprint);
    expect(first.fingerprint).toHaveLength(64);
  });

  it("reports reduced coverage for languages without an AST grammar", () => {
    const report = auditLeaf({
      files: [added("scripts/tool.py", "value = 1\n")],
    });
    expect(report.passed).toBe(true);
    expect(report.coverageMode).toBe("reduced_text_only");
  });

  it("flags bare returns, false, undefined arrows, and standalone buttons", () => {
    const bare = auditLeaf({
      files: [added("src/kitchen/bare.ts", "export function bareReturn(): void { return; }\n")],
      produces: [{ kind: "function", name: "bareReturn" }],
    });
    expect(ruleIds(bare)).toContain("ast.stub");

    const falseBody = auditLeaf({
      files: [added("src/kitchen/false.ts", "export function falseBody(): boolean { return false; }\n")],
      produces: [{ kind: "function", name: "falseBody" }],
    });
    expect(ruleIds(falseBody)).toContain("ast.stub");

    const undef = auditLeaf({
      files: [added("src/kitchen/undef.ts", "export const undefBody = () => undefined;\n")],
      produces: [{ kind: "function", name: "undefBody" }],
    });
    expect(ruleIds(undef)).toContain("ast.stub");

    const button = auditLeaf({
      files: [
        added(
          "src/kitchen/Toolbar.tsx",
          "export function Toolbar() {\n  return <button type=\"button\">Save</button>;\n}\n",
        ),
      ],
    });
    expect(ruleIds(button)).toContain("ast.dead-control");
  });
});
