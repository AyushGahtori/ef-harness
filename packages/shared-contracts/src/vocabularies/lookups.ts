import { z } from "zod";
import { isOneOf, zodEnumOf } from "./closed-enum.js";

/** Seeded `node_kinds` rows. `isRequirement` mirrors `is_requirement`. */
export const NODE_KINDS = [
  { kind: "decision", isRequirement: false },
  { kind: "spec_item", isRequirement: true },
  { kind: "edge_case", isRequirement: true },
  { kind: "rule", isRequirement: true },
  { kind: "journey", isRequirement: true },
  { kind: "contract", isRequirement: false },
  { kind: "arch_node", isRequirement: false },
  { kind: "research_fact", isRequirement: false },
  { kind: "plan", isRequirement: false },
  { kind: "feature", isRequirement: false },
  { kind: "task", isRequirement: false },
  { kind: "check", isRequirement: false },
  { kind: "waiver", isRequirement: false },
  { kind: "ccr", isRequirement: false },
  { kind: "source", isRequirement: false },
  { kind: "asset", isRequirement: false },
  { kind: "comment", isRequirement: false },
] as const;

/** Seeded `edge_types` rows. `invalidates` mirrors the SQL flag. */
export const EDGE_TYPES = [
  { type: "implements", invalidates: true },
  { type: "verifies", invalidates: true },
  { type: "consumes_contract", invalidates: true },
  { type: "produces_contract", invalidates: true },
  { type: "obeys", invalidates: true },
  { type: "handles_edge_case", invalidates: true },
  { type: "derived_from", invalidates: true },
  { type: "depends_on", invalidates: true },
  { type: "waives", invalidates: true },
  { type: "belongs_to", invalidates: false },
  { type: "documents", invalidates: false },
  { type: "cites", invalidates: false },
  { type: "comments_on", invalidates: false },
  { type: "supersedes", invalidates: false },
] as const;

/**
 * Seeded `task_states` rows.
 * Holds are not states: `HELD` is intentionally absent.
 */
export const TASK_STATES = [
  { state: "DRAFTED", claimable: false, done: false, terminal: false },
  { state: "READY", claimable: true, done: false, terminal: false },
  { state: "LEASED", claimable: false, done: false, terminal: false },
  { state: "CODING", claimable: false, done: false, terminal: false },
  { state: "STATIC_AUDIT", claimable: false, done: false, terminal: false },
  { state: "CLEAN_VERIFY", claimable: false, done: false, terminal: false },
  { state: "ACCEPTED", claimable: false, done: true, terminal: false },
  { state: "MERGED_TO_FEATURE", claimable: false, done: true, terminal: true },
  { state: "WAITING_INPUT", claimable: false, done: false, terminal: false },
  { state: "PARKED", claimable: false, done: false, terminal: false },
  { state: "ESCALATED", claimable: false, done: false, terminal: false },
  { state: "EXHAUSTED", claimable: false, done: false, terminal: false },
  { state: "HUMAN_OWNED", claimable: false, done: false, terminal: false },
  { state: "SUPERSEDED", claimable: false, done: false, terminal: true },
  { state: "CANCELLED", claimable: false, done: false, terminal: true },
] as const;

/** Seeded `feature_states` rows. */
export const FEATURE_STATES = [
  { state: "PLANNED", terminal: false },
  { state: "JIT_READY", terminal: false },
  { state: "IN_WAVE", terminal: false },
  { state: "LEAVES_MERGED", terminal: false },
  { state: "WIRED", terminal: false },
  { state: "JOURNEY_PASSED", terminal: false },
  { state: "QUEUED_FOR_MERGE", terminal: false },
  { state: "MERGED", terminal: false },
  { state: "DONE", terminal: true },
  { state: "BLOCKED", terminal: false },
  { state: "REOPENED", terminal: false },
  { state: "DEFERRED", terminal: false },
  { state: "ABANDONED", terminal: true },
] as const;

