---
task_id: "Task-030"
branch: "task/030-secret-purge-engine"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/db/src/secret-purge/**"
  - "packages/db/tests/secret-purge/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 030 handoff

Sanctioned 8-step secret purge. Commit stays on `task/030-secret-purge-engine`.

## Exports Provided

Import from `packages/db/src/secret-purge/index.ts` (package barrel wiring is listed below; this task does not edit `packages/db/src/index.ts`):

- `SecretPurgeEngine` — `locateSecret(secret, options?)` and `executeSecretPurge(secret, options?)`
- `PurgeReceipt` — audit receipt. `rotationMandatory` is always `true`. `secretFingerprint` is HMAC-SHA256 hex. The plaintext secret is never a field.
- `PROVIDER_ROTATION_URLS` — `ProviderRotationLinkMap` of symbolic labels to official provider rotation pages (`STRIPE_SECRET_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GITHUB_TOKEN`, `GOOGLE_API_KEY`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`)
- `ProviderRotationLinkMap`
- `PurgeLockUnavailableError` — readers could not be drained, or `wal_checkpoint(TRUNCATE)` stayed busy
- `SecretTooShortError` — secret shorter than 8 characters without `forceShortSecret: true`
- `CasBlobStore`, `KnowledgeSearchService`, `ComputeNodeContentHash`, `ComputeSecretHmac` — injected ports for Tasks 028, 018, 007, and 011
- `RawFileCasBlobStore` — uncompressed file CAS used when no `CasBlobStore` is injected. `forceDeletePurgedBlob` unlinks immediately and drops pins.

`executeSecretPurge` options: `label`, `forceShortSecret`, `remotePushed`.

Receipt fields used by later tasks: `id`, `status` (`complete` | `partial`), `partial`, `label` (`[REDACTED:<NAME>]`), `placeholder`, `secretFingerprint`, `counts`, `hashMapArtifact`, `rotationMandatory`, `rotationUrl`, `rotationGuidance`, `remoteHistoryRewriteRequired`, `remoteHistoryRewriteMessage`, `completedSteps`, `failedStep`, `pendingTargets`, `failureMessage`.

## Shared Wiring Needs (Root / Index Barrels)

Add to `packages/db/src/index.ts`:

```ts
export {
  SecretPurgeEngine,
  PurgeLockUnavailableError,
  SecretTooShortError,
  PROVIDER_ROTATION_URLS,
  RawFileCasBlobStore,
} from "./secret-purge/index.js";
export type {
  PurgeReceipt,
  ProviderRotationLinkMap,
  SecretLocationReport,
  SecretPurgeEngineOptions,
  ExecuteSecretPurgeOptions,
  CasBlobStore,
  KnowledgeSearchService,
} from "./secret-purge/index.js";
```

No root `package.json` or workspace export change.

## Dependency Intents (New Packages Requested)

None.

## Contract Change Requests

None. Injected ports, so this branch does not edit Tasks 007, 011, 018, or 028:

- `computeNodeContentHash({ kind, title, text, fields })` returns `sha256:` plus 64 lowercase hex chars over RFC 8785 canonical JSON of the NFC-normalized object. `fields` may be a JSON string or an object.
- `computeSecretHmac(secret, localKey)` returns hex HMAC-SHA256. The raw secret is not stored.
- `KnowledgeSearchService.optimizeSearchIndexes()` and optional `rebuildSearchIndexes()`. The engine also runs `INSERT INTO kb_words(kb_words) VALUES('optimize')` and the same statement for `kb_ident` itself.
- `CasBlobStore.putBlob`, `getBlob`, `pinBlob`, `unpinHolder`, `forceDeletePurgedBlob`, and optional `listStoredHashes`. `getBlob` must return uncompressed bytes. `forceDeletePurgedBlob` must unlink immediately, bypassing the 7-day grace window.

## Exact Verification Commands & Results

Ran from `C:\Users\Ayush\Desktop\ef-wt\task-030-secret-purge-engine`:

- `pnpm --filter @ef-harness/db test -- secret-purge` — pass, 5 tests (canary planted across nodes, node_versions, turns, evidence, outbox, change_sets, candidates, inbox, turn_log, a CAS text blob, a `VACUUM INTO` backup, telemetry, and a jsonl log). Raw `Buffer.indexOf` of the canary is `-1` on `state.db`, `state.db-wal`, backup `.db` files, the CAS directory, telemetry, and logs. `redactions` stores the HMAC, counts, and `hash_map_artifact`. `PRAGMA quick_check` and `PRAGMA foreign_key_check` pass. FTS no longer matches the canary token and still matches `print`. A second distinct secret gets its own `redactions` row and hash-map artifact. Short strings throw unless `forceShortSecret` is set. A reader gate that refuses to drain throws `PurgeLockUnavailableError` and leaves the row unchanged. A backup hook failure returns `partial` and a retry completes the scrub.
- `pnpm --filter @ef-harness/db typecheck` — pass (`tsc -b`).
- `pnpm --filter @ef-harness/db lint` — pass.
- `node scripts/verify-harmony.mjs --task 030` — pass (`harmony ok for Task-030`). The checker also ran workspace typecheck, lint, and the full test suite.

## Known Limitations / Follow-Ups

- The package barrel re-export above is not applied here. Callers import `packages/db/src/secret-purge/index.ts` until integration wires `packages/db/src/index.ts`.
- If `computeNodeContentHash` or `computeSecretHmac` are omitted, the engine uses local RFC 8785 and HMAC-SHA256 implementations in this folder. Pass the Task 007 and Task 011 functions when those barrels are wired.
- `RawFileCasBlobStore` stores uncompressed `.raw` blobs under `sha256/<h0..2>/<h2..4>/<hash>.raw`. It does not zstd-compress. A Task 028 store injected as `cas` must return uncompressed bytes from `getBlob`.
- Schema SQL is loaded from `schema/*.sql` at the repository root. `schema/queries.sql` `secret_occurrences` is the core locator; nodes, candidates, inbox payloads, turn_log, CAS, backups, telemetry, and logs are scanned in addition.
- Version-stable history rewrite drops `nodes_version_guard` only inside one immediate transaction, restores the trigger from `schema/state.sql`, and probes that a version-stable meaning change still aborts. `nodes.version` is not bumped. Old content hashes map to new `sha256:` hashes in the pinned CAS artifact referenced by `redactions.hash_map_artifact`.
- Remote history is never force-pushed. `remoteHistoryRewriteRequired` is true only when exportable state held the secret, `export_state.commit_sha` for `harness-state` is set, and the caller passes `remotePushed: true`.
- `PurgeReceipt.rotationMandatory` is always true. SSD wear-leveling and provider exposure are stated in `rotationGuidance`.
- A failure during backup scrub returns `status: "partial"` with `pendingTargets`. A later `executeSecretPurge` of the same secret finishes remaining files and inserts another `redactions` row.
- Telemetry is recreated from rows that no longer contain the secret. JSONL logs under the configured logs directory are rewritten in place.
