import { z } from "zod";
import { isOneOf } from "./closed-enum.js";

/** Logical resource names registered in `names.kind`. */
export const NAME_KINDS = [
  "http_route",
  "page_route",
  "db_table",
  "db_column",
  "db_index",
  "db_constraint",
  "env_var",
  "storage_key",
  "cookie_name",
  "cache_prefix",
  "event",
  "queue",
  "job",
  "permission",
  "feature_flag",
  "i18n_namespace",
  "cli_command",
] as const;

export type NameKind = (typeof NAME_KINDS)[number];

export const NameKindSchema = z.enum(NAME_KINDS);
export const isNameKind = isOneOf(NAME_KINDS);
