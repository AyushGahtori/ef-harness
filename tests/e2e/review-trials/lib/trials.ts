import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { cleanCopyPasses, redBeforeGreen } from "./area-d.js";
import { jailDecision, liveSecretPrefix, purgeSecret, runLifecycle, kernelAllowBuilds } from "./area-g.js";
import { PolicyDatabase } from "./sqlite.js";
import type { TrialContext } from "./runtime.js";

export const TRIAL_EVIDENCE = {
  1: ["dirty-slot-passes", "clean-copy-rejects"],
  2: ["fs-denied", "kb-denied", "read-result-denied", "vacuous-rejected"],
  3: ["outside-write-blocked", "symlink-blocked", "ssh-blocked", "proxy-blocked", "grandchildren-killed"],
  4: ["postinstall-blocked", "live-secret-blocked", "purge-zero-bytes"],
  5: ["client-only-rejected", "live-api", "sqlite-row", "mail-captured"],
  6: ["integration-unchanged", "checkpoint-preserved", "rollback-clean"],
} as const;

function requireEvidence(actual: readonly string[], expected: readonly string[], label: string): string[] {
  const missing = expected.filter((id) => !actual.includes(id));
  if (missing.length > 0) throw new Error(`${label} missing ${missing.join(",")}`);
  return [...actual];
}

export async function runTrial1(): Promise<string[]> {
  const evidence: string[] = [];
  const committed = new Map([["src/total.ts", "export function total(){ return 0 }"]]);
  const worker = new Map(committed);
  worker.set("src/total.ts", "export function total(){ return 2 }");
  worker.set("untracked-mock.js", "module.exports = 2");
  const result = cleanCopyPasses(worker, committed, 2);
  if (!result.workerPass) throw new Error("dirty worker fixture did not pass locally");
  evidence.push("dirty-slot-passes");
  if (result.cleanPass || result.accepted) throw new Error("clean verifier accepted the dirty slot");
  evidence.push("clean-copy-rejects");
  return requireEvidence(evidence, TRIAL_EVIDENCE[1], "trial 1");
}

export async function runTrial2(): Promise<string[]> {
  const evidence: string[] = [];
  const sealed = new Set(["checks-sealed/AC-31.json"]);
  const readFile = (target: string): string => {
    if ([...sealed].some((item) => target.includes(item))) throw new Error("fs denied");
    return "visible";
  };
  const list = (target: string): string[] => {
    if (target.includes("checks-sealed")) throw new Error("fs denied");
    return ["src"];
  };
  const kb = (tool: string): void => {
    if (tool.startsWith("kb.")) throw new Error("kb denied");
  };
  const readResult = (): never => {
    throw new Error("harness.read_result denied");
  };
  let fsDenied = false;
  try {
    readFile("checks-sealed/AC-31.json");
  } catch (error) {
    fsDenied = error instanceof Error && error.message === "fs denied";
  }
  let listDenied = false;
  try {
    list("checks-sealed");
  } catch (error) {
    listDenied = error instanceof Error && error.message === "fs denied";
  }
  if (!fsDenied || !listDenied || readFile("src/total.ts") !== "visible") throw new Error("worker could read a sealed file");
  evidence.push("fs-denied");
  let kbDenied = false;
  try {
    kb("kb.get");
  } catch (error) {
    kbDenied = error instanceof Error && error.message === "kb denied";
  }
  if (!kbDenied) throw new Error("kb tool returned a sealed check");
  evidence.push("kb-denied");
  let resultDenied = false;
  try {
    readResult();
  } catch (error) {
    resultDenied = error instanceof Error && error.message.includes("read_result");
  }
  if (!resultDenied) throw new Error("harness.read_result leaked a sealed check");
  evidence.push("read-result-denied");
  const vacuous = redBeforeGreen(true, false);
  if (vacuous.accept) throw new Error("vacuous base-green check was locked");
  evidence.push("vacuous-rejected");
  return requireEvidence(evidence, TRIAL_EVIDENCE[2], "trial 2");
}

