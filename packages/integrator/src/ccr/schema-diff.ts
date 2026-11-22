import { diffEndpoints, diffExports, diffShapes, diffTenant, makeOp, type ApiEndpoint, type ShapeField } from "./ops.js";
import type { DiffOp } from "./types.js";

export function diffOpenApi(before: string, after: string): DiffOp[] {
  const left = readOpenApi(before);
  const right = readOpenApi(after);
  if (!left || !right) return [];
  return [
    ...diffEndpoints(left.endpoints, right.endpoints),
    ...diffContractFields(left.fields, right.fields),
    ...diffTenant(left.tenant, right.tenant),
    ...diffAuth(left.auth, right.auth),
  ];
}

export function diffJsonSchema(before: string, after: string): DiffOp[] {
  const left = readJsonSchema(before);
  const right = readJsonSchema(after);
  if (!left || !right) return [];
  return diffContractFields(left, right);
}

export function diffTypeScript(before: string, after: string): DiffOp[] {
  if (before.trim() === after.trim()) return [];
  if (before.trim().length === 0 && after.trim().length === 0) return [];
  const left = readTypeScript(before);
  const right = readTypeScript(after);
  const shared = new Set(
    left.exports.map((item) => item.name).filter((name) => right.exports.some((item) => item.name === name)),
  );
  return [
    ...diffExports(left.exports, right.exports),
    ...diffShapes(
      left.fields.filter((field) => shared.has(ownerName(field.id))),
      right.fields.filter((field) => shared.has(ownerName(field.id))),
    ),
  ];
}

function diffContractFields(before: readonly ShapeField[], after: readonly ShapeField[]): DiffOp[] {
  const beforeOwners = new Set(before.map((field) => ownerName(field.id)));
  const afterOwners = new Set(after.map((field) => ownerName(field.id)));
  const ops: DiffOp[] = [];
  for (const name of afterOwners) {
    if (!beforeOwners.has(name)) ops.push(makeOp("add_export", false, `add schema ${name}`, { name, kind: "schema" }));
  }
  for (const name of beforeOwners) {
    if (!afterOwners.has(name)) ops.push(makeOp("drop_export", true, `remove schema ${name}`, { name, kind: "schema" }));
  }
  return [
    ...ops,
    ...diffShapes(
      before.filter((field) => afterOwners.has(ownerName(field.id))),
      after.filter((field) => beforeOwners.has(ownerName(field.id))),
    ),
  ];
}

function ownerName(id: string): string {
  const index = id.indexOf(".");
  return index === -1 ? id : id.slice(0, index);
}

function diffAuth(before: string, after: string): DiffOp[] {
  if (before === after) return [];
  return [
    {
      signature: `auth_change|from=${before},to=${after}`,
      kind: "auth_change",
      breaking: true,
      detail: `auth semantics changed from ${before || "(none)"} to ${after || "(none)"}`,
      payload: { from: before, to: after },
    },
  ];
}

interface OpenApiRead {
  readonly endpoints: readonly ApiEndpoint[];
  readonly fields: readonly ShapeField[];
  readonly tenant: string;
  readonly auth: string;
}

