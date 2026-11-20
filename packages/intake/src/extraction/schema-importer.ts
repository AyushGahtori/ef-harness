import type { KnowledgeGraphPort } from "./graph.js";
import { isRecord, type ImportedContract, type ImportedEntity, type ImportedField, type Json, type SchemaFormat, type SchemaImportResult } from "./types.js";
import { lineOfIndex, parseYaml, YamlSyntaxError } from "./yaml.js";

const HTTP_METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"] as const;
const PRISMA_SCALARS = new Set(["String", "Int", "BigInt", "Float", "Decimal", "Boolean", "DateTime", "Json", "Bytes"]);

export class SchemaImportError extends Error {
  readonly line: number | null;

  constructor(message: string, line: number | null) {
    super(message);
    this.name = "SchemaImportError";
    this.line = line;
  }
}

function pointerEscape(segment: string): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

function pointerUnescape(segment: string): string {
  return segment.replaceAll("~1", "/").replaceAll("~0", "~");
}

function refName(pointer: string): string {
  const parts = pointer.split("/");
  return pointerUnescape(parts[parts.length - 1] ?? pointer);
}

function getPointer(root: unknown, pointer: string): unknown {
  const body = pointer.startsWith("#") ? pointer.slice(1) : pointer;
  if (body === "" || body === "/") return root;
  if (!body.startsWith("/")) return undefined;
  let current: unknown = root;
  for (const segment of body.split("/").slice(1).map(pointerUnescape)) {
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
    } else if (isRecord(current)) {
      current = current[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

function enumValues(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const values: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && item.trim()) values.push(item);
    else if (typeof item === "number" || typeof item === "boolean") values.push(String(item));
  }
  return values;
}

function typeName(schema: Record<string, unknown>): string {
  if (typeof schema.type === "string") return schema.type;
  if (Array.isArray(schema.type)) {
    return schema.type.filter((item): item is string => typeof item === "string").join("|");
  }
  if (typeof schema.$ref === "string") return refName(schema.$ref);
  return "object";
}

function fieldOf(input: {
  name: string;
  type: string;
  required: boolean;
  enumValues?: readonly string[];
  nullable?: boolean;
  ref?: string | null;
  circular?: boolean;
}): ImportedField {
  return {
    name: input.name,
    type: input.type,
    required: input.required,
    enumValues: input.enumValues ?? [],
    nullable: input.nullable ?? false,
    ref: input.ref ?? null,
    circular: input.circular ?? false,
  };
}

function readProperty(
  name: string,
  property: unknown,
  required: boolean,
  stack: readonly string[],
): ImportedField {
  if (!isRecord(property)) return fieldOf({ name, type: "unknown", required });
  if (typeof property.$ref === "string") {
    return fieldOf({
      name,
      type: refName(property.$ref),
      required,
      ref: property.$ref,
      circular: stack.includes(property.$ref),
    });
  }
  if (isRecord(property.items) && typeof property.items.$ref === "string") {
    return fieldOf({
      name,
      type: "array",
      required,
      nullable: property.nullable === true,
      ref: property.items.$ref,
      circular: stack.includes(property.items.$ref),
    });
  }
  const nullable = property.nullable === true || (Array.isArray(property.type) && property.type.includes("null"));
  return fieldOf({
    name,
    type: typeName(property),
    required,
    enumValues: enumValues(property.enum),
    nullable,
  });
}

function readFields(schema: unknown, root: unknown, stack: readonly string[]): ImportedField[] {
  if (!isRecord(schema)) return [];
  if (typeof schema.$ref === "string") {
    if (stack.includes(schema.$ref)) {
      return [fieldOf({ name: refName(schema.$ref), type: refName(schema.$ref), required: false, ref: schema.$ref, circular: true })];
    }
    const target = getPointer(root, schema.$ref);
    return readFields(target, root, [...stack, schema.$ref]);
  }
  const requiredNames = Array.isArray(schema.required)
    ? schema.required.filter((item): item is string => typeof item === "string")
    : [];
  const required = new Set(requiredNames);
  if (!isRecord(schema.properties)) return [];
  return Object.entries(schema.properties).map(([name, property]) => readProperty(name, property, required.has(name), stack));
}

function entityFrom(
  name: string,
  schema: unknown,
  root: unknown,
  pointer: string,
  draft: string | null,
  sourceName: string,
  enumList: readonly string[] = [],
): ImportedEntity {
  const record = isRecord(schema) ? schema : {};
  return {
    role: "entity",
    name,
    basis: "observed",
    fields: readFields(schema, root, [pointer]),
    enumValues: enumList.length > 0 ? enumList : enumValues(record.enum),
    pointer,
    draft,
    sourceName,
  };
}

function defined<T>(items: readonly (T | null)[]): T[] {
  return items.filter((item): item is T => item !== null);
}

function readParameters(pathItem: Record<string, unknown>, operation: Record<string, unknown>, root: unknown): ImportedField[] {
  const lists = [pathItem.parameters, operation.parameters];
  const params: unknown[] = [];
  for (const list of lists) {
    if (Array.isArray(list)) params.push(...list);
  }
  return defined(
    params.map((param) => {
      if (!isRecord(param)) return null;
      const resolved = typeof param.$ref === "string" ? getPointer(root, param.$ref) : param;
      if (!isRecord(resolved) || typeof resolved.name !== "string") return null;
      const location = typeof resolved.in === "string" ? resolved.in : "";
      const schema = isRecord(resolved.schema) ? resolved.schema : {};
      const required = resolved.required === true || (resolved.required === undefined && location === "path");
      const ref = typeof schema.$ref === "string" ? schema.$ref : null;
      return fieldOf({
        name: resolved.name,
        type: ref ? refName(ref) : typeName(schema),
        required,
        enumValues: enumValues(schema.enum),
        nullable: schema.nullable === true,
        ref,
      });
    }),
  );
}

function readRequest(operation: Record<string, unknown>, root: unknown): ImportedField[] {
  if (!isRecord(operation.requestBody)) return [];
  const content = isRecord(operation.requestBody.content) ? operation.requestBody.content : null;
  if (!content) return [];
  const json = content["application/json"];
  const media = isRecord(json) ? json : Object.values(content).find(isRecord);
  if (!isRecord(media)) return [];
  return readFields(media.schema, root, []);
}

function importOpenApi(root: unknown, filename: string, versionHint: string | null): { entities: ImportedEntity[]; contracts: ImportedContract[] } {
  if (!isRecord(root) || typeof root.openapi !== "string") {
    throw new SchemaImportError("OpenAPI document needs an openapi version.", versionHint === null ? null : Number(versionHint));
  }
  if (!/^3\.(0|1)(\.|$)/.test(root.openapi)) {
    throw new SchemaImportError(`Unsupported OpenAPI version "${root.openapi}".`, null);
  }
  if (!isRecord(root.paths)) throw new SchemaImportError("OpenAPI paths must be an object.", null);
  const draft = root.openapi.startsWith("3.1") ? "openapi-3.1" : "openapi-3.0";
  const schemas = isRecord(root.components) && isRecord(root.components.schemas) ? root.components.schemas : {};
  const entities = Object.entries(schemas).map(([name, schema]) =>
    entityFrom(name, schema, root, `#/components/schemas/${pointerEscape(name)}`, draft, filename),
  );
  const contracts: ImportedContract[] = [];
  for (const [path, item] of Object.entries(root.paths)) {
    if (!isRecord(item)) continue;
    const pathItem = typeof item.$ref === "string" && isRecord(getPointer(root, item.$ref)) ? (getPointer(root, item.$ref) as Record<string, unknown>) : item;
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!isRecord(operation)) continue;
      const responses = isRecord(operation.responses) ? operation.responses : {};
      contracts.push({
        role: "contract",
        name: typeof operation.operationId === "string" ? operation.operationId : `${method.toUpperCase()} ${path}`,
        basis: "observed",
        method: method.toUpperCase(),
        path,
        statusCodes: Object.keys(responses),
        parameters: readParameters(pathItem, operation, root),
        requestFields: readRequest(operation, root),
        responseType: null,
        pointer: `#/paths/${pointerEscape(path)}/${method}`,
        sourceName: filename,
      });
    }
  }
  return { entities, contracts };
}

