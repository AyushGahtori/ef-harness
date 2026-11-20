export interface JsonSchema {
  readonly $ref?: string;
  readonly type?: string | readonly string[];
  readonly properties?: Readonly<Record<string, JsonSchema>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean | JsonSchema;
  readonly items?: JsonSchema;
  readonly enum?: readonly unknown[];
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly exclusiveMinimum?: number;
  readonly exclusiveMaximum?: number;
  readonly pattern?: string;
  readonly format?: string;
  readonly nullable?: boolean;
}

const SENSITIVE_KEYS = new Set([
  "password",
  "passwordhash",
  "passwd",
  "secret",
  "apikey",
  "api_key",
  "accesstoken",
  "access_token",
  "refreshtoken",
  "refresh_token",
  "ssn",
  "creditcard",
  "credit_card",
]);

export interface SchemaIssue {
  readonly path: string;
  readonly message: string;
  readonly sensitiveLeak: boolean;
}

function isSchema(value: unknown): value is JsonSchema {
  return typeof value === "object" && value !== null;
}

export function resolveSchema(
  schema: JsonSchema,
  components: Readonly<Record<string, JsonSchema>>,
  seen: Set<string> = new Set(),
): JsonSchema {
  if (!schema.$ref) return schema;
  const name = schema.$ref.startsWith("#/components/schemas/")
    ? schema.$ref.slice("#/components/schemas/".length)
    : schema.$ref;
  if (seen.has(name)) return {};
  const target = components[name];
  if (!target) return {};
  seen.add(name);
  return resolveSchema(target, components, seen);
}

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
}

function acceptsType(schema: JsonSchema, value: unknown): boolean {
  const declared = schema.type;
  const types = declared === undefined ? [] : Array.isArray(declared) ? [...declared] : [declared];
  if (schema.nullable && value === null) return true;
  if (types.length === 0) return true;
  const actual = typeOf(value);
  return types.some((type) => {
    if (type === "number" && actual === "integer") return true;
    if (type === "integer" && actual === "integer") return true;
    return type === actual;
  });
}

export function validateJsonSchema(
  schema: JsonSchema,
  value: unknown,
  components: Readonly<Record<string, JsonSchema>> = {},
  path = "$",
): SchemaIssue[] {
  const resolved = resolveSchema(schema, components);
  const issues: SchemaIssue[] = [];
  if (resolved.enum && !resolved.enum.some((item) => JSON.stringify(item) === JSON.stringify(value))) {
    issues.push({ path, message: "value is outside enum", sensitiveLeak: false });
  }
  if (!acceptsType(resolved, value)) {
    issues.push({ path, message: `expected ${String(resolved.type)}`, sensitiveLeak: false });
    return issues;
  }
  if (typeof value === "string") {
    if (resolved.minLength !== undefined && value.length < resolved.minLength) {
      issues.push({ path, message: `shorter than minLength ${resolved.minLength}`, sensitiveLeak: false });
    }
    if (resolved.maxLength !== undefined && value.length > resolved.maxLength) {
      issues.push({ path, message: `longer than maxLength ${resolved.maxLength}`, sensitiveLeak: false });
    }
    if (resolved.pattern !== undefined && !new RegExp(resolved.pattern).test(value)) {
      issues.push({ path, message: "does not match pattern", sensitiveLeak: false });
    }
    if (resolved.format === "date-time" && Number.isNaN(Date.parse(value))) {
      issues.push({ path, message: "is not a date-time", sensitiveLeak: false });
    }
  }
  if (typeof value === "number") {
    if (resolved.minimum !== undefined && value < resolved.minimum) {
      issues.push({ path, message: `below minimum ${resolved.minimum}`, sensitiveLeak: false });
    }
    if (resolved.maximum !== undefined && value > resolved.maximum) {
      issues.push({ path, message: `above maximum ${resolved.maximum}`, sensitiveLeak: false });
    }
    if (resolved.exclusiveMinimum !== undefined && value <= resolved.exclusiveMinimum) {
      issues.push({ path, message: "fails exclusiveMinimum", sensitiveLeak: false });
    }
    if (resolved.exclusiveMaximum !== undefined && value >= resolved.exclusiveMaximum) {
      issues.push({ path, message: "fails exclusiveMaximum", sensitiveLeak: false });
    }
  }
  if (Array.isArray(value) && resolved.items) {
    value.forEach((item, index) => {
      issues.push(...validateJsonSchema(resolved.items as JsonSchema, item, components, `${path}[${index}]`));
    });
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const properties = resolved.properties ?? {};
    for (const key of resolved.required ?? []) {
      if (record[key] === undefined) {
        issues.push({ path: `${path}.${key}`, message: "missing required property", sensitiveLeak: false });
      }
    }
    for (const [key, propertySchema] of Object.entries(properties)) {
      if (record[key] !== undefined) {
        issues.push(...validateJsonSchema(propertySchema, record[key], components, `${path}.${key}`));
      }
    }
    const extras = Object.keys(record).filter((key) => properties[key] === undefined);
    const additional = resolved.additionalProperties;
    for (const key of extras) {
      const sensitive = SENSITIVE_KEYS.has(key.toLowerCase());
      if (sensitive || additional === false) {
        issues.push({
          path: `${path}.${key}`,
          message: sensitive ? `undeclared sensitive field ${key}` : `unexpected property ${key}`,
          sensitiveLeak: sensitive,
        });
      } else if (isSchema(additional)) {
        issues.push(...validateJsonSchema(additional, record[key], components, `${path}.${key}`));
      }
    }
  }
  return issues;
}

