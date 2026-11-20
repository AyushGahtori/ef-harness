import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { systemClock, type Clock } from "./clock.js";
import { UploadRejectedError } from "./errors.js";
import { TrackingWindowsJobManager, type JobHandle, type WindowsJobManager } from "./job.js";
import { closeServer, listenLoopback, readLimitedBody } from "./net-util.js";
import { efHarnessHome, isEnoent, projectServiceDir } from "./paths.js";
import { ProjectSharedServerPool } from "./shared-server.js";
import type { ServiceConnection, ServiceCreateRequest, ServiceProvider } from "./types.js";
import {
  assertStorageOutsidePublicWeb,
  assertUploadAllowed,
  DEFAULT_UPLOAD_POLICY,
  safeObjectSegments,
  type UploadPolicy,
} from "./upload-rules.js";

interface StorageRuntime {
  readonly port: number;
  stop(): Promise<void>;
}

interface BucketRecord {
  projectId: string;
  envId: string;
  bucket: string;
  token: string;
  dir: string;
}

interface StoredObject {
  contentType: string;
  filePath: string;
}

export interface ObjectStorageConnection extends ServiceConnection {
  readonly service: "s3";
  readonly endpoint: string;
  readonly bucket: string;
  readonly accessKey: string;
  readonly region: "us-east-1";
  readonly storagePath: string;
}

export interface LocalObjectStorageOptions {
  readonly policy?: UploadPolicy;
  readonly home?: string;
  readonly clock?: Clock;
  readonly idleGraceMs?: number;
  readonly jobManager?: WindowsJobManager;
}

export class LocalObjectStorageProvider implements ServiceProvider {
  readonly service = "s3" as const;
  readonly policy: UploadPolicy;
  private readonly home: string;
  private readonly jobManager: WindowsJobManager;
  private readonly buckets = new Map<string, BucketRecord>();
  private readonly objects = new Map<string, StoredObject>();
  private readonly jobs = new Map<string, JobHandle>();
  private readonly pool: ProjectSharedServerPool<StorageRuntime>;

  constructor(options: LocalObjectStorageOptions = {}) {
    this.policy = options.policy ?? DEFAULT_UPLOAD_POLICY;
    this.home = options.home ?? efHarnessHome();
    this.jobManager = options.jobManager ?? new TrackingWindowsJobManager();
    this.pool = new ProjectSharedServerPool({
      idleGraceMs: options.idleGraceMs ?? 5_000,
      clock: options.clock ?? systemClock(),
      start: (projectId) => this.startServer(projectId),
      stop: async (_projectId, runtime) => {
        await runtime.stop();
      },
    });
  }

  async create(request: ServiceCreateRequest): Promise<ObjectStorageConnection> {
    if (this.buckets.has(request.envId)) {
      throw new Error(`object storage environment ${request.envId} already exists`);
    }
    const bucket = `env-${sanitizeBucketId(request.envId)}`;
    const dir = path.join(projectServiceDir(this.home, request.projectId, "s3"), bucket);
    assertStorageOutsidePublicWeb(dir, this.policy.publicWebRoots);
    await this.pool.acquire(request.projectId);
    try {
      await mkdir(dir, { recursive: true });
      const token = randomBytes(16).toString("hex");
      this.buckets.set(request.envId, {
        projectId: request.projectId,
        envId: request.envId,
        bucket,
        token,
        dir,
      });
      const runtime = this.pool.runtimeOf(request.projectId);
      if (!runtime) throw new Error("local object storage server is not running");
      await this.jobFor(request.projectId);
      const endpoint = `http://127.0.0.1:${runtime.port}`;
      return {
        service: "s3",
        envId: request.envId,
        projectId: request.projectId,
        endpoint,
        bucket,
        accessKey: token,
        region: "us-east-1",
        storagePath: dir,
        variables: {
          S3_ENDPOINT: endpoint,
          S3_BUCKET: bucket,
          S3_ACCESS_KEY: token,
          S3_REGION: "us-east-1",
        },
      };
    } catch (error) {
      this.buckets.delete(request.envId);
      await this.pool.release(request.projectId);
      throw error;
    }
  }

  async resetData(envId: string): Promise<void> {
    const record = this.record(envId);
    await this.deleteObjects(record);
  }

  async destroy(envId: string): Promise<void> {
    const record = this.buckets.get(envId);
    if (!record) return;
    this.buckets.delete(envId);
    await this.deleteObjects(record);
    await rm(record.dir, { recursive: true, force: true });
    await this.pool.release(record.projectId);
  }

  async closeProject(projectId: string): Promise<void> {
    const ids = [...this.buckets.values()]
      .filter((record) => record.projectId === projectId)
      .map((record) => record.envId);
    for (const envId of ids) await this.destroy(envId);
    await this.pool.close(projectId);
    const job = this.jobs.get(projectId);
    if (job) {
      this.jobs.delete(projectId);
      await this.jobManager.terminateJob(job);
    }
  }

  private async startServer(projectId: string): Promise<StorageRuntime> {
    await this.jobFor(projectId);
    const server = http.createServer((req, res) => {
      void this.handle(projectId, req, res);
    });
    const port = await listenLoopback(server);
    return {
      port,
      stop: () => closeServer(server),
    };
  }

