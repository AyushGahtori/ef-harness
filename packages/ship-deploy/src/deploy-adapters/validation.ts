import { ShellPathRejectedError } from "./errors.js";

export const SHELL_SAFE_PATTERN = /^[a-zA-Z0-9._:/-]+$/;

export function assertShellSafeSegment(value: string, label: string): void {
  if (!SHELL_SAFE_PATTERN.test(value)) {
    throw new ShellPathRejectedError(`${label}=${value}`);
  }
}

export function assertNoArgvSecretFlag(command: string): void {
  if (/\s-e\s+\w+=\S/.test(command) || /--env\s+\w+=\S/.test(command)) {
    throw new Error("argv_secret");
  }
}