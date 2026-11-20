import { createHash } from "node:crypto";

/** Lowercase hex SHA-256 of the exact UTF-8 bytes. No `sha256:` prefix. */
export function hashFileContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}
