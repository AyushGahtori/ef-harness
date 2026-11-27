import type { WaveBundle } from "./load.js";

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
  readonly source: string;
  readonly questions: readonly StageQuestion[];
}

export interface NumericConflict {
  readonly cell: string;
  readonly values: readonly { readonly questionId: string; readonly optionId: string; readonly numeric: number }[];
}

export interface PresetCoherence {
  readonly preset: StagePreset;
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

const M2_QUESTIONS: readonly { readonly id: string; readonly pack: string }[] = [
  { id: "product.purpose", pack: "core" },
  { id: "product.audience", pack: "core" },
  { id: "product.stage", pack: "core" },
  { id: "actors.roles", pack: "core" },
  { id: "workflows.primary", pack: "core" },
  { id: "workflows.secondary", pack: "core" },
  { id: "data.entities", pack: "core" },
  { id: "data.ownership", pack: "core" },
  { id: "product.persists_data", pack: "core" },
  { id: "errors.user_facing_style", pack: "core" },
  { id: "testing.expectations", pack: "core" },
  { id: "delivery.platform", pack: "core" },
  { id: "deploy.target", pack: "core" },
  { id: "constraints.deadline_budget", pack: "core" },
  { id: "constraints.stack_preferences", pack: "core" },
  { id: "integrations.external", pack: "core" },
  { id: "time.locale_timezone", pack: "core" },
  { id: "content.language", pack: "core" },
  { id: "data.storage.engine", pack: "data" },
  { id: "data.retention_deletion", pack: "data" },
  { id: "data.personal_data", pack: "data" },
  { id: "data.import_existing", pack: "data" },
  { id: "data.backup", pack: "data" },
  { id: "data.concurrent_edits", pack: "data" },
  { id: "auth.needed", pack: "auth" },
  { id: "auth.method", pack: "auth" },
  { id: "auth.roles_permissions", pack: "auth" },
  { id: "auth.session_length", pack: "auth" },
  { id: "auth.account_recovery", pack: "auth" },
  { id: "ui.pages_inventory", pack: "web" },
  { id: "ui.look_and_feel", pack: "web" },
  { id: "ui.responsive_targets", pack: "web" },
  { id: "ui.forms_validation_style", pack: "web" },
  { id: "ui.states_style", pack: "web" },
  { id: "ui.accessibility_level", pack: "web" },
  { id: "api.consumers", pack: "api" },
  { id: "api.style", pack: "api" },
  { id: "api.error_format", pack: "api" },
  { id: "api.rate_limits", pack: "api" },
  { id: "jobs.background_needed", pack: "api" },
  { id: "cli.distribution", pack: "cli" },
  { id: "cli.config_location", pack: "cli" },
  { id: "cli.output_format", pack: "cli" },
  { id: "cli.exit_codes", pack: "cli" },
];

export const M2_QUESTION_IDS = M2_QUESTIONS.map((question) => question.id);

function elaboration(cell: string, value: string, numeric?: number): StageElaboration {
  if (numeric === undefined) return { cell, value };
  return { cell, value, numeric };
}

function option(
  id: string,
  label: string,
  elaborations: readonly StageElaboration[],
  extra?: Pick<StageOption, "conflictsWith" | "requires">,
): StageOption {
  return {
    id,
    label,
    conflictsWith: extra?.conflictsWith ?? [],
    requires: extra?.requires ?? [],
    elaborations,
  };
}

function steady(id: string, pack: string): StageQuestion {
  return {
    id,
    pack,
    options: [option("default", `Recommended ${id}`, [elaboration(`${id}.value`, `Default for ${id}`, 1)])],
    recommend: { prototype: "default", mvp: "default", production: "default" },
  };
}

function specials(): Map<string, StageQuestion> {
  const questions: StageQuestion[] = [
    {
      id: "auth.needed",
      pack: "auth",
      options: [
        option("no_auth", "No auth", [elaboration("auth.required", "Requests are anonymous.", 0)], {
          conflictsWith: [{ questionId: "product.persists_data", optionId: "per_user_saved_preferences" }],
          requires: [],
        }),
        option("session_auth", "Signed-in session", [elaboration("auth.required", "A server session identifies the caller.", 1)]),
      ],
      recommend: { prototype: "no_auth", mvp: "session_auth", production: "session_auth" },
    },
    {
      id: "auth.method",
      pack: "auth",
      options: [
        option("not_used", "No sign-in method", [elaboration("auth.method_code", "No sign-in method is configured.", 0)], {
          conflictsWith: [],
          requires: [{ questionId: "auth.needed", optionId: "no_auth" }],
        }),
        option("magic_link", "Magic link", [elaboration("auth.method_code", "Sign-in uses a single-use magic link.", 1)], {
          conflictsWith: [],
          requires: [{ questionId: "auth.needed", optionId: "session_auth" }],
        }),
      ],
      recommend: { prototype: "not_used", mvp: "magic_link", production: "magic_link" },
    },
    {
      id: "product.persists_data",
      pack: "core",
      options: [
        option("ephemeral", "Ephemeral session data", [elaboration("prefs.saved", "No per-user preferences are stored.", 0)]),
        option(
          "per_user_saved_preferences",
          "Per-user saved preferences",
          [elaboration("prefs.saved", "Preferences are stored per signed-in user.", 1)],
          {
            conflictsWith: [{ questionId: "auth.needed", optionId: "no_auth" }],
            requires: [{ questionId: "auth.needed", optionId: "session_auth" }],
          },
        ),
      ],
      recommend: { prototype: "ephemeral", mvp: "per_user_saved_preferences", production: "per_user_saved_preferences" },
    },
    {
      id: "data.retention_deletion",
      pack: "data",
      options: [
        option("keep_none", "No retention window", [elaboration("retention.days", "Nothing is retained past the request.", 0)]),
        option("keep_30", "Keep 30 days", [elaboration("retention.days", "Retained records expire after 30 days.", 30)]),
        option("keep_90", "Keep 90 days", [elaboration("retention.days", "Retained records expire after 90 days.", 90)]),
      ],
      recommend: { prototype: "keep_none", mvp: "keep_30", production: "keep_90" },
    },
    {
      id: "data.backup",
      pack: "data",
      options: [
        option("none", "No scheduled backup", [elaboration("retention.days", "No backup retention window is configured.", 0)]),
        option("daily_30", "Daily backup, 30 days", [elaboration("retention.days", "Daily backups are kept 30 days.", 30)]),
        option("daily_90", "Daily backup, 90 days", [elaboration("retention.days", "Daily backups are kept 90 days.", 90)]),
      ],
      recommend: { prototype: "none", mvp: "daily_30", production: "daily_90" },
    },
    {
      id: "data.concurrent_edits",
      pack: "data",
      options: [
        option("last_write_wins", "Last save wins", [
          elaboration("concurrency.same_entity", "The later save replaces the earlier one; no warning.", 0),
        ]),
        option("optimistic_version", "Warn when someone else changed it", [
          elaboration("concurrency.same_entity", "If the record changed since it was opened, the system rejects the save.", 1),
          elaboration("fields.version", "Every editable entity has an integer version incremented on save.", 1),
        ]),
      ],
      recommend: { prototype: "last_write_wins", mvp: "optimistic_version", production: "optimistic_version" },
    },
  ];
  return new Map(questions.map((question) => [question.id, question]));
}

let cached: StageCatalog | null = null;

export function m2StagePort(): StageCatalog {
  if (cached) return cached;
  const overrides = specials();
  const questions = M2_QUESTIONS.map((spec) => overrides.get(spec.id) ?? steady(spec.id, spec.pack));
  const catalog: StageCatalog = { source: STAGE_CATALOG_SOURCE, questions };
  assertStageCatalogShape(catalog);
  if (questions.length !== 44) throw new Error(`M2 stage port must contain 44 questions, found ${questions.length}`);
  cached = catalog;
  return catalog;
}

function parseRef(value: string): StageOptionRef {
  const splitAt = value.indexOf(":");
  if (splitAt <= 0) throw new Error(`conflict ref ${value} is missing a question id`);
  return { questionId: value.slice(0, splitAt), optionId: value.slice(splitAt + 1) };
}

export function wave1StageQuestions(bundle: WaveBundle): StageQuestion[] {
  return bundle.questions.map((question) => ({
    id: question.id,
    pack: question.packId,
    recommend: {
      prototype: question.stage_recommendations.prototype?.option ?? "",
      mvp: question.stage_recommendations.mvp?.option ?? "",
      production: question.stage_recommendations.production?.option ?? "",
    },
    options: question.options.map((item) => {
      const match = bundle.elaborations.find(
        (elaboration) => elaboration.question === question.id && elaboration.option === item.id,
      );
      const conflictsWith = (match?.cells ?? [])
        .filter((cell) => cell.cell === "conflicts_with")
        .map((cell) => parseRef(cell.value));
      return {
        id: item.id,
        label: item.label,
        conflictsWith,
        requires: [],
        elaborations: [],
      };
    }),
  }));
}

export function combinedStageCatalog(bundle: WaveBundle): StageCatalog {
  const catalog: StageCatalog = {
    source: `${STAGE_CATALOG_SOURCE}+wave1`,
    questions: [...m2StagePort().questions, ...wave1StageQuestions(bundle)],
  };
  assertStageCatalogShape(catalog);
  return catalog;
}

function presetKey(preset: StagePreset): StageKey {
  if (preset === "Prototype") return "prototype";
  if (preset === "MVP") return "mvp";
  return "production";
}

function selectionLabel(questionId: string, optionId: string, label: string): string {
  return `${questionId}=${optionId} (${label})`;
}

/**
 * Local port of Task 077 StageCoherenceSelfTest.
 * Swap for packages/planner/src/tag-detector when that branch is integrated.
 */
export class StageCoherenceSelfTest {
  constructor(private readonly catalog: StageCatalog) {}

