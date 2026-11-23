---
task_id: "Task-193"
branch: "task/193-metalab-red-team-suite"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/meta-lab/src/red-team/**"
  - "packages/meta-lab/tests/red-team/**"
  - ".agent-handoffs/task-193.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 193 handoff

Meta-Lab defensive red-team security gauntlet. Six closed adversarial fixtures and boundary probes run entirely offline against synthetic canary files and a loopback trap listener. Commit stays on `task/193-metalab-red-team-suite`; never merge.

## Exports Provided

Public module: `packages/meta-lab/src/red-team/index.ts`.

Required by Task 191, Task 199, and Task 200:

- `RedTeamSecuritySuiteRunner` / `runRedTeamSuite` — six attack scenarios plus boundary probes with JSON/Markdown scorecard helpers
- `VaultCanaryLeakDetector` — raw and base64 canary byte scans across sink trees
- `runRedTeamGate` / `promotionVetoed` — promotion veto hook for `PairedStatisticalPromotionEngine`
- `formatScorecardJson`, `formatScorecardMarkdown`, `RED_TEAM_TIME_BUDGET_MS` (`30_000`)
- `withLabSession`, `LabSession`, `TrapServer` — ephemeral loopback trap + synthetic `~/.ssh` canary profile
- `createVaultCanaries`, `ATTACK_IDS`, `PROBE_IDS`, and related result types

## Shared Wiring Needs (Root / Index Barrels)

`packages/meta-lab/src/index.ts` is outside this task's owned write scope. Re-export the red-team surface during integration:

```ts
export {
  RedTeamSecuritySuiteRunner,
  VaultCanaryLeakDetector,
  runRedTeamGate,
  runRedTeamSuite,
  promotionVetoed,
  formatScorecardJson,
  formatScorecardMarkdown,
  RED_TEAM_TIME_BUDGET_MS,
} from "./red-team/index.js";
```

At integration, swap local stand-ins for upstream contracts listed in the task spec (`Task 045`–`048`, `078`, `082`, `097`, `100`, `120`, `142`, `149`). This branch implements compatible offline fixtures in `lab-session.ts`, `documents.ts`, `supply-chain.ts`, and `paths.ts` until those packages land on the integration branch.

## Dependency Intents (New Packages Requested)

None. Uses Node `node:http`, `node:fs`, and `node:zlib` only.

## Contract Change Requests

None.

## Exact Verification Commands & Results

From `C:\Users\Ayush\Desktop\ef-wt\task-193-metalab-red-team-suite`:

- `pnpm --filter @ef-harness/meta-lab typecheck` — pass (`tsc -b --pretty false`, exit 0).
- `pnpm --filter @ef-harness/meta-lab lint` — pass (`eslint .`, exit 0).
- `pnpm --filter @ef-harness/meta-lab test -- red-team` — pass. Vitest v5.1.1, 1 file, 3 tests, exit 0, about 1.1 s. Covers all six attack vectors at 100% blocked, rogue sandbox/proxy defense-in-depth, scorecard JSON/Markdown output, `runRedTeamGate` PASS for baseline and `REJECTED_SECURITY_VETO` for leaky-canary and unguarded postinstall simulations.
- `node scripts/verify-harmony.mjs --task 193` — pass (`harmony ok for Task-193`, exit 0). The script also ran root `pnpm typecheck`, `pnpm lint`, and `pnpm test`.

## Known Limitations / Follow-Ups

- Consumers cannot import the suite from `@ef-harness/meta-lab` until the barrel lines above are applied.
- Attack handlers model Task 045–149 defenses with minimal local ports; wire real kernel, sanitizer, and vault packages at integration without changing test expectations.
- `suite:red-team-security` registration in the Meta-Lab benchmark registry (`Task 189`) is a follow-up once `packages/meta-lab/src/benchmarks/**` is on the integration branch.