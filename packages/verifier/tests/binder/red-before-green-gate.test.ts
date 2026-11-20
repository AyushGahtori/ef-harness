import { describe, expect, it } from "vitest";
import {
  BindingDefectError,
  RedBeforeGreenGate,
  kernelRun,
} from "../../src/binder/index.js";
import { PRINT_MODULE, acceptanceCheck, implementedPrint, printEntry } from "./fixtures.js";

const gate = new RedBeforeGreenGate();

describe("RedBeforeGreenGate", () => {
  it("locks a behavioral assertion failure and a stub marker", async () => {
    const mismatch = await gate.evaluate({
      check: acceptanceCheck({ expected: [{ label: "Soup", quantity: 2 }] }),
      baseFiles: { [PRINT_MODULE]: implementedPrint("[]") },
      run: kernelRun(acceptanceCheck({ expected: [{ label: "Soup", quantity: 2 }] })),
    });
    expect(mismatch.locked).toBe(true);
    expect(mismatch.classification).toBe("valid_red");
    expect(mismatch.reason).toBe("assertion");

    const missing = acceptanceCheck({ expected: [{ label: "Soup", quantity: 2 }] });
    const stubbed = await gate.lock({
      check: missing,
      baseFiles: {},
      run: kernelRun(missing),
    });
    expect(stubbed.locked).toBe(true);
    expect(stubbed.reason).toBe("stub_marker");
    expect(stubbed.message).toContain("EF_HARNESS_CONTRACT_STUB_NOT_IMPLEMENTED");
  });

  it("rejects a false green, including a no-op assertion and a forgotten await", async () => {
    const check = acceptanceCheck({
      expected: [{ label: "Soup", quantity: 2 }],
      adaptsInternalState: false,
    });
    const decision = await gate.evaluate({
      check,
      baseFiles: { [PRINT_MODULE]: implementedPrint() },
      run: kernelRun(check),
    });
    expect(decision.locked).toBe(false);
    expect(decision.classification).toBe("false_green");
    expect(decision.defect).toBeInstanceOf(BindingDefectError);
    expect(decision.attribution).toBe("binding_defect");
    expect(decision.routedTo).toBe("task_author");
    expect(decision.workerPenalized).toBe(false);
    await expect(
      gate.lock({
        check,
        baseFiles: { [PRINT_MODULE]: implementedPrint() },
        run: kernelRun(check),
      }),
    ).rejects.toBeInstanceOf(BindingDefectError);

    const noop = await gate.evaluate({
      check,
      baseFiles: {},
      run: () => {
        if (true !== true) {
          throw new Error("unreachable");
        }
      },
    });
    expect(noop.classification).toBe("false_green");

    const forgottenAwait = await gate.evaluate({
      check,
      baseFiles: {},
      run: (runtime) => {
        void runtime.invoke().catch(() => undefined);
      },
    });
    expect(forgottenAwait.classification).toBe("false_green");
    expect(forgottenAwait.locked).toBe(false);
  });

  it("rejects syntax errors, missing modules, and TypeScript compile errors", async () => {
    const check = acceptanceCheck();
    const syntax = await gate.evaluate({
      check,
      baseFiles: { [PRINT_MODULE]: "export function toPrintRows( {\n" },
      run: kernelRun(check),
    });
    expect(syntax.locked).toBe(false);
    expect(syntax.classification).toBe("non_behavioral");
    expect(syntax.reason).toBe("syntax");
    expect(syntax.defect).toBeInstanceOf(BindingDefectError);
    await expect(
      gate.lock({
        check,
        baseFiles: { [PRINT_MODULE]: "export function toPrintRows( {\n" },
        run: kernelRun(check),
      }),
    ).rejects.toMatchObject({ code: "syntax", workerPenalized: false });

    const missingModule = await gate.evaluate({
      check,
      baseFiles: {
        [PRINT_MODULE]: `import { internalHelper } from "./internal-helper";
export interface Totals { readonly [key: string]: unknown }
export function toPrintRows(totals: Totals): Totals {
  return internalHelper(totals);
}
`,
      },
      run: kernelRun(check),
    });
    expect(missingModule.reason).toBe("module_not_found");
    expect(missingModule.locked).toBe(false);

    const typed = await gate.evaluate({
      check,
      baseFiles: {
        [PRINT_MODULE]: `export function toPrintRows(_totals: string): string {
  return 1;
}
`,
      },
      run: kernelRun(check),
    });
    expect(typed.reason).toBe("typescript");
    expect(typed.classification).toBe("non_behavioral");
  });

  it("requires green-on-base for preservation regressions", async () => {
    const passing = acceptanceCheck({
      isPreservationRegression: true,
      expected: [{ label: "Soup", quantity: 2 }],
    });
    const green = await gate.evaluate({
      check: passing,
      baseFiles: { [PRINT_MODULE]: implementedPrint() },
      run: kernelRun(passing),
    });
    expect(green.locked).toBe(true);
    expect(green.classification).toBe("preservation_green");
    expect(green.attribution).toBe("none");

    const failing = acceptanceCheck({
      isPreservationRegression: true,
      expected: [{ label: "Soup", quantity: 2 }],
    });
    const red = await gate.evaluate({
      check: failing,
      baseFiles: { [PRINT_MODULE]: implementedPrint("[]") },
      run: kernelRun(failing),
    });
    expect(red.locked).toBe(false);
    expect(red.classification).toBe("preservation_failed");
    expect(red.defect?.code).toBe("preservation_failed");
    expect(red.routedTo).toBe("task_author");
  });

  it("still supplies a stub when the entry file does not exist yet", async () => {
    const check = acceptanceCheck({
      entries: [printEntry({ signature: "export async function toPrintRows(totals: Totals): Promise<PrintRow[]>" })],
      expected: [{ label: "Soup", quantity: 2 }],
    });
    const decision = await gate.evaluate({
      check,
      baseFiles: {},
      run: kernelRun(check),
    });
    expect(decision.reason).toBe("stub_marker");
    expect(decision.locked).toBe(true);
  });
});
