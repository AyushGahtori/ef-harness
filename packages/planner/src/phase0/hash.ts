import { createHash } from "node:crypto";

export function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

export function sha256FileBytes(content: string): string {
  return sha256(content.replaceAll("\r\n", "\n"));
}
