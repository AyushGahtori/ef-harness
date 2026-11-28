import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "src", "telemetry", "win32-helper.cs");
const prebuiltDir = path.join(root, "prebuilt");
const executable = path.join(prebuiltDir, "win32-helper.exe");
const csc = "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe";

function isExecutable(filePath) {
  if (!fs.existsSync(filePath)) return false;
  const header = Buffer.alloc(2);
  const fd = fs.openSync(filePath, "r");
  try {
    const read = fs.readSync(fd, header, 0, 2, 0);
    return read === 2 && header[0] === 0x4d && header[1] === 0x5a;
  } finally {
    fs.closeSync(fd);
  }
}

if (!fs.existsSync(source)) {
  process.stderr.write("win32-helper.cs is missing from packages/governor/src/telemetry\n");
  process.exit(1);
}

if (isExecutable(executable)) {
  process.stdout.write(`win32 helper prebuilt ok: ${executable}\n`);
  process.exit(0);
}

if (process.platform === "win32" && fs.existsSync(csc)) {
  fs.mkdirSync(prebuiltDir, { recursive: true });
  const result = spawnSync(
    csc,
    ["/nologo", "/platform:x64", "/optimize+", "/r:System.Web.Extensions.dll", `/out:${executable}`, source],
    { encoding: "utf8" },
  );
  if (result.status !== 0 || !isExecutable(executable)) {
    process.stderr.write(`win32 helper compile failed\n${result.stdout ?? ""}\n${result.stderr ?? ""}`);
    process.exit(result.status || 1);
  }
  process.stdout.write(`win32 helper compiled: ${executable}\n`);
  process.exit(0);
}

process.stdout.write(
  "win32 helper source is present; the prebuilt exe is compiled on Windows when csc.exe is available\n",
);
