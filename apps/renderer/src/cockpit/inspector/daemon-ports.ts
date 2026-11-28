import type { BinaryStreamClient, DiffRangeChunk, LogByteChunk, LogLocation, ScreenshotChunk, SeekableZstdLogReader } from "./ports.js";

/** Preload JSON-RPC. Channel 1 framing stays on the daemon; this client reads the JSON result. */
export interface InspectorRpc {
  request(method: string, params: Record<string, unknown>): Promise<unknown>;
}

export function daemonBinaryStream(rpc: InspectorRpc): BinaryStreamClient {
  return {
    async fetchDiffRange(attemptId, filePath, hunkOffset, limit): Promise<DiffRangeChunk> {
      const result = (await rpc.request("fetchDiffRange", { attemptId, filePath, hunkOffset, limit })) as DiffRangeChunk;
      return result;
    },
    async fetchLogChunk(artifactId, byteOffset, limit): Promise<LogByteChunk> {
      const result = (await rpc.request("fetchLogChunk", { artifactId, byteOffset, limit })) as {
        bytes: string;
        totalBytes: number;
        archived?: boolean;
      };
      return {
        artifactId,
        byteOffset,
        bytes: decodeBase64(result.bytes),
        totalBytes: result.totalBytes,
        archived: result.archived === true,
      };
    },
    async fetchScreenshot(artifactId, byteOffset, limit): Promise<ScreenshotChunk> {
      const result = (await rpc.request("fetchScreenshot", { artifactId, byteOffset, limit })) as {
        bytes: string;
        totalBytes: number;
      };
      return { artifactId, bytes: decodeBase64(result.bytes), totalBytes: result.totalBytes };
    },
  };
}

export function daemonLogReader(rpc: InspectorRpc): SeekableZstdLogReader {
  return {
    async locateLineWindow(artifactId, startLine, maxLines, maxBytes): Promise<LogLocation> {
      const result = (await rpc.request("locateLineWindow", {
        artifactId,
        startLine,
        maxLines,
        maxBytes,
      })) as LogLocation;
      return result;
    },
  };
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
