import { z } from "zod";
import { UnknownPromptContractError } from "./errors.js";
import { extractFencedJson } from "./extract-json.js";
import {
  AskOwnerResponderV1Schema,
  CockpitExplainerV1Schema,
  DocImportV1Schema,
  EntailmentCheckerV1Schema,
  IntakeExtractorV1Schema,
  IssueTriageV1Schema,
  ModuleCardWriterV1Schema,
  SweepPlannerV1Schema,
  SweepWorkerV1Schema,
  TasteReviewerV1Schema,
  TurnSummarizerV1Schema,
  VisualSteerV1Schema,
} from "./schemas/auxiliary.js";
import { BatchResolveV1Schema, ClarifyV1Schema, OpeningReviewV1Schema } from "./schemas/discovery.js";
import {
  BlindBinderV1Schema,
  CiTriageV1Schema,
  FeatureIntegratorV1Schema,
  FinalProjectAuditorV1Schema,
  InvestigatorV1Schema,
  LeafWorkerV1Schema,
  ProjectIntegratorV1Schema,
  ReviewerV1Schema,
} from "./schemas/execution.js";
import {
  FeatureArchitectV1Schema,
  FeaturePlannerV1Schema,
  FeatureResearcherV1Schema,
  MasterPlannerV1Schema,
  OracleAuthorV1Schema,
  SystemArchitectV1Schema,
} from "./schemas/planning.js";
import {
  ContradictionCheckV1Schema,
  RouterV1Schema,
  SpecExpanderV1Schema,
} from "./schemas/steering.js";

export const PROMPT_MODEL_LEVELS = [
  "Cheap",
  "Mid",
  "Senior",
  "Manager",
  "Junior\u2013Senior",
] as const;

export type PromptModelLevel = (typeof PROMPT_MODEL_LEVELS)[number];

export type DefaultModelLevel = PromptModelLevel | "task-author";

export type PromptToolAccess = "none" | "scoped";

export interface PromptContractDefinition {
  readonly contractId: string;
  readonly level: string;
  readonly defaultLevel: DefaultModelLevel;
  readonly allowedLevels: readonly PromptModelLevel[];
  readonly stage: string;
  readonly independentFamily: boolean;
  readonly toolAccess: PromptToolAccess;
  readonly output: z.ZodType;
}

const ALL_LEVELS = PROMPT_MODEL_LEVELS;
const CHEAP_OR_MID = ["Cheap", "Mid"] as const satisfies readonly PromptModelLevel[];
const INDEPENDENT_FAMILY = new Set(["oracle-author@1", "entailment-checker@1"]);

function promptContracts<T extends Record<string, PromptContractDefinition>>(contracts: T): T {
  for (const [id, contract] of Object.entries(contracts)) {
    if (contract.contractId !== id) {
      throw new Error(`prompt contract key ${id} does not match ${contract.contractId}`);
    }
    if (contract.independentFamily !== INDEPENDENT_FAMILY.has(id)) {
      throw new Error(`independent family flag mismatch for ${id}`);
    }
    if (
      contract.defaultLevel !== "task-author" &&
      !contract.allowedLevels.includes(contract.defaultLevel)
    ) {
      throw new Error(`default level for ${id} is not in allowedLevels`);
    }
  }
  return Object.freeze(contracts);
}

const discoveryLevel = "Cheap / Mid";
const discoveryStage = "Discovery ([opening prompts](opening-prompts.md))";

