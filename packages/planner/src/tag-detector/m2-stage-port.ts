import {
  assertStageCatalogShape,
  type StageCatalog,
  type StageElaboration,
  type StageOption,
  type StageQuestion,
} from "./stage-coherence.js";

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
    options: [
      option("default", `Recommended ${id}`, [elaboration(`${id}.value`, `Default for ${id}`, 1)]),
    ],
    recommend: { prototype: "default", mvp: "default", production: "default" },
  };
}

function specials(): Map<string, StageQuestion> {
  const questions: StageQuestion[] = [
    {
      id: "auth.needed",
      pack: "auth",
      options: [
        option(
          "no_auth",
          "No auth",
          [elaboration("auth.required", "Requests are anonymous.", 0)],
          {
            conflictsWith: [
              { questionId: "product.persists_data", optionId: "per_user_saved_preferences" },
            ],
            requires: [],
          },
        ),
        option(
          "session_auth",
          "Signed-in session",
          [elaboration("auth.required", "A server session identifies the caller.", 1)],
        ),
      ],
      recommend: { prototype: "no_auth", mvp: "session_auth", production: "session_auth" },
    },
    {
      id: "auth.method",
      pack: "auth",
      options: [
        option(
          "not_used",
          "No sign-in method",
          [elaboration("auth.method_code", "No sign-in method is configured.", 0)],
          {
            conflictsWith: [],
            requires: [{ questionId: "auth.needed", optionId: "no_auth" }],
          },
        ),
        option(
          "magic_link",
          "Magic link",
          [elaboration("auth.method_code", "Sign-in uses a single-use magic link.", 1)],
          {
            conflictsWith: [],
            requires: [{ questionId: "auth.needed", optionId: "session_auth" }],
          },
        ),
      ],
      recommend: { prototype: "not_used", mvp: "magic_link", production: "magic_link" },
    },
    {
      id: "product.persists_data",
      pack: "core",
      options: [
        option(
          "ephemeral",
          "Ephemeral session data",
          [elaboration("prefs.saved", "No per-user preferences are stored.", 0)],
        ),
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
      recommend: {
        prototype: "ephemeral",
        mvp: "per_user_saved_preferences",
        production: "per_user_saved_preferences",
      },
    },
    {
      id: "data.retention_deletion",
      pack: "data",
      options: [
        option("keep_none", "No retention window", [
          elaboration("retention.days", "Nothing is retained past the request.", 0),
        ]),
        option("keep_30", "Keep 30 days", [
          elaboration("retention.days", "Retained records expire after 30 days.", 30),
        ]),
        option("keep_90", "Keep 90 days", [
          elaboration("retention.days", "Retained records expire after 90 days.", 90),
        ]),
      ],
      recommend: { prototype: "keep_none", mvp: "keep_30", production: "keep_90" },
    },
    {
      id: "data.backup",
      pack: "data",
      options: [
        option("none", "No scheduled backup", [
          elaboration("retention.days", "No backup retention window is configured.", 0),
        ]),
        option("daily_30", "Daily backup, 30 days", [
          elaboration("retention.days", "Daily backups are kept 30 days.", 30),
        ]),
        option("daily_90", "Daily backup, 90 days", [
          elaboration("retention.days", "Daily backups are kept 90 days.", 90),
        ]),
      ],
      recommend: { prototype: "none", mvp: "daily_30", production: "daily_90" },
    },
    {
      id: "data.concurrent_edits",
      pack: "data",
      options: [
        option("last_write_wins", "Last save wins", [
          elaboration(
            "concurrency.same_entity",
            "The later save replaces the earlier one; no warning.",
            0,
          ),
        ]),
        option("optimistic_version", "Warn when someone else changed it", [
          elaboration(
            "concurrency.same_entity",
            "If the record changed since it was opened, then the system shall reject the save and show a reload prompt.",
            1,
          ),
          elaboration(
            "fields.version",
            "Every editable entity has an integer version incremented on save.",
            1,
          ),
        ]),
      ],
      recommend: {
        prototype: "last_write_wins",
        mvp: "optimistic_version",
        production: "optimistic_version",
      },
    },
  ];
  return new Map(questions.map((question) => [question.id, question]));
}

let cached: StageCatalog | null = null;

export function m2StagePort(): StageCatalog {
  if (cached) return cached;
  const overrides = specials();
  const questions = M2_QUESTIONS.map((spec) => overrides.get(spec.id) ?? steady(spec.id, spec.pack));
  const catalog: StageCatalog = { source: "local-port:task-075-076", questions };
  assertStageCatalogShape(catalog);
  if (questions.length !== 44) {
    throw new Error(`M2 stage port must contain 44 questions, found ${questions.length}`);
  }
  cached = catalog;
  return catalog;
}

export function injectPrototypeAuthPreferenceClash(catalog: StageCatalog): StageCatalog {
  return {
    source: catalog.source,
    questions: catalog.questions.map((question) =>
      question.id === "product.persists_data"
        ? {
            ...question,
            recommend: { ...question.recommend, prototype: "per_user_saved_preferences" },
          }
        : question,
    ),
  };
}

export function injectNumericDefaultClash(catalog: StageCatalog): StageCatalog {
  return {
    source: catalog.source,
    questions: catalog.questions.map((question) =>
      question.id === "data.backup"
        ? { ...question, recommend: { ...question.recommend, prototype: "daily_30" } }
        : question,
    ),
  };
}
