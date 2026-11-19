# Research: importing documents, screenshots, assets and bug reports safely

Question: how can documents and media be converted with precise provenance, and how are assets and third-party reports sanitized before reaching agents? Design: [external intake](../external-intake.md).

## Converting documents with positions

| Format | Tool | Position information |
|---|---|---|
| PDF | [pdf.js](https://mozilla.github.io/pdf.js/) | Text items per page with coordinates |
| DOCX | [mammoth](https://github.com/mwilliamson/mammoth.js) | Paragraph structure |
| Images | [Tesseract](https://github.com/tesseract-ocr/tesseract) OCR | Word bounding boxes |
| OpenAPI | Any OpenAPI parser; JSON Pointer for locations | [JSON Pointer (RFC 6901)](https://www.rfc-editor.org/rfc/rfc6901) |
| HAR | [HAR 1.2 format](http://www.softwareishard.com/blog/har-12-spec/) | Entry index |

## Sanitizing assets

- SVG can carry scripts and event handlers; sanitizers such as DOMPurify have an SVG profile that removes them. [DOMPurify](https://github.com/cure53/DOMPurify)
- Re-encoding raster images (e.g. with sharp, which drops metadata unless asked to keep it) removes EXIF data such as GPS coordinates. [sharp](https://sharp.pixelplumbing.com/)
- Fonts can be parsed and validated (and their embedding permissions read) with libraries such as fontkit. [fontkit](https://github.com/foliojs/fontkit)

## Third-party text is an injection path

Issues and web content are standard prompt-injection carriers; OWASP recommends treating external content as untrusted and separating it from instructions. [OWASP LLM Top 10](https://genai.owasp.org/llm-top-10/) Credential leaks through logs and tool output are common in agent tooling ([skills research](evaluating-prompts-and-skills.md)), which is why HAR files are scrubbed of headers and cookies before any model sees them.

## To measure

- Statement extraction precision and recall on a labeled PRD set.
- Rate of conflicts between imported documents and live statements in real sessions.
