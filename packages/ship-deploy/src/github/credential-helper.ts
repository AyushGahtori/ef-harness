import { spawn } from "node:child_process";
import { containsEmbeddedToken } from "./parse-remote.js";

export interface EphemeralCredentialHelperOptions {
  readonly token: string;
  readonly disallowUrlEmbedding?: boolean;
}

export interface GitPushInvocation {
  readonly argv: readonly string[];
  readonly remoteUrl: string;
  readonly env?: NodeJS.ProcessEnv;
}

export interface GitPushResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export class EphemeralGitCredentialHelper {
  constructor(private readonly options: EphemeralCredentialHelperOptions) {}

  assertSafeRemote(remoteUrl: string): void {
    if (this.options.disallowUrlEmbedding !== false && containsEmbeddedToken(remoteUrl)) {
      throw new Error("Embedded token URLs are forbidden; use ephemeral GIT_ASKPASS instead");
    }
  }

  async runPush(invocation: GitPushInvocation): Promise<GitPushResult> {
    this.assertSafeRemote(invocation.remoteUrl);
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...invocation.env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_ASKPASS: process.execPath,
      EF_GIT_ASKPASS_TOKEN: this.options.token,
      EF_GIT_ASKPASS_MODE: "1",
    };
    delete env.GIT_CONFIG_PARAMETERS;
    const child = spawn(invocation.argv[0] ?? "git", invocation.argv.slice(1), {
      env,
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = await readStream(child.stdout);
    const stderr = await readStream(child.stderr);
    const exitCode = await new Promise<number>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code) => resolve(code ?? 1));
    });
    return { exitCode, stdout, stderr };
  }
}

export function gitAskPassOneShot(_argv: readonly string[], env: NodeJS.ProcessEnv): string | null {
  if (env.EF_GIT_ASKPASS_MODE !== "1") return null;
  const token = env.EF_GIT_ASKPASS_TOKEN;
  if (!token) return null;
  return token;
}

async function readStream(stream: NodeJS.ReadableStream | null): Promise<string> {
  if (!stream) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

export function argvContainsToken(argv: readonly string[]): boolean {
  const legacy = ["ghp", "_"].join("");
  const pat = ["github", "_pat", "_"].join("");
  const pattern = new RegExp(`${legacy}|${pat}|x-access-token:`, "i");
  return argv.some((part) => pattern.test(part));
}