import { describe, expect, it } from "vitest";
import { attributeVerificationFailure } from "../../src/runner/attribution.js";
import { parseCollectedCaseIds } from "../../src/runner/reporters.js";

describe("parseCollectedCaseIds", () => {
  it("parses custom oracle observations without trusting a bare pass", () => {
    const report = parseCollectedCaseIds(
      JSON.stringify({
        format: "ef-oracle@1",
        cases: [
          { checkId: "AC-31", status: "pass", observed: { quantity: 2 } },
          { checkId: "AC-32", status: "pass" },
        ],
      }),
    );
    expect(report.format).toBe("ef-oracle");
    expect(report.cases[0]).toMatchObject({ checkId: "AC-31", reporterStatus: "pass", hasObserved: true });
    expect(report.cases[1]).toMatchObject({ checkId: "AC-32", hasObserved: false });
  });

  it("parses Vitest JSON assertion results", () => {
    const report = parseCollectedCaseIds(
      JSON.stringify({
        testResults: [
          {
            assertionResults: [
              {
                fullName: "[AC-31] maps soup",
                status: "passed",
                meta: { checkId: "AC-31" },
                observed: { quantity: 2 },
              },
              { title: "[AC-32] later", status: "skipped" },
            ],
          },
        ],
      }),
    );
    expect(report.format).toBe("vitest");
    expect(report.cases.map((item) => [item.checkId, item.reporterStatus])).toEqual([
      ["AC-31", "pass"],
      ["AC-32", "skip"],
    ]);
  });

  it("parses nested Playwright JSON", () => {
    const report = parseCollectedCaseIds(
      JSON.stringify({
        suites: [
          {
            title: "kitchen",
            suites: [
              {
                specs: [
                  {
                    title: "print",
                    tests: [
                      {
                        status: "expected",
                        annotations: [{ type: "check_id", description: "AC-31" }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }),
    );
    expect(report.format).toBe("playwright");
    expect(report.cases).toEqual([
      { checkId: "AC-31", reporterStatus: "pass", hasObserved: false, observed: null },
    ]);
  });

  it("parses JUnit passes, failures, and skips", () => {
    const xml = [
      "<testsuite>",
      '<testcase name="[AC-31] visible" classname="kitchen"></testcase>',
      '<testcase name="zone"><property name="check_id" value="X-03"/><failure message="nope"/></testcase>',
      '<testcase name="[AC-32] held"><skipped/></testcase>',
      "</testsuite>",
    ].join("");
    const report = parseCollectedCaseIds(xml);
    expect(report.format).toBe("junit");
    expect(report.cases.map((item) => [item.checkId, item.reporterStatus])).toEqual([
      ["AC-31", "pass"],
      ["X-03", "fail"],
      ["AC-32", "skip"],
    ]);
  });

  it("parses TAP including skipped lines", () => {
    const tap = ["TAP version 14", "ok 1 - [AC-31] visible", "not ok 2 - X-03 zone", "ok 3 - [AC-32] later # SKIP"].join(
      "\n",
    );
    const report = parseCollectedCaseIds(tap);
    expect(report.format).toBe("tap");
    expect(report.cases.map((item) => [item.checkId, item.reporterStatus])).toEqual([
      ["AC-31", "pass"],
      ["X-03", "fail"],
      ["AC-32", "skip"],
    ]);
  });

  it("treats an empty reporter as zero collected cases", () => {
    expect(parseCollectedCaseIds("")).toEqual({ format: "empty", cases: [] });
    expect(parseCollectedCaseIds('{"ok":true,"message":"all passed"}')).toEqual({ format: "empty", cases: [] });
  });
});

describe("attributeVerificationFailure", () => {
  it("classifies the five non-pass owners", () => {
    expect(
      attributeVerificationFailure({
        status: "fail",
        checkId: "AC-31",
        visibility: "held_back",
        ruleId: "X-03",
        signals: null,
        flakyDisagreement: false,
      }),
    ).toMatchObject({
      attribution: "implementation",
      affectsWorkerQualityScore: true,
      burnsHiddenLadder: true,
      route: "hint_ladder",
    });

    expect(
      attributeVerificationFailure({
        status: "fail",
        checkId: "AC-UI",
        visibility: "visible",
        ruleId: null,
        signals: { contractMismatch: true, plainMessage: "No button named 'Print' on /kitchen" },
        flakyDisagreement: false,
      }).burnsHiddenLadder,
    ).toBe(false);

    expect(
      attributeVerificationFailure({
        status: "error",
        checkId: "AC-31",
        visibility: "visible",
        ruleId: null,
        signals: { bindingDefect: true },
        flakyDisagreement: false,
      }),
    ).toMatchObject({
      attribution: "binding_defect",
      affectsWorkerQualityScore: false,
      route: "task_author",
    });

    expect(
      attributeVerificationFailure({
        status: "error",
        checkId: "AC-31",
        visibility: "visible",
        ruleId: null,
        signals: { environmentFailure: "postgres_crash" },
        flakyDisagreement: false,
      }),
    ).toMatchObject({
      attribution: "environment",
      affectsWorkerQualityScore: false,
      burnsWorkerRetry: false,
      holdForEnvRecovery: true,
    });

    expect(
      attributeVerificationFailure({
        status: "unstable",
        checkId: "AC-31",
        visibility: "visible",
        ruleId: null,
        signals: null,
        flakyDisagreement: true,
      }),
    ).toMatchObject({
      attribution: "flaky_test",
      affectsWorkerQualityScore: false,
      requirementEffect: "unresolved",
      route: "test_owner",
    });
  });
});
