import { EvidenceLocatorSchema, type EvidenceLocator } from "@ef-harness/shared-contracts";
import { isRecord, type Json } from "./extraction/types.js";

/** Citations persisted by intake must match the landed `EvidenceLocatorSchema`. */
export function parseEvidenceLocator(value: unknown): EvidenceLocator {
  const parsed = EvidenceLocatorSchema.safeParse(value);
  if (!parsed.success) {
    const message = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "locator"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Evidence locator is not valid: ${message}`);
  }
  return parsed.data;
}

/** JSON object safe to store on an evidence row. Optional fields are omitted. */
export function evidenceLocatorJson(value: unknown): Json {
  const encoded = JSON.stringify(parseEvidenceLocator(value));
  const parsed: unknown = JSON.parse(encoded);
  return requireJson(parsed);
}

/** `#/paths/...` OpenAPI refs become RFC 6901 pointers the spec locator accepts. */
export function specEvidenceLocator(pointer: string): EvidenceLocator {
  const body = pointer.startsWith("#") ? pointer.slice(1) : pointer;
  const jsonPointer = body.startsWith("/") ? body : `/${body}`;
  return parseEvidenceLocator({ kind: "spec", pointer: jsonPointer });
}

function requireJson(value: unknown): Json {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => requireJson(item));
  if (isRecord(value)) {
    const copy: Record<string, Json> = {};
    for (const key of Object.keys(value)) {
      const child = value[key];
      if (child !== undefined) copy[key] = requireJson(child);
    }
    return copy;
  }
  throw new Error("Evidence locator did not serialize to JSON");
}
