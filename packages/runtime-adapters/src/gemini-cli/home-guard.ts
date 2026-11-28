import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { geminiDirName, personalGeminiMarker } from "./constants.js";
import { GeminiHomeAccessError } from "./errors.js";

export function isUserGeminiPath(candidate: string): boolean {
  const marker = personalGeminiMarker().toLowerCase();
  const slashed = candidate.replaceAll("\\", "/").toLowerCase();
  if (slashed.includes(marker)) return true;
  const forbidden = path.resolve(path.join(os.homedir(), geminiDirName())).toLowerCase();
  let resolved = candidate;
  try {
    resolved = path.resolve(candidate);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ERR_INVALID_ARG_VALUE") return slashed.includes(marker);
  }
  const norm = resolved.toLowerCase();
  return norm === forbidden || norm.startsWith(`${forbidden}${path.sep}`);
}

function pathText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value instanceof URL) return fileURLToPath(value);
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) return value.toString("utf8");
  return null;
}

export interface PathTouch {
  readonly op: string;
  readonly filePath: string;
  readonly forbidden: boolean;
}

type FsFn = (...args: unknown[]) => unknown;

interface Patched {
  readonly owner: Record<string, unknown>;
  readonly name: string;
  readonly original: FsFn;
}

export class GeminiHomeGuard {
  readonly touches: PathTouch[] = [];

  inspect(filePath: string, op = "touch"): string {
    const forbidden = isUserGeminiPath(filePath);
    this.touches.push({ op, filePath, forbidden });
    if (forbidden) throw new GeminiHomeAccessError(filePath);
    return filePath;
  }

  get forbiddenAttempts(): number {
    return this.touches.filter((touch) => touch.forbidden).length;
  }

  installFsSpy(): () => void {
    const patched: Patched[] = [];
    const wrap = (owner: Record<string, unknown>, name: string): void => {
      const current = owner[name];
      if (typeof current !== "function") return;
      const original = current as FsFn;
      const guarded: FsFn = (...args) => {
        const text = pathText(args[0]);
        if (text !== null) this.inspect(text, name);
        return original.apply(owner, args);
      };
      owner[name] = guarded;
      patched.push({ owner, name, original });
    };
    const syncNames = [
      "readFileSync",
      "writeFileSync",
      "appendFileSync",
      "openSync",
      "accessSync",
      "statSync",
      "lstatSync",
      "readdirSync",
      "copyFileSync",
      "renameSync",
      "unlinkSync",
      "mkdirSync",
      "realpathSync",
      "rmSync",
    ];
    const asyncNames = [
      "readFile",
      "writeFile",
      "appendFile",
      "open",
      "access",
      "stat",
      "lstat",
      "readdir",
      "copyFile",
      "rename",
      "unlink",
      "mkdir",
      "realpath",
      "rm",
    ];
    const fsRecord = fs as unknown as Record<string, unknown>;
    const promises = fs.promises as unknown as Record<string, unknown>;
    for (const name of syncNames) wrap(fsRecord, name);
    for (const name of asyncNames) {
      wrap(fsRecord, name);
      wrap(promises, name);
    }
    return () => {
      for (const item of patched.reverse()) {
        item.owner[item.name] = item.original;
      }
    };
  }
}

const ENV_ALLOWLIST = [
  "PATH",
  "Path",
  "PATHEXT",
  "SYSTEMROOT",
  "SystemRoot",
  "COMSPEC",
  "WINDIR",
  "TEMP",
  "TMP",
  "USERPROFILE",
  "HOME",
  "HOMEDRIVE",
  "HOMEPATH",
  "LANG",
  "TERM",
  "PROCESSOR_ARCHITECTURE",
] as const;

export function buildIsolatedEnv(input: {
  readonly parent: NodeJS.ProcessEnv;
  readonly geminiCliHome: string;
  readonly apiKey: string | null;
  readonly extra: Readonly<Record<string, string>>;
  readonly loopbackProxy: string;
  readonly guard: GeminiHomeGuard;
}): NodeJS.ProcessEnv {
  input.guard.inspect(input.geminiCliHome, "env-home");
  const env: NodeJS.ProcessEnv = {};
  for (const key of ENV_ALLOWLIST) {
    const value = input.parent[key];
    if (typeof value !== "string") continue;
    if (isUserGeminiPath(value)) continue;
    env[key] = value;
  }
  env.GEMINI_CLI_HOME = input.geminiCliHome;
  env.HTTPS_PROXY = input.loopbackProxy;
  env.HTTP_PROXY = input.loopbackProxy;
  if (input.apiKey !== null) env.GEMINI_API_KEY = input.apiKey;
  for (const [key, value] of Object.entries(input.extra)) {
    input.guard.inspect(value, `env:${key}`);
    env[key] = value;
  }
  return env;
}
