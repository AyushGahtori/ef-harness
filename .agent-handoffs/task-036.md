---
task_id: "Task-036"
branch: "task/036-git-safety-scanner"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/git-engine/src/safety-scan/**"
  - "packages/git-engine/tests/safety-scan/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 036 handoff

First-commit and candidate-diff safety scanner, `.gitignore` proposal generator, and `.git/info/exclude` manager. Commit stays on `task/036-git-safety-scanner`.

## Exports Provided

Import from `packages/git-engine/src/safety-scan/index.ts` (same-package relative import `../safety-scan/index.js` until the package barrel is wired):

- `GitSafetyScanner`
  - `scanWorkingTreeForBaseline(): Promise<SafetyScanReport>`
  - `scanCommitDiffForSecrets(base: string, candidate: string): Promise<DiffSecretScanResult>`
  - `generateGitignoreProposal(input?: GitignoreProposalInput): Promise<GitignoreProposal>`
  - `applyUserEditedProposal(editedText: string, proposal: GitignoreProposal): Promise<AppliedGitignoreProposal>`
- `SafetyScanReport` with `blockedSecrets`, `largeFiles`, `recommendedIgnores`, `proposedGitignoreDiff`, and `safeToCommit`
- `ensureGitInfoExclude(repoRoot, options?): Promise<EnsureExcludeResult>`
- `normalizeSkillFolder(folder: string): string`
- `GitSafetyError`
- `createDefaultGitRunner()` local fallback until Task 035's `GitRunner` is injected

`BlockedSecretFinding` is an Interrupt-now record: `file`, `path`, `line`, `rule`, `ruleId`, redacted `preview`, `severity: "interrupt_now"`. Previews never contain the raw secret. A live-key hit keeps only the known prefix plus `****...****`.

`DiffSecretScanResult.rejected` is true when any finding exists, and `severity` is `"interrupt_now"` or `"clear"`.

Consumed ports, defined locally so this task does not edit shared contracts:

- `GitRunner.execGit(args, { cwd, timeoutMs?, env?, userExplicitConsentToken? })` returns `{ exitCode, stdout, stderr, durationMs }`. The scanner calls only `rev-parse`, `diff`, and `cat-file`.
- `SecretRedactor.redact(text)` masks an already-redacted preview. Vault values are passed separately as `{ label, value }[]` and are matched in raw, Base64, and URL-encoded forms. The redactor is never given the raw value.

`ensureGitInfoExclude` writes `.harness/views/`, `.harness/tmp/`, `.ef-skills/`, `.harness/skills/`, and any mounted skill folders into `.git/info/exclude` (or the worktree gitdir from `git rev-parse --git-path info/exclude`). It does not modify `.gitignore`.

## Shared Wiring Needs (Root / Index Barrels)

`packages/git-engine/src/index.ts` is outside this task's write scope. The integrator should re-export the safety-scan barrel from that package entry:

```ts
export {
  GitSafetyScanner,
  ensureGitInfoExclude,
  normalizeSkillFolder,
  createDefaultGitRunner,
  GitSafetyError,
} from "./safety-scan/index.js";
export type {
  SafetyScanReport,
  DiffSecretScanResult,
  GitignoreProposal,
  GitRunner,
  SecretRedactor,
} from "./safety-scan/index.js";
```

Task 037 can import `../safety-scan/index.js` from `packages/git-engine/src/snapshots/` without that barrel. Task 059 and Task 120 need the package entry export above.

## Dependency Intents (New Packages Requested)

None. No new package is required. The bundled `gitleaks` executable is optional and resolved from an explicit path, `EF_HARNESS_GITLEAKS`, or Electron `resources/gitleaks`. When it is absent, the built-in TypeScript scanner still runs.

## Contract Change Requests

None. `GitRunner` and `SecretRedactor` are local ports matching the Task 035 and Task 011 shapes this scanner needs. Vault values are an input array rather than a new shared-contract type.

## Exact Verification Commands & Results

Run from `C:\Users\Ayush\Desktop\ef-wt\task-036-git-safety-scanner` on `task/036-git-safety-scanner`.

- `pnpm --filter @ef-harness/git-engine test -- safety-scan` — pass, 1 file, 21 tests (`.env*`, PEM and key filenames, synthetic high-entropy tokens, vault raw/Base64/URL forms, sparse file over 50 MB, injected 5 GB file that is not read, `node_modules` and the other build directories, OS junk, placeholder `.env.example`, live-key redaction, out-of-tree symlink, `.git/info/exclude`, diff rejection, gitleaks exit 1 vs exit >1).
- `pnpm --filter @ef-harness/git-engine typecheck` — pass, exit 0.
- `pnpm --filter @ef-harness/git-engine lint` — pass, exit 0.
- `node scripts/verify-harmony.mjs --task 036` — pass, `harmony ok for Task-036`, exit 0.

## Known Limitations / Follow-Ups

- The package barrel re-export above is integrator wiring. This task does not edit `packages/git-engine/src/index.ts`.
- `createDefaultGitRunner` is a compatible fallback (`shell: false`, `core.longpaths=true`, `core.quotepath=false`, `GIT_TERMINAL_PROMPT=0`). Inject Task 035's runner when that branch lands.
- In-tree symlinks are not opened. Escaping symlinks are flagged and their targets are not read. A target that also lives inside the tree is scanned when the walk reaches its real path.
- Build directories are flagged by name and not content-scanned, so a secret that exists only inside `node_modules/` is not a separate finding. The directory itself is a recommended ignore and clears `safeToCommit` until ignored.
- Files over 50 MB are flagged from `lstat` and not read. Binary files (NUL in the first 8 KB) skip regex and entropy scans. Keystore magic is still checked on that prefix.
- `safeToCommit` is false when any blocked secret, large file, unignored junk file, or unignored build directory is present. Suggested stack ignores for a clean tree do not by themselves clear the flag.
- Lines a user deletes in `applyUserEditedProposal` stay off later proposals from that same scanner instance. A new instance will propose them again if the files are still present and not ignored.
- `ensureGitInfoExclude` throws when the folder has no `.git` directory. It does not create one.
- A `gitleaks` crash sets `repairSignal` and the warning `gitleaks-repair`. The TypeScript scanner still reports its own findings. A crash alone does not mark an otherwise clean tree unsafe.
- An explicit `gitleaksBinary` that is missing is treated as absent and does not fall through to `EF_HARNESS_GITLEAKS`.
