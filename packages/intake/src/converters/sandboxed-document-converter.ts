import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deserializeDocument, serializeDocument } from "./assemble.js";
import { assertRawFileSize, CONVERTER_MEMORY_LIMIT_BYTES, CONVERTER_WALL_CLOCK_MS } from "./limits.js";
import { createCanonicalHash, type CanonicalHash } from "./ports/canonical-hash.js";
import { MemoryCasBlobStore, type CasBlobStore } from "./ports/cas-blob-store.js";
import { NodeSandboxRunner, type SandboxRunner } from "./ports/sandbox-runner.js";
import { ConverterProcessError, rehydrateConverterError } from "./errors.js";
import type { ConvertRequest, NormalizedDocument, VisionCaptioner } from "./types.js";

export interface SandboxReceipt {
  readonly executed: boolean;
  readonly pid: number | null;
  readonly networkDenied: boolean;
  readonly memoryLimitBytes: number;
  readonly wallClockMs: number;
  readonly jobAssigned: boolean;
  readonly zeroNetwork: true;
}

export interface SandboxConversion {
  readonly document: NormalizedDocument;
  readonly cacheHit: boolean;
  readonly deduplicated: boolean;
  readonly engines: readonly string[];
  readonly sandbox: SandboxReceipt;
}

interface WorkerSuccess {
  readonly ok: true;
  readonly document: NormalizedDocument;
  readonly engines: readonly string[];
  readonly networkDenied: boolean;
  readonly pid: number;
}

interface WorkerFailure {
  readonly ok: false;
  readonly error: { readonly name: string; readonly message: string };
  readonly networkDenied: boolean;
  readonly pid: number;
}

export interface SandboxedDocumentConverterOptions {
  readonly cas?: CasBlobStore;
  readonly hash?: CanonicalHash;
  readonly runner?: SandboxRunner;
}

export class SandboxedDocumentConverter {
  private readonly cas: CasBlobStore;
  private readonly hash: CanonicalHash;
  private readonly runner: SandboxRunner;
  spawnCount = 0;

  constructor(options: SandboxedDocumentConverterOptions = {}) {
    this.hash = options.hash ?? createCanonicalHash();
    this.cas = options.cas ?? new MemoryCasBlobStore(this.hash);
    this.runner = options.runner ?? new NodeSandboxRunner();
  }