function readOpenApi(text: string): OpenApiRead | null {
  const value = parseJson(text);
  if (!isRecord(value)) return null;
  if (!isRecord(value.paths) && !isRecord(value.components)) return null;
  const components = isRecord(value.components) ? value.components : {};
  const schemas = isRecord(components.schemas) ? components.schemas : {};
  const fields: ShapeField[] = [];
  for (const [name, schema] of Object.entries(schemas)) {
    fields.push(...readSchemaFields(schema, name, { outputOnly: flag(schema, "x-output-only"), uiVariant: /variant/i.test(name) }));
  }
  const schemes = isRecord(components.securitySchemes) ? Object.keys(components.securitySchemes).sort().join(",") : "";
  const endpoints: ApiEndpoint[] = [];
  if (isRecord(value.paths)) {
    for (const [path, methods] of Object.entries(value.paths)) {
      if (!isRecord(methods)) continue;
      for (const [method, operation] of Object.entries(methods)) {
        if (!isRecord(operation) || method.startsWith("x-")) continue;
        const id = `${method.toUpperCase()} ${path}`;
        const responses = isRecord(operation.responses) ? operation.responses : {};
        const statuses = Object.keys(responses).sort();
        const auth = canonical(operation.security ?? value.security ?? []);
        const errorShape = errorEnvelope(schemas, responses);
        endpoints.push({ id, statuses, auth, errorShape });
        const request = requestSchema(operation);
        if (request && !("$ref" in request)) {
          fields.push(...readSchemaFields(request, `request:${path}`, { outputOnly: false, uiVariant: false }));
        }
      }
    }
  }
  return {
    endpoints,
    fields,
    tenant: typeof value["x-tenant"] === "string" ? value["x-tenant"] : "",
    auth: schemes,
  };
}

function readJsonSchema(text: string): ShapeField[] | null {
  const value = parseJson(text);
  if (!isRecord(value)) return null;
  if (isRecord(value.properties) || Array.isArray(value.enum) || typeof value.type === "string") {
    const name = typeof value.title === "string" ? value.title : "Schema";
    return readSchemaFields(value, name, { outputOnly: flag(value, "x-output-only"), uiVariant: /variant/i.test(name) });
  }
  const fields: ShapeField[] = [];
  let named = 0;
  for (const [name, schema] of Object.entries(value)) {
    if (!isRecord(schema)) continue;
    if (!isRecord(schema.properties) && !Array.isArray(schema.enum) && typeof schema.type !== "string") continue;
    named += 1;
    fields.push(
      ...readSchemaFields(schema, name, { outputOnly: flag(schema, "x-output-only"), uiVariant: /variant/i.test(name) }),
    );
  }
  return named > 0 ? fields : null;
}

function readTypeScript(text: string): { readonly exports: { name: string; kind: string }[]; readonly fields: ShapeField[] } {
  const exports: { name: string; kind: string }[] = [];
  const fields: ShapeField[] = [];
  for (const match of text.matchAll(/export\s+interface\s+([A-Za-z_][\w]*)\s*\{([^}]*)\}/g)) {
    const name = match[1];
    const body = match[2];
    if (!name || body === undefined) continue;
    exports.push({ name, kind: "interface" });
    const uiVariant = /variant|primitive/i.test(name);
    const outputOnly = /output/i.test(name);
    for (const prop of body.matchAll(/([A-Za-z_][\w]*)(\?)?\s*:\s*([^;\n]+)/g)) {
      const propName = prop[1];
      const type = prop[3]?.trim() ?? "unknown";
      if (!propName) continue;
      const enums = stringUnion(type);
      fields.push({
        id: `${name}.${propName}`,
        type: enums.length > 0 ? "string" : type,
        required: prop[2] !== "?",
        enums,
        outputOnly,
        uiVariant,
        constraints: "",
      });
    }
  }
  for (const match of text.matchAll(/export\s+type\s+([A-Za-z_][\w]*)\s*=\s*([^;]+);/g)) {
    const name = match[1];
    const body = match[2]?.trim() ?? "";
    if (!name) continue;
    exports.push({ name, kind: "type" });
    const enums = stringUnion(body);
    if (enums.length > 0) {
      fields.push({
        id: name,
        type: "string",
        required: true,
        enums,
        outputOnly: /output/i.test(name),
        uiVariant: /variant|primitive/i.test(name),
        constraints: "",
      });
    }
  }
  for (const match of text.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z_][\w]*)/g)) {
    if (match[1]) exports.push({ name: match[1], kind: "function" });
  }
  for (const match of text.matchAll(/export\s+const\s+([A-Za-z_][\w]*)/g)) {
    if (match[1]) exports.push({ name: match[1], kind: "const" });
  }
  return { exports, fields };
}

