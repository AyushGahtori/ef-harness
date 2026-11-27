# Pass 01 — Chunk 003: Named-Pipe IPC, Event/Artifact Streaming, and M0 Simulation (`Tasks 031–034`)

## 1. Chunk identification and scope
- **Pass number:** Pass 01
- **Chunk ID:** `pass-01/chunk-003`
- **Unit IDs:** `Tasks 031–033` (`packages/ipc`), `Task 034` (`packages/sim`)
- **Branches and commits:**
  - `task/031-named-pipe-ipc-transport` (`e23f4fe`)
  - `task/032-ipc-event-stream-resync` (`2117d11`)
  - `task/033-binary-artifact-streaming` (`6dfa32b`)
  - `task/034-m0-deterministic-sim-exit-gate` (`15c4663`)
- **Worktree paths:** `C:/Users/Ayush/Desktop/ef-wt/integration/packages/ipc`, `C:/Users/Ayush/Desktop/ef-wt/integration/packages/sim`
- **Governing architecture documents:** `kernel-schema-and-protocol.md`, `database-design.md`, `roadmap.md` (M0 exit gate), `IMPLEMENTATION_TASKS.md` (`Tasks 031–034`).

## 2. Units inspected
- `Task 031` (`e23f4fe`), `Task 032` (`2117d11`), `Task 033` (`6dfa32b`), `Task 034` (`15c4663`).

## 3. Files inspected
- `packages/ipc/package.json`, `packages/ipc/src/index.ts`
- `packages/ipc/src/transport/{constants.ts,frame-codec.ts,message-port-bridge.ts,named-pipe-client.ts,named-pipe-server.ts}`
- `packages/ipc/src/protocol/{dispatcher.ts,event-stream.ts,ports.ts,resync.ts,schemas.ts}`
- `packages/ipc/src/streams/{artifact-stream-client.ts,artifact-stream-server.ts,credit-flow.ts,seekable-zstd.ts}`
- `packages/sim/package.json`, `packages/sim/src/index.ts`, `packages/sim/src/m0/{cas-store.ts,harness.ts,ipc-sim.ts,outbox-sim.ts,runner.ts}`

## 4. Architecture documents consulted
- `kernel-schema-and-protocol.md` (5-byte binary frame header `[channel:u8, length:u32be]`, credit-based artifact backpressure `stream.credit`, `events.subscribe` / `snapshot.get` cursor resync, `op_id` idempotency)
- `roadmap.md` (M0 deterministic simulation exit gate invariants)

## 5. Contracts and signatures discovered
- `FrameCodec` (`031`: instance `encode(channel, payload)` / `push(chunk)`, max frame cap)
- `NamedPipeServer`, `NamedPipeClient`, `MessagePortBridge` (`031`)
- `RpcDispatcher`, `EventStreamBroadcaster`, `SnapshotResyncService`, `StateSnapshotPort`, `WriteQueuePort`, `OutboxPort` (`032`)
- `ArtifactStreamServer`, `ArtifactStreamClient` (`033`: expects `FrameCodecPort` and `stream.credit` routing)
- `runM0DeterministicSim` (`034`)

## 6. Confirmed findings
- **F-006** — `packages/ipc/src/protocol/schemas.ts` conflicts with `packages/shared-contracts/src/packets/rpc.ts` on `op_id` nesting, `project` vs `project_id`, `questionId` vs `question_id`, `stream_epoch` type (`string` vs `number`), and `artifact.open` requiring `op_id`.
- **F-013** — `packages/ipc` (`032–033`) has zero dependency on `@ef-harness/db` and defines async `StateSnapshotPort.getFeatureProgress()` (0-arg), async `WriteQueuePort.execute`, and stateful `OutboxPort` that do not match synchronous `BoardReadModelRepo.getFeatureProgress(featureId)`, `CoordinatorWriteQueue.enqueue`, and stateless `OutboxRepo` in `packages/db`.
- **F-014** — Intra-`packages/ipc` seam between `031` (`FrameCodec` instance methods) and `033` (`ArtifactStreamServer` expecting static/divergent `FrameCodecPort.encodeFrame`).
- **F-015** — `stream.credit` routing & schema mismatch between `032` (`RpcDispatcher` / `schemas.ts`: `{ stream_id, credits }`) and `033` (`ArtifactStreamServer` / `ArtifactStreamClient`: `{ streamId, chunks }`).
- **F-016** — `packages/sim` (`034`) implements private in-memory mocks (`m0/cas-store.ts`, `ipc-sim.ts`, `outbox-sim.ts`) with zero imports from `@ef-harness/db` or `@ef-harness/ipc`, failing to verify the real M0 kernel!

## 7. Unverified findings
- None (`0` unverified).

## 8. Producer-consumer relationships
- `packages/db` (`012–030`) → `packages/ipc` (`031–033`) → `apps/daemon` & `apps/desktop` (`067, 123, 131–133`) & `packages/sim` (`034`).

## 9. Defects and missing integrations
- `packages/ipc` needs `@ef-harness/db` adapter wiring, unified `rpc.ts` validation (`F-006`), unified `FrameCodec` (`F-014`), and unified `stream.credit` dispatch (`F-015`).
- `packages/sim` must run its seeded fault-injection scenarios against real `@ef-harness/db` + `@ef-harness/ipc` (`F-016`).

## 10. Tests and verification performed
- Cross-checked `packages/ipc/src/protocol/schemas.ts`, `packages/ipc/src/streams/*`, and `packages/shared-contracts/src/packets/rpc.ts` line-by-line.

## 11. Unresolved questions
- None in this chunk.

## 12. Explicit files and relationships still requiring inspection
- `apps/daemon` and `apps/desktop` IPC usage (`067` in `pass-02`, `122–133` in `pass-05`), plus `packages/meta-lab` fault sim (`192` in `pass-06`).