  async convert(request: ConvertRequest): Promise<SandboxConversion> {
    assertRawFileSize(request.bytes.byteLength);
    const sourceHash = this.hash.sha256Prefixed(request.bytes);
    await this.cas.putBlob(request.bytes, { retention: "evidence", holderKind: "intake" });
    const memoryLimitBytes = request.memoryLimitBytes ?? CONVERTER_MEMORY_LIMIT_BYTES;
    const wallClockMs = request.wallClockMs ?? CONVERTER_WALL_CLOCK_MS;
    const cacheKey = `${sourceHash}|${request.pageStart ?? "*"}|${request.pageEnd ?? "*"}`;
    const cached = await this.cas.readNormalized(cacheKey);
    if (cached) {
      const document = await attachVision(
        this.cas,
        deserializeDocument(cached),
        request.bytes,
        request.visionCaptioner,
      );
      return {
        document,
        cacheHit: true,
        deduplicated: true,
        engines: ["cache"],
        sandbox: {
          executed: false,
          pid: null,
          networkDenied: true,
          memoryLimitBytes,
          wallClockMs,
          jobAssigned: false,
          zeroNetwork: true,
        },
      };
    }
    const directory = await mkdtemp(join(tmpdir(), "ef-intake-"));
    try {
      const inputPath = join(directory, "input.bin");
      await writeFile(inputPath, request.bytes);
      const launch = workerLaunch(memoryLimitBytes);
      const stdin = JSON.stringify({
        fileName: request.fileName,
        inputPath,
        sourceHash,
        ...(request.pageStart !== undefined ? { pageStart: request.pageStart } : {}),
        ...(request.pageEnd !== undefined ? { pageEnd: request.pageEnd } : {}),
      });
      let result = await this.spawnOnce(launch, directory, stdin, wallClockMs, memoryLimitBytes);
      if (result.exitCode === 3221226505) {
        this.spawnCount -= 1;
        result = await this.spawnOnce(launch, directory, stdin, wallClockMs, memoryLimitBytes);
      }
      const payload = parseWorkerPayload(result.stdout, result.stderr, result.exitCode);
      if (!payload.ok) throw rehydrateConverterError(payload.error.name, payload.error.message);
      await this.cas.writeNormalized(cacheKey, serializeDocument(payload.document));
      const document = await attachVision(this.cas, payload.document, request.bytes, request.visionCaptioner);
      return {
        document,
        cacheHit: false,
        deduplicated: false,
        engines: payload.engines,
        sandbox: {
          executed: true,
          pid: payload.pid || result.pid,
          networkDenied: payload.networkDenied,
          memoryLimitBytes,
          wallClockMs,
          jobAssigned: result.jobAssigned,
          zeroNetwork: true,
        },
      };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  private async spawnOnce(
    launch: { readonly command: string; readonly args: readonly string[]; readonly cwd: string },
    directory: string,
    stdin: string,
    wallClockMs: number,
    memoryLimitBytes: number,
  ) {
    this.spawnCount += 1;
    return this.runner.runIsolated({
      command: launch.command,
      args: launch.args,
      cwd: launch.cwd,
      env: scrubbedEnv(directory),
      wallClockMs,
      memoryLimitBytes,
      stdin,
    });
  }
}

function parseWorkerPayload(stdout: string, stderr: string, exitCode = 0): WorkerSuccess | WorkerFailure {
  const trimmed = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{"))
    .at(-1);
  if (!trimmed) {
    throw new ConverterProcessError(
      `exit ${exitCode}: ${stderr.trim() || stdout.trim() || "Converter child produced no output."}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new ConverterProcessError(stderr.trim() || "Converter child returned malformed output.");
  }
  if (!parsed || typeof parsed !== "object" || !("ok" in parsed)) {
    throw new ConverterProcessError("Converter child returned an unexpected payload.");
  }
  return parsed as WorkerSuccess | WorkerFailure;
}

function workerLaunch(memoryLimitBytes: number): {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
} {
  const ts = fileURLToPath(new URL("./worker-main.ts", import.meta.url));
  const js = fileURLToPath(new URL("./worker-main.js", import.meta.url));
  const hook = new URL("./register-ts-hook.mjs", import.meta.url).href;
  const script = existsSync(ts) ? ts : js;
  void memoryLimitBytes;
  const cwd = moduleRoot(script);
  return {
    command: process.execPath,
    cwd,
    args: [
      "--experimental-strip-types",
      "--disable-warning=ExperimentalWarning",
      "--no-warnings",
      "--import",
      hook,
      script,
    ],
  };
}

function moduleRoot(start: string): string {
  let dir = dirname(start);
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(join(dir, "node_modules", "tsx"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return dirname(start);
}

function scrubbedEnv(tempDir: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!value) continue;
    if (/(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|PASSWD)/i.test(key)) continue;
    env[key] = value;
  }
  env.TEMP = tempDir;
  env.TMP = tempDir;
  env.HOME = tempDir;
  env.USERPROFILE = tempDir;
  env.EF_CONVERTER_ZERO_NETWORK = "1";
  return env;
}

async function attachVision(
  cas: CasBlobStore,
  document: NormalizedDocument,
  bytes: Uint8Array,
  captioner: VisionCaptioner | undefined,
): Promise<NormalizedDocument> {
  if (document.mediaType !== "image" || !captioner) return document;
  const width = document.stats.width ?? 0;
  const height = document.stats.height ?? 0;
  const caption = await captioner.caption({ bytes, width, height, ocrText: document.text });
  await cas.putBlob(Buffer.from(caption.summary, "utf8"), { retention: "evidence", holderKind: "intake" });
  return {
    ...document,
    blocks: document.blocks.map((block) => {
      if (block.locator.type !== "image") return block;
      return { ...block, locator: { ...block.locator, visionSummaryRef: caption.ref } };
    }),
  };
}