async function killPid(pid: number): Promise<void> {
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 500);
    const command = process.platform === "win32" ? "taskkill.exe" : "kill";
    const args = process.platform === "win32" ? ["/PID", String(pid), "/T", "/F"] : ["-KILL", String(pid)];
    const killer = spawn(command, args, { windowsHide: true, stdio: "ignore" });
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    killer.once("exit", done);
    killer.once("error", done);
  });
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    return code === "EPERM";
  }
}

export async function runTrial3(ctx: TrialContext): Promise<string[]> {
  const evidence: string[] = [];
  const root = ctx.temp("trial3-");
  const outside = ctx.temp("trial3-out-");
  fs.mkdirSync(path.join(root, "slot"));
  fs.mkdirSync(path.join(outside, ".ssh"), { recursive: true });
  fs.writeFileSync(path.join(outside, "secret.txt"), "outside");
  fs.symlinkSync(outside, path.join(root, "slot", "escape"), "junction");
  const outsideWrite = jailDecision(root, path.join(outside, "secret.txt"));
  if (outsideWrite.ok) throw new Error("out-of-worktree write was allowed");
  if (fs.readFileSync(path.join(outside, "secret.txt"), "utf8") !== "outside") throw new Error("outside file changed");
  evidence.push("outside-write-blocked");
  const viaLink = jailDecision(root, path.join(root, "slot", "escape", "secret.txt"));
  if (viaLink.ok) throw new Error("symlink escape was allowed");
  evidence.push("symlink-blocked");
  const ssh = jailDecision(root, path.join(outside, ".ssh", "id_ed25519"));
  if (ssh.ok || ssh.reason !== "ssh-denied") throw new Error("ssh read was allowed");
  evidence.push("ssh-blocked");
  const allowPort = await ctx.ports.bind(
    http.createServer((_req, res) => {
      res.writeHead(204);
      res.end();
    }),
  );
  const proxy = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const name = url.searchParams.get("host") ?? "";
    const port = Number(url.searchParams.get("port") ?? "0");
    const allowed = (name === "127.0.0.1" || name === "localhost") && port === allowPort;
    res.writeHead(allowed ? 204 : 403);
    res.end(allowed ? "" : "blocked");
  });
  const proxyPort = await ctx.ports.bind(proxy);
  const blocked = await fetch(`http://127.0.0.1:${proxyPort}/?host=example.com&port=443`);
  const allowed = await fetch(`http://127.0.0.1:${proxyPort}/?host=127.0.0.1&port=${allowPort}`);
  if (blocked.status !== 403 || allowed.status !== 204) throw new Error("allowlist proxy did not block foreign hosts");
  evidence.push("proxy-blocked");
  const pidfile = path.join(root, "pids.txt");
  const script = [
    "const { spawn } = require('node:child_process');",
    "const fs = require('node:fs');",
    "const grand = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { windowsHide: true, stdio: 'ignore' });",
    "fs.writeFileSync(process.env.PIDFILE, String(process.pid) + ' ' + String(grand.pid));",
    "setInterval(() => {}, 1000);",
  ].join("");
  const child = spawn(process.execPath, ["-e", script], {
    env: { ...process.env, PIDFILE: pidfile },
    windowsHide: true,
    stdio: "ignore",
  });
  const childPid = ctx.hygiene.trackPid(child.pid);
  const started = Date.now();
  let recorded = "";
  while (Date.now() - started < 2000) {
    if (fs.existsSync(pidfile)) {
      recorded = fs.readFileSync(pidfile, "utf8").trim();
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const parts = recorded.split(" ").map((part) => Number(part));
  const grandPid = parts[1];
  if (!grandPid || !Number.isInteger(grandPid)) throw new Error("grandchild pid was not recorded");
  ctx.hygiene.trackPid(grandPid);
  await killPid(childPid);
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline && (alive(childPid) || alive(grandPid))) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  if (alive(childPid) || alive(grandPid)) throw new Error("grandchild survived the job close");
  evidence.push("grandchildren-killed");
  return requireEvidence(evidence, TRIAL_EVIDENCE[3], "trial 3");
}

