import { describe, expect, it } from "vitest";
import { parseTestReporterOutput, stableTestId } from "../../src/test-health/test-reporter-parser.js";
import { HEALTHY_VITEST_JSON, MIXED_VITEST_JSON } from "./fixtures.js";

describe("test reporter parser", () => {
  it("parses Vitest JSON reporter cases", () => {
    const parsed = parseTestReporterOutput(HEALTHY_VITEST_JSON);
    expect(parsed.format).toBe("vitest");
    expect(parsed.cases.length).toBe(2);
    expect(parsed.cases.every((c) => c.status === "pass")).toBe(true);
  });

  it("parses JUnit XML testcases", () => {
    const xml = `<?xml version="1.0"?><testsuite><testcase classname="pkg" name="works"/><testcase classname="pkg" name="fails"><failure>boom</failure></testcase></testsuite>`;
    const parsed = parseTestReporterOutput(xml);
    expect(parsed.format).toBe("junit");
    expect(parsed.cases.find((c) => c.status === "fail")).toBeTruthy();
  });

  it("parses go test -json lines", () => {
    const text = `{"Action":"pass","Package":"example","Test":"TestFoo"}\n{"Action":"fail","Package":"example","Test":"TestBar","Output":"assert"}`;
    const parsed = parseTestReporterOutput(text);
    expect(parsed.format).toBe("go-json");
    expect(parsed.cases.length).toBe(2);
  });

  it("builds stable test ids", () => {
    const a = stableTestId("tests/a.test.ts", "suite > case");
    const b = stableTestId("tests/a.test.ts", "suite > case");
    expect(a).toBe(b);
    expect(a).toHaveLength(16);
  });

  it("classifies mixed vitest failures", () => {
    const parsed = parseTestReporterOutput(MIXED_VITEST_JSON);
    expect(parsed.cases.filter((c) => c.status === "fail").length).toBe(3);
  });
});