export const PROMPT_CONTRACTS = promptContracts({
  "opening-review@1": {
    contractId: "opening-review@1",
    level: discoveryLevel,
    defaultLevel: "Cheap",
    allowedLevels: CHEAP_OR_MID,
    stage: discoveryStage,
    independentFamily: false,
    toolAccess: "none",
    output: OpeningReviewV1Schema,
  },
  "batch-resolve@1": {
    contractId: "batch-resolve@1",
    level: discoveryLevel,
    defaultLevel: "Cheap",
    allowedLevels: CHEAP_OR_MID,
    stage: discoveryStage,
    independentFamily: false,
    toolAccess: "none",
    output: BatchResolveV1Schema,
  },
  "clarify@1": {
    contractId: "clarify@1",
    level: discoveryLevel,
    defaultLevel: "Cheap",
    allowedLevels: CHEAP_OR_MID,
    stage: discoveryStage,
    independentFamily: false,
    toolAccess: "none",
    output: ClarifyV1Schema,
  },
  "router@1": {
    contractId: "router@1",
    level: "Cheap",
    defaultLevel: "Cheap",
    allowedLevels: ["Cheap"],
    stage: "Steering",
    independentFamily: false,
    toolAccess: "none",
    output: RouterV1Schema,
  },
  "spec-expander@1": {
    contractId: "spec-expander@1",
    level: "Mid",
    defaultLevel: "Mid",
    allowedLevels: ["Mid"],
    stage: "Spec expansion",
    independentFamily: false,
    toolAccess: "none",
    output: SpecExpanderV1Schema,
  },
  "contradiction-check@1": {
    contractId: "contradiction-check@1",
    level: "Cheap",
    defaultLevel: "Cheap",
    allowedLevels: ["Cheap"],
    stage: "Spec expansion",
    independentFamily: false,
    toolAccess: "none",
    output: ContradictionCheckV1Schema,
  },
  "feature-researcher@1": {
    contractId: "feature-researcher@1",
    level: "Mid",
    defaultLevel: "Mid",
    allowedLevels: ["Mid"],
    stage: "Research",
    independentFamily: false,
    toolAccess: "scoped",
    output: FeatureResearcherV1Schema,
  },
  "system-architect@1": {
    contractId: "system-architect@1",
    level: "Manager",
    defaultLevel: "Manager",
    allowedLevels: ["Manager"],
    stage: "Architecture",
    independentFamily: false,
    toolAccess: "none",
    output: SystemArchitectV1Schema,
  },
  "feature-architect@1": {
    contractId: "feature-architect@1",
    level: "Senior",
    defaultLevel: "Senior",
    allowedLevels: ["Senior"],
    stage: "Architecture (just in time)",
    independentFamily: false,
    toolAccess: "none",
    output: FeatureArchitectV1Schema,
  },
  "master-planner@1": {
    contractId: "master-planner@1",
    level: "Manager",
    defaultLevel: "Manager",
    allowedLevels: ["Manager"],
    stage: "Planning",
    independentFamily: false,
    toolAccess: "none",
    output: MasterPlannerV1Schema,
  },
  "feature-planner@1": {
    contractId: "feature-planner@1",
    level: "Senior",
    defaultLevel: "Senior",
    allowedLevels: ["Senior"],
    stage: "Planning (just in time)",
    independentFamily: false,
    toolAccess: "none",
    output: FeaturePlannerV1Schema,
  },
  "leaf-worker@1": {
    contractId: "leaf-worker@1",
    level: "Junior\u2013Senior",
    defaultLevel: "Junior\u2013Senior",
    allowedLevels: ["Junior\u2013Senior"],
    stage: "Coding",
    independentFamily: false,
    toolAccess: "scoped",
    output: LeafWorkerV1Schema,
  },
  "blind-binder@1": {
    contractId: "blind-binder@1",
    level: "Mid",
    defaultLevel: "Mid",
    allowedLevels: ["Mid"],
    stage: "Verification",
    independentFamily: false,
    toolAccess: "scoped",
    output: BlindBinderV1Schema,
  },
  "reviewer@1": {
    contractId: "reviewer@1",
    level: "Senior",
    defaultLevel: "Senior",
    allowedLevels: ["Senior"],
    stage: "High-risk diffs",
    independentFamily: false,
    toolAccess: "none",
    output: ReviewerV1Schema,
  },
  "feature-integrator@1": {
    contractId: "feature-integrator@1",
    level: "Senior",
    defaultLevel: "Senior",
    allowedLevels: ["Senior"],
    stage: "Integration",
    independentFamily: false,
    toolAccess: "scoped",
    output: FeatureIntegratorV1Schema,
  },
  "project-integrator@1": {
    contractId: "project-integrator@1",
    level: "Manager",
    defaultLevel: "Manager",
    allowedLevels: ["Manager"],
    stage: "Merge queue",
    independentFamily: false,
    toolAccess: "scoped",
    output: ProjectIntegratorV1Schema,
  },
  "final-project-auditor@1": {
    contractId: "final-project-auditor@1",
    level: "Manager",
    defaultLevel: "Manager",
    allowedLevels: ["Manager"],
    stage: "Completion",
    independentFamily: false,
    toolAccess: "none",
    output: FinalProjectAuditorV1Schema,
  },
  "investigator@1": {
    contractId: "investigator@1",
    level: "Senior",
    defaultLevel: "Senior",
    allowedLevels: ["Senior"],
    stage: "Mystery bugs",
    independentFamily: false,
    toolAccess: "scoped",
    output: InvestigatorV1Schema,
  },
  "ci-triage@1": {
    contractId: "ci-triage@1",
    level: "Cheap",
    defaultLevel: "Cheap",
    allowedLevels: ["Cheap"],
    stage: "CI failures",
    independentFamily: false,
    toolAccess: "none",
    output: CiTriageV1Schema,
  },
  "oracle-author@1": {
    contractId: "oracle-author@1",
    level: "Senior, different model family from the planner where available",
    defaultLevel: "Senior",
    allowedLevels: ["Senior"],
    stage: "Planning (checks)",
    independentFamily: true,
    toolAccess: "none",
    output: OracleAuthorV1Schema,
  },
  "entailment-checker@1": {
    contractId: "entailment-checker@1",
    level: "Cheap, independent family where available",
    defaultLevel: "Cheap",
    allowedLevels: ["Cheap"],
    stage: "Discovery, research, intake",
    independentFamily: true,
    toolAccess: "none",
    output: EntailmentCheckerV1Schema,
  },
  "ask-owner-responder@1": {
    contractId: "ask-owner-responder@1",
    level: "The task author's level",
    defaultLevel: "task-author",
    allowedLevels: ALL_LEVELS,
    stage: "Coding (live questions and disputes)",
    independentFamily: false,
    toolAccess: "none",
    output: AskOwnerResponderV1Schema,
  },
  "doc-import@1": {
    contractId: "doc-import@1",
    level: "Mid",
    defaultLevel: "Mid",
    allowedLevels: ["Mid"],
    stage: "Markdown edits to generated views",
    independentFamily: false,
    toolAccess: "none",
    output: DocImportV1Schema,
  },
  "intake-extractor@1": {
    contractId: "intake-extractor@1",
    level: "Mid",
    defaultLevel: "Mid",
    allowedLevels: ["Mid"],
    stage: "Documents and screenshots",
    independentFamily: false,
    toolAccess: "none",
    output: IntakeExtractorV1Schema,
  },
  "issue-triage@1": {
    contractId: "issue-triage@1",
    level: "Cheap",
    defaultLevel: "Cheap",
    allowedLevels: ["Cheap"],
    stage: "External bug reports",
    independentFamily: false,
    toolAccess: "none",
    output: IssueTriageV1Schema,
  },
  "module-card-writer@1": {
    contractId: "module-card-writer@1",
    level: "Cheap",
    defaultLevel: "Cheap",
    allowedLevels: ["Cheap"],
    stage: "Brownfield reading (L2)",
    independentFamily: false,
    toolAccess: "none",
    output: ModuleCardWriterV1Schema,
  },
  "sweep-planner@1": {
    contractId: "sweep-planner@1",
    level: "Senior",
    defaultLevel: "Senior",
    allowedLevels: ["Senior"],
    stage: "Sweeps",
    independentFamily: false,
    toolAccess: "none",
    output: SweepPlannerV1Schema,
  },
  "sweep-worker@1": {
    contractId: "sweep-worker@1",
    level: "Mid",
    defaultLevel: "Mid",
    allowedLevels: ["Mid"],
    stage: "Sweeps",
    independentFamily: false,
    toolAccess: "scoped",
    output: SweepWorkerV1Schema,
  },
  "visual-steer@1": {
    contractId: "visual-steer@1",
    level: "Mid with vision",
    defaultLevel: "Mid",
    allowedLevels: ["Mid"],
    stage: "App preview point-to-fix",
    independentFamily: false,
    toolAccess: "none",
    output: VisualSteerV1Schema,
  },
  "taste-reviewer@1": {
    contractId: "taste-reviewer@1",
    level: "Mid with vision",
    defaultLevel: "Mid",
    allowedLevels: ["Mid"],
    stage: "UI review (advisory)",
    independentFamily: false,
    toolAccess: "none",
    output: TasteReviewerV1Schema,
  },
  "turn-summarizer@1": {
    contractId: "turn-summarizer@1",
    level: "Cheap",
    defaultLevel: "Cheap",
    allowedLevels: ["Cheap"],
    stage: "Worker loop compaction",
    independentFamily: false,
    toolAccess: "none",
    output: TurnSummarizerV1Schema,
  },
  "cockpit-explainer@1": {
    contractId: "cockpit-explainer@1",
    level: "Cheap",
    defaultLevel: "Cheap",
    allowedLevels: ["Cheap"],
    stage: "Cockpit \u201cExplain\u201d",
    independentFamily: false,
    toolAccess: "none",
    output: CockpitExplainerV1Schema,
  },
});

