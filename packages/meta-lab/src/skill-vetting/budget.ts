import type { LoadedSkill } from "./model.js";
import { SkillTokenBudgetError } from "./model.js";
import {
  SKILL_TOKEN_CAP,
  TASK_SKILL_COUNT_CAP,
  TASK_SKILL_TOKEN_CAP,
  countSkillTokens,
} from "./tokenizer.js";

export interface RankedSkill {
  readonly skill: LoadedSkill;
  readonly roleExact: number;
  readonly specificity: number;
  readonly overlap: number;
}

export interface SkillSelection {
  readonly selected: readonly LoadedSkill[];
  readonly totalTokens: number;
  readonly ranked: readonly RankedSkill[];
}

export class SkillTokenBudgetEnforcer {
  count(text: string): number {
    return countSkillTokens(text);
  }

  assertWithinCap(text: string, label: string): number {
    const tokenCount = countSkillTokens(text);
    if (tokenCount > SKILL_TOKEN_CAP) {
      throw new SkillTokenBudgetError(
        `skill ${label} is ${tokenCount} tokens (${tokenCount} > ${SKILL_TOKEN_CAP})`,
        tokenCount,
        SKILL_TOKEN_CAP,
      );
    }
    return tokenCount;
  }

  assertMountedSet(skills: readonly LoadedSkill[]): number {
    const total = skills.reduce((sum, skill) => sum + skill.tokenCount, 0);
    if (skills.length > TASK_SKILL_COUNT_CAP) {
      throw new SkillTokenBudgetError(
        `active skills ${skills.length} > ${TASK_SKILL_COUNT_CAP}`,
        total,
        TASK_SKILL_COUNT_CAP,
      );
    }
    if (total > TASK_SKILL_TOKEN_CAP) {
      throw new SkillTokenBudgetError(
        `combined skill tokens ${total} > ${TASK_SKILL_TOKEN_CAP}`,
        total,
        TASK_SKILL_TOKEN_CAP,
      );
    }
    for (const skill of skills) {
      this.assertWithinCap(skill.injectedText, `${skill.entry.skillId}@${skill.entry.version}`);
    }
    return total;
  }

  /**
   * Rank by exact role, then tag specificity, then overlap.
   * Keep at most 2 skills and at most 3,500 combined tokens.
   */
  selectForTask(input: {
    readonly role: string;
    readonly touches: readonly string[];
    readonly skills: readonly LoadedSkill[];
  }): SkillSelection {
    const ranked = rankSkillsForTask(input.skills, input.role, input.touches);
    const selected: LoadedSkill[] = [];
    let totalTokens = 0;
    for (const row of ranked) {
      if (selected.length >= TASK_SKILL_COUNT_CAP) break;
      if (row.skill.entry.vettingStatus !== "vetted") continue;
      if (row.skill.tokenCount > SKILL_TOKEN_CAP) continue;
      if (totalTokens + row.skill.tokenCount > TASK_SKILL_TOKEN_CAP) continue;
      selected.push(row.skill);
      totalTokens += row.skill.tokenCount;
    }
    return { selected, totalTokens, ranked };
  }
}

export function rankSkillsForTask(
  skills: readonly LoadedSkill[],
  role: string,
  touches: readonly string[],
): RankedSkill[] {
  const ranked: RankedSkill[] = [];
  for (const skill of skills) {
    const overlap = skill.entry.allowedTouches.filter((tag) => touches.includes(tag)).length;
    if (overlap === 0) continue;
    const specificity =
      skill.entry.allowedTouches.length === 0 ? 0 : overlap / skill.entry.allowedTouches.length;
    ranked.push({
      skill,
      roleExact: skill.entry.allowedRoles.includes(role) ? 1 : 0,
      specificity,
      overlap,
    });
  }
  ranked.sort((left, right) => {
    if (right.roleExact !== left.roleExact) return right.roleExact - left.roleExact;
    if (right.specificity !== left.specificity) return right.specificity - left.specificity;
    if (right.overlap !== left.overlap) return right.overlap - left.overlap;
    if (left.skill.tokenCount !== right.skill.tokenCount) {
      return left.skill.tokenCount - right.skill.tokenCount;
    }
    return left.skill.entry.skillId.localeCompare(right.skill.entry.skillId);
  });
  return ranked;
}
