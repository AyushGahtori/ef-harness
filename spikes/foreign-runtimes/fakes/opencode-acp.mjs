import { serveAcp } from "./acp-session.mjs";

serveAcp({
  name: "fake-opencode",
  version: "0.0.0",
  opencode: true,
}).catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
