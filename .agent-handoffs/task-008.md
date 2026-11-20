---
task_id: "Task-008"
branch: "task/008-core-packet-schemas"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/shared-contracts/src/packets/**"
  - "packages/shared-contracts/tests/packets/**"
  - ".agent-handoffs/task-008.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 008 handoff

Core versioned packet, locator, checkpoint, receipt, and window-daemon RPC Zod schemas. Commit stays on `task/008-core-packet-schemas`.

## Exports Provided

Import path after barrel wiring: `@ef-harness/shared-contracts` (re-exported from `packages/shared-contracts/src/packets/index.ts`).

Schemas:

- `TaskPacketV1Schema` (`task-packet@1`) and alias `WorkerBriefSchema`
- `CandidateV1Schema` (`candidate@1`)
- `MergeInstructionsV1Schema` (`merge-instructions@1`)
- `CcrV1Schema` (`ccr@1`), `CcrChangeSchema`, `AddColumnSchema`
- `EventV1Schema` (`event@1`)
- `BudgetSchema`, `LimitsSchema`, `GitBaseSchema`, `RequirementClauseSchema`, `ContractVersionSchema`, `ContractUseSchema`, `SkillPinSchema`
- `DependencyIntentSchema`, `MigrationIntentSchema`, `WiringNeedSchema`, `RouteWiringNeedSchema`, `BarrelWiringNeedSchema`, `LockfileWiringNeedSchema`, `SchemaIndexWiringNeedSchema`, `LocalCheckSchema`
- `DiffstatSchema`, `ExportChangeSchema`
- `EvidenceLocatorSchema`, `TurnLocatorSchema`, `PdfLocatorSchema`, `PdfIntakeLocatorSchema`, `DocxLocatorSchema`, `TextLocatorSchema`, `ImageLocatorSchema`, `SpecLocatorSchema`
- `AttemptCheckpointSchema` (format_version 1), `AttemptCheckpointV0Schema`, `PendingEffectSchema`
- `VerificationReceiptSchema`, `StaticAuditReportSchema`, `StaticFindingSchema`, `CheckOutcomeSchema`, `CheckCountsSchema`, `SandboxMetadataSchema`
- `WorkerEventSchema` (`worker-event@1`)
- `JsonRpcRequestSchema`, `JsonRpcSuccessResponseSchema`, `JsonRpcErrorResponseSchema`, `JsonRpcErrorObjectSchema`, `JsonRpcIdSchema`, `OpIdSchema`
- `DaemonNotificationSchema`, `EventsBatchNotificationSchema`, `EventsBatchParamsSchema`, `ResyncRequiredNotificationSchema`, `TelemetryNotificationSchema`, `StreamCreditGrantSchema`
- `FrameHeaderSchema`, `ArtifactOpenResultSchema`, `SnapshotGetResultSchema`
- Per-method request and params schemas: `SessionHelloRequestSchema`, `SessionHelloParamsSchema`, `SessionPingRequestSchema`, `ProjectListRequestSchema`, `ProjectOpenRequestSchema`, `ProjectCloseRequestSchema`, `ChatSendRequestSchema`, `ChatSendParamsSchema`, `QuestionAnswerParamsSchema`, `BatchAcceptParamsSchema`, `NodeGetParamsSchema`, `NodeSearchParamsSchema`, `GraphViewParamsSchema`, `ImpactPreviewParamsSchema`, `PlanPreviewParamsSchema`, `InboxListParamsSchema`, `InboxResolveParamsSchema`, `ArtifactOpenParamsSchema`, `DiffGetParamsSchema`, `PreviewUrlRequestSchema`, `PreviewStartRequestSchema`, `SettingsGetParamsSchema`, `SettingsSetParamsSchema`, `SettingsSetRequestSchema`, `EventsSubscribeParamsSchema`, `SnapshotGetParamsSchema`, `BuildStartRequestSchema`, `BuildPauseAllRequestSchema`, `BuildStopRequestSchema`, `TaskRetryRequestSchema`, `TaskTakeOverRequestSchema`, `DiagExportParamsSchema`, `DiagExportRequestSchema`

Helpers and constants:

- `formatZodError`
- `exportPacketJsonSchemas`, `PACKET_SCHEMAS`
- `readCheckpoint`, `CheckpointUpcasterRegistry`, `CheckpointRegistry`, `checkpointV0ToV1`, `defaultCheckpointUpcasters`
- `decodeFrameHeader`
- `integerUnits`, `jsonValueSchema`, `createJsonValueSchema`, `withinJsonByteLimit`
- `JSON_IPC_MAX_BYTES` (1048576), `SNAPSHOT_SECTION_MAX_BYTES` (2097152), `BINARY_CHUNK_BYTES` (65536), `MICRO_USD_SCALE`, `PPM_SCALE`
- `READ_ONLY_RPC_METHODS`, `MUTATING_RPC_METHODS`, `RPC_METHODS`

Read-only RPC methods (no `op_id`): `session.hello`, `session.ping`, `project.list`, `node.get`, `node.search`, `graph.view`, `impact.preview`, `plan.preview`, `inbox.list`, `artifact.open`, `diff.get`, `preview.url`, `settings.get`, `events.subscribe`, `snapshot.get`.

Mutating RPC methods (`op_id` required, non-empty): `project.open`, `project.close`, `chat.send`, `question.answer`, `batch.accept`, `build.start`, `build.pauseAll`, `build.stop`, `task.retry`, `task.takeOver`, `inbox.resolve`, `preview.start`, `settings.set`, `diag.export`.

## Shared Wiring Needs (Root / Index Barrels)

`packages/shared-contracts/src/index.ts` — add this line and do not edit that file on this branch:

```ts
export * from "./packets/index.js";
```

Do not add a `package.json` `exports` subpath `./packets`. `ef/layer-boundary` rejects `@ef-harness/shared-contracts/packets` as a deep import. Consumers import the root barrel after the line above.

`packages/shared-contracts/package.json` — declare the existing workspace Zod package on this package (it is already a root devDependency, resolved as zod 3.25.76). Schemas import `zod/v4`:

```json
"dependencies": {
  "zod": "^3.25.0"
}
```

## Dependency Intents (New Packages Requested)

No new registry package. `zod` `^3.25.0` is already in the root manifest. The shared-contracts package must list it as a dependency so `import { z } from "zod/v4"` is not a phantom dependency. No other packages.

## Contract Change Requests

None.

## Exact Verification Commands & Results

Ran from `C:\Users\Ayush\Desktop\ef-wt\task-008-core-packet-schemas`:

- `pnpm --filter @ef-harness/shared-contracts test -- packets` — pass, 4 files, 23 tests.
- `pnpm --filter @ef-harness/shared-contracts typecheck` — pass (`tsc -b`).
- `pnpm --filter @ef-harness/shared-contracts lint` — pass (`eslint .`).
- `node scripts/verify-harmony.mjs --task 008` — pass (`harmony ok for Task-008`), including workspace typecheck, lint, and test.

## Known Limitations / Follow-Ups

- `budget.usd` is integer micro-USD (`MICRO_USD_SCALE` 1000000). `budget.allowance` values are integer ppm of a plan window. `budget.local_slots` is an integer slot count. The abridged `0.40` / `0.6` dollar figures in `build-pipeline.md` are rejected. `local_slots` and `limits.max_steps` are required; the abridged sample omitted them.
- `candidate@1.migration_intents` defaults to `[]` when omitted so the abridged candidate sample parses. The field is part of the output.
- `event@1` requires `seq` and `payload`. The abridged sample omitted them. `created` is a UTC ISO-8601 string. SQLite stores `outbox.rev` and integer `outbox.created_at`; the kernel maps `revision` to `rev` and `created` to `created_at`. Packet `commit` maps to `candidates.commit_sha`. Checkpoint `attempt` is the text `attempts.id`; task and candidate `attempt` is the integer attempt number from the JSON samples.
- Locator fields follow the task names (`turnId`, `charStart`, `charEnd`, `lineStart`, `lineEnd`, `ocrText`, `jsonPointer`). The pdf object in `external-intake.md` uses `char_start` / `char_end` and is accepted by `PdfIntakeLocatorSchema`, which is one arm of `EvidenceLocatorSchema`.
- `ccr@1.change` is closed on the documented `add_column` shape. Further change operations need a follow-up schema. Status is `open | approved | rejected | applied`; the sample only shows `open`.
- `WorkerEventSchema` is the normalized runtime event union (`session.started` through `message.delta`). Usage cost is `cost_micro_usd`. Rate-limit share is `used_ppm`, not a float percent.
- JSON Schema export uses Zod 4 `toJSONSchema`. Cross-field refinements (character-span order, sandbox tier versus `unsandboxed`, receipt count tallies) are enforced at runtime and are not all expressible as JSON Schema keywords.
- Window responses and daemon notifications keep unknown keys (newer minor fields). Worker packets and RPC requests are strict.
