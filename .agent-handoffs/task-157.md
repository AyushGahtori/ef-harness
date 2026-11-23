---
task_id: "Task-157"
branch: "task/157-local-whisper-dictation-engine"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/dictation/src/stt/**"
  - "packages/dictation/tests/stt/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 157 handoff

Local whisper.cpp dictation with an OS fallback, an editable unsubmitted composer draft, LocalAgreement-2 grey/black tokens, a 3s pause hint, a 60s mic-off, amber low-confidence spans, and reversible retraction strike-through. This branch was created from `649773097c387ae534b686ea5825f449f843aa7c` (tag `foundation/task-001-complete`). Sibling task branches are not merged here.

## Exports Provided

Wire these from `packages/dictation/src/stt/index.ts`:

- `LocalWhisperSttEngine` — on-device whisper.cpp session. PCM stays in RAM, the child is supervised by a job, and GPU priority is held only while local Whisper is the active engine. `start`, `stop`, `toggle`, `pushToTalkDown`, `pushToTalkUp`, `handleKey`, `pushPcm`, `applyKeyboardEdit`, `submitFromUser`, `reconcilePressure`, and `snapshot`.
- `OsFallbackDictationBridge` — Windows / Web Speech path. Badge text is exactly `Using Windows Dictation · Download local Whisper for offline accuracy`. Download offer is exactly `Download local Whisper (offline, higher accuracy)`.
- `DictationStabilityStream` — LocalAgreement-2. The first hypothesis is tentative (grey). A token becomes confirmed (black) only when the same text occupies the same index in two consecutive frames. Confirmed tokens are monotonic.
- `LowConfidenceCriticalSpanHighlighter` — amber underline plus tooltip `Verify or edit` when probability is strictly below `0.72` and the token is a number, price, quantity, time, date, negation, quantifier, or domain identifier that is not already in vocabulary. Filler words are never underlined. Negative inputs are treated as natural-log probabilities.
- `EditableDictationDraftController` — writes `confirmed` (primary ink) and `tentative` (muted ink) into the composer. `autoSend` stays `false`. `submitFromUser` is the only submit path. Silence at 3s sets `Paused listening… press Enter to send or keep talking` and leaves the mic on. Silence at 60s sets `Mic turned off after 60s silence — draft kept safely`, stops the mic, and notifies the engine to release GPU priority. The draft text is kept.

`selectWhisperModel` picks `medium` at `>= 4096 MB` VRAM, `small.en` at `>= 2048 MB` VRAM or `>= 16384 MB` RAM, otherwise `base.en`. Red pressure does not select a model; the engine uses the OS bridge instead.

`buildWhisperCppArgs` always passes `-f -` (stdin PCM) and, when a prompt is set, `--carry-initial-prompt`. It never adds a `.wav` path or an `http` URL. `setCarryInitialPrompt` updates the prompt used on the next `start` and on every `decode` call.

Spoken cues `actually scratch that`, `actually, scratch that`, `never mind that part`, and `no wait` add a non-destructive `strike-through` preview on the preceding clause. The preview's `reconciler` is `{ task: "Task-071", kind: "cross_chunk_retraction", applyOn: "after_send" }`. A keyboard edit that overlaps the preview suppresses it. `setRetractionPreviewEnabled(false)` hides previews without deleting text.

Microphone permission, unplug, and missing-device failures all surface `Microphone disconnected — check Windows mic settings`, keep confirmed text, turn the mic off, and release GPU priority. `audioLevel` is a 0..1 RMS ring. The default hotkey is `Ctrl+Space` push-to-talk. Click uses toggle. Both the combo and `toggle | push_to_talk` are configurable.

## Shared Wiring Needs (Root / Index Barrels)

`packages/dictation/src/index.ts` is outside this task's owned scope and is intentionally untouched. Add this re-export when the integrator lands the branch:

```ts
export {
  DictationStabilityStream,
  EditableDictationDraftController,
  LocalWhisperSttEngine,
  LowConfidenceCriticalSpanHighlighter,
  OsFallbackDictationBridge,
  buildWhisperCppArgs,
  selectWhisperModel,
} from "./stt/index.js";
export type {
  DictationEngineMode,
  DraftEngineSnapshot,
  DraftSnapshot,
  FallbackReason,
  HighlightSpan,
  HypothesisToken,
  KeyboardEdit,
  RetractionPreview,
  StabilityFrame,
  StableToken,
  WhisperModelId,
} from "./stt/index.js";
```

No root `package.json`, workspace, or tsconfig change. No new dependency.

## Dependency Intents (New Packages Requested)

None. The engine uses the existing `@ef-harness/dictation` toolchain and Node built-ins only.

## Contract Change Requests

Sibling packages are not on this base. Dictation talks to them through local ports in `packages/dictation/src/stt/ports.ts`. Replace the adapters; do not keep the local copies once the real barrels exist.

| Needed sibling | This branch | Swap |
| --- | --- | --- |
| Task 041 `WindowsJobSupervisor` (foundation job objects are Task 040 `WindowsJobManager`) | `WindowsJobSupervisorPort.superviseWhisper` / `close` / `activeChildCount` | Spawn `whisper-cli` with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`. `close` terminates the child. Dictation never writes a wav path into the argv. |
| Task 118 `GpuWhisperPriorityArbiter` | `GpuWhisperPriorityArbiterPort.acquireInteractive` / `release` | Acquire when local Whisper starts. Release on user stop, 60s silence, mic fault, spawn failure, and Red pressure. OS fallback does not acquire the lease. |
| Task 118 calibration / pressure | `MachineCalibrationPort.snapshot` and `selectWhisperModel` | Read `totalRamMb`, `gpuVramMb`, and `Green \| Yellow \| Orange \| Red`. Red at start, or `reconcilePressure()` while Whisper is running, drops the child and continues on the OS bridge with the draft intact. |
| Task 132 `SignedComponentDownloader` + AV quarantine | `SignedComponentDownloaderPort.resolveWhisperComponent(modelId)` | Return `{ available: true, binaryPath, modelPath }` for the requested `base.en` / `small.en` / `medium` file, or `{ available: false, reason: "not_downloaded" \| "quarantined" \| "hash_mismatch" }`. Any blocked reason uses the OS bridge and the download offer. |
| Task 155 `SingleComposerView` | `SingleComposerViewPort.applyDictationDraft` / `submitExplicit` | Render `confirmed` in primary ink and `tentative` in muted ink. Show `hint` and `status` inline. Call `submitExplicit` only from Enter / Send. Dictation never calls it on a timer. |
| Task 158 vocabulary | `VocabularyLookup.contains` and `setCarryInitialPrompt` | Known domain names are not amber-underlined. The 224-token prompt is passed through `--carry-initial-prompt` unchanged. This branch does not build or store vocabulary. |
| Task 071 retraction reconciler | `RetractionPreview.reconciler` | The strike-through is a preview only. Authoritative retraction still happens after Send. |

## Exact Verification Commands & Results

Run from `C:\Users\Ayush\Desktop\ef-wt\task-157-local-whisper-dictation-engine`.

- `pnpm --filter @ef-harness/dictation typecheck` — pass (`tsc -b`).
- `pnpm --filter @ef-harness/dictation lint` — pass (`eslint .`).
- `pnpm --filter @ef-harness/dictation test -- stt` — pass, 4 files, 19 tests. Covers LocalAgreement-2 grey-to-black streaming, keyboard-edit preservation, zero auto-send, the 3s hint with the mic still on, the 8s continuation into the same draft, the 60s mic-off with GPU release and the draft kept, amber number/time/negation/price/quantity/date/quantifier/domain highlighting, retraction strike-through, OS fallback, Red release, mic disconnect, and zero wav/network audio.
- `node scripts/verify-harmony.mjs --task 157` — pass (`harmony ok for Task-157`).

## Known Limitations / Follow-Ups

- The in-memory `WindowsJobSupervisorPort`, `GpuWhisperPriorityArbiterPort`, `SignedComponentDownloaderPort`, `MachineCalibrationPort`, `SingleComposerViewPort`, and `OsSpeechRecognizerPort` are local stand-ins. Swap them for the real Task 041 / 118 / 132 / 155 barrels. Do not keep both.
- `WhisperDecoderPort` is the hypothesis source. The supervised child is still spawned with the whisper.cpp argv, and PCM is written to its stdin in RAM. The integrator should parse that child's stdout instead of the scripted decoder. Tests never launch a real `whisper-cli.exe`.
- Model bytes come from `resolveWhisperComponent(modelId)`. This branch records the calibration choice and uses the path the port returns. It does not download GGUF files.
- `packages/dictation/src/index.ts` is intentionally untouched. The barrel block above is the integrator's wiring step.
- Red and a missing binary both keep the mic alive on the OS bridge. They do not auto-send and they do not hold the GPU lease.
- Yellow and Orange still run local Whisper. Only Red refuses it.
- Retraction previews do not delete text. Task 071 still owns cross-chunk reconciliation after Send.
