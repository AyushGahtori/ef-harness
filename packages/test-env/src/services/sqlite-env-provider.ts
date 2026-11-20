import { copyFile, mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { isEnoent } from "./paths.js";
import type { ServiceConnection, ServiceCreateRequest, ServiceProvider } from "./types.js";

const SIDECAR_SUFFIXES = ["-wal", "-shm", "-journal"] as const;

export interface SqliteConnection extends ServiceConnection {
  readonly service: "sqlite";
  readonly connectionString: string;
  readonly filePath: string;
}

interface SqliteEnvRecord {
  projectId: string;
  filePath: string;
  templatePath: string | null;
}

export class SqliteEnvProvider implements ServiceProvider {
  readonly service = "sqlite" as const;
  private readonly envs = new Map<string, SqliteEnvRecord>();

  async create(request: ServiceCreateRequest): Promise<SqliteConnection> {
    if (this.envs.has(request.envId)) {
      throw new Error(`sqlite environment ${request.envId} already exists`);
    }
    const filePath = path.join(request.tempDir, `env_${safeFileStem(request.envId)}.sqlite`);
    await mkdir(request.tempDir, { recursive: true });
    if (request.templatePath) {
      const templateStat = await stat(request.templatePath);
      if (!templateStat.isFile()) {
        throw new Error(`sqlite template is not a file: ${request.templatePath}`);
      }
      await copySqliteTemplate(request.templatePath, filePath);
    } else {
      await writeFile(filePath, Buffer.alloc(0));
    }
    this.envs.set(request.envId, {
      projectId: request.projectId,
      filePath,
      templatePath: request.templatePath ?? null,
    });
    const connectionString = `file:${filePath}`;
    return {
      service: "sqlite",
      envId: request.envId,
      projectId: request.projectId,
      connectionString,
      filePath,
      variables: { DATABASE_URL: connectionString },
    };
  }

  async resetData(envId: string): Promise<void> {
    const record = this.record(envId);
    if (record.templatePath) {
      await copySqliteTemplate(record.templatePath, record.filePath);
      return;
    }
    await writeFile(record.filePath, Buffer.alloc(0));
  }

  async destroy(envId: string): Promise<void> {
    const record = this.envs.get(envId);
    if (!record) return;
    this.envs.delete(envId);
    await rm(record.filePath, { force: true });
    for (const suffix of SIDECAR_SUFFIXES) {
      await rm(`${record.filePath}${suffix}`, { force: true });
    }
  }

  async closeProject(projectId: string): Promise<void> {
    const ids = [...this.envs.entries()]
      .filter(([, record]) => record.projectId === projectId)
      .map(([envId]) => envId);
    for (const envId of ids) {
      await this.destroy(envId);
    }
  }

  private record(envId: string): SqliteEnvRecord {
    const record = this.envs.get(envId);
    if (!record) throw new Error(`unknown sqlite environment ${envId}`);
    return record;
  }
}

async function copySqliteTemplate(templatePath: string, destPath: string): Promise<void> {
  await copyFile(templatePath, destPath);
  for (const suffix of SIDECAR_SUFFIXES) {
    try {
      await copyFile(`${templatePath}${suffix}`, `${destPath}${suffix}`);
    } catch (error) {
      if (!isEnoent(error)) throw error;
    }
  }
}

function safeFileStem(envId: string): string {
  const cleaned = envId.replace(/[^a-zA-Z0-9_-]/g, "_");
  if (!cleaned) throw new Error("environment id is empty");
  return cleaned;
}
