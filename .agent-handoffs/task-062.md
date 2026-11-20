---
task_id: "Task-062"
branch: "task/062-ui-interaction-contract-verifier"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/verifier/src/ui-contract/**"
  - "packages/verifier/tests/ui-contract/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 062 handoff

UI interaction contract verifier. Planner screen contracts are parsed as published, copy catalogs are linted before dispatch, and Playwright checks use role, label, text, and declared test ids. Missing visible controls stay a contract mismatch and do not touch the hint ladder. Wrong seeded rows and ARIA snapshots are implementation failures. Commit stays on `task/062-ui-interaction-contract-verifier`.

## Exports Provided

Import from `packages/verifier/src/ui-contract/index.ts` until the package barrel is wired.

- `UiInteractionContractSchema.parse(input)` reads the planner YAML or JSON contract (`contract`, `route`, `as.role`, landmarks `heading | table | navigation | main | form`, actions `button | link | textbox | combobox`, states `empty | loading | error | unauthorized | populated`, `testids`, and per-string `matchMode`). Default `matchMode` is `normalized`. A test id is rejected on a control that already has a unique accessible name.
- `CopyCatalogLinter.lint` / `.inspect` lint planner copy catalogs before dispatch. Rejects duplicate accessible names on one screen unless each entry has `within` or `testid` (`DuplicateControlNameError`), empty labels, generic labels (`Click here`, `Submit`, `Button`, `OK` when unscoped), buttons not named by an action, and names incompatible with the declared role.
- `bindCopyCatalog(contract, catalog)` resolves `copyKey` strings to catalog text and rejects visible contract copy that is not a catalog entry.
- `TextMatchNormalizer` implements `normalized` (whitespace collapse, case-insensitive, curly/straight quotes and apostrophes, separators `·` `-` `–` `—` `|`), `exact` (byte-for-byte), and `contains`. `Couldn't` is not `Could not`.
- `UiInteractionContractVerifier` implements the local `SurfaceVerifierAdapter` (`id: "ui-interaction-contract"`). `verify(request)` opens a new Playwright browser context, authenticates as `contract.as.role`, runs declared interactions, and closes that context. `collect` handles checks whose `surface` is `browser` or `ui`.
- `compileContractChecks`, `assertNoBrittleLocators`, `missingControlMessage` — generated checks are only `getByRole`, `getByLabel`, `getByText`, or `getByTestId`. CSS, XPath, and `#id` selectors throw `BrittleLocatorError`.
- `matchAriaSnapshot`, `toMatchAriaSnapshot`, `parseAriaSnapshot`, `seededRowsFromSnapshot`, `classifySeededRows` — partial order-sensitive ARIA comparison, including `/regex/` names such as `/Order #\d+/`.
- `launchChromium`, `loadPlaywright`, `isMissingChromiumError`, `HumanStepRequired` — a missing Chromium binary throws `HumanStepRequired('install_playwright_chromium')`.
- `redactVerbatim` — worker-facing text does not repeat hidden expected rows.

`UiVerificationResult.attribution` is `pass`, `contract_mismatch`, or `implementation`. Contract mismatches set `disposition: "plain_message"`, `hiddenCheckFailure: false`, and do not call the hint ladder. Example: `No button named 'Print' on /kitchen`. Seeded-row or ARIA mismatches set `attribution: "implementation"`, `disposition: "hint_ladder"`, `hiddenCheckFailure: true`, and call `HintLadderPort.processHiddenFailure` with the sealed expected and observed values. The worker message does not contain those rows. Uncaught `pageerror` and severe `console.error` fail the run even when the target control rendered. Failure artifacts stay `diagnostic`. A pass promotes trace, screenshot, and ARIA tree to `evidence`.

## Shared Wiring Needs (Root / Index Barrels)

`packages/verifier/src/index.ts` is frozen. Re-export this module from the package barrel:

```ts
export {
  BrittleLocatorError,
  ContractSchemaError,
  CopyCatalogLintError,
  CopyCatalogLinter,
  DuplicateControlNameError,
  HumanStepRequired,
  TextMatchNormalizer,
  UiInteractionContractSchema,
  UiInteractionContractVerifier,
  assertNoBrittleLocators,
  bindCopyCatalog,
  classifySeededRows,
  compileContractChecks,
  isMissingChromiumError,
  launchChromium,
  loadPlaywright,
  matchAriaSnapshot,
  missingControlMessage,
  parseAriaSnapshot,
  redactVerbatim,
  seededRowsFromSnapshot,
  toMatchAriaSnapshot,
} from "./ui-contract/index.js";

export type {
  ActionSpec,
  CasBlobStorePort,
  CopyCatalog,
  CopyCatalogEntry,
  CopyLintIssue,
  EnvironmentHandlePort,
  GeneratedCheck,
  HiddenCheckFailure,
  HiddenUiExpectation,
  HintLadderPort,
  LandmarkSpec,
  MatchMode,
  StateSpec,
  StoredArtifact,
  SurfaceCheckResult,
  SurfaceCollectInput,
  SurfaceVerifierAdapter,
  TextSpec,
  UiInteractionContract,
  UiVerificationRequest,
  UiVerificationResult,
} from "./ui-contract/index.js";
```

Register `UiInteractionContractVerifier` with Task 060 `CleanVerifierRunner.registerSurfaceVerifier` for `surface: "browser"`. Do not edit `packages/verifier/src/runner/**` from this branch.

No root `package.json` script changes. No new workspace package.

## Dependency Intents (New Packages Requested)

No new workspace package. `playwright` and `yaml` are already root devDependencies. `packages/verifier/package.json` is frozen, so this module loads both with `requireFromRepository` from the repository root `package.json`.

When package manifests can change, add these to `@ef-harness/verifier` dependencies and switch the requires to normal package imports:

- `playwright` (same version as the root manifest, currently `^1.55.0`)
- `yaml` (same version as the root manifest, currently `^2.8.0`)

Chromium is not bundled. First launch without the browser binary must stay `HumanStepRequired('install_playwright_chromium')` for Task 121, not an opaque stack trace.

## Contract Change Requests

None. No schema, barrel, or package manifest edits on this branch.

## Exact Verification Commands & Results

Run from `C:\Users\Ayush\Desktop\ef-wt\task-062-ui-interaction-contract-verifier`.

- `pnpm --filter @ef-harness/verifier typecheck` — exit 0.
- `pnpm --filter @ef-harness/verifier lint` — exit 0.
- `pnpm --filter @ef-harness/verifier test -- ui-contract` — exit 0. Vitest v5.1.1: 6 files, 32 tests passed (schema YAML, copy-catalog duplicates/generic labels/role mismatch, normalized/exact/contains matrices including `’` vs `'` and `·` vs `-` while rejecting `Couldn't` vs `Could not`, brittle locators, ARIA regex snapshots, live Playwright missing Print as `contract_mismatch` with ladder step unchanged, wrong rows as `implementation` routed to the hint ladder without echoing `Soup · 2`, loading hold and 500 error mock, curly-quote normalization, `pageerror` and `console.error` with a CAS zip trace, hidden `display:none` Print, duplicate Print, keyboard tab order, fresh browser contexts).
- `node scripts/verify-harmony.mjs --task 062` — exit 0. Printed `harmony ok for Task-062` (schema 67/67, diagram check, owned-path scope, repo typecheck, lint, and test).

## Known Limitations / Follow-Ups

Sibling branches are not on this base. This module depends on local ports. Swap them when those tasks integrate. Do not import unpublished sibling packages as if they were already wired.

| Local port | Replace with | Notes |
|---|---|---|
| `EnvironmentHandlePort` | Task 049 `EnvironmentHandle` | `verify` reads `env.vars().APP_URL` and requires the host `env-${env.id}.localhost` so the context cookie stays on that origin. Task 049's host is `env-${shortId}.localhost`. Pass a port whose `id` is the label embedded in `APP_URL`, and put `APP_URL` in `vars()`. Task 060 `ProvisionedEnv` already has `id` and `vars()` and is structurally usable as this port. |
| `SurfaceVerifierAdapter` | Task 060 `SurfaceVerifierAdapter` | `supports` treats `surface: "browser"` (Task 060 `CheckSurface`) and the local alias `"ui"`. `collect` reads `input.env` and `input.checks` (`checkId`, `surface`, `input`). Task 060's collect input has extra fields (`checkoutPath`, `commitSha`, `attemptId`, `replay`, `clock`); they are ignored. Check `input` shape is `{ contract, copyCatalog?, hidden?, focusState?, dataPath?, networkDelayMs?, populatedBody? }`. Observations omit hidden expected rows. `signals` is set only for `contract_mismatch` (`contractMismatch`, `visibleControlMissing`, `plainMessage`) so Task 060 does not burn a ladder step. |
| `CasBlobStorePort` | Task 060 `CasBlobStorePort` / Task 028 `CasBlobStore` | This verifier `put`s the trace zip, PNG screenshot, and ARIA tree as `retention: "diagnostic"`, then `promote(digest, "evidence")` on pass. Task 060's port has `put` with a retention argument and no `promote`. Wrap it: record the digest at `diagnostic`, and on `promote` retag that blob to `evidence` before Task 066 acceptance. Task 028's `putBlob` has no retention field; keep retention beside the hash in the wrapper. |
| `HintLadderPort.processHiddenFailure` | Task 065 `HintLadderController.processHiddenFailure` | Called only for hidden behavior failures. The sealed object is host-only (`checkId`, `route`, `ruleId`, `failureType`, `expected`, `observed`). Task 065 also requires `taskId`, `attemptId`, `model`, `workerLevel`, `briefVersion`, and `ruleText`. Map those from the attempt in the host. Do not copy `expected` into the worker payload. `ruleId` is `null` until the runner supplies one; this branch does not invent a rule id. Contract mismatches never call this port, so `verification_state.ladder_step` stays untouched. |
| `HumanStepRequired` | Task 121 human-step card | Code is exactly `install_playwright_chromium`. The message is `HumanStepRequired('install_playwright_chromium')`. |
| Copy catalog authority | Task 068 kitchen UI and Task 174 UI consistency | Workers render catalog keys. Checks locate the catalog value. This branch does not edit planner or kitchen app files. |
| Post-hoc binder | Task 061 | Screen contracts are contract-bound. This verifier does not call the binder and does not read expected values from candidate code. |

Authentication in this branch sets cookie `ef_role` to `contract.as.role` (or the focused state's `viewAs`) on the `APP_URL` origin. The fixture page reads that cookie. A product session that is not this cookie needs a host auth hook before the kitchen UI tasks run; do not put the seeded orders into that hook.

Loading and error checks intercept `dataPath` (default `/api/orders`). `focusState: "loading"` holds that response until the progressbar assertion finishes, so a 5 ms flash is still observable. `focusState: "error"` fulfills HTTP 500. `focusState: "empty"` fulfills `[]`. Other states do not intercept.

Every `verify` call creates and closes its own `BrowserContext` (no shared cookies or `localStorage`). `launchChromium` adds `--host-resolver-rules=MAP *.localhost 127.0.0.1` so `env-<id>.localhost` reaches the loopback fixture. Tests use one shared browser process and still assert a new context per run.

Keyboard checks Tab from the document start, then activate with Enter and Space for buttons, Enter for links, and fill or select when the action declares a value. A control outside the tab order fails as `implementation` and does not advance the ladder. Playwright `getByRole` ignores `display:none`, so a hidden Print button is `contract_mismatch`. Two visible controls with the same accessible name and no `within` scope are also `contract_mismatch` (`Multiple buttons named 'Print' on /kitchen`).
