import { z } from "zod";

const identifier = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/);
const httpMethod = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]);

export const ColumnSpecSchema = z.object({
  name: identifier,
  type: z.enum(["text", "integer", "timestamp"]),
  nullable: z.boolean(),
  maxLength: z.number().int().positive().optional(),
  primaryKey: z.boolean().optional(),
});

export const ApiContractCheckSchema = z.object({
  checkId: z.string().min(1),
  authHeader: z.string().min(1).optional(),
  roles: z.array(z.string().min(1)).min(1),
  deriveBoundaryCases: z.boolean().optional(),
  openapi: z
    .object({
      openapi: z.string().optional(),
      paths: z.record(z.string(), z.record(z.string(), z.unknown())),
      components: z
        .object({
          schemas: z.record(z.string(), z.unknown()).optional(),
        })
        .optional(),
    })
    .passthrough(),
  operations: z
    .array(
      z.object({
        method: httpMethod,
        path: z.string().min(1),
        authorizedRoles: z.array(z.string()),
        public: z.boolean().optional(),
      }),
    )
    .min(1),
  calls: z
    .array(
      z.object({
        id: z.string().min(1),
        method: httpMethod,
        path: z.string().min(1),
        role: z.string().min(1).optional(),
        body: z.unknown().optional(),
        expect: z.object({
          status: z.number().int(),
          headers: z.record(z.string(), z.string()).optional(),
        }),
      }),
    )
    .min(1),
  invalidInputs: z
    .array(
      z.object({
        id: z.string().min(1),
        method: httpMethod,
        path: z.string().min(1),
        role: z.string().min(1),
        body: z.unknown(),
        expectStatus: z.number().int(),
      }),
    )
    .optional(),
});

export const AuthCallbackCheckSchema = z.object({
  checkId: z.string().min(1),
  loginPath: z.string().min(1),
  callbackPath: z.string().min(1),
  protectedPath: z.string().min(1),
  successRedirect: z.string().min(1),
  sessionCookie: z.string().min(1).optional(),
  allowedRole: z.string().min(1),
  deniedRole: z.string().min(1),
  clientId: z.string().min(1).optional(),
});

export const TimeBoundaryCheckSchema = z.object({
  checkId: z.string().min(1),
  timeZone: z.string().min(1),
  cutoffLocalTime: z.string().regex(/^\d{2}:\d{2}:\d{2}$/),
  inclusive: z.boolean(),
  calendarDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  summerDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  evaluatePath: z.string().min(1),
  civilPath: z.string().min(1),
  clockHeader: z.string().min(1).optional(),
  springGap: z.object({
    year: z.number().int(),
    month: z.number().int(),
    day: z.number().int(),
    hour: z.number().int(),
    minute: z.number().int(),
    second: z.number().int(),
  }),
  fallOverlap: z.object({
    year: z.number().int(),
    month: z.number().int(),
    day: z.number().int(),
    hour: z.number().int(),
    minute: z.number().int(),
    second: z.number().int(),
  }),
});

export const BackgroundJobCheckSchema = z.object({
  checkId: z.string().min(1),
  enqueuePath: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
  clockHeader: z.string().min(1).optional(),
  clock: z.string().datetime(),
  observations: z.object({
    databasePath: z.string().min(1),
    mailpitPath: z.string().min(1),
    eventPath: z.string().min(1),
    eventType: z.string().min(1),
    clockField: z.string().min(1),
  }),
});

export const CliSurfaceCheckSchema = z.object({
  checkId: z.string().min(1),
  command: z.array(z.string().min(1)).min(1),
  cwd: z.string().min(1).optional(),
  expectExitCode: z.number().int(),
  stdout: z.object({
    format: z.enum(["json", "text"]),
    jsonRequiredKeys: z.array(z.string()).optional(),
  }),
  stderr: z.object({
    allowEmpty: z.boolean().optional(),
    linePattern: z.string().optional(),
  }),
});

export const ConcurrencyPerfCheckSchema = z.object({
  checkId: z.string().min(1),
  mode: z.enum(["optimistic_version", "last_write_wins"]),
  path: z.string().min(1),
  readPath: z.string().min(1),
  manifestDialect: z.enum(["sqlite", "postgres"]),
  dialectProbePath: z.string().min(1),
  barrierHeader: z.string().min(1).optional(),
  barrierParties: z.number().int().min(2).optional(),
  clients: z
    .array(
      z.object({
        body: z.record(z.string(), z.unknown()),
      }),
    )
    .length(2),
  performance: z.object({
    path: z.string().min(1),
    datasetRows: z.number().int().min(10_000),
    seed: z.number().int(),
    warmup: z.number().int().nonnegative(),
    iterations: z.number().int().min(1),
    p95ThresholdMs: z.number().positive(),
    maxHostCpuPercent: z.number().min(0).max(100),
  }),
});

export const MigrationPreservationCheckSchema = z.object({
  checkId: z.string().min(1),
  dialect: z.enum(["sqlite", "postgres"]),
  table: identifier,
  postTable: identifier,
  primaryKey: identifier,
  predecessor: z.object({
    createSql: z.string().min(1),
    columns: z.array(ColumnSpecSchema).min(1),
    seed: z.number().int(),
  }),
  unchangedColumns: z.array(identifier).min(1),
  upSql: z.string().min(1),
  downSql: z.string().min(1).optional(),
  statementTimeoutMs: z.number().int().positive(),
  transformations: z.array(
    z.object({
      description: z.string().min(1),
      sql: z.string().min(1),
      expect: z.record(z.string(), z.union([z.string(), z.number(), z.null()])),
    }),
  ),
  readSql: z.string().min(1),
  expectedIndexes: z.array(z.string().min(1)),
});

export const InboundWebhookCheckSchema = z.object({
  checkId: z.string().min(1),
  targetPath: z.string().min(1),
  secret: z.string().min(1),
  style: z.enum(["github", "stripe"]),
  eventId: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
  observationPath: z.string().min(1),
});

export const RateLimitBurstCheckSchema = z.object({
  checkId: z.string().min(1),
  path: z.string().min(1),
  limit: z.number().int().positive(),
  burst: z.number().int().positive(),
  method: httpMethod.optional(),
  body: z.unknown().optional(),
});

export type ApiContractCheck = z.infer<typeof ApiContractCheckSchema>;
export type AuthCallbackCheck = z.infer<typeof AuthCallbackCheckSchema>;
export type TimeBoundaryCheck = z.infer<typeof TimeBoundaryCheckSchema>;
export type BackgroundJobCheck = z.infer<typeof BackgroundJobCheckSchema>;
export type CliSurfaceCheck = z.infer<typeof CliSurfaceCheckSchema>;
export type ConcurrencyPerfCheck = z.infer<typeof ConcurrencyPerfCheckSchema>;
export type MigrationPreservationCheck = z.infer<typeof MigrationPreservationCheckSchema>;
export type InboundWebhookCheck = z.infer<typeof InboundWebhookCheckSchema>;
export type RateLimitBurstCheck = z.infer<typeof RateLimitBurstCheckSchema>;
export type ColumnSpec = z.infer<typeof ColumnSpecSchema>;
