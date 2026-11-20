import {
  buildResolutionOptions,
  makeConflictId,
  type CatalogRuleEntry,
  type ConflictDraft,
  type SettledDecisionRef,
} from "./types.js";

/**
 * Layer 1. Direct catalog `conflicts_with` pairs and unsatisfied `requires`
 * among settled decisions. Lookups are hash maps so the pass stays under 5 ms.
 */
export class CatalogRuleChecker {
  check(decisions: readonly SettledDecisionRef[], rules: readonly CatalogRuleEntry[]): ConflictDraft[] {
    const byOption = new Map<string, SettledDecisionRef>();
    const byGroup = new Map<string, SettledDecisionRef[]>();
    for (const decision of decisions) {
      byOption.set(decision.optionId, decision);
      const group = byGroup.get(decision.groupId);
      if (group === undefined) byGroup.set(decision.groupId, [decision]);
      else group.push(decision);
    }
    const rulesByOption = new Map<string, CatalogRuleEntry>();
    for (const rule of rules) rulesByOption.set(rule.optionId, rule);

    const conflicts: ConflictDraft[] = [];
    const seenPairs = new Set<string>();
    const seenRequires = new Set<string>();

    for (const decision of decisions) {
      const rule = rulesByOption.get(decision.optionId);
      if (rule === undefined) continue;
      for (const otherOption of rule.conflictsWith) {
        const other = byOption.get(otherOption);
        if (other === undefined || other.id === decision.id) continue;
        const pairKey = [decision.id, other.id].sort().join("|");
        if (seenPairs.has(pairKey)) continue;
        seenPairs.add(pairKey);
        const titles = [decision.title, other.title];
        conflicts.push({
          id: makeConflictId(1, rule.id, [decision.id, other.id]),
          layer: 1,
          nodeIds: [decision.id, other.id].sort(),
          ruleId: rule.id,
          plainEnglishConflict: `Catalog rule ${rule.id}: "${decision.title}" conflicts with "${other.title}".`,
          concreteCounterexample: `Selecting both ${decision.optionId} and ${other.optionId} violates ${rule.id}.`,
          resolutionOptions: buildResolutionOptions(titles, [decision.basis, other.basis]),
        });
      }
      for (const requirement of rule.requires) {
        if (byOption.has(requirement.optionId)) continue;
        const group = byGroup.get(requirement.groupId) ?? [];
        const violator = group.find((candidate) => candidate.optionId !== requirement.optionId);
        const rightId = violator?.id ?? `missing:${requirement.groupId}:${requirement.optionId}`;
        const rightTitle = violator?.title ?? requirement.optionId;
        const requireKey = `${decision.id}|${rule.id}|${requirement.optionId}`;
        if (seenRequires.has(requireKey)) continue;
        seenRequires.add(requireKey);
        conflicts.push({
          id: makeConflictId(1, rule.id, [decision.id, rightId]),
          layer: 1,
          nodeIds: [decision.id, rightId].sort(),
          ruleId: rule.id,
          plainEnglishConflict: `Catalog rule ${rule.id}: "${decision.title}" requires ${requirement.optionId}, but "${rightTitle}" does not satisfy it.`,
          concreteCounterexample: `${decision.optionId} requires ${requirement.optionId} in group ${requirement.groupId}, and that option is not the settled value.`,
          resolutionOptions: buildResolutionOptions(
            [decision.title, rightTitle],
            violator === undefined ? [decision.basis] : [decision.basis, violator.basis],
          ),
        });
      }
    }
    return conflicts;
  }
}
