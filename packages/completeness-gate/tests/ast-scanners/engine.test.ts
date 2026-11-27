import { describe, expect, it } from "vitest";
import { computeStaticAuditFingerprint, StaticAuditAstEngine } from "../../src/ast-scanners/index.js";
import type { StaticAuditFinding } from "../../src/ast-scanners/index.js";
import { MARKER_FIXME, MARKER_TODO, audit, createContext, ruleIds } from "./support.js";

const realTotals = `export function computeTotals(lines: readonly number[]): number {
  let total = 0;
  for (const line of lines) {
    if (line > 0) total += line;
  }
  return total;
}
`;

const cleanForm = `export function DishForm(props: { onSave: (value: string) => void }) {
  return (
    <form
      action="/dishes"
      onSubmit={(event) => {
        event.preventDefault();
        props.onSave("saved");
      }}
    >
      <label>
        Dish
        <input placeholder="Dish" name="dish" />
        <input placeholder="Enter dish name" name="label" />
      </label>
      <a href="/menu">Menu</a>
      <button type="submit">Save</button>
    </form>
  );
}
`;

describe("ast-scanners", () => {
  it("hard-fails a bare unfinished marker", async () => {
    const report = await audit([
      { path: "src/app.ts", status: "A", content: `// ${MARKER_TODO}: handle error\nexport const ready = true;\n` },
    ]);
    expect(ruleIds(report)).toContain("unfinished-marker");
    expect(report.recordedDeferralIds).toEqual([]);
  });

  it("hard-fails an unapproved deferral id and records an approved one", async () => {
    const rejected = await audit([
      {
        path: "src/app.ts",
        status: "A",
        content: `// ${MARKER_TODO}(DEF-999): nope\nexport const ready = true;\n`,
      },
    ], { approvedDeferralIds: ["DEF-12"] });
    expect(ruleIds(rejected)).toContain("unfinished-marker");
    expect(rejected.recordedDeferralIds).toEqual([]);

    const accepted = await audit([
      {
        path: "src/mail.ts",
        status: "A",
        content: `// ${MARKER_TODO}(DEF-12): swap SMTP provider in v2\nexport const copy = "lorem ipsum";\n`,
      },
    ], { approvedDeferralIds: ["DEF-12"] });
    expect(accepted.recordedDeferralIds).toEqual(["DEF-12"]);
    expect(accepted.hardFindings.some((finding) => finding.message.includes("lorem"))).toBe(true);
    expect(accepted.hardFindings.some((finding) => finding.snippet.includes("DEF-12"))).toBe(false);
  });

  it("does not treat a different marker token as an approved deferral", async () => {
    const report = await audit([
      {
        path: "src/app.ts",
        status: "A",
        content: `// ${MARKER_FIXME}(DEF-12): nope\nexport const ready = true;\n`,
      },
    ], { approvedDeferralIds: ["DEF-12"] });
    expect(ruleIds(report)).toContain("unfinished-marker");
    expect(report.recordedDeferralIds).toEqual([]);
  });

  it("catches markers in comments, strings, template literals, and JSX text", async () => {
    const report = await audit([
      {
        path: "src/copy.tsx",
        status: "A",
        content: [
          "/**",
          ` * ${MARKER_TODO}: finish totals`,
          " */",
          `export const label = \`${MARKER_TODO}\`;`,
          "export const note = \"not implemented\";",
          "export const copy = \"lorem ipsum\";",
          "// XXX",
          "// HACK",
          "export function Copy() {",
          "  return <p>Placeholder text</p>;",
          "}",
          "",
        ].join("\n"),
      },
    ]);
    expect(report.hardFindings.filter((finding) => finding.ruleId === "unfinished-marker").length).toBeGreaterThanOrEqual(6);
    expect(report.coverageMode).toBe("full_ast");
  });

  it("passes a real implementation, a declared constant, and clean JSX with placeholder attributes", async () => {
    const report = await audit(
      [
        { path: "src/totals.ts", status: "A", content: `export const EMPTY_TOTALS = [] as const;\n${realTotals}` },
        { path: "src/DishForm.tsx", status: "A", content: cleanForm },
      ],
      {
        produces: [
          { name: "computeTotals", kind: "function" },
          { name: "EMPTY_TOTALS", kind: "constant" },
          { name: "DishForm", kind: "function" },
        ],
      },
    );
    expect(report.hardFindings).toEqual([]);
    expect(report.coverageMode).toBe("full_ast");
    expect(report.fileCoverage.every((file) => file.textScanExecuted && file.typeBuildScan === "typescript-syntax")).toBe(
      true,
    );
  });

  it("hard-fails a stubbed contract function and ignores a real constant export", async () => {
    const report = await audit(
      [
        {
          path: "src/totals.ts",
          status: "A",
          content: "export const EMPTY_TOTALS = [] as const;\nexport const computeTotals = () => [];\n",
        },
      ],
      {
        produces: [
          { name: "computeTotals", kind: "function" },
          { name: "EMPTY_TOTALS", kind: "constant" },
        ],
      },
    );
    expect(report.hardFindings).toHaveLength(1);
    expect(report.hardFindings[0]?.ruleId).toBe("stub-body");
    expect(report.hardFindings[0]?.message).toContain("computeTotals");
  });

  it("hard-fails an empty body, a null return, and an unimplemented throw", async () => {
    const report = await audit(
      [
        {
          path: "src/stubs.ts",
          status: "A",
          content: [
            "export function emptyBody() {}",
            "export function nullBody() { return null; }",
            "export function thrown() { throw new Error(\"not implemented\"); }",
            "",
          ].join("\n"),
        },
      ],
      {
        produces: [
          { name: "emptyBody", kind: "function" },
          { name: "nullBody", kind: "handler" },
          { name: "thrown", kind: "operation" },
        ],
      },
    );
    const stubbed = report.hardFindings.filter((finding) => finding.ruleId === "stub-body").map((finding) => finding.message);
    expect(stubbed.some((message) => message.includes("emptyBody"))).toBe(true);
    expect(stubbed.some((message) => message.includes("nullBody"))).toBe(true);
    expect(stubbed.some((message) => message.includes("thrown"))).toBe(true);

    const extraStubs = await audit(
      [
        {
          path: "src/extra-stubs.ts",
          status: "A",
          content: [
            "export function bareReturn(): void { return; }",
            "export function falseBody(): boolean { return false; }",
            "export const undefBody = () => undefined;",
            "",
          ].join("\n"),
        },
      ],
      {
        produces: [
          { name: "bareReturn", kind: "function" },
          { name: "falseBody", kind: "function" },
          { name: "undefBody", kind: "function" },
        ],
      },
    );
    const extraMessages = extraStubs.hardFindings
      .filter((finding) => finding.ruleId === "stub-body")
      .map((finding) => finding.message);
    expect(extraMessages.some((message) => message.includes("bareReturn"))).toBe(true);
    expect(extraMessages.some((message) => message.includes("falseBody"))).toBe(true);
    expect(extraMessages.some((message) => message.includes("undefBody"))).toBe(true);
  });

  it("allows a contract that declares a constant or empty return", async () => {
    const report = await audit(
      [
        {
          path: "src/stubs.ts",
          status: "A",
          content: "export function emptyBody() {}\nexport const none = () => null;\n",
        },
      ],
      {
        produces: [
          { name: "emptyBody", kind: "function", allowsEmptyReturn: true },
          { name: "none", kind: "function", allowsConstantReturn: true },
        ],
      },
    );
    expect(ruleIds(report)).not.toContain("stub-body");
  });

  it("hard-fails empty catches and promise catches, including log-only catches under X-11", async () => {
    const empty = await audit([
      {
        path: "src/save.ts",
        status: "A",
        content: "export async function saveDish(): Promise<void> {\n  try {\n    await write();\n  } catch {}\n}\n",
      },
    ]);
    expect(ruleIds(empty)).toContain("swallowed-error");

    const named = await audit([
      {
        path: "src/save.ts",
        status: "A",
        content: "export function saveDish(): void {\n  try {\n    write();\n  } catch (error) {}\n}\n",
      },
    ]);
    expect(ruleIds(named)).toContain("swallowed-error");

    const promise = await audit([
      {
        path: "src/load.ts",
        status: "A",
        content: "export function loadDish() {\n  return read().catch(() => {});\n}\nexport function loadOther() {\n  return read().catch(() => null);\n}\n",
      },
    ]);
    expect(promise.hardFindings.filter((finding) => finding.ruleId === "swallowed-error")).toHaveLength(2);

    const logged = await audit(
      [
        {
          path: "src/save.ts",
          status: "A",
          content: "export function saveDish(): void {\n  try {\n    write();\n  } catch (error) {\n    console.error(error);\n  }\n}\n",
        },
      ],
      { conventionRuleIds: ["X-11"] },
    );
    expect(ruleIds(logged)).toContain("swallowed-error");

    const loggedWithoutRule = await audit([
      {
        path: "src/save.ts",
        status: "A",
        content: "export function saveDish(): void {\n  try {\n    write();\n  } catch (error) {\n    console.log(error);\n  }\n}\n",
      },
    ]);
    expect(ruleIds(loggedWithoutRule)).not.toContain("swallowed-error");

    const rethrown = await audit(
      [
        {
          path: "src/save.ts",
          status: "A",
          content: "export function saveDish(): void {\n  try {\n    write();\n  } catch (error) {\n    console.error(error);\n    throw error;\n  }\n}\n",
        },
      ],
      { conventionRuleIds: ["X-11"] },
    );
    expect(ruleIds(rethrown)).not.toContain("swallowed-error");
  });

  it("does not flag empty catches in tests or declared cleanup helpers", async () => {
    const tests = await audit([
      {
        path: "src/save.test.ts",
        status: "A",
        content: `// ${MARKER_TODO}: fixture\ntry {\n  close();\n} catch {}\n`,
      },
    ]);
    expect(ruleIds(tests)).not.toContain("swallowed-error");
    expect(ruleIds(tests)).not.toContain("unfinished-marker");

    const cleanup = await audit(
      [
        {
          path: "src/close.ts",
          status: "A",
          content: "export function closeQuietly(stream: { end(): void }): void {\n  try {\n    stream.end();\n  } catch {}\n}\n",
        },
      ],
      { cleanupHelperNames: ["closeQuietly"] },
    );
    expect(ruleIds(cleanup)).not.toContain("swallowed-error");
  });

  it("hard-fails dead controls and passes a real form", async () => {
    const click = await audit([
      { path: "src/Click.tsx", status: "A", content: "export function Click() {\n  return <button type=\"button\" onClick={() => {}} />;\n}\n" },
    ]);
    expect(ruleIds(click)).toContain("dead-ui-control");

    const change = await audit([
      { path: "src/Field.tsx", status: "A", content: "export function Field() {\n  return <input onChange={() => {}} />;\n}\n" },
    ]);
    expect(ruleIds(change)).toContain("dead-ui-control");

    const href = await audit([
      { path: "src/Link.tsx", status: "A", content: "export function Link() {\n  return <a href=\"#\">Docs</a>;\n}\n" },
    ]);
    expect(ruleIds(href)).toEqual(["dead-ui-control"]);

    const voidHref = await audit([
      {
        path: "src/Link.tsx",
        status: "A",
        content: "export function Link() {\n  return <a href=\"javascript:void(0)\">Docs</a>;\n}\n",
      },
    ]);
    expect(ruleIds(voidHref)).toEqual(["dead-ui-control"]);

    const form = await audit([
      {
        path: "src/Form.tsx",
        status: "A",
        content: "export function Form() {\n  return <form><input name=\"dish\" /></form>;\n}\n",
      },
    ]);
    expect(form.hardFindings.some((finding) => finding.message.includes("no onSubmit"))).toBe(true);

    const button = await audit([
      {
        path: "src/Form.tsx",
        status: "A",
        content: "export function Form() {\n  return <form action=\"/dishes\"><button>Save</button></form>;\n}\n",
      },
    ]);
    expect(button.hardFindings.some((finding) => finding.message.includes("neither onClick"))).toBe(true);
    expect(button.hardFindings.some((finding) => finding.message.includes("no onSubmit"))).toBe(false);

    const standaloneDead = await audit([
      {
        path: "src/Toolbar.tsx",
        status: "A",
        content: "export function Toolbar() {\n  return <button type=\"button\">Save</button>;\n}\n",
      },
    ]);
    expect(standaloneDead.hardFindings.some((finding) => finding.message.includes("outside a form"))).toBe(true);

    const standaloneLive = await audit([
      {
        path: "src/Toolbar.tsx",
        status: "A",
        content: [
          "export function Toolbar(props: { onSave: () => void; extra?: Record<string, unknown> }) {",
          "  return (",
          "    <div>",
          "      <button type=\"button\" onClick={props.onSave}>Save</button>",
          "      <button type=\"submit\" form=\"dish-form\">Submit</button>",
          "      <button {...props.extra}>Spread</button>",
          "    </div>",
          "  );",
          "}",
          "",
        ].join("\n"),
      },
    ]);
    expect(standaloneLive.hardFindings).toEqual([]);

    const clean = await audit([{ path: "src/DishForm.tsx", status: "A", content: cleanForm }]);
    expect(clean.hardFindings).toEqual([]);
  });

  it("hard-fails elision markers", async () => {
    const report = await audit([
      {
        path: "src/partial.ts",
        status: "A",
        content: [
          "export const value = 1;",
          "// ... existing code ...",
          "// ... rest of file ...",
          "/* unchanged */",
          "# ...",
          "",
        ].join("\n"),
      },
    ]);
    expect(report.hardFindings.filter((finding) => finding.ruleId === "elision-placeholder")).toHaveLength(4);
  });

  it("hard-fails an unplanned 80% deletion and allows a declared deletion or a 50% edit", async () => {
    const previous = Array.from({ length: 10 }, (_, index) => `kept ${index}`).join("\n") + "\n";
    const eighty = await audit([
      { path: "src/legacy.ts", status: "M", previousContent: previous, content: "kept 0\nkept 1\n" },
    ]);
    expect(ruleIds(eighty)).toEqual(["unplanned-large-deletion"]);
    expect(eighty.hardFindings[0]?.message).toContain("80%");

    const half = await audit([
      {
        path: "src/legacy.ts",
        status: "M",
        previousContent: previous,
        content: Array.from({ length: 5 }, (_, index) => `kept ${index}`).join("\n") + "\n",
      },
    ]);
    expect(ruleIds(half)).not.toContain("unplanned-large-deletion");

    const declared = await audit(
      [{ path: "src/legacy.ts", status: "M", previousContent: previous, content: "kept 0\nkept 1\n" }],
      { declaresDeletion: true },
    );
    expect(ruleIds(declared)).not.toContain("unplanned-large-deletion");

    const removed = await audit([
      { path: "src/gone.ts", status: "D", previousContent: "one\ntwo\nthree\nfour\n", content: "" },
    ]);
    expect(ruleIds(removed)).toContain("unplanned-large-deletion");
  });

  it("ignores plan-owned generated paths and seed or fixture paths", async () => {
    const report = await audit(
      [
        {
          path: "src/generated/client.ts",
          status: "A",
          content: `export const value = "${MARKER_TODO}";\nexport const stub = () => [];\n`,
        },
        {
          path: "prisma/seed.ts",
          status: "A",
          content: "// ... existing code ...\nexport const seed = true;\n",
        },
        {
          path: "tests/fixtures/data.ts",
          status: "A",
          content: "/* unchanged */\nexport const row = { name: \"Lorem ipsum\" };\n",
        },
      ],
      {
        excludedGeneratedPaths: ["src/generated/**", "prisma/client"],
        seedFixturePaths: ["prisma/seed.ts", "tests/fixtures/**"],
        produces: [{ name: "stub", kind: "function" }],
      },
    );
    expect(report.hardFindings).toEqual([]);
    expect(report.ignoredPaths).toEqual([
      "prisma/seed.ts",
      "src/generated/client.ts",
      "tests/fixtures/data.ts",
    ]);
  });

  it("flags a branch on a visible example literal", async () => {
    const report = await audit(
      [
        {
          path: "src/price.ts",
          status: "A",
          content: "export function priceDish(dish: string): number {\n  if (dish === 'Soup') return 2;\n  return 1;\n}\n",
        },
      ],
      { visibleExampleLiterals: ["'Soup'"] },
    );
    expect(report.hardFindings).toEqual([]);
    expect(ruleIds(report, "soft")).toContain("visible-example-special-case");

    const other = await audit(
      [
        {
          path: "src/price.ts",
          status: "A",
          content: "export function priceDish(dish: string): number {\n  if (dish === 'Salad') return 2;\n  return 1;\n}\n",
        },
      ],
      { visibleExampleLiterals: ["'Soup'"] },
    );
    expect(ruleIds(other, "soft")).not.toContain("visible-example-special-case");
  });

  it("records soft signals for a tiny diff and complexity far below the MUST list", async () => {
    const tiny = await audit(
      [{ path: "src/small.ts", status: "A", content: "export const value = 1;\n" }],
      { sizeEstimateLines: 200 },
    );
    expect(ruleIds(tiny, "soft")).toContain("diff-smaller-than-estimate");

    const simple = await audit(
      [{ path: "src/price.ts", status: "A", content: "export function priceDish(dish: string): number {\n  return dish.length;\n}\n" }],
      { must: ["one", "two", "three", "four", "five", "six"] },
    );
    expect(ruleIds(simple, "soft")).toContain("complexity-below-must");
  });

  it("sets reduced text coverage for an unsupported extension and still scans text", async () => {
    const clean = await audit([{ path: "src/main.rb", status: "A", content: "puts 'hello'\n" }]);
    expect(clean.coverageMode).toBe("reduced_text_only");
    expect(clean.hardFindings).toEqual([]);
    expect(clean.fileCoverage[0]).toMatchObject({
      language: "unsupported",
      coverageMode: "reduced_text_only",
      textScanExecuted: true,
      typeBuildScan: "unavailable",
    });

    const marked = await audit([
      { path: "src/main.rb", status: "A", content: `# ${MARKER_TODO}\nputs 'hello'\n` },
    ]);
    expect(marked.coverageMode).toBe("reduced_text_only");
    expect(ruleIds(marked)).toContain("unfinished-marker");
  });

  it("keeps a stable fingerprint for the same hard-finding set", async () => {
    const first = await audit([
      { path: "src/app.ts", status: "A", content: `// ${MARKER_TODO}: handle error\nexport const ready = true;\n` },
    ]);
    const second = await audit([
      { path: "src/app.ts", status: "A", content: `// ${MARKER_TODO}: handle error\nexport const ready = true;\n` },
    ]);
    const third = await audit([
      { path: "src/app.ts", status: "A", content: `\n// ${MARKER_TODO}: handle error\nexport const ready = true;\n` },
    ]);
    expect(first.fingerprint).toBe(second.fingerprint);
    expect(third.fingerprint).toBe(first.fingerprint);
    expect(first.fingerprint).toHaveLength(64);

    const shifted: StaticAuditFinding = {
      ...(first.hardFindings[0] as StaticAuditFinding),
      line: 40,
      column: 8,
    };
    expect(computeStaticAuditFingerprint([shifted, ...(first.softFindings)])).toBe(first.fingerprint);
    expect(computeStaticAuditFingerprint([shifted, first.hardFindings[0] as StaticAuditFinding].reverse())).toBe(
      computeStaticAuditFingerprint([first.hardFindings[0] as StaticAuditFinding, shifted].reverse()),
    );

    const different: StaticAuditFinding = {
      ...(first.hardFindings[0] as StaticAuditFinding),
      snippet: "export const other = false;",
    };
    expect(computeStaticAuditFingerprint([different])).not.toBe(first.fingerprint);
  });

  it("uses a configured ast-grep runner for Python and stays text-only when it is not configured", async () => {
    const source = "def save():\n    try:\n        write()\n    except Exception:\n        pass\n";
    const textOnly = await audit([{ path: "src/app.py", status: "A", content: source }]);
    expect(textOnly.coverageMode).toBe("reduced_text_only");
    expect(ruleIds(textOnly)).toContain("swallowed-error");

    const engine = new StaticAuditAstEngine({
      astGrep: {
        scan: () =>
          Promise.resolve({
            available: true,
            matches: [
              {
                ruleId: "swallowed-error",
                line: 4,
                column: 5,
                snippet: "except Exception: pass",
                message: "Empty except swallows an error.",
                remediation: "Surface the error.",
              },
            ],
          }),
      },
    });
    const grammared = await engine.audit({
      files: [{ path: "src/app.py", status: "A", content: source }],
      auditContext: createContext({ astGrepLanguages: ["python"] }),
    });
    expect(grammared.coverageMode).toBe("full_ast");
    expect(grammared.fileCoverage[0]?.typeBuildScan).toBe("ast-grep");
    expect(ruleIds(grammared)).toContain("swallowed-error");
  });
});
