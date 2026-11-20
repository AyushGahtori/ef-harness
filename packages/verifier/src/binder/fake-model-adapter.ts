import type { BinderWrite } from "./types.js";

/** One scripted blind-binder@1 turn. `output` is the closed JSON result; the adapter file is separate. */
export interface ScriptedBinderTurn {
  output: unknown;
  adapterSource?: string;
  writes?: readonly BinderWrite[];
}

export interface BinderModelAdapter {
  complete(prompt: string): ScriptedBinderTurn | Promise<ScriptedBinderTurn>;
}

/**
 * Local stand-in for a model protocol adapter.
 * Tests script valid, malicious, and defective binder outputs. No network calls.
 */
export class FakeModelAdapter implements BinderModelAdapter {
  readonly prompts: string[] = [];
  private index = 0;

  constructor(private readonly script: readonly ScriptedBinderTurn[]) {}

  complete(prompt: string): ScriptedBinderTurn {
    this.prompts.push(prompt);
    const turn = this.script[this.index];
    if (!turn) {
      throw new Error("FakeModelAdapter script exhausted");
    }
    this.index += 1;
    return turn;
  }

  get calls(): number {
    return this.prompts.length;
  }
}
