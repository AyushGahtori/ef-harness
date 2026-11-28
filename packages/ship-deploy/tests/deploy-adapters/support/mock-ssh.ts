import type { SshExecRequest, SshExecResult, SshTransportPort } from "../../../src/deploy-adapters/contracts.js";

export interface MockSshCall {
  readonly command: string;
  readonly stdin?: string;
}

export class MockSshTransport implements SshTransportPort {
  readonly calls: MockSshCall[] = [];
  private readonly healthByContainer = new Map<string, string>();
  private digests = "[]";

  constructor(
    readonly host: string,
    readonly fingerprint: string,
  ) {}

  setHealth(container: string, status: string): void {
    this.healthByContainer.set(container, status);
  }

  setDigests(json: string): void {
    this.digests = json;
  }

  async exec(request: SshExecRequest): Promise<SshExecResult> {
    this.calls.push({ command: request.command, stdin: request.stdin });
    if (request.command.includes("docker info")) {
      return { exitCode: 0, stdout: "26.1.0", stderr: "" };
    }
    if (request.command.startsWith("cat ")) {
      return { exitCode: 0, stdout: this.digests, stderr: "" };
    }
    if (request.command.includes("docker inspect")) {
      const container = request.command
        .replace(/^docker inspect --format='\{\{\.State\.Health\.Status\}\}'\s+/, "")
        .trim();
      return {
        exitCode: 0,
        stdout: this.healthByContainer.get(container) ?? "healthy",
        stderr: "",
      };
    }
  if (request.command.includes("docker compose")) {
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    if (request.command.includes("docker run")) {
      const nameMatch = /--name ([\w-]+)/.exec(request.command);
      const container = nameMatch?.[1] ?? "ctr";
      if (!this.healthByContainer.has(container)) {
        this.healthByContainer.set(container, "healthy");
      }
      return { exitCode: 0, stdout: container, stderr: "" };
    }
    if (request.command.includes("docker ps")) {
      return { exitCode: 0, stdout: "app-abc123", stderr: "" };
    }
    if (request.command.startsWith("install -m 600")) {
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    return { exitCode: 0, stdout: "", stderr: "" };
  }

  argvSecretLeaks(): string[] {
    return this.calls
      .map((item) => item.command)
      .filter((command) => /\s-e\s+\w+=\S/.test(command) || /--env\s+\w+=\S/.test(command));
  }
}