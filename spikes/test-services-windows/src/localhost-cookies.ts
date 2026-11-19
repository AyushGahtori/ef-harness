import { createRequire } from "node:module";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { LOOPBACK_HOST } from "./constants.ts";
import { SpikeError } from "./errors.ts";
import { reserveLoopbackPort } from "./ports.ts";

const execFileAsync = promisify(execFile);

export interface LocalhostCookieReport {
  env1ResolvedToLoopback: boolean;
  env2ResolvedToLoopback: boolean;
  env1RemoteAddresses: string[];
  env2RemoteAddresses: string[];
  env1CookieVisibleOnEnv1: boolean;
  env1CookieVisibleOnEnv2: boolean;
  isolated: boolean;
}

interface Page {
  goto(url: string): Promise<unknown>;
  evaluate<T>(fn: () => T): Promise<T>;
}

interface BrowserContext {
  newPage(): Promise<Page>;
}

interface Browser {
  newContext(): Promise<BrowserContext>;
  close(): Promise<void>;
}

export async function probeLocalhostCookieIsolation(): Promise<LocalhostCookieReport> {
  const reserved = await reserveLoopbackPort();
  await reserved.unhold();
  const seen: Array<{ host: string; remote: string }> = [];
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    seen.push({ host: request.headers.host ?? "", remote: request.socket.remoteAddress ?? "" });
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("ok");
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(reserved.port, LOOPBACK_HOST, () => resolve());
  });
  const browser = await launchChromium();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const env1 = `http://env1.localhost:${reserved.port}/`;
    const env2 = `http://env2.localhost:${reserved.port}/`;
    await page.goto(env1);
    await page.evaluate(() => {
      document.cookie = "sid=from-env1; path=/";
    });
    const env1Cookie = await page.evaluate(() => document.cookie);
    await page.goto(env2);
    const env2Cookie = await page.evaluate(() => document.cookie);
    const env1Remotes = seen.filter((hit) => hit.host.startsWith("env1.localhost")).map((hit) => hit.remote);
    const env2Remotes = seen.filter((hit) => hit.host.startsWith("env2.localhost")).map((hit) => hit.remote);
    const env1ResolvedToLoopback = env1Remotes.some((remote) => remote.endsWith("127.0.0.1"));
    const env2ResolvedToLoopback = env2Remotes.some((remote) => remote.endsWith("127.0.0.1"));
    const env1CookieVisibleOnEnv1 = env1Cookie.includes("sid=from-env1");
    const env1CookieVisibleOnEnv2 = env2Cookie.includes("sid=");
    return {
      env1ResolvedToLoopback,
      env2ResolvedToLoopback,
      env1RemoteAddresses: env1Remotes,
      env2RemoteAddresses: env2Remotes,
      env1CookieVisibleOnEnv1,
      env1CookieVisibleOnEnv2,
      isolated: env1ResolvedToLoopback && env2ResolvedToLoopback && env1CookieVisibleOnEnv1 && !env1CookieVisibleOnEnv2,
    };
  } finally {
    await browser.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await reserved.release();
  }
}

async function launchChromium(): Promise<Browser> {
  const root = repoRoot();
  const require = createRequire(path.join(root, "package.json"));
  const playwright = require("playwright") as { chromium: { launch(options: { headless: boolean }): Promise<Browser> } };
  try {
    return await playwright.chromium.launch({ headless: true });
  } catch (error) {
    const cli = path.join(root, "node_modules", "playwright", "cli.js");
    if (!existsSync(cli)) throw error;
    await execFileAsync(process.execPath, [cli, "install", "chromium"], { cwd: root, windowsHide: true });
    return playwright.chromium.launch({ headless: true });
  }
}

function repoRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  while (true) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new SpikeError("repo_root", "Could not find the workspace root.");
    dir = parent;
  }
}
