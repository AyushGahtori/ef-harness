import { z } from "zod";
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
  StreamCancelNotificationSchema,
  StreamCreditGrantSchema,
  StreamEndNotificationSchema,
  StreamErrorNotificationSchema,
} from "./rpc.js";
import { WorkerEventSchema } from "./worker-event.js";
import {
  BudgetSchema,
  CcrChangeSchema,
  DependencyIntentSchema,
  MigrationIntentSchema,
  WiringNeedSchema,
} from "./intents.js";

const JSON_SCHEMA_DRAFT_2020_12 = "https://json-schema.org/draft/2020-12/schema";

type JsonSchemaObject = Record<string, unknown>;

function applyDescription(target: JsonSchemaObject, description: string | undefined): JsonSchemaObject {
  if (description !== undefined && target.description === undefined) {
    return { ...target, description };
  }
  return target;
}

function convertStringSchema(schema: z.ZodString): JsonSchemaObject {
  const out: JsonSchemaObject = { type: "string" };
  const extraPatterns: string[] = [];
  for (const check of schema._def.checks) {
    switch (check.kind) {
      case "min":
        out.minLength = check.value;
        break;
      case "max":
        out.maxLength = check.value;
        break;
      case "length":
        out.minLength = check.value;
        out.maxLength = check.value;
        break;
      case "regex":
        if (out.pattern === undefined) {
          out.pattern = check.regex.source;
        } else {
          extraPatterns.push(check.regex.source);
        }
        break;
      case "email":
        out.format = "email";
        break;
      case "url":
        out.format = "uri";
        break;
      case "uuid":
        out.format = "uuid";
        break;
      default:
        break;
    }
  }
  if (extraPatterns.length > 0) {
    const first = typeof out.pattern === "string" ? [out.pattern] : [];
    delete out.pattern;
    out.allOf = [...first, ...extraPatterns].map((pattern) => ({ pattern }));
  }
  return applyDescription(out, schema.description);
}

function convertNumberSchema(schema: z.ZodNumber): JsonSchemaObject {
  let isInt = false;
  const out: JsonSchemaObject = { type: "number" };
  for (const check of schema._def.checks) {
    switch (check.kind) {
      case "int":
        isInt = true;
        break;
      case "min":
        if (check.inclusive) {
          out.minimum = check.value;
        } else {
          out.exclusiveMinimum = check.value;
        }
        break;
      case "max":
        if (check.inclusive) {
          out.maximum = check.value;
        } else {
          out.exclusiveMaximum = check.value;
        }
        break;
      case "multipleOf":
        out.multipleOf = check.value;
        break;
      default:
        break;
    }
  }
  if (isInt) {
    out.type = "integer";
  }
  return applyDescription(out, schema.description);
}

function convertObjectSchema(schema: z.ZodObject<z.ZodRawShape>): JsonSchemaObject {
  const properties: Record<string, JsonSchemaObject> = {};
  const required: string[] = [];
  for (const [key, field] of Object.entries(schema.shape as Record<string, z.ZodTypeAny>)) {
    properties[key] = zodToJsonSchemaNode(field);
    if (!field.isOptional()) {
      required.push(key);
    }
  }
  const out: JsonSchemaObject = {
    type: "object",
    properties,
  };
  if (required.length > 0) {
    out.required = required;
  }
  if (schema._def.unknownKeys === "strict") {
    out.additionalProperties = false;
  } else if (schema._def.catchall._def.typeName !== z.ZodFirstPartyTypeKind.ZodNever) {
    out.additionalProperties = zodToJsonSchemaNode(schema._def.catchall);
  } else if (schema._def.unknownKeys === "passthrough") {
    out.additionalProperties = true;
  }
  return applyDescription(out, schema.description);
}

function convertArraySchema(schema: z.ZodArray<z.ZodTypeAny>): JsonSchemaObject {
  const out: JsonSchemaObject = {
    type: "array",
    items: zodToJsonSchemaNode(schema.element),
  };
  if (schema._def.minLength !== null) {
    out.minItems = schema._def.minLength.value;
  }
  if (schema._def.maxLength !== null) {
    out.maxItems = schema._def.maxLength.value;
  }
  if (schema._def.exactLength !== null) {
    out.minItems = schema._def.exactLength.value;
    out.maxItems = schema._def.exactLength.value;
  }
  return applyDescription(out, schema.description);
}

function convertTupleSchema(schema: z.ZodTuple): JsonSchemaObject {
  const items = (schema._def.items as z.ZodTypeAny[]).map((item) => zodToJsonSchemaNode(item));
  const out: JsonSchemaObject = {
    type: "array",
    prefixItems: items,
    minItems: items.length,
  };
  if (schema._def.rest !== null) {
    out.items = zodToJsonSchemaNode(schema._def.rest as z.ZodTypeAny);
  } else {
    out.maxItems = items.length;
    out.items = false;
  }
  return applyDescription(out, schema.description);
}

function convertLiteralSchema(schema: z.ZodLiteral<unknown>): JsonSchemaObject {
  const value = schema._def.value;
  if (value === null) {
    return applyDescription({ type: "null" }, schema.description);
  }
  const valueType = typeof value;
  const out: JsonSchemaObject =
    valueType === "string" || valueType === "number" || valueType === "boolean"
      ? { type: valueType, const: value }
      : { const: value };
  return applyDescription(out, schema.description);
}

function convertNativeEnumValues(values: Record<string, string | number>): Array<string | number> {
  const numericReverse = new Set<string>();
  for (const [key, val] of Object.entries(values)) {
    if (typeof val === "number") {
      numericReverse.add(String(val));
    } else if (typeof values[val] === "number") {
      numericReverse.add(key);
    }
  }
  const out: Array<string | number> = [];
  for (const [key, val] of Object.entries(values)) {
    if (!numericReverse.has(key)) {
      out.push(val);
    }
  }
  return out;
}

