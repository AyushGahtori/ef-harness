import { z } from "zod";
import {
  EvidenceLocatorSchema,
  ImageRegionSchema,
  type EvidenceLocator,
} from "../packets/locators.js";

export const APPROVED_BASES = [
  "explicit",
  "derived",
  "delegated",
  "defaulted",
  "proposed",
  "observed",
] as const;

export type ApprovedBasis = (typeof APPROVED_BASES)[number];

export const ApprovedBasisSchema = z.enum(APPROVED_BASES);

/** Bases `batch-resolve@1` may attach, and only when `status` is `settled`. */
export const DiscoverySettledBasisSchema = z.enum(["explicit", "derived", "delegated"]);

export const TOUCHES_TAGS = [
  "personal_data",
  "credentials",
  "money",
  "user_content",
  "authn",
  "authz",
  "session",
  "scheduling",
  "time_display",
  "file_upload",
  "file_download",
  "external_api",
  "inbound_webhook",
  "outbound_message",
  "background_job",
  "realtime",
  "destructive_write",
  "bulk_write",
  "migration",
  "search",
  "form_input",
  "route",
  "interactive_ui",
  "logging",
  "config_env",
  "caching",
  "rate_limited",
  "concurrent_edit",
] as const;

export const TouchesTagSchema = z.enum(TOUCHES_TAGS);

export type TouchesTag = (typeof TOUCHES_TAGS)[number];

export const IdSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => !/\s/.test(value), "id must not contain whitespace");

export const TextSchema = z.string().trim().min(1);

/** Non-blank text that keeps the original characters, including edge spaces. */
export const VerbatimTextSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, "text must not be blank");

export const NonNegativeIntSchema = z.number().int().nonnegative();

export const PositiveIntSchema = z.number().int().positive();

export const UnitIntervalSchema = z.number().min(0).max(1);

export const OpeningRubricIdSchema = z.string().regex(/^opening\.[1-5]$/);

export function addIssue(
  ctx: z.RefinementCtx,
  path: (string | number)[],
  message: string,
): void {
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path,
    message,
  });
}

const QuotedTextSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, "quote must not be blank");

export const TurnEvidenceSchema = z
  .object({
    turn: IdSchema,
    start: NonNegativeIntSchema,
    end: PositiveIntSchema,
    quote: QuotedTextSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.end <= value.start) {
      addIssue(ctx, ["end"], "end must be greater than start");
    }
  });

export const ResearchQuoteSchema = z.string().trim().min(10);

export const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(5, 7));
    const day = Number(value.slice(8, 10));
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
      return false;
    }
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  }, "date must be a real calendar day");

export const HttpUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  }, "url must use http or https");

export const ScopePredicateSchema = z
  .object({
    any: z.array(TouchesTagSchema).default([]),
    all: z.array(TouchesTagSchema).default([]),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.any.length === 0 && value.all.length === 0) {
      addIssue(ctx, [], "scope predicate must list at least one tag in any or all");
    }
  });

export { ImageRegionSchema };
export const LocatorSchema = EvidenceLocatorSchema;
export type Locator = EvidenceLocator;

export function refineLocator(
  locator: Locator,
  ctx: z.RefinementCtx,
  path: (string | number)[],
): void {
  if (locator.kind === "turn") {
    if (locator.end <= locator.start) {
      addIssue(ctx, [...path, "end"], "end must be greater than start");
    }
    return;
  }
  if (locator.kind === "pdf" || locator.kind === "docx" || locator.kind === "text") {
    const start = "charStart" in locator ? locator.charStart : locator.char_start;
    const end = "charEnd" in locator ? locator.charEnd : locator.char_end;
    const endField = "charEnd" in locator ? "charEnd" : "char_end";
    if (end <= start) {
      addIssue(ctx, [...path, endField], "end must be greater than start");
    }
  }
  if (locator.kind === "text") {
    const lineStart = "lineStart" in locator ? locator.lineStart : locator.line_start;
    const lineEnd = "lineEnd" in locator ? locator.lineEnd : locator.line_end;
    const lineEndField = "lineEnd" in locator ? "lineEnd" : "line_end";
    const lineStartField = "lineStart" in locator ? "lineStart" : "line_start";
    if (lineEnd < lineStart) {
      addIssue(ctx, [...path, lineEndField], `${lineEndField} must be >= ${lineStartField}`);
    }
  }
}

const ScreenActionSchema = z
  .object({
    button: TextSchema,
    variant: z.enum(["primary", "secondary", "danger"]),
  })
  .strict();

const ScreenRegionSchema = z
  .object({
    slot: z.enum(["header", "main", "nav", "footer", "aside"]),
    title: z.string().nullable(),
    component: z.string().nullable(),
    actions: z.array(ScreenActionSchema),
    columns: z.array(TextSchema),
    empty_state: z.string().nullable(),
  })
  .strict();

export const ScreenSpecSchema = z
  .object({
    screen: IdSchema,
    route: TextSchema,
    template: z.enum(["app-shell", "page-header", "list-detail", "form", "empty", "error"]),
    regions: z.array(ScreenRegionSchema),
    states: z.array(z.enum(["loading", "empty", "populated", "error"])).min(1),
    density: z.enum(["compact", "balanced", "comfortable"]),
    references: z.array(TextSchema),
  })
  .strict();

export const FieldPairSchema = z
  .object({
    key: IdSchema,
    value: z.union([z.string(), z.number().int(), z.boolean(), z.null()]),
  })
  .strict();

export const EARS_TEXT_PATTERN =
  /^(?:when\s+.+,\s+|while\s+.+,\s+|if\s+.+,\s+then\s+|where\s+.+,\s+)?the\s+\S.+\bshall\b\s+\S.+$/i;
