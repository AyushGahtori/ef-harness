# External intake: documents, screenshots, specs, assets and bug reports

Developers bring more than speech: a 30-page PRD, Figma screenshots, a logo and brand font, an existing OpenAPI file, a GitHub issue or a Sentry stack trace. This document defines how each enters the knowledge database with traceable provenance, how conflicts with what the developer said are handled, how real assets reach the code, and how imported text is kept from steering agents. Research: [intake and assets](research/intake-and-assets.md).

## Decisions in plain words

1. **Every input becomes a source record** stored by content hash, labeled untrusted, converted offline in a sandboxed process.
2. **Every extracted fact cites a span inside its source:** page and character range for documents, region for images, JSON pointer for specs. Code verifies text quotes at their span.
3. **Imported documents are the developer's evidence but rank below what they say live.** A contradiction is never resolved silently; it becomes a clarification with both quotes.
4. **Structured inputs are parsed by code, not models.** An OpenAPI file becomes contracts directly.
5. **Brand assets are sanitized, registered with IDs and copied into the project in Phase 0.** Briefs reference asset IDs, and the static audit fails any reference to an image or font that doesn't exist.
6. **Bug reports are scrubbed and summarized by a reader with no tools** into a symptom card the developer confirms. Raw issue text never directs an agent.

## Sources and converters

| Input | Converter (offline, sandboxed) | Output |
|---|---|---|
| PDF | Text extraction with page numbers and character offsets; tables kept as tables | Blocks with locators |
| DOCX | Paragraph extraction with paragraph numbers | Blocks with locators |
| Markdown, HTML, plain text | Structural parse (headings, lists, tables) | Blocks with locators |
| Screenshot or design image | Stored as-is; OCR text with bounding boxes; vision-model description | Image regions with locators |
| OpenAPI / JSON Schema | Parsed and validated by code | Contract and entity proposals |
| CSV / spreadsheet | Parsed by code | Sample data and field hints |
| HAR file | Parsed and scrubbed (below) | Request sequence for investigations |
| Issue or error tracker item | Fetched read-only, scrubbed | Symptom card candidate |
| Logo, image, icon, font | Validated and sanitized (below) | Asset records |

### Locators

Every extracted claim stores one locator plus the quoted text and the source hash:

```json
{ "source": "SRC-07", "source_hash": "sha256:…",
  "locator": {"kind": "pdf", "page": 12, "char_start": 1840, "char_end": 1912},
  "quote": "Orders placed after 10:45 are moved to the next day." }
```

| Kind | Locator fields |
|---|---|
| `turn` | Turn ID, start, end (existing rule) |
| `pdf` | Page, character range (optional bounding box for display) |
| `docx` | Paragraph, character range |
| `text` | Line range, character range |
| `image` | Region `[x, y, w, h]` plus OCR text if any |
| `spec` | JSON pointer (`/paths/~1orders/post/responses/409`) |

Text quotes are checked by code at their locator, the same way speech quotes are ([opening prompts](opening-prompts.md)). Image-derived claims can't be verified as text; they carry a crop of the region and get at most a `derived` basis with *visual* provenance, which means high-impact image claims are shown for confirmation.

## Large documents

1. **Chunk by structure** (sections and headings), not fixed size.
2. **Extract per chunk** with `intake-extractor@1` (no tools; document text as data): candidate decisions, requirements, entities, rules, open questions, each with a locator.
3. **Merge** duplicates across chunks by meaning and criterion ID.
4. **Map onto the catalog** the same way spoken answers are batch-resolved.
5. **Review screen:**

```
From “Lunch ordering PRD v3.pdf” (30 pages)
  48 statements found · 39 match catalog decisions · 6 conflict with what you said · 3 need confirmation
  [Review conflicts]  [Review all]  [Accept matches ⏎]
```

**Precedence when sources disagree**