  private async handle(projectId: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const parts = url.pathname.split("/").filter((part) => part.length > 0).map(decodeURIComponent);
      const bucketName = parts[0];
      const key = parts.slice(1).join("/");
      if (!bucketName) {
        sendText(res, 404, "NoSuchBucket");
        return;
      }
      const record = this.bucketByName(projectId, bucketName);
      if (!record) {
        sendText(res, 404, "NoSuchBucket");
        return;
      }
      if (!authorized(record, req)) {
        sendText(res, 403, "AccessDenied");
        return;
      }
      const method = (req.method ?? "GET").toUpperCase();
      if (!key) {
        if (method === "DELETE") {
          await this.deleteObjects(record);
          await rm(record.dir, { recursive: true, force: true });
          await mkdir(record.dir, { recursive: true });
          sendText(res, 204, "");
          return;
        }
        sendText(res, 200, "BucketExists");
        return;
      }
      const target = resolveInside(record.dir, key);
      if (method === "PUT") {
        await this.putObject(record, target, req, res);
        return;
      }
      if (method === "GET" || method === "HEAD") {
        await this.getObject(target, method, res);
        return;
      }
      if (method === "DELETE") {
        await rm(target, { force: true });
        this.objects.delete(target);
        sendText(res, 204, "");
        return;
      }
      sendText(res, 405, "MethodNotAllowed");
    } catch (error) {
      if (error instanceof UploadRejectedError) {
        const status = error.rule === "size" ? 413 : error.rule === "type" ? 415 : 400;
        sendText(res, status, error.message);
        return;
      }
      sendText(res, 500, error instanceof Error ? error.message : "storage error");
    }
  }

  private async putObject(
    record: BucketRecord,
    target: string,
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const contentTypeHeader = headerValue(req.headers["content-type"]);
    const declaredLength = Number(headerValue(req.headers["content-length"]) ?? "");
    if (Number.isFinite(declaredLength) && declaredLength > this.policy.maxBytes) {
      sendText(res, 413, `X-08 upload rejected: ${declaredLength} bytes exceeds the limit`);
      req.resume();
      return;
    }
    const read = await readLimitedBody(req, this.policy.maxBytes);
    if (read.tooLarge) {
      sendText(res, 413, `X-08 upload rejected: body exceeds the ${this.policy.maxBytes} byte limit`);
      return;
    }
    assertUploadAllowed(this.policy, contentTypeHeader, read.body.length);
    assertStorageOutsidePublicWeb(target, this.policy.publicWebRoots);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, read.body);
    this.objects.set(target, {
      contentType: contentTypeHeader ?? "application/octet-stream",
      filePath: target,
    });
    res.writeHead(200, { etag: `"${record.bucket}"` });
    res.end();
  }

  private async getObject(target: string, method: "GET" | "HEAD", res: ServerResponse): Promise<void> {
    const meta = this.objects.get(target);
    try {
      const body = await readFile(target);
      res.writeHead(200, {
        "content-type": meta?.contentType ?? "application/octet-stream",
        "content-length": String(body.length),
      });
      res.end(method === "HEAD" ? undefined : body);
    } catch (error) {
      if (isEnoent(error)) {
        sendText(res, 404, "NoSuchKey");
        return;
      }
      throw error;
    }
  }

  private async deleteObjects(record: BucketRecord): Promise<void> {
    const root = path.resolve(record.dir);
    const doomed = [...this.objects.keys()].filter(
      (filePath) => filePath === root || filePath.startsWith(`${root}${path.sep}`),
    );
    for (const filePath of doomed) {
      await rm(filePath, { force: true });
      this.objects.delete(filePath);
    }
  }

  private bucketByName(projectId: string, bucket: string): BucketRecord | undefined {
    for (const record of this.buckets.values()) {
      if (record.projectId === projectId && record.bucket === bucket) return record;
    }
    return undefined;
  }

  private record(envId: string): BucketRecord {
    const record = this.buckets.get(envId);
    if (!record) throw new Error(`unknown object storage environment ${envId}`);
    return record;
  }

  private async jobFor(projectId: string): Promise<JobHandle> {
    const existing = this.jobs.get(projectId);
    if (existing) return existing;
    const created = await this.jobManager.createJob(`project-service:${projectId}:s3`, {
      killOnJobClose: true,
    });
    this.jobs.set(projectId, created);
    return created;
  }
}

function resolveInside(root: string, key: string): string {
  const segments = safeObjectSegments(key);
  const target = path.resolve(root, ...segments);
  const resolvedRoot = path.resolve(root);
  if (target !== resolvedRoot && !target.startsWith(resolvedRoot + path.sep)) {
    throw new UploadRejectedError("escape", "X-08 upload rejected: object key escapes the bucket");
  }
  return target;
}

function authorized(record: BucketRecord, req: IncomingMessage): boolean {
  const header = headerValue(req.headers["x-ef-access-key"]);
  if (header) return tokensMatch(record.token, header);
  const auth = headerValue(req.headers.authorization);
  if (auth?.startsWith("Bearer ")) return tokensMatch(record.token, auth.slice("Bearer ".length));
  return false;
}

function tokensMatch(expected: string, presented: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(presented);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0];
  return undefined;
}

function sendText(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(body);
}

function sanitizeBucketId(envId: string): string {
  const cleaned = envId.replace(/[^a-zA-Z0-9_-]/g, "-");
  if (!cleaned) throw new Error("environment id is empty");
  return cleaned;
}
