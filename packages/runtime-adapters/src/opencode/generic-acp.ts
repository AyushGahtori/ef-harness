import { GenericAcpAdapter } from "../acp/adapter.js";
import { OsWindowsJob } from "../acp/os-boundary.js";
import { ACP_RUNTIME_PROFILES } from "../acp/profiles.js";

/**
 * OpenCode ACP profile on `GenericAcpAdapter`.
 * Session frames for the pinned opencode permission rules stay on the local
 * JSON-RPC client; the job object is the same `OsWindowsJob` the ACP adapter uses.
 */
export class OpenCodeGenericAcp {
  readonly adapter: GenericAcpAdapter;

  constructor() {
    this.adapter = new GenericAcpAdapter({
      profile: ACP_RUNTIME_PROFILES["opencode-acp"],
      jobs: new OsWindowsJob(),
    });
  }
}
