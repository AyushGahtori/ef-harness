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
  const request = await readRequest();
  const networkDenied = networkIsDenied();
  try {
    const bytes = new Uint8Array(readFileSync(request.inputPath));
    const result = await convertBytes(bytes, request.fileName, request.sourceHash, {
      ...(request.pageStart !== undefined ? { pageStart: request.pageStart } : {}),
      ...(request.pageEnd !== undefined ? { pageEnd: request.pageEnd } : {}),
    });
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        document: result.document,
        engines: result.engines,
        networkDenied,
        pid: process.pid,
      })}\n`,
    );
  } catch (error) {
    const known = error instanceof Error ? error : new Error(String(error));
    process.stdout.write(
      `${JSON.stringify({
        ok: false,
        error: { name: known.name, message: known.message },
        networkDenied,
        pid: process.pid,
      })}\n`,
    );
    process.exitCode = 2;
  }
}

async function readRequest(): Promise<WorkerRequest> {
  const requestArg = process.argv.slice(2).find((arg) => arg.endsWith(".json"));
  const raw = requestArg ? readFileSync(requestArg, "utf8") : await readStdin();
  const parsed: unknown = JSON.parse(raw);
  if (!isWorkerRequest(parsed)) {
    throw new Error("Converter request is missing fileName, inputPath, or sourceHash.");
  }
  return parsed;
}

function isWorkerRequest(value: unknown): value is WorkerRequest {
  if (value === null || typeof value !== "object") return false;
  if (!("fileName" in value) || typeof value.fileName !== "string") return false;
  if (!("inputPath" in value) || typeof value.inputPath !== "string") return false;
  if (!("sourceHash" in value) || typeof value.sourceHash !== "string") return false;
  if ("pageStart" in value && value.pageStart !== undefined && typeof value.pageStart !== "number") return false;
  if ("pageEnd" in value && value.pageEnd !== undefined && typeof value.pageEnd !== "number") return false;
  return true;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}
