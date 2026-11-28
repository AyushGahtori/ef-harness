import type { DiffOp, DiffOpKind } from "./types.js";

export function makeOp(
  kind: DiffOpKind,
  breaking: boolean,
  detail: string,
  payload: Readonly<Record<string, string>>,
): DiffOp {
  const keys = Object.keys(payload).sort();
  const body = keys.map((key) => `${key}=${payload[key] ?? ""}`).join(",");
  return { signature: `${kind}|${body}`, kind, breaking, detail, payload };
}

export interface ShapeField {
  readonly id: string;
  readonly type: string;
  readonly required: boolean;
  readonly enums: readonly string[];
  readonly outputOnly: boolean;
  readonly uiVariant: boolean;
  readonly constraints: string;
}

export interface ApiEndpoint {
  readonly id: string;
  readonly statuses: readonly string[];
  readonly auth: string;
  readonly errorShape: string;
}

export function diffShapes(before: readonly ShapeField[], after: readonly ShapeField[]): DiffOp[] {
  const beforeMap = new Map(before.map((field) => [field.id, field]));
  const afterMap = new Map(after.map((field) => [field.id, field]));
  const removed = before.filter((field) => !afterMap.has(field.id));
  const added = after.filter((field) => !beforeMap.has(field.id));
  const ops: DiffOp[] = [];
  const renamed = removed.length === 1 && added.length === 1 && sameParent(removed[0]?.id, added[0]?.id);
  if (renamed && removed[0] && added[0]) {
    ops.push(
      makeOp("rename_field", true, `rename ${removed[0].id} to ${added[0].id}`, {
        from: removed[0].id,
        to: added[0].id,
      }),
    );
    ops.push(...typeOps(removed[0].id, removed[0].type, added[0].type));
  } else {
    for (const field of removed) {
      ops.push(makeOp("drop_field", true, `drop field ${field.id}`, { name: field.id }));
    }
    for (const field of added) ops.push(addedField(field));
  }
  for (const field of after) {
    const prior = beforeMap.get(field.id);
    if (!prior) continue;
    ops.push(...diffExistingField(prior, field));
  }
  return ops;
}

export function diffEndpoints(before: readonly ApiEndpoint[], after: readonly ApiEndpoint[]): DiffOp[] {
  const beforeMap = new Map(before.map((endpoint) => [endpoint.id, endpoint]));
  const afterMap = new Map(after.map((endpoint) => [endpoint.id, endpoint]));
  const ops: DiffOp[] = [];
  for (const endpoint of before) {
    if (!afterMap.has(endpoint.id)) {
      ops.push(makeOp("drop_endpoint", true, `drop endpoint ${endpoint.id}`, { name: endpoint.id }));
    }
  }
  for (const endpoint of after) {
    const prior = beforeMap.get(endpoint.id);
    if (!prior) {
      ops.push(makeOp("add_endpoint", false, `add endpoint ${endpoint.id}`, { name: endpoint.id }));
      continue;
    }
    const beforeStatus = [...prior.statuses].sort().join(",");
    const afterStatus = [...endpoint.statuses].sort().join(",");
    if (beforeStatus !== afterStatus) {
      ops.push(
        makeOp("status_change", true, `status codes for ${endpoint.id} changed from ${beforeStatus} to ${afterStatus}`, {
          name: endpoint.id,
          from: beforeStatus,
          to: afterStatus,
        }),
      );
    }
    if (prior.auth !== endpoint.auth) {
      ops.push(
        makeOp("auth_change", true, `auth semantics changed for ${endpoint.id}`, {
          name: endpoint.id,
          from: prior.auth,
          to: endpoint.auth,
        }),
      );
    }
    if (prior.errorShape !== endpoint.errorShape) {
      ops.push(
        makeOp("error_envelope_change", true, `error envelope changed for ${endpoint.id}`, {
          name: endpoint.id,
          from: prior.errorShape,
          to: endpoint.errorShape,
        }),
      );
    }
  }
  return ops;
}