function draftOf(root: Record<string, unknown>): string | null {
  const schema = typeof root.$schema === "string" ? root.$schema : "";
  if (schema.includes("2020-12")) return "2020-12";
  if (schema.includes("draft-07") || schema.includes("draft/07")) return "draft-07";
  return null;
}

function importJsonSchema(root: Record<string, unknown>, filename: string): ImportedEntity[] {
  const draft = draftOf(root);
  const title = typeof root.title === "string" ? root.title : filename.replace(/\.[^.]+$/, "");
  const defs = isRecord(root.$defs) ? root.$defs : isRecord(root.definitions) ? root.definitions : {};
  const defPointer = isRecord(root.$defs) ? "$defs" : "definitions";
  const entities = [entityFrom(title, root, root, "#", draft, filename)];
  for (const [name, schema] of Object.entries(defs)) {
    entities.push(entityFrom(name, schema, root, `#/${defPointer}/${pointerEscape(name)}`, draft, filename));
  }
  return entities;
}

function splitCsv(body: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  for (const ch of body) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function parseColumn(body: string): ImportedField | null {
  const trimmed = body.trim();
  if (!trimmed || /^(primary|unique|constraint|foreign|check)\b/i.test(trimmed)) return null;
  const match = /^(?:"([^"]+)"|([A-Za-z_][\w]*))\s+([\s\S]+)$/.exec(trimmed);
  if (!match) return null;
  const name = match[1] || match[2] || "";
  const rest = match[3] ?? "";
  const constraintAt = rest.search(/\b(NOT\s+NULL|NULL|PRIMARY\s+KEY|UNIQUE|CHECK|DEFAULT|REFERENCES|CONSTRAINT)\b/i);
  const type = (constraintAt < 0 ? rest : rest.slice(0, constraintAt)).trim();
  const required = /\bNOT\s+NULL\b/i.test(rest) || /\bPRIMARY\s+KEY\b/i.test(rest);
  const enumMatch = /\bIN\s*\(([^)]*)\)/i.exec(rest);
  const values = enumMatch
    ? splitCsv(enumMatch[1] ?? "").map((item) => item.trim().replace(/^'(.*)'$/, "$1").replace(/^"(.*)"$/, "$1"))
    : [];
  return fieldOf({
    name,
    type,
    required,
    enumValues: values,
    nullable: /\bNULL\b/i.test(rest) && !required,
  });
}