function zodToJsonSchemaNode(schema: z.ZodTypeAny): JsonSchemaObject {
  if (schema instanceof z.ZodString) {
    return convertStringSchema(schema);
  }
  if (schema instanceof z.ZodNumber) {
    return convertNumberSchema(schema);
  }
  if (schema instanceof z.ZodBoolean) {
    return applyDescription({ type: "boolean" }, schema.description);
  }
  if (schema instanceof z.ZodNull) {
    return applyDescription({ type: "null" }, schema.description);
  }
  if (schema instanceof z.ZodUnknown || schema instanceof z.ZodAny) {
    return applyDescription({}, schema.description);
  }
  if (schema instanceof z.ZodNever) {
    return applyDescription({ not: {} }, schema.description);
  }
  if (schema instanceof z.ZodUndefined || schema instanceof z.ZodVoid) {
    return applyDescription({ not: {} }, schema.description);
  }
  if (schema instanceof z.ZodLiteral) {
    return convertLiteralSchema(schema);
  }
  if (schema instanceof z.ZodEnum) {
    return applyDescription(
      { type: "string", enum: [...(schema._def.values as string[])] },
      schema.description,
    );
  }
  if (schema instanceof z.ZodNativeEnum) {
    return applyDescription(
      { enum: convertNativeEnumValues(schema._def.values as Record<string, string | number>) },
      schema.description,
    );
  }
  if (schema instanceof z.ZodObject) {
    return convertObjectSchema(schema);
  }
  if (schema instanceof z.ZodArray) {
    return convertArraySchema(schema as z.ZodArray<z.ZodTypeAny>);
  }
  if (schema instanceof z.ZodTuple) {
    return convertTupleSchema(schema);
  }
  if (schema instanceof z.ZodRecord) {
    return applyDescription(
      {
        type: "object",
        propertyNames: zodToJsonSchemaNode(schema.keySchema),
        additionalProperties: zodToJsonSchemaNode(schema.valueSchema),
      },
      schema.description,
    );
  }
  if (schema instanceof z.ZodUnion) {
    const options = (schema.options as z.ZodTypeAny[]).map((option) => zodToJsonSchemaNode(option));
    return applyDescription({ anyOf: options }, schema.description);
  }
  if (schema instanceof z.ZodDiscriminatedUnion) {
    const options = (schema.options as z.ZodTypeAny[]).map((option) => zodToJsonSchemaNode(option));
    return applyDescription({ anyOf: options }, schema.description);
  }
  if (schema instanceof z.ZodIntersection) {
    return applyDescription(
      {
        allOf: [
          zodToJsonSchemaNode(schema._def.left as z.ZodTypeAny),
          zodToJsonSchemaNode(schema._def.right as z.ZodTypeAny),
        ],
      },
      schema.description,
    );
  }
  if (schema instanceof z.ZodNullable) {
    return applyDescription(
      {
        anyOf: [zodToJsonSchemaNode(schema.unwrap() as z.ZodTypeAny), { type: "null" }],
      },
      schema.description,
    );
  }
  if (schema instanceof z.ZodOptional) {
    return applyDescription(
      zodToJsonSchemaNode(schema.unwrap() as z.ZodTypeAny),
      schema.description,
    );
  }
  if (schema instanceof z.ZodDefault) {
    return applyDescription(
      zodToJsonSchemaNode(schema.removeDefault() as z.ZodTypeAny),
      schema.description,
    );
  }
  if (schema instanceof z.ZodEffects) {
    return applyDescription(
      zodToJsonSchemaNode(schema.innerType() as z.ZodTypeAny),
      schema.description,
    );
  }
  if (schema instanceof z.ZodBranded) {
    return applyDescription(
      zodToJsonSchemaNode(schema.unwrap() as z.ZodTypeAny),
      schema.description,
    );
  }
  if (schema instanceof z.ZodReadonly) {
    return applyDescription(
      zodToJsonSchemaNode(schema.unwrap() as z.ZodTypeAny),
      schema.description,
    );
  }
  if (schema instanceof z.ZodCatch) {
    return applyDescription(
      zodToJsonSchemaNode(schema._def.innerType as z.ZodTypeAny),
      schema.description,
    );
  }
  if (schema instanceof z.ZodPipeline) {
    return applyDescription(
      zodToJsonSchemaNode(schema._def.out as z.ZodTypeAny),
      schema.description,
    );
  }
  throw new Error(`Unsupported Zod schema construct for JSON Schema export: ${schema.constructor.name}`);
}

function zodToJsonSchema(schema: z.ZodTypeAny): JsonSchemaObject {
  return {
    $schema: JSON_SCHEMA_DRAFT_2020_12,
    ...zodToJsonSchemaNode(schema),
  };
}

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
  "stream-cancel@1": StreamCancelNotificationSchema,
  "stream-end@1": StreamEndNotificationSchema,
  "stream-error@1": StreamErrorNotificationSchema,
  "snapshot-result@1": SnapshotGetResultSchema,
  "frame-header@1": FrameHeaderSchema,
} as const satisfies Record<string, z.ZodTypeAny>;

export type PacketSchemaName = keyof typeof PACKET_SCHEMAS;

export function exportPacketJsonSchemas(): Record<PacketSchemaName, Record<string, unknown>> {
  const exported = {} as Record<PacketSchemaName, Record<string, unknown>>;
  for (const name of Object.keys(PACKET_SCHEMAS) as PacketSchemaName[]) {
    const schema = PACKET_SCHEMAS[name];
    exported[name] = zodToJsonSchema(schema);
  }
  return exported;
}
