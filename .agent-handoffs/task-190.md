---
task_id: "Task-190"
branch: "task/190-metalab-simulated-developers"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/meta-lab/src/sim-dev/**"
  - "packages/meta-lab/tests/sim-dev/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 190 handoff

Meta-Lab simulated developer harnesses: scripted regression driver, hidden-spec persona model driver, anonymized recorded-session replayer, and exact-input model response cache. Commit stays on `task/190-metalab-simulated-developers`; never merge.

Sibling branches `007`, `011`, `069`, and `189` are not on this base (`649773097c387ae534b686ea5825f449f843aa7c`). This branch wires them through compact local ports documented below until those packages land on `harness/integration`.

## Exports Provided

Import from `packages/meta-lab/src/sim-dev/index.ts` until the package root barrel is allowed to re-export.

- `ScriptedRegressionSimDev` — deterministic ruleset driver (`matchQuestionId`, `matchTopicPattern`, `replyText`, `clickAction`, mid-build injections) with strict unmatched-question halts.
- `HiddenSpecPersonaSimDev` — persona styles, hidden-spec vault isolation, `<= 25` turn ceiling, repetition halt, synthetic `SecretCard` credential `sk_test_SIM_MOCK_123`.
- `AnonymizedSessionReplayer` — double-pass scrub + reproducible replay of recorded `userMessage` / `uiActions` fixtures.
- `ExactInputModelResponseCache` — RFC 8785-style exact-input keys in `node:sqlite` WAL store; `--cache-mode` analogues `read-write` | `read-only` | `bypass`; hit-ratio stats.
- `SimDevDriver` / `SimDevTranscriptRecorder` — uniform transcript `{ turnSeq, triggerEvent, responseText, actionTaken, elapsedMs, personaTokens }`.
- `AnonymizationScrubber` — email, Windows user paths, company tokens, and secret markers with fail-closed gate.
- `DeterministicFakeModelAdapter` — offline persona/cache tests with zero network.
- `createCanonicalHash` / `exactInputCacheKey` — local Task 007 hash port.

## Shared Wiring Needs (Root / Index Barrels)

When `packages/meta-lab/src/index.ts` can change, re-export the sim-dev barrel:

```ts
export * from "./sim-dev/index.js";
```

When `packages/meta-lab/package.json` exports can change, add a subpath:

```json
"./sim-dev": {
  "types": "./dist/sim-dev/index.d.ts",
  "import": "./dist/sim-dev/index.js"
}
```

No root `package.json` script changes required for this task.

## Dependency Intents (New Packages Requested)

None.

## Contract Change Requests

None.

## Sibling swaps (branches not on this base)

| Local port | Missing sibling | Swap |
| --- | --- | --- |
| `createCanonicalHash` / `exactInputCacheKey` in `sim-dev/canonical-hash.ts` | `CanonicalHash` (Task 007) | Re-export Task 007 hasher; keep cache key shape stable for Task 191. |
| `createLocalPacketSecurityRedactor` in `sim-dev/ports.ts` | `PacketSecurityRedactor` (Task 011) | Pipe recorded sessions through real redactor before scrub pass 1. |
| `createDiscoverySessionPort` in `sim-dev/ports.ts` | `DiscoverySessionCoordinator` (Task 069) | Drive live discovery sessions instead of in-memory question fixtures. |
| `createOfflineBenchmarkRegistryStub` in `sim-dev/ports.ts` | `MetaLabBenchmarkRegistry` (Task 189) | Bind sim-dev E2E runs to frozen suites + manifest ledger receipts. |

## Exact Verification Commands & Results

```text
pnpm --filter @ef-harness/shared-contracts build
pnpm --filter @ef-harness/meta-lab test -- sim-dev
pnpm --filter @ef-harness/meta-lab typecheck
pnpm --filter @ef-harness/meta-lab lint
node scripts/verify-harmony.mjs --task 190
```

All passed on 2026-11-23 in `task/190-metalab-simulated-developers` (`sim-dev` tests: 6/6).

## Known Limitations / Follow-Ups

- Sim-dev drivers operate on structured in-memory harness fixtures, not a live daemon IPC loop (`Task 191` evaluation runner will orchestrate full pipelines).
- Persona replies use `DeterministicFakeModelAdapter`; live persona models plug in behind the same `FakeModelAdapter` interface.
- Recorded sessions are JSON fixtures; export from desktop consent flow lands in a later UI task.