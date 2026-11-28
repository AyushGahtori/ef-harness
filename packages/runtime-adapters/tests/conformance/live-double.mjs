import readline from "node:readline";

const input = readline.createInterface({ input: process.stdin });
input.on("line", (line) => {
  const message = JSON.parse(line);
  const body = { id: message.id, ok: true };
  if (message.op === "probe") {
    process.stdout.write(`${JSON.stringify({ ...body, version: "2.0.0" })}\n`);
    return;
  }
  if (message.op === "auth") {
    process.stdout.write(`${JSON.stringify({ ...body, signedIn: true })}\n`);
    return;
  }
  if (message.op === "usage") {
    process.stdout.write(
      `${JSON.stringify({ ...body, inputTokens: 8, outputTokens: 3, note: "session-secret-value-151" })}\n`,
    );
    return;
  }
  process.stdout.write(`${JSON.stringify(body)}\n`);
});