/** Seeded `project_states` rows. Pausing is a flag, not one of these states. */
export const PROJECT_STATES = [
  "DISCOVERY",
  "SPEC_COMPLETE",
  "UPFRONT_DOCS",
  "PREVIEW",
  "PHASE0",
  "WAVES",
  "COMPLETION",
  "READY_TO_LAND",
  "LANDED",
  "SHIPPING",
] as const;

/** `node_changes.class` CHECK list. */
export const CHANGE_CLASSES = [
  "cosmetic",
  "clarifying",
  "compatible",
  "breaking",
  "created",
  "retired",
] as const;

/** `task_holds.reason` values. A hold is a row, never a task state. */
export const HOLD_REASONS = [
  "user_pause",
  "requirement_change",
  "budget",
  "ccr",
  "governor",
] as const;

/** `inbox_items.kind` values. */
export const INBOX_KINDS = [
  "question",
  "secret",
  "human_step",
  "approval",
  "conflict",
  "fyi",
] as const;

/** `effects.state` CHECK list. */
export const EFFECT_STATES = [
  "intended",
  "approved",
  "sent",
  "confirmed",
  "failed",
  "unknown",
] as const;

/** `artifacts.retention` CHECK list. */
export const RETENTION_CLASSES = ["evidence", "diagnostic", "ephemeral", "asset"] as const;

/** `grants.priority_class` CHECK list from the global database. */
export const PRIORITY_CLASSES = ["interactive", "foreground", "background", "batch"] as const;

export type NodeKind = (typeof NODE_KINDS)[number]["kind"];
export type EdgeType = (typeof EDGE_TYPES)[number]["type"];
export type TaskState = (typeof TASK_STATES)[number]["state"];
export type FeatureState = (typeof FEATURE_STATES)[number]["state"];
export type ProjectState = (typeof PROJECT_STATES)[number];
export type ChangeClass = (typeof CHANGE_CLASSES)[number];
export type HoldReason = (typeof HOLD_REASONS)[number];
export type InboxKind = (typeof INBOX_KINDS)[number];
export type EffectState = (typeof EFFECT_STATES)[number];
export type RetentionClass = (typeof RETENTION_CLASSES)[number];
export type PriorityClass = (typeof PRIORITY_CLASSES)[number];

const nodeKindNames = NODE_KINDS.map((row) => row.kind);
const edgeTypeNames = EDGE_TYPES.map((row) => row.type);
const taskStateNames = TASK_STATES.map((row) => row.state);
const featureStateNames = FEATURE_STATES.map((row) => row.state);

export const NodeKindSchema = zodEnumOf(nodeKindNames);
export const EdgeTypeSchema = zodEnumOf(edgeTypeNames);
export const TaskStateSchema = zodEnumOf(taskStateNames);
export const FeatureStateSchema = zodEnumOf(featureStateNames);
export const ProjectStateSchema = z.enum(PROJECT_STATES);
export const ChangeClassSchema = z.enum(CHANGE_CLASSES);
export const HoldReasonSchema = z.enum(HOLD_REASONS);
export const InboxKindSchema = z.enum(INBOX_KINDS);
export const EffectStateSchema = z.enum(EFFECT_STATES);
export const RetentionClassSchema = z.enum(RETENTION_CLASSES);
export const PriorityClassSchema = z.enum(PRIORITY_CLASSES);

export const isNodeKind = isOneOf(nodeKindNames);
export const isEdgeType = isOneOf(edgeTypeNames);
export const isTaskState = isOneOf(taskStateNames);
export const isFeatureState = isOneOf(featureStateNames);
export const isProjectState = isOneOf(PROJECT_STATES);
export const isChangeClass = isOneOf(CHANGE_CLASSES);
export const isHoldReason = isOneOf(HOLD_REASONS);
export const isInboxKind = isOneOf(INBOX_KINDS);
export const isEffectState = isOneOf(EFFECT_STATES);
export const isRetentionClass = isOneOf(RETENTION_CLASSES);
export const isPriorityClass = isOneOf(PRIORITY_CLASSES);
