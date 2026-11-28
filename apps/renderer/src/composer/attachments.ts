import type { AttachmentChip, AttachmentRoute, DroppedFile } from "./types.js";

const BRAND_NAME = /\b(logo|brand)\b/i;

const INTAKE_EXTENSIONS = new Set([
  "pdf",
  "doc",
  "docx",
  "har",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "md",
  "txt",
  "csv",
  "html",
]);

export function fileExtension(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? name;
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "";
  return base.slice(dot + 1).toLowerCase();
}

export function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) {
    const kb = bytes / 1024;
    const rounded = kb >= 10 ? Math.round(kb) : Math.round(kb * 10) / 10;
    return `${rounded} KB`;
  }
  const mb = bytes / (1024 * 1024);
  const rounded = mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10;
  return `${rounded} MB`;
}

export function typeBadge(name: string, mediaType: string): string {
  const extension = fileExtension(name);
  const known: Record<string, string> = {
    pdf: "PDF",
    doc: "DOCX",
    docx: "DOCX",
    svg: "SVG",
    har: "HAR",
    png: "PNG",
    jpg: "JPEG",
    jpeg: "JPEG",
    webp: "WEBP",
    gif: "GIF",
  };
  const badge = known[extension];
  if (badge) return badge;
  if (mediaType.toLowerCase().startsWith("image/")) return "IMAGE";
  if (extension) return extension.toUpperCase();
  return "FILE";
}

export function routeDroppedFile(file: DroppedFile): AttachmentRoute {
  const extension = fileExtension(file.name);
  const image =
    extension === "svg" ||
    extension === "png" ||
    extension === "jpg" ||
    extension === "jpeg" ||
    extension === "webp" ||
    extension === "gif" ||
    file.mediaType.toLowerCase().startsWith("image/");
  if (extension === "svg" || (image && BRAND_NAME.test(file.name))) return "brand-asset";
  if (INTAKE_EXTENSIONS.has(extension) || file.mediaType.toLowerCase().startsWith("image/")) {
    return "intake";
  }
  return "intake";
}

export function toAttachmentChip(file: DroppedFile, id: string): AttachmentChip {
  return {
    id,
    name: file.name,
    byteSize: file.byteSize,
    sizeLabel: formatByteSize(file.byteSize),
    typeBadge: typeBadge(file.name, file.mediaType),
    route: routeDroppedFile(file),
    mediaType: file.mediaType,
  };
}
