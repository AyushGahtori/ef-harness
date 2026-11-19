import { serveAcp } from "./acp-session.mjs";

serveAcp({ name: "fake-copilot", version: "0.0.0" }).catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
