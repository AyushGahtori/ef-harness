import { FileSizeLimitError } from "./errors.js";

export const MAX_RAW_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_UNCOMPRESSED_BYTES = 200 * 1024 * 1024;
export const MAX_EXPANSION_RATIO = 50;
export const MAX_PDF_PAGES_PER_PASS = 500;
export const PDF_OCR_CHAR_THRESHOLD = 30;
export const CONVERTER_MEMORY_LIMIT_BYTES = 512 * 1024 * 1024;
export const CONVERTER_WALL_CLOCK_MS = 30_000;
export const CSV_HEAD_ROWS = 20;
export const CSV_EDGE_ROWS = 2;
export const MAX_IMAGE_PIXELS = 2_000_000;

export function assertRawFileSize(byteLength: number): void {
  if (!Number.isFinite(byteLength) || byteLength < 0 || byteLength > MAX_RAW_FILE_BYTES) {
    throw new FileSizeLimitError();
  }
}

export function exceedsExpansion(uncompressed: number, compressed: number): boolean {
  if (!Number.isFinite(uncompressed) || uncompressed < 0) return true;
  if (uncompressed > MAX_UNCOMPRESSED_BYTES) return true;
  if (compressed <= 0) return uncompressed > 0;
  return uncompressed > compressed * MAX_EXPANSION_RATIO;
}
