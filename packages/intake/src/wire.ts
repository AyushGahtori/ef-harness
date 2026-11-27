import type { CasBlobStore as DbCasBlobStore } from "@ef-harness/db";
import type { SandboxedDocumentConverterOptions } from "./converters/sandboxed-document-converter.js";
import { SandboxedDocumentConverter } from "./converters/sandboxed-document-converter.js";
import { DbCasBlobStoreAdapter } from "./converters/ports/db-cas-store.js";
import { bindHarnessRun, HarnessRunSandboxRunner, type HarnessRunBinding } from "./converters/ports/harness-run-runner.js";

export interface HarnessDocumentConverter {
  readonly converter: SandboxedDocumentConverter;
  readonly harness: HarnessRunBinding;
}

/**
 * Production converter: raw bytes go to `CasBlobStore` and the worker runs
 * inside `HarnessRunEngine`. Unit tests inject their own runner instead.
 */
export function createHarnessDocumentConverter(options: {
  readonly cas: DbCasBlobStore;
  readonly holderId: string;
  readonly artifactRoot: string;
}): HarnessDocumentConverter {
  const harness = bindHarnessRun(options.artifactRoot);
  const converterOptions: SandboxedDocumentConverterOptions = {
    cas: new DbCasBlobStoreAdapter(options.cas, options.holderId),
    runner: new HarnessRunSandboxRunner(harness.engine, harness.artifacts),
  };
  return {
    converter: new SandboxedDocumentConverter(converterOptions),
    harness,
  };
}