export function sharedErrorFormatIssues(body: unknown): string[] {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return ["error body is not an object with code, message, and banner"];
  }
  const record = body as Record<string, unknown>;
  const issues: string[] = [];
  for (const key of ["code", "message", "banner"] as const) {
    const value = record[key];
    if (typeof value !== "string" || value.trim().length === 0) {
      issues.push(`error.${key} must be a non-empty string`);
    }
  }
  return issues;
}

export interface OpenApiDocument {
  readonly paths?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly components?: { readonly schemas?: Readonly<Record<string, JsonSchema>> };
}

export function responseSchemaFor(
  document: OpenApiDocument,
  method: string,
  path: string,
  status: number,
): JsonSchema | null {
  const operation = document.paths?.[path]?.[method.toLowerCase()];
  if (!operation || typeof operation !== "object") return null;
  const responses = (operation as { responses?: Record<string, unknown> }).responses;
  const direct = responses?.[String(status)] ?? responses?.default;
  if (!direct || typeof direct !== "object") return null;
  const content = (direct as { content?: Record<string, { schema?: JsonSchema }> }).content;
  return content?.["application/json"]?.schema ?? null;
}

export function requestSchemaFor(
  document: OpenApiDocument,
  method: string,
  path: string,
): JsonSchema | null {
  const operation = document.paths?.[path]?.[method.toLowerCase()];
  if (!operation || typeof operation !== "object") return null;
  const body = (operation as { requestBody?: { content?: Record<string, { schema?: JsonSchema }> } })
    .requestBody;
  return body?.content?.["application/json"]?.schema ?? null;
}

export interface DerivedInvalidInput {
  readonly id: string;
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
  readonly expectStatus: number;
}

export function deriveBoundaryCases(
  document: OpenApiDocument,
  method: string,
  path: string,
  components: Readonly<Record<string, JsonSchema>>,
): DerivedInvalidInput[] {
  const raw = requestSchemaFor(document, method, path);
  if (!raw) return [];
  const schema = resolveSchema(raw, components);
  if (schema.type !== "object" || !schema.properties) return [];
  const properties = schema.properties;
  const required = schema.required ?? [];
  const baseline: Record<string, unknown> = {};
  for (const [key, property] of Object.entries(properties)) {
    const resolved = resolveSchema(property, components);
    if (resolved.type === "string") baseline[key] = "ok";
    else if (resolved.type === "integer" || resolved.type === "number") {
      baseline[key] = resolved.minimum ?? 1;
    } else if (resolved.type === "boolean") baseline[key] = true;
  }
  const cases: DerivedInvalidInput[] = [];
  for (const key of required) {
    const body = { ...baseline };
    delete body[key];
    cases.push({ id: `missing-${key}`, method, path, body, expectStatus: 400 });
  }
  for (const [key, property] of Object.entries(properties)) {
    const resolved = resolveSchema(property, components);
    if (resolved.type === "string") {
      if ((resolved.minLength ?? 0) >= 1) {
        cases.push({
          id: `empty-${key}`,
          method,
          path,
          body: { ...baseline, [key]: "" },
          expectStatus: 400,
        });
      }
      if (resolved.maxLength !== undefined) {
        cases.push({
          id: `too-long-${key}`,
          method,
          path,
          body: { ...baseline, [key]: "x".repeat(resolved.maxLength + 1) },
          expectStatus: 400,
        });
      }
      cases.push({
        id: `wrong-type-${key}`,
        method,
        path,
        body: { ...baseline, [key]: 1 },
        expectStatus: 400,
      });
    }
    if (resolved.type === "integer" || resolved.type === "number") {
      if (resolved.minimum !== undefined) {
        cases.push({
          id: `below-min-${key}`,
          method,
          path,
          body: { ...baseline, [key]: resolved.minimum - 1 },
          expectStatus: 400,
        });
      }
      if (resolved.maximum !== undefined) {
        cases.push({
          id: `above-max-${key}`,
          method,
          path,
          body: { ...baseline, [key]: resolved.maximum + 1 },
          expectStatus: 400,
        });
      }
    }
  }
  return cases;
}
