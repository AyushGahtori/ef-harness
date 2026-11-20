import { cloneFields } from "./hash.js";
import { parseDocImportPayload } from "./schema.js";
import type { DocImportModel, DocImportRequest, DocImportV1 } from "./types.js";

export class DocImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocImportError";
  }
}

/**
 * Test double for `doc-import@1`.
 * Records the exact `(baseProse, editedProse, currentFields, validNodeIds)` invocation.
 */
export class FakeModelAdapter implements DocImportModel {
  readonly calls: DocImportRequest[] = [];

  constructor(private readonly respond: (input: DocImportRequest) => unknown) {}

  complete(input: DocImportRequest): DocImportV1 {
    const snapshot: DocImportRequest = {
      baseProse: input.baseProse,
      editedProse: input.editedProse,
      currentFields: cloneFields(input.currentFields),
      validNodeIds: [...input.validNodeIds],
    };
    this.calls.push(snapshot);
    const parsed = parseDocImportPayload(this.respond(snapshot));
    if (!parsed.ok) throw new DocImportError(parsed.message);
    return parsed.value;
  }
}