export type PromptContractId = keyof typeof PROMPT_CONTRACTS;

export const PROMPT_CONTRACT_IDS = Object.keys(PROMPT_CONTRACTS) as PromptContractId[];

const SCOPED_TOOLS = new Set<PromptContractId>([
  "feature-researcher@1",
  "leaf-worker@1",
  "blind-binder@1",
  "feature-integrator@1",
  "project-integrator@1",
  "investigator@1",
  "sweep-worker@1",
]);

for (const id of PROMPT_CONTRACT_IDS) {
  const contract = PROMPT_CONTRACTS[id];
  const expected = SCOPED_TOOLS.has(id) ? "scoped" : "none";
  if (contract.toolAccess !== expected) {
    throw new Error(`tool access for ${id} must be ${expected}`);
  }
}

export function isPromptContractId(value: string): value is PromptContractId {
  return Object.hasOwn(PROMPT_CONTRACTS, value);
}

export function getPromptContract(contractId: string): PromptContractDefinition {
  if (!isPromptContractId(contractId)) {
    throw new UnknownPromptContractError(contractId);
  }
  return PROMPT_CONTRACTS[contractId];
}

export function parseContractOutput(contractId: string, text: string): unknown {
  return getPromptContract(contractId).output.parse(extractFencedJson(text));
}
