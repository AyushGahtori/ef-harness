import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { SpikeError } from "./errors.ts";

export interface BinaryComponent {
  id: string;
  version: string;
  url: string;
  archiveName: string;
  sha256: string;
  sizeBytes: number;
  license: string;
  executable: string;
}

export const PIN_STRATEGY =
  "Pin the exact archive URL, byte size, and SHA-256. Task 132 must verify the signed component manifest, then hash the downloaded bytes before unpack. Refuse mutable latest URLs and refuse to spawn a binary whose archive hash does not match.";

export const BINARY_COMPONENTS: readonly BinaryComponent[] = [
  {
    id: "postgres-windows-x64",
    version: "17.12-1",
    url: "https://get.enterprisedb.com/postgresql/postgresql-17.12-1-windows-x64-binaries.zip",
    archiveName: "postgresql-17.12-1-windows-x64-binaries.zip",
    sha256: "a2cd8a774389347b70be7748ac4a37ef43cb6ee539c5fc3e85ae264b15e4a04c",
    sizeBytes: 386263884,
    license: "PostgreSQL License",
    executable: "postgres.exe",
  },
  {
    id: "garnet-windows-x64",
    version: "2.2.13",
    url: "https://github.com/microsoft/garnet/releases/download/v2.2.13/win-x64-based-readytorun.zip",
    archiveName: "win-x64-based-readytorun.zip",
    sha256: "cc8212d7c7a671c490e5c87967fc43025a22215922bdbdad5eccff00915c7b82",
    sizeBytes: 26495420,
    license: "MIT",
    executable: "GarnetServer.exe",
  },
  {
    id: "mailpit-windows-amd64",
    version: "1.34.0",
    url: "https://github.com/axllent/mailpit/releases/download/v1.34.0/mailpit-windows-amd64.zip",
    archiveName: "mailpit-windows-amd64.zip",
    sha256: "8f080d41374bf22686606374a0a483c8563c1bf29ae078179792392ff8c911d7",
    sizeBytes: 11288840,
    license: "MIT",
    executable: "mailpit.exe",
  },
];

export function componentCacheRoot(): string {
  const base = process.env.LOCALAPPDATA;
  if (!base) throw new SpikeError("cache_root", "LOCALAPPDATA is not set.");
  return path.join(base, "EFHarness", "components", "test-services-windows");
}

export function assertPinnedSha256(sha256: string): void {
  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    throw new SpikeError("unpinned_binary", "Refusing to use a component without a 64-character SHA-256 pin.");
  }
}

export async function sha256File(file: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve());
  });
  return hash.digest("hex");
}

export async function verifyArchive(file: string, expectedSha256: string): Promise<void> {
  assertPinnedSha256(expectedSha256);
  const actual = await sha256File(file);
  if (actual !== expectedSha256) {
    throw new SpikeError(
      "checksum_mismatch",
      `SHA-256 mismatch for ${path.basename(file)}. expected ${expectedSha256} actual ${actual}. The archive was not unpacked.`,
    );
  }
}

export async function ensureExtracted(component: BinaryComponent): Promise<string> {
  assertPinnedSha256(component.sha256);
  const root = componentCacheRoot();
  mkdirSync(root, { recursive: true });
  const archive = path.join(root, component.archiveName);
  if (!existsSync(archive)) {
    await download(component.url, archive);
  }
  const size = statSync(archive).size;
  if (component.sizeBytes > 0 && size !== component.sizeBytes) {
    throw new SpikeError(
      "size_mismatch",
      `${component.archiveName} is ${size} bytes, manifest expects ${component.sizeBytes}.`,
    );
  }
  await verifyArchive(archive, component.sha256);
  const dest = path.join(root, component.id);
  const marker = path.join(dest, ".extracted");
  if (!existsSync(marker)) {
    mkdirSync(dest, { recursive: true });
    await extractZip(archive, dest);
    mkdirSync(path.dirname(marker), { recursive: true });
    const { writeFileSync } = await import("node:fs");
    writeFileSync(marker, component.sha256);
  }
  return dest;
}

export async function findExecutable(root: string, name: string): Promise<string> {
  const { readdirSync } = await import("node:fs");
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name.toLowerCase() === name.toLowerCase()) return full;
    }
  }
  throw new SpikeError("binary_missing", `Could not find ${name} under ${root}.`);
}

async function download(url: string, destination: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("curl.exe", ["-L", "--fail", "--retry", "3", "-o", destination, url], {
      windowsHide: true,
      shell: false,
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new SpikeError("download_failed", `curl exited ${code} for ${url}\n${stderr}`));
    });
  });
}

async function extractZip(archive: string, destination: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("tar.exe", ["-xf", archive, "-C", destination], {
      windowsHide: true,
      shell: false,
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new SpikeError("extract_failed", `tar exited ${code}\n${stderr}`));
    });
  });
}
