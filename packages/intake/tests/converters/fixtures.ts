import { deflateRaw, buildZip } from "../../src/converters/zip-package.js";

export interface PdfImageSpec {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly rgb: Uint8Array;
}

export interface PdfPageSpec {
  readonly content: string;
  readonly images?: readonly PdfImageSpec[];
}

export function buildPdf(pages: readonly PdfPageSpec[], options: { readonly encrypt?: boolean } = {}): Uint8Array {
  let next = 1;
  const catalogId = next++;
  const pagesId = next++;
  const fontId = next++;
  const encryptId = options.encrypt ? next++ : 0;
  const planned = pages.map((page) => {
    const contentId = next++;
    const images = (page.images ?? []).map((image) => ({ image, id: next++ }));
    const pageId = next++;
    return { page, contentId, images, pageId };
  });
  const size = next;
  const bodies = new Map<number, Buffer>();
  bodies.set(catalogId, Buffer.from(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`));
  bodies.set(
    pagesId,
    Buffer.from(
      `<< /Type /Pages /Count ${planned.length} /Kids [${planned.map((page) => `${page.pageId} 0 R`).join(" ")}] >>`,
    ),
  );
  bodies.set(fontId, Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"));
  if (encryptId) {
    bodies.set(
      encryptId,
      Buffer.from(
        `<< /Filter /Standard /V 1 /R 2 /P -64 /O <${"0".repeat(64)}> /U <${"0".repeat(64)}> >>`,
      ),
    );
  }
  for (const page of planned) {
    const stream = Buffer.from(page.page.content, "latin1");
    bodies.set(
      page.contentId,
      Buffer.concat([
        Buffer.from(`<< /Length ${stream.length} >>\nstream\n`),
        stream,
        Buffer.from("endstream"),
      ]),
    );
    for (const image of page.images) {
      const rgb = Buffer.from(image.image.rgb);
      bodies.set(
        image.id,
        Buffer.concat([
          Buffer.from(
            `<< /Type /XObject /Subtype /Image /Width ${image.image.width} /Height ${image.image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${rgb.length} >>\nstream\n`,
          ),
          rgb,
          Buffer.from("\nendstream"),
        ]),
      );
    }
    const xobjects =
      page.images.length > 0
        ? ` /XObject << ${page.images.map((image) => `/${image.image.name} ${image.id} 0 R`).join(" ")} >>`
        : "";
    bodies.set(
      page.pageId,
      Buffer.from(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Contents ${page.contentId} 0 R /Resources << /Font << /F1 ${fontId} 0 R >>${xobjects} >> >>`,
      ),
    );
  }
  const header = Buffer.from("%PDF-1.4\n");
  const chunks: Buffer[] = [header];
  const offsets = new Map<number, number>();
  let cursor = header.length;
  for (let id = 1; id < size; id += 1) {
    const body = bodies.get(id);
    if (!body) throw new Error(`Missing PDF object ${id}`);
    const wrapped = Buffer.concat([Buffer.from(`${id} 0 obj\n`), body, Buffer.from("\nendobj\n")]);
    offsets.set(id, cursor);
    chunks.push(wrapped);
    cursor += wrapped.length;
  }
  let xref = `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let id = 1; id < size; id += 1) {
    xref += `${String(offsets.get(id) ?? 0).padStart(10, "0")} 00000 n \n`;
  }
  const xrefAt = cursor;
  const encrypt = encryptId ? ` /Encrypt ${encryptId} 0 R` : "";
  chunks.push(Buffer.from(`${xref}trailer\n<< /Size ${size} /Root ${catalogId} 0 R${encrypt} >>\nstartxref\n${xrefAt}\n%%EOF\n`));
  return Buffer.concat(chunks);
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOC_RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;

export function buildDocx(documentXml: string, extras: ReadonlyArray<{ name: string; data: Uint8Array }> = []): Uint8Array {
  return buildZip([
    { name: "[Content_Types].xml", data: Buffer.from(CONTENT_TYPES) },
    { name: "_rels/.rels", data: Buffer.from(ROOT_RELS) },
    { name: "word/document.xml", data: Buffer.from(documentXml) },
    { name: "word/_rels/document.xml.rels", data: Buffer.from(DOC_RELS) },
    ...extras.map((extra) => ({ name: extra.name, data: extra.data })),
  ]);
}

export function paragraphXml(text: string, style?: string): string {
  const styleXml = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : "";
  return `<w:p>${styleXml}<w:r><w:t>${escapeXml(text)}</w:t></w:r></w:p>`;
}

export function tableXml(rows: readonly (readonly string[])[]): string {
  const body = rows
    .map(
      (row) =>
        `<w:tr>${row
          .map((cell) => `<w:tc><w:p><w:r><w:t>${escapeXml(cell)}</w:t></w:r></w:p></w:tc>`)
          .join("")}</w:tr>`,
    )
    .join("");
  return `<w:tbl>${body}</w:tbl>`;
}

export function documentXml(inner: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${inner}</w:body>
</w:document>`;
}

export function declaredExpansionZip(uncompressedSize = 4_000_000_000): Uint8Array {
  const compressed = deflateRaw(Buffer.alloc(Math.min(uncompressedSize, 64), 0));
  return buildZip([
    {
      name: "word/document.xml",
      data: compressed,
      method: 8,
      declaredUncompressedSize: uncompressedSize,
    },
  ]);
}

export function streamingExpansionZip(): Uint8Array {
  const compressed = deflateRaw(Buffer.alloc(3 * 1024 * 1024, 0));
  return buildZip([
    {
      name: "word/document.xml",
      data: compressed,
      method: 8,
      declaredUncompressedSize: 1000,
    },
  ]);
}

function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