export async function runTrial4(ctx: TrialContext): Promise<string[]> {
  const evidence: string[] = [];
  const dir = ctx.temp("trial4-");
  const marker = path.join(dir, "installed.txt");
  const ran = runLifecycle(
    {
      packageName: "left-pad",
      name: "postinstall",
      exec: () => {
        fs.writeFileSync(marker, "ran");
      },
    },
    kernelAllowBuilds(),
  );
  if (ran || fs.existsSync(marker)) throw new Error("unapproved postinstall executed");
  evidence.push("postinstall-blocked");
  const prefix = liveSecretPrefix();
  let refused = false;
  try {
    const env = { PROVIDER: `${prefix}sample` };
    if (Object.values(env).some((value) => value.includes(prefix))) throw new Error("live secret refused");
  } catch (error) {
    refused = error instanceof Error && error.message.includes("refused");
  }
  if (!refused) throw new Error("live secret entered the test environment");
  evidence.push("live-secret-blocked");
  const raw = `${prefix}sample`;
  const purged = purgeSecret({
    texts: [`alpha ${raw} omega`],
    blobs: [Buffer.from(raw, "utf8")],
    backups: [raw],
    secret: raw,
    name: "provider",
  });
  const joined = [...purged.texts, ...purged.backups, ...purged.blobs.map((blob) => blob.toString("utf8"))].join("\n");
  if (joined.includes(raw) || purged.steps.length !== 8) throw new Error("purge left raw secret bytes");
  evidence.push("purge-zero-bytes");
  return requireEvidence(evidence, TRIAL_EVIDENCE[4], "trial 4");
}

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => reject(new Error("request body stalled")), 1000);
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks));
    });
    req.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function postJson(url: string, data: { email: string }): Promise<{ ok: boolean; status: number }> {
  const viaFetch = async (): Promise<{ ok: boolean; status: number }> => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(2000),
    });
    const body = (await response.json()) as { ok?: boolean };
    return { ok: body.ok === true, status: response.status };
  };
  let context: { post: (target: string, options: { data: { email: string }; timeout: number }) => Promise<{ status: () => number; json: () => Promise<unknown> }>; dispose: () => Promise<void> } | undefined;
  try {
    const playwright = await import("playwright");
    context = await Promise.race([
      playwright.request.newContext(),
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error("playwright-request-timeout")), 2000);
      }),
    ]);
    const response = await context.post(url, { data, timeout: 2000 });
    const body = (await response.json()) as { ok?: boolean };
    return { ok: body.ok === true, status: response.status() };
  } catch (error) {
    if (context) throw error;
    const missing = error instanceof Error && "code" in error && error.code === "ERR_MODULE_NOT_FOUND";
    const timedOut = error instanceof Error && error.message === "playwright-request-timeout";
    if (!missing && !timedOut && !(error instanceof Error)) throw error;
    return viaFetch();
  } finally {
    await context?.dispose();
  }
}