function importSql(text: string, filename: string): ImportedEntity[] {
  const cleaned = text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--.*$/gm, "");
  const entities: ImportedEntity[] = [];
  const pattern = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"([^"]+)"|([A-Za-z_][\w.]*))\s*\(([\s\S]*?)\)\s*;/gi;
  for (const match of cleaned.matchAll(pattern)) {
    const name = match[1] || match[2] || "table";
    const fields = defined(splitCsv(match[3] ?? "").map(parseColumn));
    entities.push({
      role: "entity",
      name,
      basis: "observed",
      fields,
      enumValues: [],
      pointer: `/tables/${pointerEscape(name)}`,
      draft: null,
      sourceName: filename,
    });
  }
  if (entities.length === 0) throw new SchemaImportError("SQL file has no CREATE TABLE statement.", null);
  return entities;
}

function importPrisma(text: string, filename: string): ImportedEntity[] {
  const entities: ImportedEntity[] = [];
  for (const match of text.matchAll(/\b(model|enum)\s+([A-Za-z_][\w]*)\s*\{([^}]*)\}/g)) {
    const kind = match[1];
    const name = match[2] ?? "Model";
    const body = match[3] ?? "";
    if (kind === "enum") {
      const values = body
        .split(/\r?\n/)
        .map((line) => line.replace(/\/\/.*$/, "").trim())
        .filter((line) => line.length > 0 && !line.startsWith("@@") && !line.startsWith("@"));
      entities.push({
        role: "entity",
        name,
        basis: "observed",
        fields: [],
        enumValues: values,
        pointer: `/enums/${pointerEscape(name)}`,
        draft: null,
        sourceName: filename,
      });
      continue;
    }
    const fields: ImportedField[] = [];
    for (const line of body.split(/\r?\n/)) {
      const cleaned = line.replace(/\/\/.*$/, "").trim();
      if (!cleaned || cleaned.startsWith("@@")) continue;
      const field = /^([A-Za-z_][\w]*)\s+([A-Za-z_][\w]*)(\?)?(\[\])?\s*(.*)$/.exec(cleaned);
      if (!field?.[1] || !field[2]) continue;
      const optional = field[3] === "?";
      const list = field[4] === "[]";
      const attrs = field[5] ?? "";
      const scalar = PRISMA_SCALARS.has(field[2]);
      fields.push(
        fieldOf({
          name: field[1],
          type: `${field[2]}${list ? "[]" : ""}`,
          required: /@id\b/.test(attrs) || !optional,
          nullable: optional && !/@id\b/.test(attrs),
          ref: scalar ? null : field[2],
        }),
      );
    }
    entities.push({
      role: "entity",
      name,
      basis: "observed",
      fields,
      enumValues: [],
      pointer: `/models/${pointerEscape(name)}`,
      draft: null,
      sourceName: filename,
    });
  }
  if (entities.length === 0) throw new SchemaImportError("Prisma file has no model or enum.", null);
  return entities;
}

