import { z } from "zod";
import { isOneOf } from "./closed-enum.js";

/** Settled-value bases. Statuses are a different vocabulary and never belong here. */
export const SETTLED_BASES = [
  "explicit",
  "derived",
  "delegated",
  "defaulted",
  "proposed",
  "observed",
] as const;

/** Unsettled criterion or cell statuses. These are never bases. */
export const CRITERION_STATUSES = [
  "open",
  "partial",
  "missing",
  "conflict",
  "asked",
  "deferred",
  "not_applicable",
  "settled",
] as const;

export type SettledBasis = (typeof SETTLED_BASES)[number];
export type CriterionStatus = (typeof CRITERION_STATUSES)[number];

export const SettledBasisSchema = z.enum(SETTLED_BASES);
export const CriterionStatusSchema = z.enum(CRITERION_STATUSES);

export const isSettledBasis = isOneOf(SETTLED_BASES);
export const isCriterionStatus = isOneOf(CRITERION_STATUSES);
