import type { PreloadSecretIpc, VaultPutResult } from "./ports.js";
import { isLiveTestKey } from "./text.js";
import { LIVE_KEY_REFUSAL, type EnvScope } from "./types.js";

export interface SecretSaveResult {
  readonly ok: boolean;
  readonly secretId: string | null;
  readonly message: string | null;
}

/**
 * Secret text lives only in this buffer. The card view stores the length.
 * A successful vault save writes zeroes through the buffer and drops it.
 */
export class SecretInputBuffer {
  private codes: number[] = [];
  private zeroed = false;

  type(value: string): void {
    this.codes = [...value].map((char) => char.codePointAt(0) ?? 0);
    this.zeroed = false;
  }

  read(): string {
    return String.fromCodePoint(...this.codes);
  }

  length(): number {
    return this.codes.length;
  }

  wasZeroed(): boolean {
    return this.zeroed;
  }

  zero(): void {
    for (let index = 0; index < this.codes.length; index += 1) this.codes[index] = 0;
    this.codes = [];
    this.zeroed = true;
  }
}

export class SecretCardController {
  readonly buffer = new SecretInputBuffer();
  refusalMessage: string | null = null;
  saved = false;
  secretId: string | null = null;
  probeStatus: "idle" | "verified" | "failed" = "idle";
  reactValue = "";

  constructor(
    private readonly ipc: PreloadSecretIpc,
    private readonly input: {
      readonly projectId: string;
      readonly envScope: EnvScope;
      readonly name: string;
    },
  ) {}

  type(value: string): void {
    this.buffer.type(value);
    this.reactValue = value;
    this.saved = false;
  }

  reactState(): { readonly value: string; readonly length: number } {
    return { value: this.reactValue, length: this.reactValue.length };
  }

  wasZeroed(): boolean {
    return this.buffer.wasZeroed();
  }

  async save(): Promise<SecretSaveResult> {
    const value = this.buffer.read();
    let result: VaultPutResult;
    try {
      result = await this.ipc.put({
        projectId: this.input.projectId,
        envScope: this.input.envScope,
        name: this.input.name,
        value,
      });
    } catch {
      this.refusalMessage = "Could not reach the vault";
      return { ok: false, secretId: null, message: this.refusalMessage };
    }
    if (!result.ok) {
      this.refusalMessage = result.message;
      return { ok: false, secretId: null, message: result.message };
    }
    this.zeroReactState();
    this.saved = true;
    this.secretId = result.secretId;
    this.refusalMessage = null;
    return { ok: true, secretId: result.secretId, message: null };
  }

  async useMock(): Promise<void> {
    await this.ipc.useLocalMock(this.input.name);
    this.zeroReactState();
    this.saved = true;
    this.probeStatus = "verified";
    this.refusalMessage = null;
  }

  async testConnection(): Promise<void> {
    if (this.secretId === null) {
      this.probeStatus = "failed";
      return;
    }
    const result = await this.ipc.probe(this.secretId);
    this.probeStatus = result.ok ? "verified" : "failed";
  }

  inspectLiveKey(scope: EnvScope): boolean {
    return isLiveTestKey(this.buffer.read(), scope);
  }

  private zeroReactState(): void {
    this.buffer.zero();
    this.reactValue = "";
  }
}

export function refusalFor(value: string, scope: EnvScope): string | null {
  return isLiveTestKey(value, scope) ? LIVE_KEY_REFUSAL : null;
}
