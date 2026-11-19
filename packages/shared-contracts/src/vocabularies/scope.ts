import { z } from "zod";
import { isTouchesTag, TouchesTagSchema, type TouchesTag } from "./touches.js";

export class ClosedVocabularyError extends Error {
  readonly value: string;

  constructor(message: string, value: string) {
    super(message);
    this.name = "ClosedVocabularyError";
    this.value = value;
  }
}

/**
 * The only legal cross-cutting scope: `{ any?, all? }` over the closed touches tags.
 * A task matches when every `all` tag is present and, if `any` is set, at least one
 * `any` tag is present. Empty predicates are rejected so a rule cannot match every
 * task or no task by accident.
 */
export const ScopePredicateSchema = z
  .object({
    any: z.array(TouchesTagSchema).min(1).optional(),
    all: z.array(TouchesTagSchema).min(1).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const anyCount = value.any?.length ?? 0;
    const allCount = value.all?.length ?? 0;
    if (anyCount === 0 && allCount === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Scope predicate must include a non-empty any list, a non-empty all list, or both",
      });
    }
  });

export type ScopePredicate = {
  readonly any?: readonly TouchesTag[];
  readonly all?: readonly TouchesTag[];
};

function taskTagSet(taskTags: readonly TouchesTag[]): Set<string> {
  const present = new Set<string>();
  for (const tag of taskTags) {
    if (!isTouchesTag(tag)) {
      throw new ClosedVocabularyError(`Unknown touches tag "${String(tag)}"`, String(tag));
    }
    present.add(tag);
  }
  return present;
}

export function matchesScopePredicate(
  taskTags: readonly TouchesTag[],
  predicate: ScopePredicate,
): boolean {
  const parsed = ScopePredicateSchema.parse(predicate);
  const present = taskTagSet(taskTags);
  for (const tag of parsed.all ?? []) {
    if (!present.has(tag)) return false;
  }
  if (parsed.any !== undefined) {
    let matched = false;
    for (const tag of parsed.any) {
      if (present.has(tag)) {
        matched = true;
        break;
      }
    }
    if (!matched) return false;
  }
  return true;
}

export function evaluateTouchesScope(
  taskTags: readonly TouchesTag[],
  predicate: ScopePredicate,
): boolean {
  return matchesScopePredicate(taskTags, predicate);
}
