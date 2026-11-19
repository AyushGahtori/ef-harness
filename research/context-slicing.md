# Research: how much context to give an agent, and in what order

Question: should workers receive large specifications or compiled slices, and how should slices be ordered and extended? Design: [knowledge slicing](../knowledge-slicing.md).

## More context isn't free

- **Context rot:** across 18 models (including GPT-4.1, Claude 4, Gemini 2.5 and Qwen3), performance consistently degraded as input length grew, even on simple retrieval and text-replication tasks, and distractors hurt more at longer lengths. [Chroma context rot report](https://www.trychroma.com/research/context-rot)
- **Lost in the middle:** models use information at the beginning and end of their input best; accuracy can drop by more than 20 points when the relevant fact sits in the middle (Liu et al., TACL 2024). [Paper](https://direct.mit.edu/tacl/article/doi/10.1162/tacl_a_00638/119630/Lost-in-the-Middle-How-Language-Models-Use-Long)

**Consequence:** compiled packets with the critical items at the start and a checklist at the end, rather than whole documents.

## Selecting what goes in

- **Program slicing** keeps only the statements that affect a variable at a point (Weiser, 1981); the packet compiler applies the same idea to a requirements graph: only nodes reachable through typed edges from the task.
- **Retrieval on demand:** full-text search (SQLite FTS5 with BM25 ranking) is sufficient for structured, ID-rich knowledge; embeddings are optional. [SQLite FTS5](https://www.sqlite.org/fts5.html)
- **Context engineering guidance** from model providers recommends the smallest high-signal set of tokens, just-in-time retrieval through tools and structured notes over raw transcripts. [Anthropic: effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)

## Tracking what was read

Recording each read with its version is how optimistic concurrency control detects stale inputs (read-set validation in databases). The coordinator already validates read sets for publication ([linked revisions](../linked-architecture-revisions.md)); extending it to pulled knowledge makes agent reads auditable too.

## To measure

- Pass rate of Junior and Mid workers with compiled packets versus whole feature documents on the same tasks.
- Pull calls per task and how often a pulled item should have been pushed.
