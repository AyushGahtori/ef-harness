# Pass 02 — Chunk 003: Clean Verifier, Multi-Surface Oracles, M1 Daemon/Viewer, and M1 Exit Gate (`Tasks 060–068`)

## 1. Chunk identification and scope
- **Pass number:** Pass 02
- **Chunk ID:** `pass-02/chunk-003`
- **Unit IDs:** `Tasks 060–066` (`packages/verifier`), `Task 067` (`apps/daemon`, `apps/desktop`, `apps/renderer`), `Task 068` (`tests/e2e`, `benchmarks/m1-kitchen-leaves`)
- **Branches and commits:**
  - `task/060-clean-verifier-harness` (`a06d371`), `task/061-red-before-green-blind-binder` (`cc176e3`, dirty worktree diff), `task/062-ui-interaction-contract-verifier` (`fe62a40`, dirty worktree diff), `task/063-multi-surface-verifiers` (`9b455fd`, dirty worktree diff), `task/064-ai-eval-property-mutation-probes` (`3a84cad`, dirty worktree diff), `task/065-hint-ladder-dispute-routing` (`9f0c374`), `task/066-candidate-acceptance-tx` (`f68afb3`, dirty worktree diff)
  - `task/067-m1-daemon-minimal-viewer` (`d1109c7`)
  - `task/068-m1-kitchen-exit-gate` (`76f8a9c`)
- **Worktree paths:** `C:/Users/Ayush/Desktop/ef-wt/integration/{packages/verifier,apps/daemon,apps/desktop,apps/renderer,tests/e2e}` and dirty worktrees `task-061`, `task-062`, `task-063`, `task-064`, `task-066`
- **Governing architecture documents:** `verification-and-runtime.md`, `completeness-and-quality.md`, `kernel-schema-and-protocol.md`, `desktop-and-ux.md`, `roadmap.md` (M1 exit gate), `IMPLEMENTATION_TASKS.md` (`Tasks 060–068`).

## 2. Units inspected
- All 9 units `Task 060` through `Task 068`, plus all 5 dirty worktree diffs (`061, 062, 063, 064, 066`).

## 3. Files inspected
- `packages/verifier/{package.json,src/index.ts}`, `src/runner/*`, `src/binder/*` (+ `task-061` diff), `src/ui-contract/*` (+ `task-062` diff), `src/surfaces/*` (+ `task-063` diff), `src/advanced/*` (+ `task-064` diff), `src/hint-ladder/*`, `src/acceptance/*` (+ `task-066` diff)
- `apps/daemon/{package.json,src/index.ts,src/bootstrap/*}`, `apps/desktop/{package.json,src/index.ts,src/bootstrap/pipe-client.ts}`, `apps/renderer/{package.json,src/index.ts,src/m1-viewer/*}`
- `tests/e2e/{package.json,m1-exit-gate/pipeline.ts,tests/m1-exit-gate.test.ts}`

## 4. Architecture documents consulted
- `verification-and-runtime.md` (clean-checkout verifier, blind red-before-green binder, Playwright UI interaction contract, 6 surface verifiers, AI cassette/mutation probes, 3-step hint ladder + dispute routing, atomic candidate acceptance transaction)
- `kernel-schema-and-protocol.md` (daemon bootstrap, outbox deliveries, Electron utility-process `MessagePort` bridge)
- `roadmap.md` (M1 20-task Kitchen-Prep end-to-end exit gate)

## 5. Contracts and signatures discovered
- `CleanVerifierRunner` (`060`), `BlindOracleBinder` (`061`), `UiInteractionContractVerifier` (`062`), `MultiSurfaceVerifierSuite` (`063`), `AdvancedProbeRunner` (`064`), `HintLadderController` (`065`), `CandidateAcceptanceCoordinator` (`066`)
- `HarnessDaemon` (`067`), `DesktopPipeBridge` (`067`), `M1MinimalViewer` (`067`)
- `runM1KitchenExitGate` (`068`)

## 6. Confirmed findings
- **F-025** — `packages/verifier` (`060–066`) is missing 5 uncommitted worktree bugfixes (`task-061`, `task-062`, `task-063`, `task-064`, `task-066`) on `harness/integration`, defines 4 incompatible `SurfaceVerifierAdapter` interfaces across `060, 062, 063, 064`, and leaves `CandidateAcceptanceCoordinator` (`066`) disconnected from `@ef-harness/db`, `@ef-harness/git-engine`, and `@ef-harness/completeness-gate`.
- **F-026** — `apps/daemon` (`067`) bypasses `@ef-harness/db` and `@ef-harness/ipc`, omits `user_version` / WAL pragmas, uses PID-only lockfile checks (vulnerable to Windows PID reuse), and writes `outbox` rows without `outbox_deliveries` (violating `outbox_without_deliveries` invariant in `schema/queries.sql`).
- **F-027** — `apps/desktop/src/bootstrap/pipe-client.ts` (`067`) corrupts/duplicates framed bytes via `localCodec.takePending()` + raw `forward(chunk)` after `session.hello` and overwrites a single global `renderer` `MessagePort` when multiple windows connect.
- **F-028** — `tests/e2e/m1-exit-gate/pipeline.ts` (`068`) implements a 1,359-line standalone mock pipeline with zero imports from `@ef-harness/db`, `git-engine`, `sandbox`, `test-env`, `mcp-server`, `worker-loop`, `completeness-gate`, or `verifier`.

## 7. Unverified findings
- None (`0` unverified).

## 8. Producer-consumer relationships
- `verifier` (`060–066`) consumes `sandbox` (`047`), `test-env` (`049`), `completeness-gate` (`059`), `db` (`017, 020, 026, 028`), `git-engine` (`037, 039`), and produces verified receipts/acceptance for `planner` (`095`), `integrator` (`096`), and `tests/e2e` (`068, 105, 134, 152, 175, 195`).
- `apps/daemon` & `apps/desktop` (`067`) are extended by `Tasks 122–133, 160, 196`.

## 9. Defects and missing integrations
- 5 uncommitted worktree diffs (`061–064, 066`) unmerged on `harness/integration`.
- Daemon/desktop (`067`) and M1 E2E (`068`) re-implement kernel primitives instead of importing M0/M1 packages.

## 10. Tests and verification performed
- Inspected uncommitted `git diff` in `task-061`, `task-062`, `task-063`, `task-064`, and `task-066`, plus `apps/daemon/src/bootstrap/*`, `apps/desktop/src/bootstrap/pipe-client.ts`, and `tests/e2e/m1-exit-gate/pipeline.ts`.

## 11. Unresolved questions
- None in this chunk.

## 12. Explicit files and relationships still requiring inspection
- `Tasks 105, 134, 152, 175, 194, 195, 198, 199` shared `tests/e2e/package.json` conflicts with `Task 068`.
- `Tasks 122–133, 160` shared `apps/daemon`, `apps/desktop`, and `apps/renderer` seams with `Task 067`.
