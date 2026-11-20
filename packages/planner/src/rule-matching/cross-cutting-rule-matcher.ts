import { corpusCrossCuttingRules } from "./catalog.js";
import { tagSet, uniqueSorted } from "./text.js";
import type { MatchableRule, RuleMatch, RuleMatchInput, RuleMatchReport } from "./types.js";

/**
 * `global` matches outright.
 * Otherwise both clauses must hold: a missing `any`/`all` is not a constraint,
 * and a present list uses intersection (`any`) or subset (`all`).
 */
export function scopeMatches(
  rule: Pick<MatchableRule, "global" | "any" | "all">,
  tags: ReadonlySet<string>,
): boolean {
  if (rule.global === true) return true;
  return anyClause(tags, rule.any) && allClause(tags, rule.all);
}

function anyClause(tags: ReadonlySet<string>, anyTags: readonly string[] | null): boolean {
  if (anyTags == null) return true;
  for (const tag of anyTags) {
    const trimmed = tag.trim();
    if (trimmed && tags.has(trimmed)) return true;
  }
  return false;
}

function allClause(tags: ReadonlySet<string>, allTags: readonly string[] | null): boolean {
  if (allTags == null) return true;
  for (const tag of allTags) {
    const trimmed = tag.trim();
    if (trimmed && !tags.has(trimmed)) return false;
  }
  return true;
}

function matchedTags(rule: MatchableRule, tags: ReadonlySet<string>): string[] {
  const hit = new Set<string>();
  for (const tag of [...(rule.any ?? []), ...(rule.all ?? [])]) {
    const trimmed = tag.trim();
    if (trimmed && tags.has(trimmed)) hit.add(trimmed);
  }
  return [...hit].sort((left, right) => left.localeCompare(right));
}

function toMatch(rule: MatchableRule, matchedVia: RuleMatch["matchedVia"], tags: ReadonlySet<string>): RuleMatch {
  return {
    ruleId: rule.id,
    title: rule.title,
    kind: rule.kind,
    matchedVia,
    matchedTags: matchedTags(rule, tags),
    appliesAs: rule.appliesAs,
    checkIds: [...rule.checkIds],
    global: rule.global,
  };
}

/**
 * Evaluates every active rule against
 * `task.touches ∪ inheritedEntityTags ∪ screen/endpoint tags`.
 * Screen and endpoint tags are direct facts about the task, not entity inheritance.
 */
export class CrossCuttingRuleMatcher {
  private readonly rules: readonly MatchableRule[];

  constructor(rules?: readonly MatchableRule[]) {
    this.rules = rules ?? corpusCrossCuttingRules();
  }

  match(input: RuleMatchInput): RuleMatchReport {
    const taskTouches = uniqueSorted(input.taskTouches);
    const inheritedEntityTags = uniqueSorted(input.inheritedEntityTags);
    const screenEndpointTags = uniqueSorted(input.screenEndpointTags);
    const direct = tagSet([...taskTouches, ...screenEndpointTags]);
    const inherited = tagSet(inheritedEntityTags);
    const full = tagSet([...taskTouches, ...inheritedEntityTags, ...screenEndpointTags]);
    const matches: RuleMatch[] = [];
    for (const rule of this.rules) {
      if (!rule.active) continue;
      if (rule.global === true) {
        matches.push(toMatch(rule, "global", full));
        continue;
      }
      if (!scopeMatches(rule, full)) continue;
      const viaDirect = scopeMatches(rule, direct);
      const onlyViaInheritance = !viaDirect && inherited.size > 0 && scopeMatches(rule, full);
      matches.push(toMatch(rule, onlyViaInheritance ? "entity_inheritance" : "direct_tag", full));
    }
    matches.sort((left, right) => left.ruleId.localeCompare(right.ruleId));
    return {
      effectiveTags: [...full].sort((left, right) => left.localeCompare(right)),
      directTags: [...direct].sort((left, right) => left.localeCompare(right)),
      inheritedEntityTags,
      screenEndpointTags,
      matches,
    };
  }

  /** Treats every supplied tag as a direct task touch. Used by `kb.list_rules_for_tags`. */
  matchTags(tags: readonly string[]): RuleMatchReport {
    return this.match({
      taskTouches: tags,
      inheritedEntityTags: [],
      screenEndpointTags: [],
    });
  }
}
