import { EntityIdError } from "./errors.js";

export interface EntityIdSpec {
  readonly prefix: string;
  readonly minWidth: number;
}

/**
 * Counter prefixes stored in `id_counters.prefix`, including the hyphen when
 * the canonical ID has one. `minWidth` is the zero-pad width of the canonical
 * examples in Task 007 (`String(n).padStart(minWidth, "0")`).
 */
export const ENTITY_ID_SPECS: readonly EntityIdSpec[] = Object.freeze([
  { prefix: "T", minWidth: 2 },
  { prefix: "R", minWidth: 2 },
  { prefix: "SI-", minWidth: 3 },
  { prefix: "EC-", minWidth: 3 },
  { prefix: "C-", minWidth: 3 },
  { prefix: "AC-", minWidth: 2 },
  { prefix: "A", minWidth: 4 },
  { prefix: "F", minWidth: 2 },
  { prefix: "D-", minWidth: 4 },
  { prefix: "CS-", minWidth: 2 },
  { prefix: "EV-", minWidth: 5 },
  { prefix: "CCR-", minWidth: 2 },
  { prefix: "VR-", minWidth: 4 },
  { prefix: "RS-", minWidth: 1 },
  { prefix: "SRC-", minWidth: 2 },
  { prefix: "W", minWidth: 1 },
  { prefix: "S-", minWidth: 1 },
]);

export interface ParsedEntityId {
  readonly prefix: string;
  readonly sequence: number;
}

const SPECS_LONGEST_FIRST: readonly EntityIdSpec[] = Object.freeze(
  [...ENTITY_ID_SPECS].sort((left, right) => right.prefix.length - left.prefix.length),
);

export function formatEntityId(prefix: string, sequence: number): string {
  const spec = ENTITY_ID_SPECS.find((item) => item.prefix === prefix);
  if (!spec) {
    throw new EntityIdError(`unknown entity id prefix: ${prefix}`);
  }
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new EntityIdError("entity id sequence must be an integer greater than or equal to 1");
  }
  return spec.prefix + String(sequence).padStart(spec.minWidth, "0");
}

export function tryParseEntityId(id: string): ParsedEntityId | null {
  if (typeof id !== "string" || id.length === 0) return null;
  for (const spec of SPECS_LONGEST_FIRST) {
    if (!id.startsWith(spec.prefix)) continue;
    const digits = id.slice(spec.prefix.length);
    if (!/^[0-9]+$/.test(digits)) continue;
    const sequence = Number(digits);
    if (!Number.isSafeInteger(sequence) || sequence < 1) return null;
    if (formatEntityId(spec.prefix, sequence) !== id) return null;
    return { prefix: spec.prefix, sequence };
  }
  return null;
}

export function isValidEntityId(id: string): boolean {
  return tryParseEntityId(id) !== null;
}

export function parseEntityId(id: string): ParsedEntityId {
  const parsed = tryParseEntityId(id);
  if (!parsed) throw new EntityIdError(`invalid entity id: ${id}`);
  return parsed;
}

export function assertValidEntityId(id: string): void {
  parseEntityId(id);
}
