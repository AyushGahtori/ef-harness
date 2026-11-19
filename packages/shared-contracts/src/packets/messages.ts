import { z } from "zod/v4";
import {
  ARRAY_MAX_ITEMS,
  idSchema,
  jsonValueSchema,
  nonNegativeIntSchema,
  pathSchema,
  positiveIntSchema,
  withinJsonByteLimit,
} from "./bounds.js";
import {
  BudgetSchema,
  ContractUseSchema,
  ContractVersionSchema,
  DependencyIntentSchema,
  GitBaseSchema,
  LimitsSchema,
  LocalCheckSchema,
  MigrationIntentSchema,
  RequirementClauseSchema,
  SkillPinSchema,
  WiringNeedSchema,
  workerNoteSchema,
  CcrChangeSchema,
} from "./intents.js";

const pathListSchema = z.array(pathSchema).max(ARRAY_MAX_ITEMS);
const intentList = <T extends z.ZodType>(item: T) => z.array(item).max(ARRAY_MAX_ITEMS);

export const TaskPacketV1Schema = withinJsonByteLimit(
  z
    .object({
      schema: z.literal("task-packet@1"),
      task: idSchema,
      attempt: positiveIntSchema,
      epoch: nonNegativeIntSchema,
      brief_version: positiveIntSchema,
      base: GitBaseSchema,
      goal: workerNoteSchema.refine((goal) => goal.trim().length > 0, {
        message: "goal must not be empty",
      }),
      write_scope: pathListSchema,
      must: z.array(RequirementClauseSchema).max(ARRAY_MAX_ITEMS),
      contracts: z.array(ContractUseSchema).max(ARRAY_MAX_ITEMS),
      checks_visible: z.array(idSchema).max(ARRAY_MAX_ITEMS),
      checks_hidden_count: z
        .int()
        .nonnegative()
        .refine((value) => !Object.is(value, -0), {
          message: "signed zero is not an integer unit",
        }),
      should: z.array(RequirementClauseSchema).max(ARRAY_MAX_ITEMS),
      skills: z.array(SkillPinSchema).max(ARRAY_MAX_ITEMS),
      tools: z.array(z.string().min(1).max(128)).max(ARRAY_MAX_ITEMS),
      budget: BudgetSchema,
      limits: LimitsSchema,
    })
    .strict(),
);

/** The pushed brief and the task packet are the same document. */
export const WorkerBriefSchema = TaskPacketV1Schema;

export const CandidateV1Schema = withinJsonByteLimit(
  z
    .object({
      schema: z.literal("candidate@1"),
      task: idSchema,
      attempt: positiveIntSchema,
      epoch: nonNegativeIntSchema,
      commit: z.string().min(1).max(128),
      changed_paths: pathListSchema,
      dependency_intents: intentList(DependencyIntentSchema),
      migration_intents: intentList(MigrationIntentSchema).default(() => []),
      wiring_needs: intentList(WiringNeedSchema),
      local_checks: z.array(LocalCheckSchema).max(ARRAY_MAX_ITEMS),
      note: workerNoteSchema,
    })
    .strict(),
);

export const ExportChangeSchema = z
  .object({
    symbol: idSchema,
    kind: z.enum(["added", "removed", "modified"]),
  })
  .strict();

export const DiffstatSchema = z
  .object({
    files: z.int().nonnegative(),
    insertions: z.int().nonnegative(),
    deletions: z.int().nonnegative(),
  })
  .strict()
  .refine(
    (stat) => !Object.is(stat.files, -0) && !Object.is(stat.insertions, -0) && !Object.is(stat.deletions, -0),
    { message: "signed zero is not an integer unit" },
  );

export const MergeInstructionsV1Schema = withinJsonByteLimit(
  z
    .object({
      schema: z.literal("merge-instructions@1"),
      task: idSchema,
      commit: z.string().min(1).max(128),
      diffstat: DiffstatSchema,
      exports_changed: z.array(ExportChangeSchema).max(ARRAY_MAX_ITEMS),
      dependency_intents: intentList(DependencyIntentSchema),
      migration_intents: intentList(MigrationIntentSchema),
      wiring_needs: intentList(WiringNeedSchema),
      contracts_verified: z.array(ContractVersionSchema).max(ARRAY_MAX_ITEMS),
      receipt: idSchema,
    })
    .strict(),
);

export const CCR_CLASSES = ["additive", "breaking"] as const;
export const CCR_STATUSES = ["open", "approved", "rejected", "applied"] as const;

export const CcrV1Schema = withinJsonByteLimit(
  z
    .object({
      schema: z.literal("ccr@1"),
      id: idSchema,
      from_feature: idSchema,
      target: z.string().min(1).max(256),
      change: CcrChangeSchema,
      reason: z.string().min(1).max(4_096),
      class: z.enum(CCR_CLASSES),
      status: z.enum(CCR_STATUSES),
    })
    .strict(),
);

export const EventV1Schema = withinJsonByteLimit(
  z
    .object({
      schema: z.literal("event@1"),
      id: idSchema,
      seq: z
        .int()
        .nonnegative()
        .refine((value) => !Object.is(value, -0), {
          message: "signed zero is not an integer unit",
        }),
      type: idSchema,
      revision: z
        .int()
        .nonnegative()
        .refine((value) => !Object.is(value, -0), {
          message: "signed zero is not an integer unit",
        }),
      subject: idSchema,
      consumers: z.array(z.string().min(1).max(64)).min(1).max(64),
      payload: jsonValueSchema,
      created: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/, {
        message: "created must be a UTC ISO-8601 timestamp",
      }),
    })
    .strict(),
);

export type TaskPacketV1 = z.infer<typeof TaskPacketV1Schema>;
export type WorkerBrief = TaskPacketV1;
export type CandidateV1 = z.infer<typeof CandidateV1Schema>;
export type MergeInstructionsV1 = z.infer<typeof MergeInstructionsV1Schema>;
export type CcrV1 = z.infer<typeof CcrV1Schema>;
export type EventV1 = z.infer<typeof EventV1Schema>;
