import { createHash } from "node:crypto";

export function normalizeCommandText(command: string): string {
  return command.replaceAll("\\", "/").replace(/\s+/g, " ").trim().toLowerCase();
}

export function normalizeFailureText(input: string): string {
  let text = input.normalize("NFC").replaceAll("\r\n", "\n").replaceAll("\\", "/");
  text = text.replace(
    /\d{4}-\d{2}-\d{2}[tT ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g,
    "<time>",
  );
  text = text.replace(/\b\d{2}:\d{2}:\d{2}(?:\.\d+)?\b/g, "<time>");
  text = text.replace(/\b\d+(?:\.\d+)?\s*(?:ms|us|µs|ns)\b/gi, "<dur>");
  text = text.replace(/\b\d+(?:\.\d+)?\s*s\b/gi, "<dur>");
  text = text.replace(/\b(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):\d{2,5}\b/gi, (match) =>
    match.replace(/:\d{2,5}$/, ":<port>"),
  );
  text = text.replace(/\bport\s+\d{2,5}\b/gi, "port <port>");
  text = text.replace(/\bpid[:=\s]+\d+\b/gi, "pid <pid>");
  text = text.replace(/\b0x[0-9a-f]+\b/gi, "0x<addr>");
  text = text.replace(/[ \t]+\n/g, "\n").replace(/[ \t]{2,}/g, " ");
  const lines = text.split("\n").map((line) => line.trimEnd());
  const tail = lines.length > 200 ? lines.slice(-200) : lines;
  return tail.join("\n").trim();
}

export function computeFailureFingerprint(input: {
  readonly exitCode: number;
  readonly commandText: string;
  readonly output: string;
  readonly timedOut?: boolean;
  readonly outputLimitExceeded?: boolean;
}): string {
  const payload = [
    "v1",
    String(input.exitCode),
    input.timedOut === true ? "timed_out" : "finished",
    input.outputLimitExceeded === true ? "output_limit" : "output_ok",
    normalizeCommandText(input.commandText),
    normalizeFailureText(input.output),
  ].join("\n");
  return createHash("sha256").update(payload).digest("hex");
}
