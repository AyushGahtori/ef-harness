import { serveAcp } from "./acp-session.mjs";

serveAcp({
  name: "fake-gemini",
  version: "0.0.0",
  authMethods: [],
}).catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
