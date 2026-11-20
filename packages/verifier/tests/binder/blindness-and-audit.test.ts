import { describe, expect, it } from "vitest";
import {
  auditBinderAdapter,
  forbiddenFieldPaths,
  parseBlindBinderV1,
  sanitizeBinderInput,
  assembleBlindBinderPrompt,
} from "../../src/binder/index.js";
import { CALLING_ADAPTER, ORACLE, acceptanceCheck } from "./fixtures.js";

describe("blindness firewall and adapter audit", () => {
  it("strips nested expect, expected, expectedOutput, rubric, and oracle fields", () => {
    const raw = {
      rows: [{ label: "Soup", quantity: 2 }],
      expect: ORACLE,
      expected: { orderedRows: [{ label: ORACLE }] },
      meta: {
        rubric: ORACLE,
        expectedOutput: ORACLE,
        oracle: { note: ORACLE },
        keep: "visible-setup",
      },
    };
    expect(forbiddenFieldPaths(raw)).toEqual([
      "expect",
      "expected",
      "meta.rubric",
      "meta.expectedOutput",
      "meta.oracle",
    ]);
    const clean = sanitizeBinderInput(raw) as { meta: { keep: string }; rows: unknown };
    expect(forbiddenFieldPaths(clean)).toEqual([]);
    expect(JSON.stringify(clean)).not.toContain(ORACLE);
    expect(clean.meta.keep).toBe("visible-setup");
  });

  it("keeps the oracle out of the blind-binder prompt and wraps candidate code as untrusted", () => {
    const check = acceptanceCheck({
      input: {
        rows: [{ label: "Soup", quantity: 2 }],
        expected: { secret: ORACLE },
        nested: { rubric: ORACLE, expectedOutput: ORACLE, expect: ORACLE },
      },
      expected: { orderedRows: [{ label: ORACLE, quantity: 9 }] },
    });
    const prompt = assembleBlindBinderPrompt(check, {
      "src/kitchen/to-print-rows.ts": "export function toPrintRows() { return []; }\n",
    });
    expect(prompt.text.startsWith("<instruction>")).toBe(true);
    expect(prompt.text).toContain('<data source="candidate" trust="untrusted"');
    expect(prompt.text).toContain('trust="untrusted"');
    expect(prompt.text).not.toContain(ORACLE);
    expect(forbiddenFieldPaths(prompt.inputDocument)).toEqual([]);
  });

  it("rejects expectation imports, undeclared helpers, constant adapters, and schema drift", () => {
    const check = acceptanceCheck();
    const file = ".harness-binder/AC-31.adapter.ts";
    expect(
      auditBinderAdapter(
        `import { expectedRows } from "../tests/expectations";\nimport { toPrintRows } from "../src/kitchen/to-print-rows";\nexport function observe(input: unknown) {\n  const orderedRows = toPrintRows(input as never);\n  return { orderedRows: expectedRows };\n}\n`,
        file,
        check,
      ).code,
    ).toBe("expectation_import");

    expect(
      auditBinderAdapter(
        `import { toPrintRows } from "../src/kitchen/to-print-rows";\nimport { internalHelper } from "../src/kitchen/internal-helper";\nexport function observe(input: unknown) {\n  internalHelper();\n  const orderedRows = toPrintRows(input as never);\n  return { orderedRows };\n}\n`,
        file,
        check,
      ).code,
    ).toBe("undeclared_helper");

    expect(
      auditBinderAdapter(
        `import { toPrintRows } from "../src/kitchen/to-print-rows";\nexport function observe(_input: unknown) {\n  return { orderedRows: [{ label: "Soup", quantity: 2 }] };\n}\n`,
        file,
        check,
      ).code,
    ).toBe("entry_not_invoked");

    expect(
      auditBinderAdapter(
        `import { toPrintRows } from "../src/kitchen/to-print-rows";\nexport function observe(input: unknown) {\n  void toPrintRows(input as never);\n  return { orderedRows: [{ label: "Soup", quantity: 2 }] };\n}\n`,
        file,
        check,
      ).code,
    ).toBe("constant_adapter");

    expect(auditBinderAdapter(CALLING_ADAPTER, file, check).ok).toBe(true);

    expect(
      auditBinderAdapter(
        `import { toPrintRows } from "../src/kitchen/to-print-rows";\nexport function observe(input: unknown) {\n  const status = toPrintRows(input as never);\n  return { status };\n}\n`,
        file,
        check,
      ).code,
    ).toBe("schema_mismatch");
  });

  it("rejects binder output that carries expected values", () => {
    const valid = {
      entry_used: "toPrintRows",
      observations_schema: { fields: [{ name: "orderedRows", type: "PrintRow[]" }] },
    };
    expect(parseBlindBinderV1(valid).ok).toBe(true);
    expect(parseBlindBinderV1({ ...valid, expectations: ["Soup x 2"] }).ok).toBe(false);
    expect(parseBlindBinderV1({ ...valid, expected: "Soup x 2" }).ok).toBe(false);
    expect(
      parseBlindBinderV1({
        entry_used: "toPrintRows",
        observations_schema: { fields: [{ name: "expectedOutput", type: "string" }] },
      }).ok,
    ).toBe(false);
    const blocked = parseBlindBinderV1({ blocked: true, reason: "No sensible entry point" });
    expect(blocked.ok).toBe(true);
  });
});
