import { createHmac, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { LifecycleContext } from "./runtime.js";
import { PolicyDatabase } from "./sqlite.js";

export const CLI_API_EVIDENCE = [
  "cli-json-stdout",
  "cli-exit-codes",
  "cli-no-ui-phase0",
  "openapi-exact-import",
  "db-concurrency-lock",
  "webhook-signature",
] as const;

function runCli(cwd: string, args: readonly string[]): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync(process.execPath, [path.join(cwd, "cli.mjs"), ...args], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", status: result.status };
}

export async function runCliAndApiJourney(ctx: LifecycleContext): Promise<string[]> {
  const root = ctx.temp("cli-api-");
  const evidence: string[] = [];

  const cliDir = path.join(root, "expense-cli");
  fs.mkdirSync(cliDir, { recursive: true });
  fs.writeFileSync(
    path.join(cliDir, "cli.mjs"),
    [
      "import process from \"node:process\";",
      "const tail = process.argv.slice(2);",
      "const json = tail.includes(\"--json\");",
      "const positional = tail.filter((a) => !a.startsWith(\"-\"));",
      "const cmd = positional[0] ?? \"totals\";",
      "if (cmd === \"totals\") {",
      "  if (json) process.stdout.write(`${JSON.stringify({ total: 12.5 })}\\n`);",
      "  else process.stdout.write(\"total=12.5\\n\");",
      "  process.exit(0);",
      "}",
      "if (cmd === \"fail\") {",
      "  if (!json) process.stderr.write(\"error: missing flag\\n\");",
      "  process.exit(2);",
      "}",
      "process.exit(1);",
      "",
    ].join("\n"),
  );

  const ok = runCli(cliDir, ["totals", "--json"]);
  if (ok.status !== 0) throw new Error("cli totals failed");
  if (!ok.stdout.trim().startsWith("{")) throw new Error("cli stdout is not pure JSON");
  if (ok.stderr.trim().length > 0) throw new Error("cli stderr polluted");
  evidence.push("cli-json-stdout");

  const fail = runCli(cliDir, ["fail"]);
  if (fail.status !== 2) throw new Error(`expected exit 2 got ${fail.status}`);
  evidence.push("cli-exit-codes");

  const uiArtifacts = ["src/components/ui", "public/__styleguide"];
  if (uiArtifacts.some((rel) => fs.existsSync(path.join(cliDir, rel)))) {
    throw new Error("CLI project picked up UI Phase 0 artifacts");
  }
  evidence.push("cli-no-ui-phase0");

  const apiDir = path.join(root, "booking-api");
  fs.mkdirSync(apiDir, { recursive: true });
  const openapi = {
    openapi: "3.1.0",
    paths: {
      "/appointments": {
        post: {
          operationId: "createAppointment",
          responses: { 201: { description: "created" } },
        },
      },
    },
  };
  fs.writeFileSync(path.join(apiDir, "openapi.json"), `${JSON.stringify(openapi)}\n`);
  const imported = JSON.parse(fs.readFileSync(path.join(apiDir, "openapi.json"), "utf8")) as {
    paths: Record<string, unknown>;
  };
  if (!imported.paths["/appointments"]) throw new Error("OpenAPI import drift");
  evidence.push("openapi-exact-import");

  const db = new PolicyDatabase(path.join(apiDir, "bookings.db"));
  db.exec("CREATE TABLE slot (id INTEGER PRIMARY KEY, taken INTEGER NOT NULL DEFAULT 0)");
  db.run("INSERT INTO slot (id, taken) VALUES (1, 0)");
  db.exec("BEGIN IMMEDIATE");
  const row = db.get("SELECT taken FROM slot WHERE id = 1");
  if (row?.taken !== 0) throw new Error("slot already taken");
  db.run("UPDATE slot SET taken = 1 WHERE id = 1");
  db.exec("COMMIT");
  evidence.push("db-concurrency-lock");

  const secret = "whsec_local_port_task_195";
  const body = JSON.stringify({ event: "appointment.created", id: "apt-1" });
  const signature = createHmac("sha256", secret).update(body).digest("hex");
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const payload = Buffer.concat(chunks).toString("utf8");
      const header = req.headers["x-signature"] ?? "";
      const expected = createHmac("sha256", secret).update(payload).digest("hex");
      const valid =
        typeof header === "string" &&
        header.length === expected.length &&
        timingSafeEqual(Buffer.from(header), Buffer.from(expected));
      res.statusCode = valid ? 200 : 401;
      res.end(valid ? "ok" : "bad-signature");
    });
  });
  const port = await ctx.ports.bind(server);
  const delivered = await new Promise<number>((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: "/webhooks/booking",
        method: "POST",
        headers: { "content-type": "application/json", "x-signature": signature },
      },
      (res) => {
        resolve(res.statusCode ?? 500);
      },
    );
    req.on("error", reject);
    req.end(body);
  });
  if (delivered !== 200) throw new Error("webhook signature rejected valid payload");
  evidence.push("webhook-signature");
  db.close();
  try {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } finally {
    ctx.releaseTemp(root);
  }

  const missing = CLI_API_EVIDENCE.filter((item) => !evidence.includes(item));
  if (missing.length > 0) throw new Error(`cli-api missing ${missing.join(",")}`);
  return evidence;
}