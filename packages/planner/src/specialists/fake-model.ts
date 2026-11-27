import type { ModelCall, SpecialistModel, SpecialistRole } from "./types.js";

export class UnscriptedModelError extends Error {
  constructor(role: SpecialistRole) {
    super(`no scripted ${role} output`);
    this.name = "UnscriptedModelError";
  }
}

interface ScriptedTurn {
  readonly role: SpecialistRole;
  readonly body: unknown;
}

/**
 * Deterministic in-memory model. Tests enqueue outputs. Nothing is sent over the network.
 */
export class FakeModelAdapter implements SpecialistModel {
  readonly calls: ModelCall[] = [];
  private readonly queue: ScriptedTurn[] = [];

  enqueue(role: SpecialistRole, body: unknown): this {
    this.queue.push({ role, body });
    return this;
  }

  complete(call: ModelCall): unknown {
    this.calls.push(call);
    const index = this.queue.findIndex((turn) => turn.role === call.role);
    if (index < 0) throw new UnscriptedModelError(call.role);
    const [turn] = this.queue.splice(index, 1);
    return turn?.body;
  }
}
