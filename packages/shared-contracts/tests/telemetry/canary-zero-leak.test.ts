import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createHarnessTelemetry } from "../../src/telemetry/create.js";
import { SecretRedactor } from "../../src/telemetry/redactor.js";
import { RotatingJsonlSink } from "../../src/telemetry/sink.js";
import { LocalTracer } from "../../src/telemetry/tracer.js";
import { StructuredLogger } from "../../src/telemetry/logger.js";
import { repeatAlphabet, secretForms, tempDir } from "./helpers.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("canary zero leak", () => {
  it("keeps generated secrets out of jsonl logs and span attributes in every encoding", () => {
    const directory = tempDir("canary");
    directories.push(directory);
    const redactor = new SecretRedactor();
    const secrets = Array.from({ length: 8 }, (_unused, index) => generatedSecret(index));
    for (const [index, secret] of secrets.entries()) {
      redactor.register(`CANARY_${index}`, secret);
    }
    const logSink = new RotatingJsonlSink({
      directory,
      redactor,
      clock: () => new Date("2026-05-01T00:00:00.000Z"),
    });
    const traceDirectory = path.join(directory, "traces");
    const traceSink = new RotatingJsonlSink({
      directory: traceDirectory,
      prefix: "efharness-trace",
      redactor,
      clock: () => new Date("2026-05-01T00:00:00.000Z"),
    });
    const tracer = new LocalTracer({ redactor, sink: traceSink });
    const logger = new StructuredLogger({
      component: "harnessd",
      sink: logSink,
      redactor,
      tracer,
      level: "debug",
    });

    for (const secret of secrets) {
      const forms = secretForms(secret);
      const error = new Error(`failed ${secret}`);
      error.stack = `Error: failed ${secret}\n    at run (file.js:1:1)`;
      error.cause = new Error(forms[1] ?? secret);
      logger.info("canary", { secret, forms, error });
      const stream = redactor.openStream();
      const streamed = stream.push(secret.slice(0, 20)) + stream.push(secret.slice(20)) + stream.flush();
      expect(streamed).not.toContain(secret);
      const span = tracer.startModelCall({
        taskId: "T1",
        attemptId: "A1",
        cost: 1,
        outcome: secret,
        attributes: { blob: forms.join(" ") },
      });
      span.recordException(error);
      span.end("error");
    }
    logger.flush();
    tracer.close();
    traceSink.close();
    logSink.close();

    const dumped = readTree(directory);
    for (const secret of secrets) {
      for (const form of secretForms(secret)) {
        expect(dumped).not.toContain(form);
      }
    }
    expect(dumped).toContain("[REDACTED:CANARY_0]");
    expect(dumped).toContain("\"taskId\":\"T1\"");
    expect(dumped).toContain("\"attemptId\":\"A1\"");
  });

  it("wires the factory onto local files with no network client in the telemetry sources", () => {
    const directory = tempDir("factory");
    directories.push(directory);
    const secret = "FactorySecretValue";
    const telemetry = createHarnessTelemetry({
      component: "harnessd",
      directory,
      level: "debug",
    });
    telemetry.redactor.register("FACTORY", secret);
    telemetry.tracer.startTransaction("tx").run(() => {
      telemetry.logger.info(`hello ${secret}`, { secret });
    });
    telemetry.close();
    const dumped = readTree(directory);
    expect(dumped).not.toContain(secret);
    expect(dumped).toContain("[REDACTED:FACTORY]");
    expect(dumped).toContain("\"component\":\"harnessd\"");

    const sourceDir = path.resolve(import.meta.dirname, "../../src/telemetry");
    const banned = ["node:http", "node:https", "node:net", "node:dns", "node:tls", "undici"];
    for (const name of fs.readdirSync(sourceDir)) {
      if (!name.endsWith(".ts")) continue;
      const text = fs.readFileSync(path.join(sourceDir, name), "utf8");
      for (const spec of banned) {
        expect(text.includes(`"${spec}"`) || text.includes(`'${spec}'`)).toBe(false);
      }
      expect(text.includes("fetch(")).toBe(false);
    }
  });
});

function generatedSecret(index: number): string {
  return `v${index}/${repeatAlphabet(24, "aB3xQ9mN7pL2wR8k")}+${index}=`;
}

function readTree(directory: string): string {
  if (!fs.existsSync(directory)) return "";
  const parts: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) parts.push(readTree(full));
    else if (entry.isFile()) parts.push(fs.readFileSync(full, "utf8"));
  }
  return parts.join("");
}
