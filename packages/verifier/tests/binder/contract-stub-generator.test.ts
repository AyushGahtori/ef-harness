import { describe, expect, it } from "vitest";
import {
  ContractStubGenerator,
  EF_HARNESS_CONTRACT_STUB_NOT_IMPLEMENTED,
  InProcessCleanVerifierPort,
  compileCleanTree,
} from "../../src/binder/index.js";
import {
  ASYNC_PRINT_SIGNATURE,
  JOB_SIGNATURE,
  PRINT_MODULE,
  PRINT_SIGNATURE,
  ROUTE_SIGNATURE,
  printEntry,
} from "./fixtures.js";

describe("ContractStubGenerator", () => {
  const generator = new ContractStubGenerator();
  const port = new InProcessCleanVerifierPort();

  it("generates a type-valid sync function that throws the stub marker", async () => {
    const stub = generator.generate(printEntry());
    expect(stub.modulePath).toBe(PRINT_MODULE);
    expect(stub.source).toContain(PRINT_SIGNATURE.replace("export function toPrintRows(totals: Totals): PrintRow[]", "export function toPrintRows(totals: Totals): PrintRow[]"));
    expect(stub.source).toContain("throw new Error(EF_HARNESS_CONTRACT_STUB_NOT_IMPLEMENTED)");
    expect(stub.source).toContain(`"${EF_HARNESS_CONTRACT_STUB_NOT_IMPLEMENTED}"`);
    expect(stub.async).toBe(false);
    const compiled = compileCleanTree({ [stub.modulePath]: stub.source });
    expect(compiled.ok).toBe(true);
    await expect(
      port.invoke({
        files: { [stub.modulePath]: stub.source },
        modulePath: stub.modulePath,
        exportName: "toPrintRows",
        args: [{ rows: [] }],
      }),
    ).rejects.toThrow(EF_HARNESS_CONTRACT_STUB_NOT_IMPLEMENTED);
  });

  it("generates an async function that rejects with the stub marker", async () => {
    const stub = generator.generate(
      printEntry({ signature: ASYNC_PRINT_SIGNATURE, exportName: "toPrintRows" }),
    );
    expect(stub.source).toContain("export async function toPrintRows");
    expect(stub.source).toContain("return Promise.reject(new Error(EF_HARNESS_CONTRACT_STUB_NOT_IMPLEMENTED))");
    expect(compileCleanTree({ [stub.modulePath]: stub.source }).ok).toBe(true);
    await expect(
      port.invoke({
        files: { [stub.modulePath]: stub.source },
        modulePath: stub.modulePath,
        exportName: "toPrintRows",
        args: [{}],
      }),
    ).rejects.toThrow(EF_HARNESS_CONTRACT_STUB_NOT_IMPLEMENTED);
  });

  it("generates a route stub handler and a job stub handler", async () => {
    const route = generator.generate(
      printEntry({
        kind: "route",
        name: "POST /kitchen/print",
        exportName: "postKitchenPrint",
        signature: ROUTE_SIGNATURE,
        modulePath: "src/routes/kitchen-print.ts",
        stubKind: "route",
        route: { method: "POST", path: "/kitchen/print" },
      }),
    );
    expect(route.kind).toBe("route");
    expect(route.source).toContain("Route stub handler POST /kitchen/print");
    expect(compileCleanTree({ [route.modulePath]: route.source }).ok).toBe(true);
    await expect(
      port.invoke({
        files: { [route.modulePath]: route.source },
        modulePath: route.modulePath,
        exportName: "postKitchenPrint",
        args: [{}],
      }),
    ).rejects.toThrow(EF_HARNESS_CONTRACT_STUB_NOT_IMPLEMENTED);

    const job = generator.generate(
      printEntry({
        kind: "exported_function",
        name: "runNightlyClose",
        exportName: "runNightlyClose",
        signature: JOB_SIGNATURE,
        modulePath: "src/jobs/nightly-close.ts",
        stubKind: "job",
        jobName: "nightly-close",
      }),
    );
    expect(job.source).toContain("Job stub handler nightly-close");
    expect(job.source).toContain("export async function runNightlyClose");
    expect(compileCleanTree({ [job.modulePath]: job.source }).ok).toBe(true);
  });

  it("can return an empty value instead of throwing", async () => {
    const stub = generator.generate(printEntry(), { behavior: "empty" });
    expect(stub.source).toContain("return [] as unknown as PrintRow[]");
    expect(compileCleanTree({ [stub.modulePath]: stub.source }).ok).toBe(true);
    await expect(
      port.invoke({
        files: { [stub.modulePath]: stub.source },
        modulePath: stub.modulePath,
        exportName: "toPrintRows",
        args: [{}],
      }),
    ).resolves.toEqual([]);
  });

  it("materializes a stub only when the declared module is missing", () => {
    const existing = "export function toPrintRows() { return []; }\n";
    const files = generator.materializeMissing(
      { [PRINT_MODULE]: existing },
      [printEntry()],
    );
    expect(files[PRINT_MODULE]).toBe(existing);
    const filled = generator.materializeMissing({}, [printEntry()]);
    expect(filled[PRINT_MODULE]).toContain(EF_HARNESS_CONTRACT_STUB_NOT_IMPLEMENTED);
  });
});