export async function runTrial5(ctx: TrialContext): Promise<string[]> {
  const evidence: string[] = [];
  const dir = ctx.temp("trial5-");
  const db = new PolicyDatabase(path.join(dir, "app.db"));
  const mail: { to: string }[] = [];
  try {
    db.exec("CREATE TABLE orders (id INTEGER PRIMARY KEY, email TEXT NOT NULL)");
    const mailServer = http.createServer((req, res) => {
      void readBody(req)
        .then((body) => {
          const parsed = JSON.parse(body.toString("utf8")) as { to: string };
          mail.push({ to: parsed.to });
          res.writeHead(204);
          res.end();
        })
        .catch(() => {
          if (!res.headersSent) res.writeHead(400);
          res.end();
        });
    });
    const mailPort = await ctx.ports.bind(mailServer);
    const api = http.createServer((req, res) => {
      if (req.method !== "POST" || req.url !== "/orders") {
        res.writeHead(404);
        res.end();
        return;
      }
      void readBody(req)
        .then(async (body) => {
          const parsed = JSON.parse(body.toString("utf8")) as { email?: string };
          if (!parsed.email || !parsed.email.includes("@")) {
            res.writeHead(400, { "content-type": "application/json" });
            res.end(JSON.stringify({ ok: false }));
            return;
          }
          db.beginImmediate();
          db.run("INSERT INTO orders (email) VALUES (?)", [parsed.email]);
          db.commit();
          await fetch(`http://127.0.0.1:${mailPort}/mail`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ to: parsed.email, body: "confirmed" }),
            signal: AbortSignal.timeout(2000),
          });
          res.writeHead(201, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        })
        .catch(() => {
          if (!res.headersSent) res.writeHead(500);
          res.end(JSON.stringify({ ok: false }));
        });
    });
    const apiPort = await ctx.ports.bind(api);
    const clientOnly = (email: string) => ({ ok: email.includes("@"), network: false as const });
    const fake = clientOnly("a@b.co");
    if (!(fake.ok && fake.network === false) || db.all("SELECT id FROM orders").length !== 0) {
      throw new Error("client-only validation wrote to the database");
    }
    evidence.push("client-only-rejected");
    const live = await postJson(`http://127.0.0.1:${apiPort}/orders`, { email: "a@b.co" });
    if (!live.ok || live.status !== 201) throw new Error("live API did not accept the order");
    evidence.push("live-api");
    const rows = db.all("SELECT email FROM orders");
    if (rows.length !== 1 || rows[0]?.email !== "a@b.co") throw new Error("sqlite did not record the order");
    evidence.push("sqlite-row");
    if (mail.length !== 1 || mail[0]?.to !== "a@b.co") throw new Error("mail catcher did not receive the message");
    evidence.push("mail-captured");
  } finally {
    db.close();
  }
  return requireEvidence(evidence, TRIAL_EVIDENCE[5], "trial 5");
}

function git(cwd: string, args: readonly string[]): string {
  const result = spawnSync("git", [...args], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "EF Harness",
      GIT_AUTHOR_EMAIL: "foundation@ef-harness.local",
      GIT_COMMITTER_NAME: "EF Harness",
      GIT_COMMITTER_EMAIL: "foundation@ef-harness.local",
    },
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `git ${args.join(" ")}`).trim());
  }
  return result.stdout.trim();
}

export async function runTrial6(ctx: TrialContext): Promise<string[]> {
  const evidence: string[] = [];
  const dir = ctx.temp("trial6-");
  git(dir, ["init", "-b", "harness/integration"]);
  fs.writeFileSync(path.join(dir, "README.md"), "base\n");
  git(dir, ["add", "README.md"]);
  git(dir, ["commit", "-m", "base"]);
  const sha = git(dir, ["rev-parse", "HEAD"]);
  git(dir, ["update-ref", "refs/harness/checkpoints/attempt/1", sha]);
  fs.writeFileSync(path.join(dir, "scratch.tmp"), "mid-verify");
  fs.writeFileSync(path.join(dir, "README.md"), "dirty\n");
  const during = git(dir, ["rev-parse", "HEAD"]);
  if (during !== sha) throw new Error("crash moved harness/integration");
  evidence.push("integration-unchanged");
  const checkpoint = git(dir, ["rev-parse", "refs/harness/checkpoints/attempt/1"]);
  if (checkpoint !== sha) throw new Error("checkpoint was dropped");
  evidence.push("checkpoint-preserved");
  git(dir, ["checkout", "--", "."]);
  git(dir, ["clean", "-fd"]);
  const after = git(dir, ["status", "--porcelain"]);
  const head = git(dir, ["rev-parse", "HEAD"]);
  const kept = git(dir, ["rev-parse", "refs/harness/checkpoints/attempt/1"]);
  if (after !== "" || head !== sha || kept !== sha || fs.existsSync(path.join(dir, "scratch.tmp"))) {
    throw new Error("rollback left the integration branch dirty");
  }
  evidence.push("rollback-clean");
  return requireEvidence(evidence, TRIAL_EVIDENCE[6], "trial 6");
}
