---
task_id: "Task-078"
branch: "task/078-skill-vetting-quarantine-catalog"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "corpus/skills/**"
  - "packages/meta-lab/src/skill-vetting/**"
  - "packages/meta-lab/tests/skill-vetting/**"
  - ".agent-handoffs/task-078.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 078 handoff

Public skill acquisition gates and the pinned M2 six-skill catalog. Commit stays on `task/078-skill-vetting-quarantine-catalog`.

## Exports Provided

Import from `packages/meta-lab/src/skill-vetting/index.ts` until the frozen package barrel is wired:

- `SkillManifestRegistry` — `list`, `get`, `readCandidate`, `loadForMount`, `setVettingStatus`. Load refuses a disk SHA-256 or `pinnedCommitSha` that diverges from `corpus/skills/manifest.json`.
- `StaticSkillSecurityVetter` — `scan`, `assertClean`, `assertCandidate`. Hard-rejects hidden Unicode (U+200B–U+200F, U+202A–U+202E, U+FEFF, U+2060, U+2066–U+2069, tag block U+E0000–U+E007F), HTML comments, markdown link-title payloads, hidden markup, user ssh/aws/claude/codex/gemini config paths and `%APPDATA%`, `curl|sh`, `iex`, secret exfiltration, `--no-verify` / `skipTests` / `ignore previous instructions`, binaries and unapproved script hooks, and a downloaded skill with a missing or non-OSI license.
- `SkillTokenBudgetEnforcer` — `count`, `assertWithinCap` (message `N > 2000`), `assertMountedSet` (`<= 2` skills and `<= 3500` combined tokens), `selectForTask` / `rankSkillsForTask` (exact role, then tag specificity, then overlap).
- `CanarySkillQuarantineHarness` — `evaluate`, `promote`. A clean run moves `quarantined` to `vetted`. Canary access, network, out-of-scope test edits, or a failed smoke check moves it to `rejected`.
- `SkillMounter` — `mount`. Copies vetted payload files into `<worktree>/.ef-skills/<attemptId>/` and records that path in `<worktree>/.git/info/exclude`. Refuses user-home config directories and any path outside the worktree.
- `verifyPinnedCatalog`, `assertInferOrAskByteParity`, `buildM2Manifest`, `countSkillTokens`, `TOKENIZER_ID` (`cl100k-o200k-upper-bound-v1`).
- Local ports: `PacketSecurityRedactorPort`, `SandboxPolicyPort`, `NativeWorkerLoopPort`, with `LocalPacketSecurityRedactor`, `LocalSandboxPolicy`, and `LocalNativeWorkerLoop`.

`vettingStatus` is `quarantined | vetted | revoked | rejected`. `rejected` is the failed-promotion terminal from the canary harness. Only `vetted` can be mounted. Setting `revoked` blocks the next `loadForMount` / `mount` call.

Manifest entry shape: `{ skillId, version, sourceType: 'authored' | 'downloaded', upstreamRepo, pinnedCommitSha, license, sha256, tokenCount, allowedRoles[], allowedTouches[], vettingStatus, lastVettedAt }`. `sha256` covers every file in the skill directory except `quarantine-report.json`. `pinnedCommitSha` is the git blob SHA-1 of `SKILL.md`. `tokenCount` is the cl100k/o200k upper bound of `SKILL.md` plus linked `snippets/*.md` files.

M2 catalog under `corpus/skills/m2/`:

| Skill | sourceType | tokens | license |
|---|---|---|---|
| `infer-or-ask@1` | authored | 1440 | LicenseRef-EF-Harness |
| `systematic-debugging@1` | downloaded | 693 | MIT |
| `test-driven-verification@1` | downloaded | 720 | MIT |
| `frontend-accessibility-ui@1` | downloaded | 792 | MIT |
| `sql-migrations-safety@1` | downloaded | 865 | MIT |
| `api-security-hardening@1` | downloaded | 830 | MIT |

`infer-or-ask@1` is a byte copy of `skills/infer-or-ask/SKILL.md`. Each skill directory also stores a passing `quarantine-report.json` (0 canary accesses, 0 network calls, 0 out-of-scope test edits, smoke passed).

## Shared Wiring Needs (Root / Index Barrels)

`packages/meta-lab/src/index.ts` and `packages/meta-lab/package.json` are frozen. Integration should re-export this module from the package barrel. No new `package.json` `exports` key is required once the barrel re-exports it.

