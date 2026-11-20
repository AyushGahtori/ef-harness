---
task_id: "Task-053"
branch: "task/053-worker-loop-provider-protocols"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/worker-loop/src/protocols/**"
  - "packages/worker-loop/tests/protocols/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 053 handoff

Own worker loop model protocol adapters and the model profile registry. Commit stays on `task/053-worker-loop-provider-protocols`.

## Exports Provided

Public module: `packages/worker-loop/src/protocols/index.ts`.

Required by Task 057, Tasks 136–138, and Task 140:

- `ModelProtocolAdapter` (type)
- `ModelProfile` (type) with `family`, `contextWindow`, `maxOutputTokens`, `editFormat` (`apply_patch | str_replace | search_replace`), `supportsParallelToolCalls`, `supportsReasoningReplay`, `supportsStreamingToolArgs`, `toolCallReliabilityTier`, `supportsPromptCaching`, `routeConstraints`, plus `supportsToolCalling` and `smallContext`
- `StreamEvent` (type)
- `NormalizedModelError` (class)
- `OpenAIResponsesAdapter`
- `AnthropicMessagesAdapter`
- `OpenAICompatibleChatAdapter`
- `GeminiApiAdapter`

Also exported from the same module:

- `ModelProfileRegistry`, `createDefaultModelProfileRegistry`, `defaultModelProfiles`, `normalizeModelProfile`
- `StreamStallError`, `UnknownOutcomeTimeoutError`, `SiwcConstraintError`, `SiwcHostedToolError`
- `MalformedToolArgsItem`, `TokenUsage`, `ModelTurnRequest`, `AdapterCallOptions`, `EncryptedReasoningProbeResult`
- `classifyProviderFailure`, `parseRateLimitHeaders`, `parseDelayMs`, `assertSiwcCompliantBody`
- `SseByteParser`, `IDLE_TIMEOUT_MS` (`60_000`)
- `opaqueReplayItem`, `reasoningItemHasEncryptedContent`
- `OpenAIResponsesAdapter.probeEncryptedReasoning`

Default roster ids: `gpt-5`, `gpt-5-siwc`, `claude-sonnet`, `openrouter-chat`, `ollama-local-8k`, `lm-studio-local`, `gemini-flash`. `canAssignCodingTask` is false when `supportsToolCalling` is false or `smallContext` is true (`contextWindow <= 32768` forces `smallContext`).

## Shared Wiring Needs (Root / Index Barrels)

Do not edit `packages/worker-loop/src/index.ts` in this task. After integration, re-export the protocol surface from that frozen barrel:

```ts
export {
  AnthropicMessagesAdapter,
  GeminiApiAdapter,
  IDLE_TIMEOUT_MS,
  ModelProfileRegistry,
  NormalizedModelError,
  OpenAICompatibleChatAdapter,
  OpenAIResponsesAdapter,
  SiwcConstraintError,
  SiwcHostedToolError,
  StreamStallError,
  UnknownOutcomeTimeoutError,
  assertSiwcCompliantBody,
  classifyProviderFailure,
  createDefaultModelProfileRegistry,
  parseRateLimitHeaders,
} from "./protocols/index.js";
export type {
  AdapterCallOptions,
  EncryptedReasoningProbeResult,
  MalformedToolArgsItem,
  ModelProfile,
  ModelProtocolAdapter,
  ModelTurnRequest,
  StreamEvent,
  TokenUsage,
} from "./protocols/index.js";
```

No root `package.json`, workspace, tsconfig, eslint, or `packages/shared-contracts/src/index.ts` edits. `packages/worker-loop` already depends on `@ef-harness/shared-contracts`; this task does not import it.

## Dependency Intents (New Packages Requested)

None. Adapters use Node `fetch` and `AbortSignal` only.

Local ports, because Tasks 010 and 011 are not on this base:

- Currency: `packages/worker-loop/src/protocols/currency-port.ts` `usdToMicroUnits(decimal: string): number`. Scale is `1_000_000` micro-USD via digit/`BigInt` parsing. Swap for Task 010 `usdToMicroUnits` when `packages/shared-contracts/src/vocabularies` is on the barrel. Call sites: OpenRouter `x-openrouter-cost` and chat `usage.cost`.
- Redactor: `SecretRedactorPort` in `telemetry-port.ts` (`registerVaultSecret`, `redact`, `redactValue`, `scanForSecrets`). `createLocalSecretRedactor()` is the stand-in for Task 011 `SecretRedactor`. Vault matches require length `>= 8`. Placeholders are `[REDACTED:LABEL]`. Prompt and message strings are redacted. `Authorization`, `x-api-key`, and `x-goog-api-key` are not passed through the redactor. Opaque reasoning items, Anthropic thinking blocks, and Gemini thought parts are exempt so replay stays verbatim.
- Tracer: `LocalTracerPort` (`startSpan`, `endSpan`, `getSpan`) and `createInMemoryTracer()`. Span fields match Task 011: `traceId`, `spanId`, `parentSpanId`, `name`, `startMs`, `endMs`, `status`, `attributes`. Each model call opens a `model.call` span. Swap for Task 011 `LocalTracer` when that module is exported. This port does not write JSONL and does not open a network client.

No unpublished sibling package is imported. Tasks 054–057 are not on this base.

## Contract Change Requests

None. No schema or shared-contract edits.

Integrator notes that are not contract changes:

- `route === "siwc"` forces `store: false`, `stream: true`, and omits `max_output_tokens`, `temperature`, and `previous_response_id`. Hosted tools throw `SiwcHostedToolError` before fetch. `assertSiwcCompliantBody` is the pre-flight backstop.
- Routes with `omitMaxOutputTokens` (SIWC) abort the HTTP stream when counted output tokens exceed `reservedOutputTokens` and stop with `stopReason: "output_budget_cutoff"`. Later SSE frames in the same read are not emitted.
- `rate_limit` and `usage_limit` set `isProviderSchedulingError: true`. `subscription_sharing_usage_limit_exceeded` is `usage_limit`, not a transient 429.
- `StreamStallError` fires when no further stream bytes arrive for `60_000` ms. `UnknownOutcomeTimeoutError` fires when the caller aborts after the request body was handed to `fetch`, and it keeps `clientRequestId` and `idempotencyKey`.
- Malformed tool-argument JSON becomes `MalformedToolArgsItem` and does not throw out of the parser.

## Exact Verification Commands & Results

From `C:\Users\Ayush\Desktop\ef-wt\task-053-worker-loop-provider-protocols`:

- `pnpm --filter @ef-harness/worker-loop typecheck` — pass (`tsc -b --pretty false`, exit 0).
- `pnpm --filter @ef-harness/worker-loop lint` — pass (`eslint .`, exit 0).
- `pnpm --filter @ef-harness/worker-loop test -- protocols` — pass. Vitest v5.1.1, 6 files, 26 tests, exit 0. Covers 1-byte SSE fragmentation, UTF-8 boundaries, SIWC field stripping, hosted-tool rejection, reasoning replay order, encrypted-reasoning probe success and fallback, output-budget cutoff, malformed tool arguments, prompt redaction with auth headers left intact, 401 / 429 / usage-limit classification, the 60s fake-clock stall, unknown-outcome timeout, Anthropic cache breakpoints and token usage, OpenRouter cost headers, Ollama without streaming usage, and Gemini function calls, thought signatures, JSON schema output, and `usageMetadata`.
- `node scripts/verify-harmony.mjs --task 053` — pass (`harmony ok for Task-053`, exit 0).

## Known Limitations / Follow-Ups

- Consumers cannot import the adapters from `@ef-harness/worker-loop` until the barrel lines above are applied. Until then import `packages/worker-loop/src/protocols/index.ts` only inside this package.
- The local redactor covers vault values (raw, URI-encoded, base64, base64url, JSON-escaped) and the built-in token shapes named by Task 011. It is not Task 011's streaming overlap filter or JSONL sink.
- The local tracer records the model-call span in memory only.
- Default output-token estimate is `ceil(characterLength / 4)` until a provider usage field arrives. Cutoff settlement uses the live counted output tokens. Tests inject `countOutputTokens` when they need one character per token.
- Adapters require `baseUrl` and `apiKey` on `AdapterCallOptions`. There is no default production host, so unit tests cannot reach a live provider.
- `OpenAIResponsesAdapter.probeEncryptedReasoning` is optional on `ModelProtocolAdapter`. The other three adapters do not implement it.
- Chat routes `ollama` and `lm_studio` omit `stream_options` and `parallel_tool_calls`. Tools are omitted when `supportsToolCalling` is false.