function parseGraphqlArgs(raw: string | undefined): ImportedField[] {
  if (!raw) return [];
  const inner = raw.slice(1, -1).trim();
  if (!inner) return [];
  return defined(
    inner.split(",").map((part) => {
      const [name, type] = part.trim().split(":").map((item) => item?.trim() ?? "");
      if (!name || !type) return null;
      return fieldOf({ name, type, required: type.endsWith("!"), nullable: !type.endsWith("!") });
    }),
  );
}

function importGraphql(text: string, filename: string): { entities: ImportedEntity[]; contracts: ImportedContract[] } {
  const stripped = text.replace(/#[^\n]*/g, "");
  const entities: ImportedEntity[] = [];
  const contracts: ImportedContract[] = [];
  for (const match of stripped.matchAll(/\b(type|input|enum|interface)\s+([A-Za-z_][\w]*)\s*\{([^{}]*)\}/g)) {
    const kind = match[1];
    const name = match[2] ?? "Type";
    const body = match[3] ?? "";
    if (kind === "enum") {
      const values = body
        .split(/\s+/)
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
      entities.push({
        role: "entity",
        name,
        basis: "observed",
        fields: [],
        enumValues: values,
        pointer: `/types/${pointerEscape(name)}`,
        draft: null,
        sourceName: filename,
      });
      continue;
    }
    const fields: ImportedField[] = [];
    for (const field of body.matchAll(/([A-Za-z_][\w]*)\s*(\([^)]*\))?\s*:\s*(\S+)/g)) {
      const fieldName = field[1] ?? "";
      const args = field[2];
      const typeToken = field[3] ?? "unknown";
      if (!fieldName) continue;
      if (name === "Query" || name === "Mutation") {
        contracts.push({
          role: "contract",
          name: fieldName,
          basis: "observed",
          method: name === "Query" ? "QUERY" : "MUTATION",
          path: fieldName,
          statusCodes: [],
          parameters: parseGraphqlArgs(args),
          requestFields: [],
          responseType: typeToken,
          pointer: `/types/${pointerEscape(name)}/${pointerEscape(fieldName)}`,
          sourceName: filename,
        });
        continue;
      }
      fields.push(
        fieldOf({
          name: fieldName,
          type: typeToken,
          required: typeToken.endsWith("!"),
          nullable: !typeToken.endsWith("!"),
        }),
      );
    }
    if (name !== "Query" && name !== "Mutation") {
      entities.push({
        role: "entity",
        name,
        basis: "observed",
        fields,
        enumValues: [],
        pointer: `/types/${pointerEscape(name)}`,
        draft: null,
        sourceName: filename,
      });
    }
  }
  if (entities.length === 0 && contracts.length === 0) {
    throw new SchemaImportError("GraphQL file has no type, input, or enum.", null);
  }
  return { entities, contracts };
}

function parseDocument(filename: string, text: string): { format: SchemaFormat; value: unknown } {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".sql") || (!lower.endsWith(".json") && !lower.endsWith(".yaml") && !lower.endsWith(".yml") && /^\s*CREATE\s+TABLE\b/i.test(text))) {
    return { format: "sql", value: text };
  }
  if (lower.endsWith(".prisma")) return { format: "prisma", value: text };
  if (lower.endsWith(".graphql") || lower.endsWith(".gql")) return { format: "graphql", value: text };
  if (lower.endsWith(".json") || text.trim().startsWith("{") || text.trim().startsWith("[")) {
    try {
      return { format: "json-schema", value: JSON.parse(text) as unknown };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid JSON";
      const position = /position\s+(\d+)/i.exec(message);
      const line = position?.[1] ? lineOfIndex(text, Number(position[1])) : null;
      throw new SchemaImportError(message, line);
    }
  }
  return { format: "openapi", value: parseYaml(text) };
}

function classify(filename: string, format: SchemaFormat, value: unknown): SchemaFormat {
  if (format === "sql" || format === "prisma" || format === "graphql") return format;
  if (isRecord(value) && typeof value.openapi === "string") return "openapi";
  if (isRecord(value) && (typeof value.$schema === "string" || isRecord(value.properties) || isRecord(value.$defs) || isRecord(value.definitions))) {
    return "json-schema";
  }
  const lower = filename.toLowerCase();
  if (lower.endsWith(".yaml") || lower.endsWith(".yml") || lower.endsWith(".json")) {
    throw new SchemaImportError("Document is neither OpenAPI nor JSON Schema.", null);
  }
  return format;
}

function fieldJson(field: ImportedField): Json {
  return {
    name: field.name,
    type: field.type,
    required: field.required,
    enumValues: [...field.enumValues],
    nullable: field.nullable,
    ref: field.ref,
    circular: field.circular,
  };
}

