---
task_id: "Task-100"
branch: "task/100-bug-har-scrubber-triage"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/intake/src/bug-scrubber/**"
  - "packages/intake/tests/bug-scrubber/**"
  - ".agent-handoffs/task-100.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 100 handoff

HAR and log scrubber, offline source-map stack mapper, and tool-less `issue-triage@1` symptom cards. Commit stays on `task/100-bug-har-scrubber-triage`.

## Exports Provided

Import from `packages/intake/src/bug-scrubber/index.ts` (not the package barrel; that file is frozen):

- `HarAndLogScrubber` — `scrubHar` and `scrubLog`. Auth headers become `[REDACTED:<header>]`. Sensitive keys, JWTs, live payment-key prefixes, GitHub personal-access prefixes, AWS access-key prefixes, PEM blocks, and database URLs are redacted. Postgres URLs keep the scheme, host, port, and database (`postgresql://[REDACTED_CREDENTIALS]@host:port/db`). PII mode (`{ pii: true }`) assigns stable `[EMAIL_n]`, `[PHONE_n]`, and `[IP_n]` tokens inside one capture. Large, image, font, and minified bundle bodies become `{ contentType, byteLength, truncated: true }`. Summaries are capped at 96 KB. Malformed HAR JSON returns `{ ok: false, code: "malformed_har" }` and does not throw. A residual secret returns `{ ok: false, code: "residual_secret" }` with the dirty text omitted.
- `formatRedactionBadge` — non-sensitive counts, for example `Scrubbed 4 auth cookies, 2 JWT tokens, and 1 Postgres URL before saving`.
- `SourceMapStackMapper` — local `source-map` `SourceMapConsumer` only. `http:` and `https:` frames and `sourceMappingURL` comments are ignored. No outbound fetch.
- `ToolLessIssueTriager` — scrubs first, frames external text in `<<<UNTRUSTED_DATA ...>>>` delimiters, calls `issue-triage@1` with `tools: []`, and accepts only a strict symptom card or the local `IssueTriageV1Schema` document. Tool, shell, and command payloads are rejected. Side effects stay an empty list.
- `routeSymptomCard` — complete located cards go to Brownfield Fix Discovery (`route: "brownfield_fix_discovery"`, `task: "169"`). Incomplete cards go to the 6-stage Mystery-Bug Investigation (`route: "mystery_investigation"`, `task: "182"`).
- `SymptomCardStore` — runs `PacketSecurityRedactor` and the independent `SafetyScanner` before `CasBlobStore.putBlob` and before any `symptom_cards` insert. Residual secrets throw `ResidualSecretError` and write nothing.
- `FakeModelAdapter` — scripted tool-less completions for tests. Records the prompt and refuses a non-empty tool list.

Symptom card shape: `{ title, observedBehavior, expectedBehavior, reproductionSteps, affectedUrlsOrRoutes, mappedStackFrames, failingHttpRequests, suspectedDomainTags, missingReproInfo, severity }`.

## Shared Wiring Needs (Root / Index Barrels)

`packages/intake/src/index.ts` is frozen. When integration is allowed, re-export:

```ts
export {
  HarAndLogScrubber,
  SourceMapStackMapper,
  ToolLessIssueTriager,
  SymptomCardStore,
  routeSymptomCard,
  formatRedactionBadge,
  ResidualSecretError,
} from "./bug-scrubber/index.js";
export type {
  SymptomCard,
  ScrubbedHar,
  MappedStackFrame,
  RouteDecision,
  RedactionCounts,
} from "./bug-scrubber/index.js";
```

No root `package.json`, lockfile, tsconfig, eslint, or schema edits.

## Dependency Intents (New Packages Requested)

`source-map` is already a root devDependency (`^0.7.4`) and is loaded with `createRequire` from `@ef-harness/intake` because this task cannot edit `packages/intake/package.json`. When wiring is allowed, add:

```json
"dependencies": {
  "source-map": "^0.7.4"
}
```

No other new package is required. `zod` is not imported; the issue-triage document is validated by the local port below.

## Contract Change Requests

Sibling branches are not on this base (`649773097c387ae534b686ea5825f449f843aa7c`). These local ports live under `packages/intake/src/bug-scrubber/` and should be swapped, not duplicated, once the producers land:

| Port in this task | Replace with | Producer |
| --- | --- | --- |
| `IssueTriageV1Schema` in `issue-triage-schema.ts` | `IssueTriageV1Schema` from `@ef-harness/shared-contracts` | Task 009 |
| `PacketSecurityRedactor` in `packet-security-redactor.ts` | Task 011 redactor (`SecretRedactor` on that branch; this task keeps the name `PacketSecurityRedactor` from the spec) | Task 011 |
| `CasBlobStorePort` / `MemoryCasBlobStore` in `cas-port.ts` | `CasBlobStore.putBlob` / `getBlob` | Task 028 |
| `SafetyScanner` in `safety-scanner.ts` | `GitSafetyScanner` text scan | Task 036 |
| `FakeModelAdapter` in `fake-model.ts` | `FakeModelAdapter` | Task 034 |

`SafetyScanner` is a second pattern set, separate from `PacketSecurityRedactor`, so the pre-storage check is not the same function that performed the replacement. Both must be clean or storage aborts.

Task 097 (external intake converters) is not merged here. This subtree does not import it. No swap is required for the scrubber to run.

## Exact Verification Commands & Results

Run from `C:\Users\Ayush\Desktop\ef-wt\task-100-bug-har-scrubber-triage` on `task/100-bug-har-scrubber-triage`.

- `pnpm --filter @ef-harness/intake test -- bug-scrubber` — passed. 3 files, 15 tests (auth headers, cookies, JWTs, API keys, PEM, Postgres URLs, hidden Unicode, `[EMAIL_1]` / `[EMAIL_2]`, multi-megabyte HAR under 80 KB, malformed HAR, local source maps, ignored remote maps, tool-less symptom cards, hostile tool payload, fail-closed CAS/sqlite).
- `pnpm --filter @ef-harness/intake typecheck` — passed (`tsc -b --pretty false`, exit 0).
- `pnpm --filter @ef-harness/intake lint` — passed (`eslint .`, exit 0).
- `node scripts/verify-harmony.mjs --task 100` — passed (`harmony ok for Task-100`). This also runs repo `pnpm typecheck`, `pnpm lint`, and `pnpm test`.

## Known Limitations / Follow-Ups

- Package barrel re-export and the `source-map` dependency on `@ef-harness/intake` wait for an integration change outside this write scope.
- `MemoryCasBlobStore` hashes and holds bytes in process. It does not apply Task 028 zstd, pins, or garbage collection. `SymptomCardStore` calls the same `putBlob` / `getBlob` shape so the real store can be passed in.
- `IssueTriageV1Schema` here accepts the text locator used by triage output. The full Task 009 locator union (turn, pdf, docx, image, spec) should replace this parser at integration.
- Source maps are read from the caller-supplied build roots only. A map whose generated column was not indexed returns the original minified frame with `resolved: false`.
- PII masking is opt-in (`pii: true`). Emails, phones, and IPv4 addresses stay in the capture until that flag is set. Tokens are stable for one scrubber call, not across separate calls.