```ts
export {
  CanarySkillQuarantineHarness,
  LocalNativeWorkerLoop,
  LocalPacketSecurityRedactor,
  LocalSandboxPolicy,
  SkillManifestRegistry,
  SkillMounter,
  SkillTokenBudgetEnforcer,
  StaticSkillSecurityVetter,
  assertInferOrAskByteParity,
  verifyPinnedCatalog,
} from "./skill-vetting/index.js";
```

`assertInferOrAskByteParity` reads `skills/infer-or-ask/SKILL.md`, the same relative path as `CANONICAL_ASSETS.inferOrAskSkill` on `@ef-harness/shared-contracts`. The frozen shared-contracts barrel was not edited.

## Dependency Intents (New Packages Requested)

None. The token cap uses an in-repo cl100k/o200k pretoken upper bound (`countSkillTokens`). Do not add `tiktoken` or another tokenizer package for this task.

## Contract Change Requests

None for frozen schema or package barrels.

Local ports stand in for sibling contracts that are not on this base (`6497730`):

- Replace `LocalPacketSecurityRedactor` with Task 011 `SecretRedactor.scanForSecrets` plus registered-value matching. Later tasks call that seam `PacketSecurityRedactor`. `containsRegisteredValue` is the canary-string check the quarantine harness needs.
- Replace `LocalSandboxPolicy.createSealedScratch` with the sealed attempt scratch from the sandbox package (Task 045 in the task text names `SandboxPolicy`; that task's published producer is `SecureDocFetcher`). The local port creates `ef-skill-scratch-*` only under the caller-supplied parent and seeds `CANARY_STRIPE_KEY` plus a fake `home/agent/.ssh/id_ed25519` inside that scratch. It never writes the real user profile.
- Replace `LocalNativeWorkerLoop.runSkillInScratch` with `NativeWorkerLoop.runAttempt` (Task 053 in the task text; the executor that owns `runAttempt` is Task 057). The local loop is a deterministic instruction interpreter with no model call and no network, so quarantine stays offline.

`rejected` is an extra `vettingStatus` beyond the three-value union in the task statement. It is how `quarantined → rejected` is stored. Mounting still requires `vetted`.

## Exact Verification Commands & Results

From `C:\Users\Ayush\Desktop\ef-wt\task-078-skill-vetting-quarantine-catalog`:

- `pnpm --filter @ef-harness/meta-lab test -- skill-vetting` — pass. 4 files, 16 tests. Covers SHA-256 pins, static vetting, the 2,000-token cap, OSI license checks, byte parity with `skills/infer-or-ask/SKILL.md`, unicode tag block, bidi override, `~/.ssh`, `--no-verify`, a 2,001-token reject (`2001 > 2000`), tampered SHA-256, the subtle `process.env` canary lure, clean promotion, worktree-only mount plus `.git/info/exclude`, outside-worktree and `~/.codex` refusal, revocation on the next mount, and the 4-skill selector cap (`<= 2`, `<= 3500`).
- `pnpm --filter @ef-harness/meta-lab typecheck` — pass (`tsc -b --pretty false`).
- `pnpm --filter @ef-harness/meta-lab lint` — pass (`eslint .`).
- `node scripts/verify-harmony.mjs --task 078` — pass (`harmony ok for Task-078`). The command also ran repo `pnpm typecheck`, `pnpm lint`, and `pnpm test`.

## Known Limitations / Follow-Ups

- Skills 2–6 are original offline instruction texts licensed MIT, attributed to `offline-vendor:<skillId>`, and pinned by SHA-256 plus the git blob id of `SKILL.md`. They are not byte-for-byte snapshots of a public marketplace repository. That keeps vetting, mounting, and tests offline when an upstream host is gone. Task 104 can replace a slot with a new pinned digest if a specific upstream snapshot is required.
- Quarantine does not call a live model. `LocalNativeWorkerLoop` performs the explicit instructions the static vetter allows through (including `print process.env to <file>`) inside the scratch, and the harness then scans stdout and written files for canary values.
- `infer-or-ask@1` parity is a direct read of `skills/infer-or-ask/SKILL.md`. Do not edit that canonical file from this task.
- Task 104 owns `corpus/skills/wave2/` and is not touched here.