export function diffTenant(before: string, after: string): DiffOp[] {
  if (before === after) return [];
  if (before.length === 0 && after.length === 0) return [];
  return [
    makeOp("tenant_change", true, `tenant semantics changed from ${before || "(none)"} to ${after || "(none)"}`, {
      from: before,
      to: after,
    }),
  ];
}

export function diffExports(
  before: readonly { readonly name: string; readonly kind: string }[],
  after: readonly { readonly name: string; readonly kind: string }[],
): DiffOp[] {
  const beforeNames = new Set(before.map((item) => item.name));
  const afterNames = new Set(after.map((item) => item.name));
  const ops: DiffOp[] = [];
  for (const item of before) {
    if (!afterNames.has(item.name)) {
      ops.push(makeOp("drop_export", true, `remove shared export ${item.name}`, { name: item.name, kind: item.kind }));
    }
  }
  for (const item of after) {
    if (!beforeNames.has(item.name)) {
      ops.push(makeOp("add_export", false, `add shared export ${item.name}`, { name: item.name, kind: item.kind }));
    }
  }
  return ops;
}

function diffExistingField(before: ShapeField, after: ShapeField): DiffOp[] {
  const ops: DiffOp[] = [];
  ops.push(...typeOps(after.id, before.type, after.type));
  if (!before.required && after.required) {
    ops.push(makeOp("add_required", true, `make ${after.id} required`, { name: after.id }));
  } else if (before.required && !after.required) {
    ops.push(makeOp("loosen_constraint", false, `make ${after.id} optional`, { name: after.id }));
  }
  if (before.enums.length > 0 || after.enums.length > 0) {
    const beforeSet = new Set(before.enums);
    const afterSet = new Set(after.enums);
    for (const value of after.enums) {
      if (beforeSet.has(value)) continue;
      if (after.uiVariant || before.uiVariant) {
        ops.push(makeOp("add_optional_ui_variant", false, `add UI variant ${value} on ${after.id}`, { name: value }));
      } else if (after.outputOnly || before.outputOnly) {
        ops.push(makeOp("add_output_enum_value", false, `add output enum ${value} on ${after.id}`, { name: value }));
      } else {
        ops.push(makeOp("add_input_enum_value", true, `add input enum ${value} on ${after.id}`, { name: value }));
      }
    }
    for (const value of before.enums) {
      if (afterSet.has(value)) continue;
      ops.push(makeOp("remove_enum_value", true, `remove enum ${value} from ${after.id}`, { name: value }));
    }
  }
  if (before.constraints !== after.constraints && constraintTightened(before.constraints, after.constraints)) {
    ops.push(
      makeOp("tighten_constraint", true, `tighten validation on ${after.id}`, {
        name: after.id,
        from: before.constraints,
        to: after.constraints,
      }),
    );
  } else if (before.constraints !== after.constraints && before.constraints.length > 0) {
    ops.push(
      makeOp("loosen_constraint", false, `loosen validation on ${after.id}`, {
        name: after.id,
        from: before.constraints,
        to: after.constraints,
      }),
    );
  }
  return ops;
}

function addedField(field: ShapeField): DiffOp {
  if (field.uiVariant && field.enums.length > 0) {
    return makeOp("add_optional_ui_variant", false, `add UI variant ${field.id}`, { name: field.id });
  }
  if (field.required) {
    return makeOp("add_required", true, `add required field ${field.id}`, { name: field.id, type: field.type });
  }
  return makeOp("add_optional_field", false, `add optional field ${field.id}`, { name: leaf(field.id), type: field.type });
}

function typeOps(id: string, before: string, after: string): DiffOp[] {
  const relation = compareTypes(before, after);
  if (relation === "same") return [];
  if (relation === "narrow") {
    return [makeOp("narrow_type", true, `narrow ${id} from ${before} to ${after}`, { name: id, from: before, to: after })];
  }
  if (relation === "widen") {
    return [makeOp("loosen_constraint", false, `widen ${id} from ${before} to ${after}`, { name: id, from: before, to: after })];
  }
  return [makeOp("type_change", true, `change ${id} from ${before} to ${after}`, { name: id, from: before, to: after })];
}

