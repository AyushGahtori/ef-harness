---
task_id: "Task-094"
branch: "task/094-ui-design-system-pipeline"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/planner/src/design-system/**"
  - "packages/planner/tests/design-system/**"
  - ".agent-handoffs/task-094.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 094 handoff

Phase 0 UI design-system pipeline: look-and-feel interview, W3C tokens, a deterministic Style Dictionary transform, shadcn-style primitives and layout shells, a dev-only `/__styleguide`, and token lint rules. Commit stays on `task/094-ui-design-system-pipeline`.

## Exports Provided

Import from `packages/planner/src/design-system/index.ts` until the planner barrel is wired:

- `LookAndFeelInterviewFlow` asks four visual choices (mood with a locked system typography pairing, brand color or a Task 099 asset, density `comfortable` | `balanced` | `compact`, theme `light` | `dark` | `both`). `acceptAll()` uses the recommended clean-neutral, slate-plus-indigo, balanced, both-themes direction. No gradients.
- `W3cDesignTokenGenerator` writes one W3C DTCG document (`$type` / `$value`) and compiles it to `design/tokens.json`, `src/styles/tokens.css`, `src/styles/tailwind.theme.ts`, and `src/styles/tokens.ts`. Semantic pairs in light and dark are checked at `>= 4.5` for text and `>= 3` for UI chrome before emission.
- `DesignSystemScaffoldBuilder` and `runPhase0DesignSystem` materialize the kit under `src/components/ui/**` and the shells `AppShell`, `ListPage`, `DetailPage`, `FormPage`, `AuthPage`, and `PrintLayout` when the project or a screen spec is tagged `print`.
- `StyleguideRouteVerifier` checks the dev guard, production exclusion, static axe-style failures, 375px clipping, remote fonts, and stores PNG screenshots at 375, 768, and 1440 through the CAS port.
- `DesignTokenLintRuleset` flags raw hex, `rgb()` / `hsl()`, arbitrary Tailwind colors, off-scale spacing and type, `bg-white` / `text-black`, and raw `<button>`, `<input>`, and `<dialog>` outside `src/components/ui/**`. The button hint is `Use <Button variant='primary'> from @/components/ui/button`. `emit()` writes ready-to-wire ESLint and Stylelint modules.

`LockedTokenOwnership` denies feature-worker writes to `design/tokens.json` and `src/components/ui/**` and returns a Task 112 additive P0 request. `bindScreenSpec` checks layout template ids and shared primitives.

## Shared Wiring Needs (Root / Index Barrels)

Do not edit `packages/planner/src/index.ts` in this task. When integration is allowed to touch the barrel, re-export these from `@ef-harness/planner`:

- `LookAndFeelInterviewFlow`
- `W3cDesignTokenGenerator`
- `DesignSystemScaffoldBuilder`
- `StyleguideRouteVerifier`
- `DesignTokenLintRuleset`
- `runPhase0DesignSystem`
- `LockedTokenOwnership`
- `bindScreenSpec`

Wire `runPhase0DesignSystem` as the Phase 0 `P0.4` slot (`PHASE0_P04_SLOT`). Gate 0 should read `verification.screenshotCasIds`, `verification.ok`, `contrastOk`, and `skipped`.

No root `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `tsconfig*.json`, or `eslint.config.mjs` edits. The scaffolder never writes a target `package.json`.

Generated rule modules land in the target app at `eslint/ef-token-rules.mjs` and `stylelint/ef-token-rules.mjs`. Register `eslintRules` from the ESLint module and `lintCss` from the Stylelint module when that app's lint config can be edited. `src/styles/tokens.css`, `src/styles/tokens.ts`, and `design/tokens.json` are the hex allowlist. `src/components/ui/**` may use native `<button>`, `<input>`, and `<dialog>`.

## Dependency Intents (New Packages Requested)

None installed. `package.json` stays frozen.

- `style-dictionary` — optional swap for `W3cDesignTokenGenerator.compile`. The local transform (`STYLE_DICTIONARY_SOURCE` = `local-port:style-dictionary`) already emits CSS custom properties, a Tailwind `theme.extend` object, and TypeScript constants from the DTCG document. Keep that compiler if the package is not added; it is deterministic and has no network or timestamp output.
- Target-app intents, not harness dependencies, and only for a web project: `react`, `tailwindcss`, and the Radix packages shadcn primitives wrap (`@radix-ui/react-slot`, `@radix-ui/react-dialog`). Generated components import `react` and use native accessible elements with the shadcn variant and state API until those packages are installed through Task 048. A CLI, API, or headless project gets zero UI dependencies and zero files.

## Contract Change Requests

None. No `schema/` edit. Screen specs stay on the Task 084 `screen_spec` shape. Token files and `src/components/ui/**` are a read-only ownership record in `design/ownership.json`, not a new SQL table.

## Exact Verification Commands & Results

Run from `C:\Users\Ayush\Desktop\ef-wt\task-094-ui-design-system-pipeline`:

- `pnpm --filter @ef-harness/planner test -- design-system` — 19 passed (four-choice interview and accept-all, comfortable/compact density, brand-asset suggestion vs apply, yellow `#FACC15` pairing `#0F172A` / `#854D0E`, orange `#FF7A45` pairing `#0F172A` / `#B23C0C`, light and dark contrast floors, dark 1px border and separate elevation, lint of `#7C3AED` / arbitrary Tailwind / `bg-white` / raw `<button>` vs a compliant `Button`, emitted ESLint and Stylelint modules, greenfield kit plus print layout, production bundle strip, CLI/API/headless skip with an unchanged `package.json`, brownfield adopt without overwriting CSS or primitives, locked ownership and Task 112 CCR, screen-spec rejection, clipping, remote font, and injected axe failure).
- `pnpm --filter @ef-harness/planner typecheck` — exit 0.
- `pnpm --filter @ef-harness/planner lint` — exit 0.
- `node scripts/verify-harmony.mjs --task 094` — `harmony ok for Task-094` (exit 0). The commit gate runs it again with `--require-ready`.

## Known Limitations / Follow-Ups

Sibling branches are not merged. These local ports should be swapped at integration:

- **Task 057.** `OfflineUiPlaywrightContractVerifier.source` is `local-port:task-057`. `StyleguideRouteVerifier` calls `audit()` for console errors, page errors, axe violations, clipping, and PNG bytes at 375, 768, and 1440. The task list's browser UI verifier is Task 062 `UiInteractionContractVerifier` (`LOCAL_PORTS.uiInteractionContractVerifier` = `local-port:task-062`). Point `audit()` at that export when the verifier barrel exists. Do not deep-import `packages/verifier/src/**`.
- **Task 084.** `SCREEN_SPEC_SOURCE` is `local-port:task-084`. `bindScreenSpec` accepts template ids `app-shell`, `page-header`, `list-detail`, `form-page`, `empty-state`, `error-state`, plus `detail-page`, `auth-page`, and `print-layout`. Shared primitives are the Task 084 kit plus `ListPage`, `DetailPage`, `FormPage`, `AuthPage`, and `PrintLayout`. Raw `style`, `className`, `color`, `css`, `sx`, and `pixels` on a screen component are rejected. Replace `bindScreenSpec` with `ScreenSpecGenerator.validate` when that barrel is wired.
- **Task 093.** `PHASE0_P04_SLOT.source` is `local-port:task-093`. `runPhase0DesignSystem` is the P0.4 hook. It returns `skipped: true` and writes nothing for `cli`, `api`, and `headless`.
- **Task 028.** `MemoryCasBlobStore.source` is `local-port:task-028`. `put(bytes, mediaType)` returns `{ sha256, mediaType }` and keeps the bytes in a map. Swap it for `CasBlobStore`.
- **Task 099.** Brand assets use roles `logo_light`, `logo_dark`, `favicon`, `hero`, `avatar_fallback`, and `font`. Dominant colors are suggestions until `useBrandAssetColors` is set. Font assets do not replace the system stack. `LOCAL_PORTS.brandAssetRegistry` is `local-port:task-099`.
- **Task 092 and Task 112.** `LockedTokenOwnership.source` is `local-port:task-092`. A feature-worker write to `design/tokens.json` or `src/components/ui/**` returns `ccr.task = "Task-112"`, `ccr.slot = "P0"`. `phase0` and `ccr` actors may write. Swap the actor check for the Task 092 worker lock when that API exists.
- **Style Dictionary.** Compilation does not import the `style-dictionary` package. The local transform is deterministic (same decision, same bytes) and is the stand-in until integration adds the package.
- **Contrast example ratios.** The task text cites white-on-`#FACC15` at `1.5:1` (measured `1.53:1`), `#0F172A` on `#FACC15` at `12.6:1` (WCAG 2.x relative luminance is `11.66:1`), and `#854D0E` at `5.8:1` (measured `6.85:1` on white and `6.55:1` on `#F8FAFC`). The implementation emits the specified hex pairings and reports the standard formula. Both pairings clear `4.5:1`. Dark mode uses the bright brand as the small-text color when that color already clears the dark surfaces, and a separate `1px` border token rather than the light-mode shadow.
- **Screenshots and axe.** PNGs are deterministic solid-color images at the real viewport width and height, not a live Chromium capture. The default axe pass is static (accessible names, labels, alt, focus-visible, tap target). Inject a Playwright port to fail on real console, page, or axe results.
- **Brownfield.** An existing Tailwind config, CSS variables, `src/components/ui`, MUI, or Chakra locks that kit. Existing CSS and primitive files are not overwritten, and a second `src/components/ui` kit is not added. Lint hints point at MUI or Chakra when that kit is detected.
- **Production guard.** `/__styleguide` is wrapped in `import.meta.env.DEV && process.env.NODE_ENV !== 'production'`. `productionBundle()` drops the route file. A bundle that still contains `data-ef-styleguide` or `/__styleguide` fails verification.
