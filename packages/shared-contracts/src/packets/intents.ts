import { z } from "zod";
import {
  idSchema,
  microUsdSchema,
  noteSchema,
  pathSchema,
  positiveIntSchema,
  ppmSchema,
  SHORT_TEXT_MAX_CHARS,
  shortTextSchema,
  slotSchema,
} from "./bounds.js";

export const RequirementClauseSchema = z
  .object({
    id: idSchema,
    v: positiveIntSchema,
    text: shortTextSchema,
  })
  .strict();

export const ContractVersionSchema = z
  .object({
    id: idSchema,
    v: positiveIntSchema,
  })
  .strict();

export const ContractUseSchema = ContractVersionSchema.extend({
  role: z.enum(["consume", "produce"]),
}).strict();

export const SkillPinSchema = z
  .object({
    id: idSchema,
    digest: z.string().min(1).max(256),
  })
  .strict();

export const GitBaseSchema = z
  .object({
    branch: z.string().min(1).max(256),
    commit: z.string().min(1).max(128),
  })
  .strict();

/** `usd` is micro-USD. `allowance` values are ppm of a plan window. `local_slots` counts local slots. */
export const BudgetSchema = z
  .object({
    usd: microUsdSchema,
    allowance: z.record(z.string().min(1).max(128), ppmSchema),
    local_slots: slotSchema,
  })
  .strict();

export const LimitsSchema = z
  .object({
    wall_min: positiveIntSchema,
    max_steps: positiveIntSchema,
  })
  .strict();

export const AddColumnSchema = z
  .object({
    name: idSchema,
    type: z.string().min(1).max(64),
    nullable: z.boolean(),
  })
  .strict();

/** Closed change object. Unknown keys such as `approved` are rejected. */
export const CcrChangeSchema = z
  .object({
    add_column: AddColumnSchema,
  })
  .strict();

export const DependencyIntentSchema = z
  .object({
    package: z
      .string()
      .min(1)
      .max(214)
      .refine((name) => !/\s/.test(name) && !name.includes("://"), {
        message: "package name must be a bare package specifier",
      }),
    version: z.string().min(1).max(128),
    reason: shortTextSchema,
  })
  .strict();

export const MigrationIntentSchema = z
  .object({
    table: idSchema,
    change: CcrChangeSchema,
    reason: shortTextSchema,
  })
  .strict();

export const RouteWiringNeedSchema = z
  .object({
    kind: z.literal("route"),
    path: pathSchema,
    component: idSchema,
  })
  .strict();

export const BarrelWiringNeedSchema = z
  .object({
    kind: z.literal("barrel"),
    module: pathSchema,
    export_name: idSchema,
  })
  .strict();

export const LockfileWiringNeedSchema = z
  .object({
    kind: z.literal("lockfile"),
    package: z.string().min(1).max(214),
  })
  .strict();

export const SchemaIndexWiringNeedSchema = z
  .object({
    kind: z.literal("schema_index"),
    name: idSchema,
  })
  .strict();

export const WiringNeedSchema = z.discriminatedUnion("kind", [
  RouteWiringNeedSchema,
  BarrelWiringNeedSchema,
  LockfileWiringNeedSchema,
  SchemaIndexWiringNeedSchema,
]);

export const LocalCheckSchema = z
  .object({
    cmd: z.string().min(1).max(SHORT_TEXT_MAX_CHARS),
    exit: z
      .number()
      .int()
      .min(0)
      .max(2_147_483_647)
      .refine((value) => !Object.is(value, -0), {
        message: "signed zero is not an integer unit",
      }),
  })
  .strict();

export const workerNoteSchema = noteSchema;

export type RequirementClause = z.infer<typeof RequirementClauseSchema>;
export type ContractVersion = z.infer<typeof ContractVersionSchema>;
export type ContractUse = z.infer<typeof ContractUseSchema>;
export type SkillPin = z.infer<typeof SkillPinSchema>;
export type GitBase = z.infer<typeof GitBaseSchema>;
export type Budget = z.infer<typeof BudgetSchema>;
export type Limits = z.infer<typeof LimitsSchema>;
export type CcrChange = z.infer<typeof CcrChangeSchema>;
export type DependencyIntent = z.infer<typeof DependencyIntentSchema>;
export type MigrationIntent = z.infer<typeof MigrationIntentSchema>;
export type WiringNeed = z.infer<typeof WiringNeedSchema>;
export type LocalCheck = z.infer<typeof LocalCheckSchema>;