function readSchemaFields(
  schema: unknown,
  name: string,
  flags: { readonly outputOnly: boolean; readonly uiVariant: boolean },
): ShapeField[] {
  if (!isRecord(schema)) return [];
  const outputOnly = flags.outputOnly || flag(schema, "x-output-only");
  const uiVariant = flags.uiVariant || flag(schema, "x-ui-variant") || /variant/i.test(name);
  const fields: ShapeField[] = [];
  if (Array.isArray(schema.enum)) {
    fields.push({
      id: name,
      type: typeof schema.type === "string" ? schema.type : "string",
      required: true,
      enums: schema.enum.filter((item): item is string => typeof item === "string"),
      outputOnly,
      uiVariant,
      constraints: constraintText(schema),
    });
  }
  if (!isRecord(schema.properties)) return fields;
  const required = new Set(Array.isArray(schema.required) ? schema.required.filter((item): item is string => typeof item === "string") : []);
  for (const [prop, value] of Object.entries(schema.properties)) {
    if (!isRecord(value)) continue;
    const enums = Array.isArray(value.enum) ? value.enum.filter((item): item is string => typeof item === "string") : [];
    fields.push({
      id: `${name}.${prop}`,
      type: typeof value.type === "string" ? value.type : enums.length > 0 ? "string" : "unknown",
      required: required.has(prop),
      enums,
      outputOnly: outputOnly || flag(value, "x-output-only"),
      uiVariant: uiVariant || flag(value, "x-ui-variant"),
      constraints: constraintText(value),
    });
  }
  return fields;
}

function constraintText(schema: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const key of ["minLength", "maxLength", "minimum", "maximum", "minItems", "maxItems", "format", "pattern"]) {
    const value = schema[key];
    if (typeof value === "string" || typeof value === "number") parts.push(`${key.toLowerCase()}=${String(value)}`);
  }
  return parts.join(",");
}

function requestSchema(operation: Record<string, unknown>): Record<string, unknown> | null {
  if (!isRecord(operation.requestBody)) return null;
  const content = isRecord(operation.requestBody.content) ? operation.requestBody.content : null;
  const json = content && isRecord(content["application/json"]) ? content["application/json"] : null;
  return json && isRecord(json.schema) ? json.schema : null;
}

function errorEnvelope(schemas: Record<string, unknown>, responses: Record<string, unknown>): string {
  const named = schemas.Error ?? schemas.ErrorEnvelope;
  if (named) return canonical(named);
  const errors: unknown[] = [];
  for (const [status, response] of Object.entries(responses)) {
    if (!status.startsWith("4") && !status.startsWith("5")) continue;
    errors.push(response);
  }
  return canonical(errors);
}

function stringUnion(type: string): string[] {
  const values = [...type.matchAll(/"([^"]+)"|'([^']+)'/g)].map((match) => match[1] ?? match[2] ?? "");
  if (values.length === 0) return [];
  if (!/^[\s"'|A-Za-z0-9_-]+$/.test(type)) return [];
  return values.filter((value) => value.length > 0);
}

function flag(schema: unknown, key: string): boolean {
  return isRecord(schema) && schema[key] === true;
}

function parseJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonical(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sortValue(item));
  if (!isRecord(value)) return value;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) sorted[key] = sortValue(value[key]);
  return sorted;
}

export function collectedFormats(input: {
  readonly sql: boolean;
  readonly openapi: boolean;
  readonly jsonSchema: boolean;
  readonly typescript: boolean;
}): string[] {
  const formats: string[] = [];
  if (input.sql) formats.push("sql");
  if (input.openapi) formats.push("openapi");
  if (input.jsonSchema) formats.push("jsonSchema");
  if (input.typescript) formats.push("typescript");
  return formats;
}
