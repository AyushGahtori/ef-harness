import type { HarnessDaemon } from "./daemon-server.js";

export function installShutdownSignals(daemon: HarnessDaemon): void {
  let stopping = false;
  const stop = (reason: string) => {
    if (stopping) return;
    stopping = true;
    void daemon.shutdown(reason).then(
      () => {
        process.exit(0);
      },
      () => {
        process.exit(1);
      },
    );
  };
  process.on("SIGINT", () => stop("signal"));
  process.on("SIGBREAK", () => stop("signal"));
  process.on("SIGTERM", () => stop("signal"));
}
