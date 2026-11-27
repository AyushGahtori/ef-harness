import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AskOwnerResponderV1Schema,
  BatchResolveV1Schema,
  BlindBinderV1Schema,
  CANONICAL_ASSETS,
  CheckOutcomeSchema,
  CiTriageV1Schema,
  ClarifyV1Schema,
  CockpitExplainerV1Schema,
  ContradictionCheckV1Schema,
  DocImportV1Schema,
  EntailmentCheckerV1Schema,
  EvidenceLocatorSchema,
  FeatureArchitectV1Schema,
  FeatureIntegratorV1Schema,
  FeaturePlannerV1Schema,
  FeatureResearcherV1Schema,
  FinalProjectAuditorV1Schema,
  IntakeExtractorV1Schema,
  InvestigatorV1Schema,
  IssueTriageV1Schema,
  LeafWorkerV1Schema,
  LocatorSchema,
  MasterPlannerV1Schema,
  ModuleCardWriterV1Schema,
  OpeningReviewV1Schema,
  OracleAuthorV1Schema,
  PROMPT_CONTRACT_IDS,
  ProjectIntegratorV1Schema,
  ReviewerV1Schema,
  RouterV1Schema,
  RpcRequestSchema,
  RpcResponseSchema,
  SpecExpanderV1Schema,
  StreamCancelNotificationSchema,
  StreamCreditGrantSchema,
  StreamCreditNotificationSchema,
  StreamEndNotificationSchema,
  StreamErrorNotificationSchema,
  SweepPlannerV1Schema,
  SweepWorkerV1Schema,
  SystemArchitectV1Schema,
  TasteReviewerV1Schema,
  TouchesTagSchema,
  TurnSummarizerV1Schema,
  VisualSteerV1Schema,
  canonicalAssetAbsolute,
  layer,
  normalizeEvidenceLocator,
  packageName,
} from "../src/index.js";

describe("@ef-harness/shared-contracts", () => {
  it("publishes a stable package identity", () => {
    expect(packageName).toBe("@ef-harness/shared-contracts");
    expect(layer).toBe(0);
  });

  it("resolves every canonical asset inside this repository", () => {
    for (const key of Object.keys(CANONICAL_ASSETS)) {
      const asset = key as keyof typeof CANONICAL_ASSETS;
      expect(fs.existsSync(canonicalAssetAbsolute(asset))).toBe(true);
    }
  });

  it("exports unified Zod v3 schemas for packets, RPC/streams, locators, and all 32 @1 prompts", () => {
    const promptSchemas = [
      OpeningReviewV1Schema,
      BatchResolveV1Schema,
      ClarifyV1Schema,
      RouterV1Schema,
      SpecExpanderV1Schema,
      ContradictionCheckV1Schema,
      FeatureResearcherV1Schema,
      SystemArchitectV1Schema,
      FeatureArchitectV1Schema,
      MasterPlannerV1Schema,
      FeaturePlannerV1Schema,
      LeafWorkerV1Schema,
      BlindBinderV1Schema,
      ReviewerV1Schema,
      FeatureIntegratorV1Schema,
      ProjectIntegratorV1Schema,
      FinalProjectAuditorV1Schema,
      InvestigatorV1Schema,
      CiTriageV1Schema,
      OracleAuthorV1Schema,
      EntailmentCheckerV1Schema,
      AskOwnerResponderV1Schema,
      DocImportV1Schema,
      IntakeExtractorV1Schema,
      IssueTriageV1Schema,
      ModuleCardWriterV1Schema,
      SweepPlannerV1Schema,
      SweepWorkerV1Schema,
      VisualSteerV1Schema,
      TasteReviewerV1Schema,
      TurnSummarizerV1Schema,
      CockpitExplainerV1Schema,
    ];
    expect(promptSchemas).toHaveLength(PROMPT_CONTRACT_IDS.length);
    for (const schema of [
      ...promptSchemas,
      CheckOutcomeSchema,
      EvidenceLocatorSchema,
      LocatorSchema,
      RpcRequestSchema,
      RpcResponseSchema,
      StreamCreditGrantSchema,
      StreamCreditNotificationSchema,
      StreamCancelNotificationSchema,
      StreamEndNotificationSchema,
      StreamErrorNotificationSchema,
      TouchesTagSchema,
    ]) {
      expect(schema).toBeInstanceOf(z.ZodType);
    }
    const parsed = CheckOutcomeSchema.safeParse({ status: "pass", collected_count: 0 });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error).toBeInstanceOf(z.ZodError);
    }
    expect(typeof normalizeEvidenceLocator).toBe("function");
  });
});
