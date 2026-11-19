import type { ProcessInspection } from "./types.js";

export type AliveProcess = Extract<ProcessInspection, { status: "alive" }>;

export type IdentityVerdict =
  | { readonly verdict: "match"; readonly live: AliveProcess }
  | { readonly verdict: "pid_reused"; readonly live: AliveProcess; readonly detail: string }
  | { readonly verdict: "exited"; readonly detail: string }
  | { readonly verdict: "unverified"; readonly detail: string };

export class ProcessIdentityVerifier {
  constructor(
    private readonly inspect: (pid: number) => ProcessInspection | Promise<ProcessInspection>,
  ) {}

  async verify(pid: number, startTime: number): Promise<IdentityVerdict> {
    const live = await this.inspect(pid);
    if (live.status === "not_found") {
      return { verdict: "exited", detail: "process is not running" };
    }
    if (live.status === "unverified") {
      return { verdict: "unverified", detail: live.detail };
    }
    if (live.startTime !== startTime) {
      const image = live.imagePath ?? "unknown";
      return {
        verdict: "pid_reused",
        live,
        detail: `live start_time ${live.startTime} image ${image}`,
      };
    }
    return { verdict: "match", live };
  }
}
