---
task_id: "Task-121"
branch: "task/121-human-step-probing-verification"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/governor/src/human-steps/**"
  - "packages/governor/tests/human-steps/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 121 handoff

Human-step probe registry, consented visible terminal installer, and verified-versus-attested policy. Commit stays on `task/121-human-step-probing-verification`.

## Exports Provided

Import from `packages/governor/src/human-steps/index.ts` (the package barrel is frozen):

- `HumanStepStateStore` — `state.db.human_steps` rows `{ stepId, stepType, title, plainEnglishInstructions, probeSpec, status, lastProbeResult, attestedAt?, verifiedAt?, blockingTaskIds }` plus `task_holds` rows with reason `waiting_on_human_step`. `commitProbeResult` and `commitAttestation` share one `BEGIN IMMEDIATE` transaction with hold release.
- `HumanStepProbeRegistry` — `checkAgain(stepId)` runs the built-in read-only probe (Playwright, Docker, database URL, CLI, DNS, cloud API, webhook) under a hard `10_000` ms cap. A passing result is the only writer of `status = "verified"`.
- `ConsentedTerminalInstaller` — `propose` returns the exact command and the prompt `Run this command?`. `start` runs it only when `approval.exactCommand` matches that string, streams stdout/stderr, cancels through the job supervisor, and calls `checkAgain` only on exit code `0`.
- `AttestedVsVerifiedBadgePolicy` — green `Verified` only after `lastProbeResult.outcome === "pass"`. Manual confirmation is `Self-attested by you (unprobed)`. Hard local runtimes (Playwright, Docker, database URL, CLI) cannot be attested.
- Also exported for Task 130 and tests: `HumanStepReentryHook` (`onColdOpen`, `onFocusReturn`), `openHumanSteps`, `ChildProcessJobSupervisor`, `probeDocker`, `probeCliTool`, `probePlaywright`, `probeDatabaseTarget`, `probeDns`, `probeHttps`.

## Shared Wiring Needs (Root / Index Barrels)

`packages/governor/src/index.ts` is frozen. Integration should add:

```ts
export {
  AttestedVsVerifiedBadgePolicy,
  ConsentedTerminalInstaller,
  HumanStepProbeRegistry,
  HumanStepReentryHook,
  HumanStepStateStore,
  openHumanSteps,
} from "./human-steps/index.js";
```

No root `package.json` script changes.

## Dependency Intents (New Packages Requested)

None. Probes use Node built-ins (`node:sqlite`, `node:net`, `node:tls`, `node:dns/promises`, `node:crypto`, `node:child_process`). Do not add a database driver or a Playwright dependency to `@ef-harness/governor`.

## Contract Change Requests

- Add `human_steps` to `schema/state.sql`. This task creates the table on the connection it is given (`HUMAN_STEP_SCHEMA_SQL` in `schema.ts`) because `schema/` is frozen. Columns match the task record: step id, type, title, instructions JSON, probe spec JSON, status check (`pending|probing|verified|attested|failed`), last probe JSON, `attested_at`, `verified_at`, attestation note, blocking task ids JSON, question id, `hard_local`, resolution, graph node id, timestamps.
- Document `waiting_on_human_step` as a `task_holds.reason`. The frozen column is free text (the vocabulary is a comment, not a `CHECK`). Task 115 `kernelReasonFor` currently folds unknown reasons to `requirement_change`. Integration must keep the literal reason `waiting_on_human_step` with `source = stepId`, or this task's release will not see the row.
- Add entity prefix `HS-` if human-step ids should come from Task 017 `allocateEntityId`. Until then this task allocates graph comment ids with the existing prefix `S-` and stores human-step ids as `HS-<n>` in `human_steps`.
- Optional node kind `human_step`. The local graph port writes `kind: "comment"` with `fields.humanStep = true` so it stays inside the frozen `node_kinds` seed.

## Exact Verification Commands & Results

From `C:\Users\Ayush\Desktop\ef-wt\task-121-human-step-probing-verification`:

- `pnpm --filter @ef-harness/governor typecheck` — exit 0.
- `pnpm --filter @ef-harness/governor lint` — exit 0.
- `pnpm --filter @ef-harness/governor test -- human-steps` — exit 0. Test Files 5 passed, Tests 22 passed (Playwright revision parity and about:blank launch, Docker `NOT_INSTALLED` / `INSTALLED_NOT_RUNNING` / `RUNNING`, Postgres `SELECT 1` including MD5 and cleartext handshakes, credential-masked auth failure, Redis `PING`, ECONNREFUSED, black-hole `PROBE_TIMEOUT` under 10s, real local `node` and `git` semver, `gh` not-authenticated, DNS TXT/CNAME, HTTPS cloud/webhook without bearer logging, consent, stream, cancel, exit-0 reprobe, real process-tree cancel, cold-open and focus-return reprobe, attested-versus-verified, hard-bypass refusal, atomic hold rollback).
- `pnpm --filter @ef-harness/governor test` — exit 0. Test Files 6 passed, Tests 23 passed (includes the package smoke test).
- `node scripts/verify-harmony.mjs --task 121` — exit 0. `harmony ok for Task-121`.

## Known Limitations / Follow-Ups

Sibling branches are not merged. Local ports and the swap to make at integration:

- `SqliteKnowledgeGraphPort` (`allocateEntityId`, `commitChangeSet`, `getNode`, `recordEvidence`) writes `human_step_graph_nodes` and `human_step_graph_evidence` through `node:sqlite`. Swap to Task 017 `KnowledgeGraphRepo`. Do not point it at the real `nodes` / `evidence` tables until the contract changes above exist. Evidence `sourceKind` is `repo`, which is already in the frozen evidence vocabulary. Quote text is the diagnosis or the attestation note, never the secret.
- `ChildProcessJobSupervisor.runCommand` streams output and cancels with `taskkill /T /F` (Windows) or `SIGKILL`. Swap to Task 040 `WindowsJobManager.runCommand` plus `terminateJob`. Task 041's public export is `TierAMxcProvider` / `SandboxTierProvider`, not a type named `WindowsJobSupervisor`. The task text attributes Job Object supervision to Task 041, which consumes Task 040.
- `SqliteQuestionArbiter.submit` / `retireQuestion` records `kind: "human_step"` in `human_step_questions`. Swap `submit` to Task 116 `SharedQuestionArbiter.submit` and `retireQuestion` to `retireByEdit({ questionId, source, settledAnswer })`.
- `WindowsDpapiSecretsVault.readSecret(secretId)` returns the connection URL or bearer token only inside the probe. Swap to Task 120's vault read method. Plaintext is scrubbed from diagnoses, evidence, and logs (`postgresql://user:***@host:5432/db`). The secret id is what gets stored.
- Hold release uses `SqliteTaskHoldPort` on `task_holds (task, reason, source, created_at)`. Swap `placeHold` / `releaseHold` to Task 021 `TaskHoldAndSubmissionRepo`, inside the same transaction as the status update. A passing probe or an allowed attestation deletes `waiting_on_human_step` for every `blockingTaskIds` entry and leaves other reasons (for example `user_pause`) in place.
- `packages/governor/src/index.ts` does not re-export this task. Wire the snippet above.
- Consented installs are not probes: the visible command may run up to 10 minutes and is cancellable. Probes stay at 10 seconds. `winget`, `choco`, and `npm -g` are allow-listed only as exact argv shown on the consent card. There is no silent execution path.
- Postgres SCRAM-SHA-256 is implemented and checked against the RFC 7677 `pencil` vector. SASLprep is the identity function for ASCII user names. Non-ASCII user names fail closed.
- `skipFeature` records `resolution = "feature_skipped"`, clears holds, and does not stamp `verified` or `attested`. The badge says `Browser checks disabled` for Playwright. Cold open does not reprobe a skipped feature.
- The default HTTPS client does not follow redirects and refuses URLs that embed userinfo.