function empty(filename: string, errors: SchemaImportResult["errors"]): SchemaImportResult {
  return {
    ok: false,
    filename,
    format: null,
    entities: [],
    contracts: [],
    errors,
    llmTokens: 0,
    modelCalls: 0,
  };
}

/**
 * Parses OpenAPI, JSON Schema, SQL DDL, Prisma, and GraphQL in code.
 * The model is never called. `llmTokens` stays 0.
 */
export class DeterministicSchemaContractImporter {
  importSource(source: { readonly filename: string; readonly text: string }): SchemaImportResult {
    try {
      const parsed = parseDocument(source.filename, source.text);
      const format = classify(source.filename, parsed.format, parsed.value);
      if (format === "sql") {
        return this.success(source.filename, format, importSql(source.text, source.filename), []);
      }
      if (format === "prisma") {
        return this.success(source.filename, format, importPrisma(source.text, source.filename), []);
      }
      if (format === "graphql") {
        const imported = importGraphql(source.text, source.filename);
        return this.success(source.filename, format, imported.entities, imported.contracts);
      }
      if (format === "openapi") {
        const imported = importOpenApi(parsed.value, source.filename, null);
        return this.success(source.filename, format, imported.entities, imported.contracts);
      }
      if (!isRecord(parsed.value)) throw new SchemaImportError("JSON Schema root must be an object.", null);
      return this.success(source.filename, format, importJsonSchema(parsed.value, source.filename), []);
    } catch (error) {
      if (error instanceof YamlSyntaxError) {
        return empty(source.filename, [{ filename: source.filename, line: error.line, message: error.message }]);
      }
      if (error instanceof SchemaImportError) {
        return empty(source.filename, [{ filename: source.filename, line: error.line, message: error.message }]);
      }
      const message = error instanceof Error ? error.message : "Import failed.";
      return empty(source.filename, [{ filename: source.filename, line: null, message }]);
    }
  }

  importSources(sources: readonly { readonly filename: string; readonly text: string }[]): {
    readonly results: readonly SchemaImportResult[];
    readonly llmTokens: 0;
    readonly modelCalls: 0;
  } {
    return { results: sources.map((source) => this.importSource(source)), llmTokens: 0, modelCalls: 0 };
  }

  commit(result: SchemaImportResult, graph: KnowledgeGraphPort): readonly string[] {
    if (!result.ok) return [];
    const ids: string[] = [];
    const nodes = [
      ...result.entities.map((entity) => {
        const id = graph.allocateEntityId("ENT");
        ids.push(id);
        return {
          op: "create" as const,
          id,
          kind: "arch_node",
          title: entity.name,
          text: entity.name,
          status: "active" as const,
          fields: {
            basis: "observed",
            role: "entity",
            name: entity.name,
            pointer: entity.pointer,
            draft: entity.draft,
            enumValues: [...entity.enumValues],
            fields: entity.fields.map(fieldJson),
          },
        };
      }),
      ...result.contracts.map((contract) => {
        const id = graph.allocateEntityId("CON");
        ids.push(id);
        return {
          op: "create" as const,
          id,
          kind: "contract",
          title: `${contract.method} ${contract.path}`,
          text: `${contract.method} ${contract.path}`,
          status: "active" as const,
          fields: {
            basis: "observed",
            role: "contract",
            method: contract.method,
            path: contract.path,
            statusCodes: [...contract.statusCodes],
            parameters: contract.parameters.map(fieldJson),
            requestFields: contract.requestFields.map(fieldJson),
            responseType: contract.responseType,
            pointer: contract.pointer,
          },
        };
      }),
    ];
    graph.commitChangeSet({
      origin: "import",
      author: "intake",
      summary: `Import ${result.filename}`,
      nodes,
    });
    for (const id of ids) {
      const node = graph.getNode(id);
      if (!node) continue;
      graph.recordEvidence({
        node: id,
        nodeVersion: node.version,
        sourceKind: "source",
        sourceRef: result.filename,
        locator: { kind: "spec", pointer: typeof node.fields === "object" && node.fields && "pointer" in node.fields ? String(node.fields.pointer) : "/" },
        quote: node.text,
        verified: true,
      });
    }
    return ids;
  }

  private success(
    filename: string,
    format: SchemaFormat,
    entities: readonly ImportedEntity[],
    contracts: readonly ImportedContract[],
  ): SchemaImportResult {
    return { ok: true, filename, format, entities, contracts, errors: [], llmTokens: 0, modelCalls: 0 };
  }
}
