# Vendored Mermaid parser

`mermaid-parse.mjs` is an esbuild bundle of the official `mermaid` 12.3.0 parser (MIT).
It is loaded in-process by `parseMermaidDiagram`. A small DOMPurify shim is aliased in
the bundle so Node can run `mermaid.parse` without a browser `window`. The grammar,
including flowchart, sequence, and state diagrams, is the real Mermaid parser.

Replace this file with a direct `mermaid` dependency of `@ef-harness/planner` when
package manifests can be edited. See `.agent-handoffs/task-083.md`.
