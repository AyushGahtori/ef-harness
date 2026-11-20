import { EF_HARNESS_CONTRACT_STUB_NOT_IMPLEMENTED } from "./constants.js";
import { namedTypes, requireSignature, stubKindOf } from "./signature.js";
import type { ParsedParam, ParsedSignature } from "./signature.js";
import type { ContractEntrySpec, StubBehavior } from "./types.js";

export interface GeneratedStub {
  modulePath: string;
  source: string;
  exportName: string;
  async: boolean;
  kind: "function" | "route" | "job";
}

export interface GenerateOptions {
  behavior?: StubBehavior;
}

/**
 * Builds a type-valid TypeScript module from a pre-coding contract signature.
 * The default body throws `EF_HARNESS_CONTRACT_STUB_NOT_IMPLEMENTED`.
 * Async signatures return a rejected promise. Empty mode returns a typed empty value.
 */
export class ContractStubGenerator {
  generate(entry: ContractEntrySpec, options: GenerateOptions = {}): GeneratedStub {
    const parsed = requireSignature(entry);
    const behavior = options.behavior ?? "throw";
    const kind = stubKindOf(entry);
    const source = renderStub(entry, parsed, kind, behavior);
    return {
      modulePath: entry.modulePath.replaceAll("\\", "/"),
      source,
      exportName: parsed.name,
      async: parsed.async,
      kind,
    };
  }

  /** Insert stubs only for declared entries whose modules are absent on the base. */
  materializeMissing(
    files: Readonly<Record<string, string>>,
    entries: readonly ContractEntrySpec[],
    options: GenerateOptions = {},
  ): Record<string, string> {
    const next: Record<string, string> = {};
    for (const [file, contents] of Object.entries(files)) {
      next[file.replaceAll("\\", "/")] = contents;
    }
    for (const entry of entries) {
      const modulePath = entry.modulePath.replaceAll("\\", "/");
      if (next[modulePath] !== undefined) continue;
      next[modulePath] = this.generate(entry, options).source;
    }
    return next;
  }
}

function renderStub(
  entry: ContractEntrySpec,
  parsed: ParsedSignature,
  kind: GeneratedStub["kind"],
  behavior: StubBehavior,
): string {
  const lines: string[] = [];
  lines.push(
    `export const EF_HARNESS_CONTRACT_STUB_NOT_IMPLEMENTED = ${JSON.stringify(EF_HARNESS_CONTRACT_STUB_NOT_IMPLEMENTED)};`,
  );
  lines.push("");
  for (const typeName of namedTypes(parsed)) {
    lines.push(`export interface ${typeName} {`);
    lines.push("  readonly [key: string]: unknown;");
    lines.push("}");
    lines.push("");
  }
  if (kind === "route" && entry.route) {
    lines.push(`/** Route stub handler ${entry.route.method} ${entry.route.path} */`);
  } else if (kind === "job") {
    lines.push(`/** Job stub handler ${entry.jobName ?? parsed.name} */`);
  } else {
    lines.push("/** Contract stub. Present only so red-before-green can compile on the base. */");
  }
  const params = parsed.params.map(renderParam).join(", ");
  const asyncKeyword = parsed.async ? "async " : "";
  lines.push(
    `export ${asyncKeyword}function ${parsed.name}(${params}): ${parsed.returnType} {`,
  );
  lines.push(`  ${renderBody(parsed, behavior)}`);
  lines.push("}");
  lines.push("");
  return lines.join("\n");
}

function renderParam(param: ParsedParam): string {
  const rest = param.rest ? "..." : "";
  const optional = param.optional ? "?" : "";
  return `${rest}${param.name}${optional}: ${param.type}`;
}

function renderBody(parsed: ParsedSignature, behavior: StubBehavior): string {
  if (behavior === "empty") {
    return `return ${emptyExpression(parsed.returnType, parsed.async)};`;
  }
  if (parsed.async) {
    return `return Promise.reject(new Error(EF_HARNESS_CONTRACT_STUB_NOT_IMPLEMENTED));`;
  }
  return `throw new Error(EF_HARNESS_CONTRACT_STUB_NOT_IMPLEMENTED);`;
}

function emptyExpression(returnType: string, asyncFunction: boolean): string {
  const promise = /^Promise<([\s\S]+)>$/.exec(returnType.trim());
  if (promise?.[1]) {
    return `Promise.resolve(${emptyExpression(promise[1].trim(), false)})`;
  }
  if (asyncFunction) {
    return `Promise.resolve(${emptyValue(returnType)})`;
  }
  return emptyValue(returnType);
}

function emptyValue(returnType: string): string {
  if (returnType === "string") return `""`;
  if (returnType === "number") return "0";
  if (returnType === "boolean") return "false";
  if (returnType === "void" || returnType === "undefined") return "undefined";
  if (/\[\]$/.test(returnType) || /^(?:readonly\s+)?(?:Array|ReadonlyArray)</.test(returnType)) {
    return `[] as unknown as ${returnType}`;
  }
  return `undefined as unknown as ${returnType}`;
}
