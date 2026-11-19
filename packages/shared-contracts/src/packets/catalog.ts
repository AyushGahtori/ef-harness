import { toJSONSchema, type ZodType } from "zod/v4";
import { AttemptCheckpointSchema, AttemptCheckpointV0Schema, PendingEffectSchema } from "./checkpoint.js";
import { EvidenceLocatorSchema, PdfIntakeLocatorSchema } from "./locators.js";
import {
  CandidateV1Schema,
  CcrV1Schema,
  EventV1Schema,
  MergeInstructionsV1Schema,
  TaskPacketV1Schema,
  WorkerBriefSchema,
} from "./messages.js";
import {
  CheckOutcomeSchema,
  SandboxMetadataSchema,
  StaticAuditReportSchema,
  VerificationReceiptSchema,
} from "./receipt.js";
import {
  DaemonNotificationSchema,
  FrameHeaderSchema,
  JsonRpcErrorResponseSchema,
  JsonRpcRequestSchema,
  JsonRpcSuccessResponseSchema,
  SnapshotGetResultSchema,
  StreamCreditGrantSchema,
} from "./rpc.js";
import { WorkerEventSchema } from "./worker-event.js";
import {
  BudgetSchema,
  CcrChangeSchema,
  DependencyIntentSchema,
  MigrationIntentSchema,
  WiringNeedSchema,
} from "./intents.js";

export const PACKET_SCHEMAS = {
  "task-packet@1": TaskPacketV1Schema,
  "worker-brief@1": WorkerBriefSchema,
  "candidate@1": CandidateV1Schema,
  "merge-instructions@1": MergeInstructionsV1Schema,
  "ccr@1": CcrV1Schema,
  "ccr-change@1": CcrChangeSchema,
  "event@1": EventV1Schema,
  "budget@1": BudgetSchema,
  "dependency-intent@1": DependencyIntentSchema,
  "migration-intent@1": MigrationIntentSchema,
  "wiring-need@1": WiringNeedSchema,
  "evidence-locator@1": EvidenceLocatorSchema,
  "pdf-intake-locator@1": PdfIntakeLocatorSchema,
  "attempt-checkpoint@1": AttemptCheckpointSchema,
  "attempt-checkpoint@0": AttemptCheckpointV0Schema,
  "pending-effect@1": PendingEffectSchema,
  "verification-receipt@1": VerificationReceiptSchema,
  "static-audit@1": StaticAuditReportSchema,
  "check-outcome@1": CheckOutcomeSchema,
  "sandbox-metadata@1": SandboxMetadataSchema,
  "worker-event@1": WorkerEventSchema,
  "json-rpc-request@1": JsonRpcRequestSchema,
  "json-rpc-success@1": JsonRpcSuccessResponseSchema,
  "json-rpc-error@1": JsonRpcErrorResponseSchema,
  "daemon-notification@1": DaemonNotificationSchema,
  "stream-credit@1": StreamCreditGrantSchema,
  "snapshot-result@1": SnapshotGetResultSchema,
  "frame-header@1": FrameHeaderSchema,
} as const satisfies Record<string, ZodType>;

export type PacketSchemaName = keyof typeof PACKET_SCHEMAS;

export function exportPacketJsonSchemas(): Record<PacketSchemaName, Record<string, unknown>> {
  const exported = {} as Record<PacketSchemaName, Record<string, unknown>>;
  for (const name of Object.keys(PACKET_SCHEMAS) as PacketSchemaName[]) {
    const schema = PACKET_SCHEMAS[name];
    exported[name] = toJSONSchema(schema) as Record<string, unknown>;
  }
  return exported;
}