| Situation | Resolution |
|---|---|
| Document and a later live statement disagree | Clarification card with both quotes; the recommended option is the more recent statement |
| Two documents disagree | Clarification; recommended option is the newer document version |
| Document text addressed to the AI (“ignore earlier instructions…”) | Not a requirement; flagged as suspicious content and ignored |
| Document is outdated (developer says so) | Source marked `superseded`; its claims drop to `historical` |

## OpenAPI and other structured specs

- Each operation becomes a contract proposal: method, path, parameters, request and response schemas, error responses.
- Each schema becomes an entity or value-type proposal.
- Locators are JSON pointers, so a later spec update shows a structured diff and its impact.
- Conflicts with the architecture (an existing contract with a different shape) go through the normal change path.

## Brand assets and real media

| Step | Detail |
|---|---|
| Validate | SVG: parse and remove scripts, event handlers, external references and embedded foreign content. Raster images: decode and re-encode, which strips metadata such as GPS location, with size limits. Fonts: parse; reject malformed files; record the license's embedding permission if present. |
| Register | `assets` table: ID, kind, role (`logo-primary`, `favicon`, `hero`, `font-brand`, `icon`), file hash, dimensions, source, license note |
| Before Phase 0 | Stored in the content-addressed store; shown in the canvas and used for design-token proposals (colors extracted from the logo, font families) |
| Phase 0 | A Junior recipe task copies assets into the project at stable paths (`public/brand/logo.svg`, `src/fonts/…`) and generates an asset module (`src/brand/assets.ts`) mapping IDs to paths |
| Briefs | UI tasks reference assets by ID; the packet includes the resolved import path |
| Static audit | A reference to an image, icon or font path that isn't in the asset module or the public folder fails ([completeness gate](completeness-gate.md#static-audit)) |
| No asset given | The design kit generates a deterministic placeholder (initials or pattern) registered as an asset with role and `placeholder: true`; the landing summary lists every placeholder still in use |

**Design screenshots** (Figma exports, competitor pages) are stored as *reference* assets linked to screens. They inform screen specs and the taste reviewer; they're not pixel-diff targets.

## Bug reports and traces from outside

Issues, error-tracker events and HAR files are written by other people and tools, and are a known prompt-injection path ([sandbox and security](sandbox-and-security.md#threat-model)).

```
fetch (read-only token) ─▶ scrub ─▶ issue-triage@1 (no tools) ─▶ symptom card draft ─▶ developer confirms ─▶ investigation
```

| Scrub step | Removes or replaces |
|---|---|
| Secrets | Tokens, cookies, `Authorization` headers, API keys, query-string secrets (HAR files especially) |
| Personal data | Emails, phone numbers, names in payloads → stable placeholders (`user_1@example.test`) |
| Hidden content | HTML, invisible Unicode, zero-width characters, very long lines |
| Size | Truncated with counts; full scrubbed copy kept as an artifact |

**Symptom card** fields, each with a locator into the scrubbed source: title, observed behavior, expected behavior, steps, environment (browser, OS, app version), frequency, first and last seen, affected users, stack frames mapped to project files (source maps applied locally). The developer edits and confirms the card; only then does an [investigation](investigations-and-sweeps.md#investigations) start. The investigator sees the card, and the raw text only as quoted data.

## Edge cases

| Situation | Behavior |
|---|---|
| Scanned PDF without a text layer | OCR with page regions; claims get image-style provenance and need confirmation if high impact. |
| A 300-page document | Extraction runs in the background with a cost estimate first; the developer can pick sections. |
| Asset license unclear | Allowed; noted in the landing summary as “license not recorded”. |
| An issue references a private log file URL | Not fetched; the developer can attach the file. |
| The same PRD is dropped again with edits | New source version; a diff of extracted statements is shown instead of a full re-review. |

[Project discovery](project-discovery.md) · [UI design system](ui-design-system.md) · [Investigations and sweeps](investigations-and-sweeps.md) · [Research](research/intake-and-assets.md)
