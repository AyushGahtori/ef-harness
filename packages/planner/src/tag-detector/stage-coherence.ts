export const STAGE_CATALOG_SOURCE = "local-port:task-075-076" as const;

export const STAGE_PRESETS = ["Prototype", "MVP", "Production"] as const;
export type StagePreset = (typeof STAGE_PRESETS)[number];
export type StageKey = "prototype" | "mvp" | "production";

export interface StageOptionRef {
  readonly questionId: string;
  readonly optionId: string;
}

export interface StageElaboration {
  readonly cell: string;
  readonly value: string;
  readonly numeric?: number;
}

export interface StageOption {
  readonly id: string;
  readonly label: string;
  readonly conflictsWith: readonly StageOptionRef[];
  readonly requires: readonly StageOptionRef[];
  readonly elaborations: readonly StageElaboration[];
}

export interface StageQuestion {
  readonly id: string;
  readonly pack: string;
  readonly options: readonly StageOption[];
  readonly recommend: Readonly<Record<StageKey, string>>;
}

export interface StageCatalog {
  readonly source: typeof STAGE_CATALOG_SOURCE;
  readonly questions: readonly StageQuestion[];
}

export interface StageSelection {
  readonly questionId: string;
  readonly optionId: string;
  readonly label: string;
}

export interface NumericConflict {
  readonly cell: string;
  readonly values: readonly {
    readonly questionId: string;
    readonly optionId: string;
    readonly numeric: number;
  }[];
}

export interface PresetCoherence {
  readonly preset: StagePreset;
  readonly selections: readonly StageSelection[];
  readonly conflicts: readonly { readonly left: string; readonly right: string }[];
  readonly unsatisfiedRequires: readonly {
    readonly questionId: string;
    readonly optionId: string;
    readonly missingQuestionId: string;
    readonly missingOptionId: string;
  }[];
  readonly numericConflicts: readonly NumericConflict[];
}

export interface StageCoherenceReport {
  readonly ok: boolean;
  readonly source: string;
  readonly presets: readonly PresetCoherence[];
}

export function presetKey(preset: StagePreset): StageKey {
  if (preset === "Prototype") return "prototype";
  if (preset === "MVP") return "mvp";
  return "production";
}

function selectionLabel(questionId: string, optionId: string, label: string): string {
  return `${questionId}=${optionId} (${label})`;
}

export class StageCoherenceSelfTest {
  constructor(private readonly catalog: StageCatalog) {}

  run(): StageCoherenceReport {
    const presets = STAGE_PRESETS.map((preset) => this.runPreset(preset));
    return {
      ok: presets.every(
        (preset) =>
          preset.conflicts.length === 0 &&
          preset.unsatisfiedRequires.length === 0 &&
          preset.numericConflicts.length === 0,
      ),
      source: this.catalog.source,
      presets,
    };
  }

  private runPreset(preset: StagePreset): PresetCoherence {
    const key = presetKey(preset);
    const selections: StageSelection[] = [];
    const selectedByQuestion = new Map<string, StageOption>();
    for (const question of this.catalog.questions) {
      const optionId = question.recommend[key];
      const option = question.options.find((item) => item.id === optionId);
      if (!option) {
        throw new Error(`${question.id} has no option ${optionId} for ${preset}`);
      }
      selections.push({ questionId: question.id, optionId: option.id, label: option.label });
      selectedByQuestion.set(question.id, option);
    }

    const conflicts: { left: string; right: string }[] = [];
    const questions = [...selectedByQuestion.keys()];
    for (let i = 0; i < questions.length; i += 1) {
      for (let j = i + 1; j < questions.length; j += 1) {
        const leftId = questions[i];
        const rightId = questions[j];
        if (!leftId || !rightId) continue;
        const left = selectedByQuestion.get(leftId);
        const right = selectedByQuestion.get(rightId);
        if (!left || !right) continue;
        const leftHits = left.conflictsWith.some(
          (item) => item.questionId === rightId && item.optionId === right.id,
        );
        const rightHits = right.conflictsWith.some(
          (item) => item.questionId === leftId && item.optionId === left.id,
        );
        if (leftHits || rightHits) {
          conflicts.push({
            left: selectionLabel(leftId, left.id, left.label),
            right: selectionLabel(rightId, right.id, right.label),
          });
        }
      }
    }
    conflicts.sort((a, b) => `${a.left}|${a.right}`.localeCompare(`${b.left}|${b.right}`));

    const unsatisfiedRequires: PresetCoherence["unsatisfiedRequires"][number][] = [];
    for (const [questionId, option] of selectedByQuestion) {
      for (const requirement of option.requires) {
        const selected = selectedByQuestion.get(requirement.questionId);
        if (!selected || selected.id !== requirement.optionId) {
          unsatisfiedRequires.push({
            questionId,
            optionId: option.id,
            missingQuestionId: requirement.questionId,
            missingOptionId: requirement.optionId,
          });
        }
      }
    }

    const numericGroups = new Map<string, NumericConflict["values"][number][]>();
    for (const [questionId, option] of selectedByQuestion) {
      for (const elaboration of option.elaborations) {
        if (elaboration.numeric === undefined) continue;
        const group = numericGroups.get(elaboration.cell) ?? [];
        group.push({ questionId, optionId: option.id, numeric: elaboration.numeric });
        numericGroups.set(elaboration.cell, group);
      }
    }
    const numericConflicts: NumericConflict[] = [];
    for (const [cell, values] of numericGroups) {
      const distinct = new Set(values.map((value) => value.numeric));
      if (distinct.size > 1) numericConflicts.push({ cell, values });
    }
    numericConflicts.sort((a, b) => a.cell.localeCompare(b.cell));

    return {
      preset,
      selections,
      conflicts,
      unsatisfiedRequires,
      numericConflicts,
    };
  }
}

export function assertStageCatalogShape(catalog: StageCatalog): void {
  const issues: string[] = [];
  const ids = catalog.questions.map((question) => question.id);
  const unique = new Set(ids);
  if (unique.size !== ids.length) issues.push("duplicate question ids");
  const byId = new Map(catalog.questions.map((question) => [question.id, question]));
  for (const question of catalog.questions) {
    const optionIds = new Set(question.options.map((option) => option.id));
    for (const key of ["prototype", "mvp", "production"] as const) {
      if (!optionIds.has(question.recommend[key])) {
        issues.push(`${question.id} recommend.${key} is not an option`);
      }
    }
    for (const option of question.options) {
      for (const ref of [...option.conflictsWith, ...option.requires]) {
        const target = byId.get(ref.questionId);
        if (!target || !target.options.some((item) => item.id === ref.optionId)) {
          issues.push(
            `${question.id}:${option.id} references missing ${ref.questionId}:${ref.optionId}`,
          );
        }
      }
    }
  }
  if (issues.length > 0) {
    throw new Error(issues.join("\n"));
  }
}