  run(): StageCoherenceReport {
    const presets = STAGE_PRESETS.map((preset) => this.runPreset(preset));
    return {
      ok: presets.every(
        (preset) => preset.conflicts.length === 0 && preset.unsatisfiedRequires.length === 0 && preset.numericConflicts.length === 0,
      ),
      source: this.catalog.source,
      presets,
    };
  }

  private runPreset(preset: StagePreset): PresetCoherence {
    const key = presetKey(preset);
    const selected = new Map<string, StageOption>();
    for (const question of this.catalog.questions) {
      const optionId = question.recommend[key];
      const found = question.options.find((item) => item.id === optionId);
      if (!found) throw new Error(`${question.id} has no option ${optionId} for ${preset}`);
      selected.set(question.id, found);
    }
    const conflicts: { left: string; right: string }[] = [];
    const ids = [...selected.keys()];
    for (let leftIndex = 0; leftIndex < ids.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < ids.length; rightIndex += 1) {
        const leftId = ids[leftIndex];
        const rightId = ids[rightIndex];
        if (!leftId || !rightId) continue;
        const left = selected.get(leftId);
        const right = selected.get(rightId);
        if (!left || !right) continue;
        const leftHits = left.conflictsWith.some((item) => item.questionId === rightId && item.optionId === right.id);
        const rightHits = right.conflictsWith.some((item) => item.questionId === leftId && item.optionId === left.id);
        if (leftHits || rightHits) {
          conflicts.push({
            left: selectionLabel(leftId, left.id, left.label),
            right: selectionLabel(rightId, right.id, right.label),
          });
        }
      }
    }
    const unsatisfiedRequires: PresetCoherence["unsatisfiedRequires"][number][] = [];
    for (const [questionId, chosen] of selected) {
      for (const requirement of chosen.requires) {
        const required = selected.get(requirement.questionId);
        if (!required || required.id !== requirement.optionId) {
          unsatisfiedRequires.push({
            questionId,
            optionId: chosen.id,
            missingQuestionId: requirement.questionId,
            missingOptionId: requirement.optionId,
          });
        }
      }
    }
    const numericGroups = new Map<string, NumericConflict["values"][number][]>();
    for (const [questionId, chosen] of selected) {
      for (const item of chosen.elaborations) {
        if (item.numeric === undefined) continue;
        const group = numericGroups.get(item.cell) ?? [];
        group.push({ questionId, optionId: chosen.id, numeric: item.numeric });
        numericGroups.set(item.cell, group);
      }
    }
    const numericConflicts: NumericConflict[] = [];
    for (const [cell, values] of numericGroups) {
      if (new Set(values.map((value) => value.numeric)).size > 1) numericConflicts.push({ cell, values });
    }
    return { preset, conflicts, unsatisfiedRequires, numericConflicts };
  }
}

export function assertStageCatalogShape(catalog: StageCatalog): void {
  const issues: string[] = [];
  const ids = catalog.questions.map((question) => question.id);
  if (new Set(ids).size !== ids.length) issues.push("duplicate question ids");
  const byId = new Map(catalog.questions.map((question) => [question.id, question]));
  for (const question of catalog.questions) {
    const optionIds = new Set(question.options.map((item) => item.id));
    for (const key of ["prototype", "mvp", "production"] as const) {
      if (!optionIds.has(question.recommend[key])) issues.push(`${question.id} recommend.${key} is not an option`);
    }
    for (const item of question.options) {
      for (const ref of [...item.conflictsWith, ...item.requires]) {
        const target = byId.get(ref.questionId);
        if (!target || !target.options.some((candidate) => candidate.id === ref.optionId)) {
          issues.push(`${question.id}:${item.id} references missing ${ref.questionId}:${ref.optionId}`);
        }
      }
    }
  }
  if (issues.length > 0) throw new Error(issues.join("\n"));
}
