---
task_id: "Task-199"
branch: "task/199-security-privacy-audit"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "tests/e2e/security-audit/**"
  - "tests/e2e/tests/security-audit.test.ts"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 199 handoff

Final security, privacy, supply-chain, and provider-terms audit for M6 pre-release certification. Commit stays on `task/199-security-privacy-audit`. **Never merge.**

Sibling branches are not on base `649773097c387ae534b686ea5825f449f843aa7c`. The suite uses local ports under `tests/e2e/security-audit/ports/` and closed fixtures under `tests/e2e/security-audit/fixtures/`.

## Exports Provided

Import from `tests/e2e/security-audit/index.ts`:

- `FinalSecurityPrivacyAuditSuite` — `run(options)` executes pillars 1–5, all six red-team vectors, and returns a signed `SecurityAuditCertificationReport`. Fail-closes on any finding (`exitCode !== 0`).
- `SecurityAuditCertificationReport` — schema `security-audit-certification/1`. JSON + Markdown scorecard via `scorecardMarkdown` and `SecurityAuditCertificationReportWriter.toJson`.
- `runSecurityAudit` / `writeCertificationArtifacts` — CI entry points. CLI: `node tests/e2e/security-audit/run-security-audit.ts --write`.
- `RedTeamSecuritySuiteRunner`, `VaultCanaryLeakDetector`, `runRedTeamGate` — local Task 193 ports (loopback trap only; closed fixtures).
- `SecretPurgeEngine`, `WindowsDpapiSecretsVault` — local Task 030 / Task 120 ports for DPAPI isolation and 8-step raw-byte purge proof.

## Shared Wiring Needs (Root / Index Barrels)

`tests/e2e/vitest.config.ts` is frozen (`include: tests/**/*.test.ts`). `tests/e2e/tests/security-audit.test.ts` is a side-effect loader for owned tests under `tests/e2e/security-audit/`. `pnpm --filter @ef-harness/e2e test -- security-audit` runs all seven tests.

At integration, add `security-audit/**/*.test.ts` to the frozen vitest include and delete the loader. Do not edit `tests/e2e/src/index.ts` on this branch.

Optional root scripts when `package.json` is writable:

```json
"test:security-audit": "node tests/e2e/security-audit/run-security-audit.ts"
```

## Dependency Intents (New Packages Requested)

None. Swap local ports when sibling tasks land on `harness/integration`:

| Local port | Sibling | Swap |
| --- | --- | --- |
| `WindowsDpapiSecretsVault` | Task 120 | Real DPAPI seal/unseal; keep `0` plaintext bytes on disk. |
| `SecretPurgeEngine` | Task 030 | Full 8-step purge (`VACUUM`, WAL truncate, FTS rebuild, CAS, views). |
| `RedTeamSecuritySuiteRunner` | Task 193 | Six canonical red-team scenarios; `trapHitCount === 0`. |
| `KernelPackageInstaller` | Task 048 | `pnpm v10` `onlyBuiltDependencies` / `allowBuilds` kernel install. |
| `auditProviderTerms` / `NoSilentPaidFallbackGuard` | Tasks 135, 141, 147, 148 | Console-only Claude, Gemini off-by-default, zero withdrawn vendor, ChatGPT wire locks, zero silent paid spend. |
| `auditPrivacyDeploy` | Tasks 133, 172, 179, 186 | Crash upload off, name-only env sync, SSH deploy hygiene, public `harness-state` push guard, age-sealed checks, zero-stash landing. |
| Skill manifest fixtures | Task 078 | Replace `fixtures/skills-manifest.json` with live `skills/**` SHA-256 pins (20/20). |

## Contract Change Requests

None.

## Exact Verification Commands & Results

From `C:\Users\Ayush\Desktop\ef-wt\task-199-security-privacy-audit`:

- `pnpm --filter @ef-harness/e2e typecheck` — pass (`tsc -b`, exit 0).
- `pnpm --filter @ef-harness/e2e lint` — pass (`eslint .`, exit 0).
- `pnpm --filter @ef-harness/e2e test -- security-audit` — pass (Vitest v5.1.1, 1 file loader, **7 tests**, ~4.6s). Five pillar tests + certification pass with **0 findings**, **0 residual secret bytes**, red-team **6/6 blocked**, silent spend **$0.00**, withdrawn vendor hits **0**, skill pins **20/20**, `allowBuilds` enforced. Injected `skipVacuum`, weak CSP, silent paid spend, and skill hash drift fail closed.
- `node scripts/verify-harmony.mjs --task 199` — pending (run at commit).

## Known Limitations / Follow-Ups

- DPAPI, purge, red-team, provider, and deploy checks use **local ports** and **synthetic canaries** only (`tests/e2e/security-audit/fixtures/`). No real `~/.ssh`, no outbound hosts, no exploit playbooks.
- Only one production skill exists on this base (`skills/infer-or-ask`); pillar 3 vets **20 closed fixture skills** under `fixtures/skills/` plus root `onlyBuiltDependencies`.
- Electron hardening is validated against explicit security profiles (main, pop-out, `persist:ef-preview-*`); swap for static analysis of `apps/desktop` once Task 123 lands.
- Live `pnpm audit --audit-level=high` is not executed offline; supply-chain pillar asserts frozen lockfile presence and allowlist discipline instead.