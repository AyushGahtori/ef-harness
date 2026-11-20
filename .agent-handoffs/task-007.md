---
task_id: "Task-007"
branch: "task/007-canonical-hashing-ids"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/shared-contracts/src/canonical/**"
  - "packages/shared-contracts/tests/canonical/**"
  - ".agent-handoffs/task-007.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 007 handoff

Canonical JSON (RFC 8785), Unicode NFC, content and operation hashes, entity IDs, `ef_search_text` splitting, and failure fingerprints. Commit stays on `task/007-canonical-hashing-ids`.

## Exports Provided

Import path after wiring: `@ef-harness/shared-contracts/canonical` (subpath) and the package barrel.

Runtime values:

- `canonicalizeJson(value: unknown): string`
- `normalizeNfc(value: string): string` and `normalizeNfc<T>(value: T): T`
- `computeNodeContentHash(node: NodeContent): string`
- `computeRequestHash(request: unknown): string`
- `computeSearchQueryHash(input: SearchQuery): string`
- `computeResultSetHash(results: readonly SearchResultRef[]): string`
- `computeFailureFingerprint(input: FailureFingerprintInput): string`
- `computeFailureFingerprint(failureClass: string, ruleId: string, filePath: string, detail?: string): string`
- `digestSha256(text: string): string`
- `formatEntityId(prefix: string, sequence: number): string`
- `parseEntityId(id: string): ParsedEntityId`
- `tryParseEntityId(id: string): ParsedEntityId | null`
- `isValidEntityId(id: string): boolean`
- `assertValidEntityId(id: string): void`
- `splitSearchText(value: unknown): string`
- `normalizePosixPath(filePath: string): string`
- `stripVolatileFailureTokens(detail: string): string`
- `CanonicalizationError`, `EntityIdError`
- `CONTENT_HASH_ALGORITHM` = `"sha256"`
- `CONTENT_HASH_PREFIX` = `"sha256:"`
- `ENTITY_ID_SPECS`

Types: `CanonicalizationErrorCode`, `NodeContent`, `SearchQuery`, `SearchResultRef`, `EntityIdSpec`, `ParsedEntityId`, `FailureFingerprintInput`.

Hash text is `sha256:` plus 64 lowercase hex characters over the UTF-8 bytes of canonical JSON. Do not change the prefix or algorithm.

`computeNodeContentHash` hashes NFC `{ kind, title, text, fields }` only. Omitted `fields` becomes `{}`. `fields` must be the parsed JSON value, not a raw JSON string.

`computeSearchQueryHash` hashes `{ query, filters }` only. `computeResultSetHash([])` is a stable non-empty digest, sorted by `id` then `version`, and does not mutate the input array.

`formatEntityId` uses `String(sequence).padStart(minWidth, "0")` with `sequence >= 1`. Prefixes are the `id_counters.prefix` values (hyphen included when the ID has one):

| Prefix | minWidth | Example |
| --- | --- | --- |
| `T` | 2 | `T01` |
| `R` | 2 | `R17` |
| `SI-` | 3 | `SI-212` |
| `EC-` | 3 | `EC-114` |
| `C-` | 3 | `C-014` |
| `AC-` | 2 | `AC-31` |
| `A` | 4 | `A0014` |
| `F` | 2 | `F12` |
| `D-` | 4 | `D-0012` |
| `CS-` | 2 | `CS-88` |
| `EV-` | 5 | `EV-55120` |
| `CCR-` | 2 | `CCR-14` |
| `VR-` | 4 | `VR-7781` |
| `RS-` | 1 | `RS-1` |
| `SRC-` | 2 | `SRC-07` |
| `W` | 1 | `W1` |
| `S-` | 1 | `S-1` |

`splitSearchText` returns `` `${original} ${split}` ``. Acronym boundaries are split (`XMLHttpRequest` → `XML Http Request`) and the verbatim token is kept. Nullish input returns `""`.

## Shared Wiring Needs (Root / Index Barrels)

`packages/shared-contracts/src/index.ts` is frozen by Task 001. Add:

```ts
export {
  CONTENT_HASH_ALGORITHM,
  CONTENT_HASH_PREFIX,
  ENTITY_ID_SPECS,
  CanonicalizationError,
  EntityIdError,
  assertValidEntityId,
  canonicalizeJson,
  computeFailureFingerprint,
  computeNodeContentHash,
  computeRequestHash,
  computeResultSetHash,
  computeSearchQueryHash,
  digestSha256,
  formatEntityId,
  isValidEntityId,
  normalizeNfc,
  normalizePosixPath,
  parseEntityId,
  splitSearchText,
  stripVolatileFailureTokens,
  tryParseEntityId,
} from "./canonical/index.js";
export type {
  CanonicalizationErrorCode,
  EntityIdSpec,
  FailureFingerprintInput,
  NodeContent,
  ParsedEntityId,
  SearchQuery,
  SearchResultRef,
} from "./canonical/index.js";
```

`packages/shared-contracts/package.json` is also frozen. Add an export subpath so `@ef-harness/shared-contracts/canonical` resolves:

```json
"./canonical": {
  "types": "./dist/canonical/index.d.ts",
  "import": "./dist/canonical/index.js"
}
```

The current `ef/layer-boundary` rule treats `@ef-harness/shared-contracts/canonical` as a deep import. Allow that package export subpath when the subpath is wired, or have callers import the barrel until the rule is updated.

## Dependency Intents (New Packages Requested)

None. Runtime code uses only `node:crypto`. Property tests import `fast-check`, already installed at the repository root by Task 001. No lockfile change.

## Contract Change Requests

None.

## Exact Verification Commands & Results

From `C:\Users\Ayush\Desktop\ef harness`:

- `node scripts/agent-worktree.mjs create 007 canonical-hashing-ids` — created `task/007-canonical-hashing-ids` at `C:\Users\Ayush\Desktop\ef-wt\task-007-canonical-hashing-ids`.

From `C:\Users\Ayush\Desktop\ef-wt\task-007-canonical-hashing-ids`:

- `pnpm --filter @ef-harness/shared-contracts test -- canonical` — passed, 7 files, 36 tests (RFC 8785 sample bytes and Appendix B numbers, fast-check properties at 500 runs each).
- `pnpm --filter @ef-harness/shared-contracts typecheck` — passed (`tsc -b --pretty false`).
- `pnpm --filter @ef-harness/shared-contracts lint` — passed (`eslint .`).
- `node scripts/verify-harmony.mjs --task 007` — passed (`harmony ok for Task-007`). That command also re-ran repository `typecheck`, `lint`, and `test`.

## Known Limitations / Follow-Ups

- `canonicalizeJson` throws `CanonicalizationError` for `Date`, `Map`, `Set`, `RegExp`, typed arrays, boxed primitives, accessors, lone surrogates, `NaN`, `Infinity`, raw `BigInt`, and circular references. Callers must pass JSON values. A `BigInt` is accepted only after the caller serializes it (for example the string `"055"`).
- Object properties whose values are `undefined`, functions, or symbols are omitted, matching `JSON.stringify`. Array holes and those same values become `null`.
- Two keys that NFC-normalize to one string throw `nfc_key_collision` instead of dropping one.
- Returned objects from `normalizeNfc` use a null prototype.
- Entity IDs are strict about pad width. `T100` and `A10000` are valid. `T1`, `CS-1`, and `A14` are not. Schema fixtures that insert `CS-1` directly are not the canonical form (`CS-01`).
- `EV-` width is 5 and `VR-` width is 4, taken from the digit length of `EV-55120` and `VR-7781`. Sequence 1 formats as `EV-00001` and `VR-0001`.
- `normalizePosixPath` converts `\` to `/`, strips a leading drive letter, and collapses duplicate slashes. `C:\src\a.ts` and `/src/a.ts` match. A relative `src/a.ts` stays relative.
- `stripVolatileFailureTokens` removes ISO timestamps, `HH:MM:SS`, `line N`, `file.ts:line:col`, `localhost`/`127.0.0.1` ports, and `port NNNN`. It keeps domain times without seconds such as `10:45`. UUID and memory-address stripping is left to the later investigation normalizer.
- `splitSearchText` keeps the schema-test.js shape (`original` plus a split copy) and adds acronym boundaries. Separators are `_`, `-`, `.`, `/`, and `:`.
