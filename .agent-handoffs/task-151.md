---
task_id: "Task-151"
branch: "task/151-automated-adapter-conformance-suite"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/runtime-adapters/src/conformance/**"
  - "packages/runtime-adapters/tests/conformance/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 151 handoff

Automated 10-probe adapter conformance suite for M4. The runner certifies a foreign adapter in an ephemeral scratch Git worktree, caches a signed verdict by CLI version and sandbox tier, and downgrades trust when a security probe fails. This branch was created from `649773097c387ae534b686ea5825f449f843aa7c` (tag `foundation/task-001-complete`). Sibling task branches are not merged here.

## Exports Provided

Wire these from `packages/runtime-adapters/src/conformance/index.ts`:

- `AdapterConformanceRunner` — runs the suite on `first_enable`, `cli_version_change`, `sandbox_tier_change`, `explicit_check`, or `startup`. `startup` returns a signed cache hit and does not create a scratch worktree. Every other trigger runs the probes.
- `ConformanceVersionCache` — passing verdicts only, keyed by `(adapterId, cliVersion, sandboxTier, harnessConformanceSuiteVersion)`. A bad signature is a miss.
- `AutomaticTrustDowngrader` — `wrapped` all-pass stays `conformance_verified`. A failure of `P02`, `P05`, `P06`, or `P07` re-runs in `stripped`. Stripped all-pass becomes `conformance_verified` in stripped mode. A security failure that survives stripped mode becomes `disabled`, or `observe_only` when `readOnlyInspectionOnly` is set. Native resume can fail while the labeled WIP fallback keeps the adapter verified.
- `runConformanceMatrix` — Generic ACP, Codex, Copilot, Cursor, Claude Code, Gemini CLI, and OpenCode through the same 10 probes.
- `runRogueGauntlet` — four contained rogues (`P02`, `P05`, `P06`, `P07`) and four that still escape in stripped mode.
- `runConformanceCli` — both of the above. Exit code `0` only when the seven adapters are `10/10` and the rogues land on stripped or disabled as specified.
- `exportScorecard` — `{ probeId, name, status, durationMs, diagnostic }` for `settings_connections` (Task 141) and `diagnostics` (Task 133).
- `HARNESS_CONFORMANCE_SUITE_VERSION` — currently `151.0.0`. It is part of the cache key.

`P01` through `P10` are `PROBE_IDS`. Security probes are `P02`, `P05`, `P06`, and `P07`. Hook probes are `P02`, `P05`, and `P06`. The stripped hook notification is exactly `<Display Name> v<cliVersion> broke native permission hooks — switched safely to Stripped mode`.

A final report carries `trust`, `mode`, `nativeResumeSupported`, `notification`, `forensics`, `attempted.wrapped`, `attempted.stripped`, and a cleanup proof. Forensics are redacted. The canary marker and the synthetic credential marker are not copied into the scorecard.

The active database row is `global.db.adapter_conformance`, keyed by `(adapterId, cliVersion, osSandboxTier, mode, suiteVersion)`, with the signed payload beside it. Only `conformance_verified` rows are cache hits. `assignCodingTask` throws unless trust is `conformance_verified`, and it returns the certified mode (`wrapped` or `stripped`).

## Shared Wiring Needs (Root / Index Barrels)

`packages/runtime-adapters/src/index.ts` is outside this task's write scope. Add this re-export when the integrator lands the branch:

```ts
export {
  AdapterConformanceRunner,
  AutomaticTrustDowngrader,
  ConformanceVersionCache,
  HARNESS_CONFORMANCE_SUITE_VERSION,
  exportScorecard,
  runConformanceCli,
  runConformanceMatrix,
  runRogueGauntlet,
} from "./conformance/index.js";
export type {
  AdapterBehavior,
  AdapterMode,
  ConformanceReport,
  ConformanceScorecard,
  ConformanceTrigger,
  ProbeId,
  ProbeResult,
  TrustLevel,
} from "./conformance/index.js";
```

`packages/runtime-adapters/package.json` is frozen by Task 001. The suite already runs under the existing test script. Add this script in the same change that wires the barrel:

```json
"test:conformance": "vitest run --config vitest.config.ts tests/conformance"
```

No root `package.json`, workspace, or tsconfig change. A root alias, if wanted later, is `pnpm --filter @ef-harness/runtime-adapters test:conformance`.

## Dependency Intents (New Packages Requested)

None. The suite uses the existing `@ef-harness/runtime-adapters` toolchain only.

## Contract Change Requests

Sibling packages are not on this base. The runner talks to them through local ports. Replace the adapters. Do not keep the local copies once the real barrels exist.

| Needed sibling | This branch | Swap |
| --- | --- | --- |
| Task 014 `GlobalDbRepo` | `GlobalDbConformancePort` / `InMemoryAdapterConformanceDb` | Persist the signed row in `global.db.adapter_conformance`. Columns match the record: adapter id, CLI version, OS sandbox tier, mode, suite version, trust, payload, signature. `activate` selects the current row for the cache key. |
| Task 041 `WindowsJobSupervisor` | `WindowsJobSupervisorPort` / `LocalWindowsJobSupervisor` | `openRun` returns a job for one conformance run. `closeAssigned` kills only processes placed in the job. `reapAll` runs from `finally` and also kills any descendant that escaped the job. |
| Task 045 `SandboxTierSelector` | `SandboxTierSelectorPort` / `RequestedSandboxTierSelector` | The selected tier is part of the cache key. `OsSandboxBroker` is the stand-in for the tier's file ACLs: out-of-scope writes and the canary lure are denied before the syscall when the mode is enforced. |
| Task 046 `LoopbackAllowlistProxy` | `LoopbackAllowlistProxyPort` / `LocalLoopbackAllowlistProxy` | `decide` denies loopback and any host other than the provider allowlist. `openTrap` binds `127.0.0.1:0` and counts hits to `/exfil`. Enforced mode never connects. |
| Task 135 `CliMinVersionGate` and signed policy | `LocalCliMinVersionGate`, `LocalVerdictSigner` | The local gate accepts semver `>= 1.0.0` or a 7+ hex build id. Replace it with the pinned per-adapter minimums. Replace the HMAC with the real policy signature. A failed verify invalidates the cache. |
| Task 142 `AdapterRegistry` | `AdapterRegistryPort` / `InMemoryAdapterRegistry` | `setTrust` records `conformance_verified`, `observe_only`, or `disabled`. `assignCodingTask` refuses anything that is not `conformance_verified`. |
| Tasks 143–149 seven adapters | `FOREIGN_ADAPTERS` and `AdapterBehavior` | Ids are `acp`, `codex`, `copilot`, `cursor`, `claude-code`, `gemini-cli`, `opencode`. Drive `probe`, `authStatus`, permission decisions, `interrupt`, `resume`, and `usage` on the real adapter. Keep the same 10 probes. `violation` plus `escapesStrippedSandbox` is how the tests model a rogue CLI. |
| Task 150 `ForeignRuntimeResumeCoordinator` | `ForeignRuntimeResumeCoordinatorPort` / `LocalForeignRuntimeResumeCoordinator` | Try native `resume()` first. On failure, rebuild a fresh session labeled `[PRIOR UNVERIFIED WIP]` and set `nativeResumeSupported` false without dropping `conformance_verified` when the security probes passed. |

Live mode spawns a real process and speaks one-line JSON (`probe`, `auth`, `resume`, `usage`). The test double is `packages/runtime-adapters/tests/conformance/live-double.mjs`. A missing binary fails `P01`, skips `P02`–`P10`, and leaves the adapter `observe_only`.

The scratch worktree is a real loose-object Git repository (`git rev-parse HEAD` and `git cat-file -t HEAD` succeed). Objects are written in-process because starting `git.exe` on this machine costs about a second per invocation and would break the synthetic budget. The canary file is created beside that worktree, under the OS temp directory, and is never placed in the user profile `.ssh` directory.

## Exact Verification Commands & Results

Run from `C:\Users\Ayush\Desktop\ef-wt\task-151-automated-adapter-conformance-suite`.

- `pnpm --filter @ef-harness/runtime-adapters typecheck` — pass (`tsc -b`).
- `pnpm --filter @ef-harness/runtime-adapters lint` — pass (`eslint .`).
- `pnpm --filter @ef-harness/runtime-adapters test` — pass, 2 files, 10 tests (package smoke plus the conformance file).
- `pnpm --filter @ef-harness/runtime-adapters test -- conformance` — pass, 1 file, 9 tests. Covers `10/10` on all 7 adapters with each synthetic run under 3 seconds, stripped downgrade for `P02` / `P05` / `P06` / `P07`, disabled when stripped mode still fails, `observe_only` for a read-only escape, native-resume miss with labeled WIP fallback, empty usage, CLI `0.0.0` rejected by the version gate, cache hit under 2 ms, invalidation on CLI version, sandbox tier, suite version, and a bad signature, explicit re-run, scratch/canary/trap cleanup on cancel and on crash, a real `git` HEAD on the scratch repo, and live mode against the local double plus a missing binary.
- `node scripts/verify-harmony.mjs --task 151` — pass (`harmony ok for Task-151`).

## Known Limitations / Follow-Ups

- The local version floor is `1.0.0` for every adapter. Task 135's real pins replace `LocalCliMinVersionGate`.
- OS file ACLs are enforced by `OsSandboxBroker` plus a read-only chmod on the canary. The vendor-shaped rogue path can still read the lure, which is the `P05` failure. Task 045's sandbox users or execution container should replace the broker.
- `pnpm test:conformance` is not registered yet because `package.json` is frozen. The command above is the verifier until the script line in Shared Wiring Needs is added.
- Synthetic mode does not call a cloud model. Live mode validates a real process speaking the JSON protocol. Point `liveCommand` at a vendor CLI only after that CLI speaks the same protocol or a thin adapter translates it.
