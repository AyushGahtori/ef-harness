import { UnsupportedOrMismatchedFileType } from "./errors.js";

export type BinaryKind = "pdf" | "zip" | "png" | "jpeg" | "webp" | "exe" | "text" | "unknown";

export type DispatchKind = "pdf" | "docx" | "png" | "jpeg" | "webp" | "csv" | "tsv" | "html" | "markdown";

const REJECTED_EXTENSIONS = new Set(["exe", "dll", "bat", "cmd", "com", "scr", "ps1", "msi"]);

export function extensionOf(fileName: string): string {
  const base = fileName.split(/[/\\]/).pop() ?? fileName;
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "";
  return base.slice(dot + 1).toLowerCase();
}

export function detectMagic(bytes: Uint8Array): BinaryKind {
  if (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d) {
    return "pdf";
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    ((bytes[2] === 0x03 && bytes[3] === 0x04) ||
      (bytes[2] === 0x05 && bytes[3] === 0x06) ||
      (bytes[2] === 0x07 && bytes[3] === 0x08))
  ) {
    return "zip";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "webp";
  }
  if (bytes.length >= 2 && bytes[0] === 0x4d && bytes[1] === 0x5a) return "exe";
  const sample = bytes.subarray(0, Math.min(bytes.length, 8192));
  for (const byte of sample) {
    if (byte === 0) return "unknown";
  }
  return "text";
}

function expectedMagic(extension: string): BinaryKind | "csv" | "tsv" | "html" | "markdown" | null {
  switch (extension) {
    case "pdf":
      return "pdf";
    case "docx":
      return "zip";
    case "png":
      return "png";
    case "jpg":
    case "jpeg":
      return "jpeg";
    case "webp":
      return "webp";
    case "csv":
      return "csv";
    case "tsv":
      return "tsv";
    case "html":
    case "htm":
      return "html";
    case "md":
    case "markdown":
    case "txt":
      return "markdown";
    default:
      return null;
  }
}

export function dispatchFile(bytes: Uint8Array, fileName: string): DispatchKind {
  const extension = extensionOf(fileName);
  const magic = detectMagic(bytes);
  if (REJECTED_EXTENSIONS.has(extension) || magic === "exe") {
    throw new UnsupportedOrMismatchedFileType(
      `Rejected ${fileName}: magic bytes do not match a supported intake format.`,
    );
  }
  const expected = expectedMagic(extension);
  if (expected === "pdf" && magic !== "pdf") {
    throw new UnsupportedOrMismatchedFileType(
      `Rejected ${fileName}: file extension claims PDF but magic bytes are not %PDF-.`,
    );
  }
  if (expected === "zip" && magic !== "zip") {
    throw new UnsupportedOrMismatchedFileType(
      `Rejected ${fileName}: file extension claims DOCX but magic bytes are not a ZIP archive.`,
    );
  }
  if ((expected === "png" || expected === "jpeg" || expected === "webp") && magic !== expected) {
    throw new UnsupportedOrMismatchedFileType(
      `Rejected ${fileName}: image extension does not match magic bytes.`,
    );
  }
  if ((expected === "csv" || expected === "tsv" || expected === "html" || expected === "markdown") && magic !== "text") {
    throw new UnsupportedOrMismatchedFileType(
      `Rejected ${fileName}: text extension does not match magic bytes.`,
    );
  }
  if (magic === "pdf") return "pdf";
  if (magic === "zip") return "docx";
  if (magic === "png" || magic === "jpeg" || magic === "webp") return magic;
  if (expected === "csv") return "csv";
  if (expected === "tsv") return "tsv";
  if (expected === "html") return "html";
  if (magic === "text") return "markdown";
  throw new UnsupportedOrMismatchedFileType(
    `Rejected ${fileName}: unsupported or unrecognized file format.`,
  );
}
