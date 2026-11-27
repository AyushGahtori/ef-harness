import type { StageCatalog, StageQuestion } from "./ports.js";
import { STAGE_CATALOG_SOURCE } from "./ports.js";

/** Question ids from the Task 077 M2 stage port (Tasks 075 and 076). */
export const M2_QUESTION_IDS = [
  "product.purpose",
  "product.audience",
  "product.stage",
  "actors.roles",
  "workflows.primary",
  "workflows.secondary",
  "data.entities",
  "data.ownership",
  "product.persists_data",
  "errors.user_facing_style",
  "testing.expectations",
  "delivery.platform",
  "deploy.target",
  "constraints.deadline_budget",
  "constraints.stack_preferences",
  "integrations.external",
  "time.locale_timezone",
  "content.language",
  "data.storage.engine",
  "data.retention_deletion",
  "data.personal_data",
  "data.import_existing",
  "data.backup",
  "data.concurrent_edits",
  "auth.needed",
  "auth.method",
  "auth.roles_permissions",
  "auth.session_length",
  "auth.account_recovery",
  "ui.pages_inventory",
  "ui.look_and_feel",
  "ui.responsive_targets",
  "ui.forms_validation_style",
  "ui.states_style",
  "ui.accessibility_level",
  "api.consumers",
  "api.style",
  "api.error_format",
  "api.rate_limits",
  "jobs.background_needed",
  "cli.distribution",
  "cli.config_location",
  "cli.output_format",
  "cli.exit_codes",
] as const;

/** Topic ids for the Task 103 Wave 1 packs. The pack files are not on this base. */
export const WAVE1_QUESTION_IDS = [
  "payments.billing_model",
  "payments.checkout",
  "payments.webhook_fulfillment",
  "payments.proration",
  "payments.refunds",
  "payments.tax",
  "payments.currency",
  "payments.key_isolation",
  "notifications.channels",
  "notifications.timing",
  "notifications.preferences",
  "notifications.delivery_failure",
  "notifications.templates",
  "notifications.rate_limits",
  "ai.task_type",
  "ai.grounding",
  "ai.output_shape",
  "ai.quotas",
  "ai.injection_boundary",
  "ai.eval_fallback",
  "privacy.export_erasure",
  "privacy.audit_retention",
  "scale.cache_freshness",
  "scale.queue_retries",
  "scale.rate_abuse",
  "scale.region_latency",
  "obs.telemetry",
  "ops.backup_rpo",
] as const;

function stub(id: string, pack: string): StageQuestion {
  return {
    id,
    pack,
    recommend: { prototype: "catalog_default", mvp: "catalog_default", production: "catalog_default" },
    options: [
      {
        id: "catalog_default",
        label: "Catalog default",
        conflictsWith: [],
        requires: [],
        elaborations: [],
      },
    ],
  };
}

export function priorStageQuestions(): StageQuestion[] {
  return [
    ...M2_QUESTION_IDS.map((id) => stub(id, id.split(".")[0] ?? "m2")),
    ...WAVE1_QUESTION_IDS.map((id) => stub(id, id.split(".")[0] ?? "wave1")),
  ];
}

export function buildV1StageCatalog(wave2: readonly StageQuestion[]): StageCatalog {
  return {
    source: STAGE_CATALOG_SOURCE,
    questions: [...priorStageQuestions(), ...wave2],
  };
}
