import { readFileSync } from "node:fs";
import { convertBytes } from "./convert-bytes.js";
import { networkIsDenied } from "./zero-network-guard.js";

interface WorkerRequest {
  readonly fileName: string;
  readonly inputPath: string;
  readonly sourceHash: string;
  readonly pageStart?: number;
  readonly pageEnd?: number;
}

export async function runWorker(): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  const request = JSON.parse(Buffer.concat(chunks).toString("utf8")) as WorkerRequest;
  const networkDenied = networkIsDenied();
  try {
    const bytes = new Uint8Array(readFileSync(request.inputPath));
    const result = await convertBytes(bytes, request.fileName, request.sourceHash, {
      ...(request.pageStart !== undefined ? { pageStart: request.pageStart } : {}),
      ...(request.pageEnd !== undefined ? { pageEnd: request.pageEnd } : {}),
    });
    process.stdout.write(
      JSON.stringify({
        ok: true,
        document: result.document,
        engines: result.engines,
        networkDenied,
        pid: process.pid,
      }),
    );
  } catch (error) {
    const known = error instanceof Error ? error : new Error(String(error));
    process.stdout.write(
      JSON.stringify({
        ok: false,
        error: { name: known.name, message: known.message },
        networkDenied,
        pid: process.pid,
      }),
    );
    process.exitCode = 2;
  }
}
