import { SKILL_COMBINED_TOKEN_CAP, SKILL_COUNT_CAP, type SkillRecord } from "./types.js";
import { compareText, countTokens } from "./tokens.js";

export interface RankedSkill {
  readonly skill: SkillRecord;
  readonly roleExact: number;
  readonly specificity: number;
  readonly overlap: number;
  readonly tokens: number;
}

export class LocalSkillSelector {
  readonly source = "local-port:task-078" as const;

  selectForTask(input: {
    readonly role: string;
    readonly touches: readonly string[];
    readonly skills: readonly SkillRecord[];
  }): { readonly selected: readonly SkillRecord[]; readonly ranked: readonly RankedSkill[] } {
    const ranked = rankSkills(input.skills, input.role, input.touches);
    const selected: SkillRecord[] = [];
    let total = 0;
    for (const row of ranked) {
      if (selected.length >= SKILL_COUNT_CAP) break;
      if (row.skill.vettingStatus !== "vetted") continue;
      if (total + row.tokens > SKILL_COMBINED_TOKEN_CAP) continue;
      selected.push(row.skill);
      total += row.tokens;
    }
    return { selected, ranked };
  }
}

export function rankSkills(
  skills: readonly SkillRecord[],
  role: string,
  touches: readonly string[],
): RankedSkill[] {
  const ranked: RankedSkill[] = [];
  for (const skill of skills) {
    const overlap = skill.allowedTouches.filter((tag) => touches.includes(tag)).length;
    if (overlap === 0) continue;
    const specificity = skill.allowedTouches.length === 0 ? 0 : overlap / skill.allowedTouches.length;
    ranked.push({
      skill,
      roleExact: skill.allowedRoles.includes(role) ? 1 : 0,
      specificity,
      overlap,
      tokens: countTokens(skill.text),
    });
  }
  ranked.sort((left, right) => {
    if (right.roleExact !== left.roleExact) return right.roleExact - left.roleExact;
    if (right.specificity !== left.specificity) return right.specificity - left.specificity;
    if (right.overlap !== left.overlap) return right.overlap - left.overlap;
    if (left.tokens !== right.tokens) return left.tokens - right.tokens;
    return compareText(left.skill.skillId, right.skill.skillId);
  });
  return ranked;
}
