import { SecretDetectedInPortabilityExportError } from "./errors.js";
import type { PacketSecurityRedactorPort } from "./types.js";

export interface ExportBuffer {
  readonly path: string;
  readonly content: string;
  readonly nodeId?: string;
}

export class ExportSecretGate {
  constructor(private readonly redactor: PacketSecurityRedactorPort) {}

  assertClean(buffers: readonly ExportBuffer[]): void {
    for (const buffer of buffers) {
      const scan = this.redactor.scan(buffer.content);
      if (!scan.clean) {
        throw new SecretDetectedInPortabilityExportError(
          buffer.nodeId !== undefined
            ? { path: buffer.path, preview: scan.preview, nodeId: buffer.nodeId }
            : { path: buffer.path, preview: scan.preview },
        );
      }
    }
  }
}