function sameParent(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right) return false;
  return parentOf(left) === parentOf(right);
}

function parentOf(id: string): string {
  const index = id.lastIndexOf(".");
  return index === -1 ? "" : id.slice(0, index);
}

function leaf(id: string): string {
  const index = id.lastIndexOf(".");
  return index === -1 ? id : id.slice(index + 1);
}

interface TypeFact {
  readonly family: string;
  readonly rank: number;
  readonly length: number | null;
}

const INT_RANK: Readonly<Record<string, number>> = {
  tinyint: 1,
  smallint: 2,
  int: 3,
  integer: 3,
  bigint: 4,
};

export function compareTypes(before: string, after: string): "same" | "narrow" | "widen" | "change" {
  const leftText = normalizeType(before);
  const rightText = normalizeType(after);
  if (leftText === rightText) return "same";
  const left = typeFact(leftText);
  const right = typeFact(rightText);
  if (left.family !== right.family) return "change";
  if (left.family === "text") {
    if (left.length === null && right.length !== null) return "narrow";
    if (left.length !== null && right.length === null) return "widen";
    if (left.length !== null && right.length !== null && right.length < left.length) return "narrow";
    if (left.length !== null && right.length !== null && right.length > left.length) return "widen";
    return "same";
  }
  if (right.rank < left.rank) return "narrow";
  if (right.rank > left.rank) return "widen";
  return "same";
}

function normalizeType(type: string): string {
  return type.trim().toLowerCase().replace(/\s+/g, " ");
}

function typeFact(type: string): TypeFact {
  const varchar = /^(varchar|character varying|char|character|string)\s*\(\s*(\d+)\s*\)/.exec(type);
  if (varchar?.[2]) return { family: "text", rank: 2, length: Number(varchar[2]) };
  if (type === "text" || type === "clob" || type === "string") return { family: "text", rank: 3, length: null };
  const integer = /^(tinyint|smallint|int|integer|bigint)\b/.exec(type);
  if (integer?.[1]) return { family: "int", rank: INT_RANK[integer[1]] ?? 3, length: null };
  if (type === "number") return { family: "numeric", rank: 2, length: null };
  if (type === "integer") return { family: "int", rank: 3, length: null };
  const numeric = /^(numeric|decimal)\s*(?:\(\s*(\d+))?/.exec(type);
  if (numeric) return { family: "numeric", rank: Number(numeric[2] ?? 18), length: null };
  if (type === "real" || type === "float" || type === "double") {
    return { family: "float", rank: type === "real" ? 1 : 2, length: null };
  }
  if (type === "boolean" || type === "bool") return { family: "bool", rank: 1, length: null };
  if (type === "date") return { family: "date", rank: 1, length: null };
  if (type === "datetime" || type.startsWith("timestamp")) return { family: "timestamp", rank: 1, length: null };
  if (type === "json" || type === "jsonb") return { family: "json", rank: type === "jsonb" ? 2 : 1, length: null };
  return { family: type, rank: 0, length: null };
}

function constraintTightened(before: string, after: string): boolean {
  const left = constraintMap(before);
  const right = constraintMap(after);
  const keys = new Set([...left.keys(), ...right.keys()]);
  for (const key of keys) {
    const from = left.get(key);
    const to = right.get(key);
    if (from === to) continue;
    if (key === "maxlength" || key === "maxitems" || key === "maximum") {
      if (to !== undefined && (from === undefined || Number(to) < Number(from))) return true;
    } else if (key === "minlength" || key === "minitems" || key === "minimum") {
      if (to !== undefined && (from === undefined || Number(to) > Number(from))) return true;
    } else if (to !== undefined && to.length > 0 && to !== from) {
      return true;
    }
  }
  return false;
}

function constraintMap(text: string): Map<string, string> {
  const map = new Map<string, string>();
  if (text.length === 0) return map;
  for (const part of text.split(",")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    map.set(part.slice(0, index), part.slice(index + 1));
  }
  return map;
}
