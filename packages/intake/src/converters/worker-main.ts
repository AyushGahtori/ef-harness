import { installZeroNetworkGuard } from "./zero-network-guard.js";

installZeroNetworkGuard();

const { runWorker } = await import("./worker-run.js");
await runWorker();
