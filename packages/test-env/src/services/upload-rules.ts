import path from "node:path";
import { UploadRejectedError } from "./errors.js";

export interface UploadPolicy {
  readonly maxBytes: number;
  readonly allowedContentTypes: readonly string[];
  readonly publicWebRoots: readonly string[];
}

export const DEFAULT_UPLOAD_POLICY: UploadPolicy = {
  maxBytes: 5 * 1024 * 1024,
  allowedContentTypes: [
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
    "application/pdf",
    "text/plain",
  ],
  publicWebRoots: [],
};

export function normalizeContentType(header: string | undefined): string {
  if (!header) return "";
  const [media] = header.split(";");
  return (media ?? "").trim().toLowerCase();
}

export function assertUploadAllowed(
  policy: UploadPolicy,
  contentType: string | undefined,
  size: number,
): void {
  if (!Number.isFinite(size) || size < 0 || size > policy.maxBytes) {
    throw new UploadRejectedError(
      "size",
      `X-08 upload rejected: ${size} bytes exceeds the ${policy.maxBytes} byte limit`,
    );
  }
  const normalized = normalizeContentType(contentType);
  if (!policy.allowedContentTypes.includes(normalized)) {
    throw new UploadRejectedError(
      "type",
      `X-08 upload rejected: content type ${normalized || "(missing)"} is not allowed`,
    );
  }
}

export function assertStorageOutsidePublicWeb(storagePath: string, publicWebRoots: readonly string[]): void {
  const resolved = path.resolve(storagePath);
  for (const root of publicWebRoots) {
    const resolvedRoot = path.resolve(root);
    if (resolved === resolvedRoot || resolved.startsWith(resolvedRoot + path.sep)) {
      throw new UploadRejectedError(
        "public_path",
        `X-08 upload rejected: storage path is inside a public web root (${resolved})`,
      );
    }
  }
}

export function safeObjectSegments(key: string): string[] {
  if (!key || key.length > 1024 || key.includes("\\") || key.includes("\0")) {
    throw new UploadRejectedError("escape", "X-08 upload rejected: object key is not allowed");
  }
  const segments = key.split("/").filter((segment) => segment.length > 0);
  if (segments.length === 0 || key.startsWith("/")) {
    throw new UploadRejectedError("escape", "X-08 upload rejected: object key is not allowed");
  }
  for (const segment of segments) {
    if (segment === "." || segment === "..") {
      throw new UploadRejectedError("escape", "X-08 upload rejected: object key escapes the bucket");
    }
  }
  return segments;
}
