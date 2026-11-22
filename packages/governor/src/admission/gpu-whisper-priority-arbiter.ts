import { WHISPER_VRAM_MB, type WhisperModelClass } from "./thresholds.js";

export interface LocalModelRequest {
  readonly id: string;
  readonly modelId: string;
  readonly vramMb: number;
  readonly role: "background" | "foreground";
  /** `queued` keeps the dispatch staged until pump. `now` starts immediately when allowed. */
  readonly start: "now" | "queued";
}

export interface LocalModelTicket {
  readonly id: string;
  readonly modelId: string;
  readonly vramMb: number;
  readonly role: "background" | "foreground";
  state: "queued" | "granted";
  reason: string;
}

export interface DictationGrant {
  readonly priority: "interactive";
  readonly device: "gpu" | "cpu";
  readonly reservedMb: number;
  readonly modelClass: WhisperModelClass;
  readonly ready: true;
}

/**
 * Interactive Whisper dictation outranks background local-model GPU work.
 * New Ollama / LM Studio dispatches stay queued until dictation finishes.
 * If VRAM cannot hold Whisper, dictation still starts, on CPU.
 */
export class GpuWhisperPriorityArbiter {
  private dictation: DictationGrant | null = null;
  private readonly running = new Map<string, LocalModelTicket>();
  private readonly waiting: LocalModelTicket[] = [];

  constructor(private readonly vramBudgetMb: number) {}

  get dictationActive(): boolean {
    return this.dictation !== null;
  }

  reservedForWhisperMb(): number {
    return this.dictation?.reservedMb ?? 0;
  }

  headroomMb(): number {
    let used = this.reservedForWhisperMb();
    for (const ticket of this.running.values()) used += ticket.vramMb;
    return Math.max(0, this.vramBudgetMb - used);
  }

  runningIds(): readonly string[] {
    return [...this.running.keys()];
  }

  queuedIds(): readonly string[] {
    return this.waiting.map((ticket) => ticket.id);
  }

  activateDictation(modelClass: WhisperModelClass = "base"): DictationGrant {
    const wanted = WHISPER_VRAM_MB[modelClass];
    let used = 0;
    for (const ticket of this.running.values()) used += ticket.vramMb;
    const device = this.vramBudgetMb - used >= wanted ? "gpu" : "cpu";
    const grant: DictationGrant = {
      priority: "interactive",
      device,
      reservedMb: device === "gpu" ? wanted : 0,
      modelClass,
      ready: true,
    };
    this.dictation = grant;
    return grant;
  }

  deactivateDictation(): readonly LocalModelTicket[] {
    this.dictation = null;
    return this.pump();
  }

  enqueueLocalModel(request: LocalModelRequest): LocalModelTicket {
    const existing =
      this.running.get(request.id) ?? this.waiting.find((ticket) => ticket.id === request.id);
    if (existing) throw new Error(`Local model id ${request.id} is already tracked`);
    const ticket: LocalModelTicket = {
      id: request.id,
      modelId: request.modelId,
      vramMb: request.vramMb,
      role: request.role,
      state: "queued",
      reason: "queued",
    };
    this.waiting.push(ticket);
    if (request.start === "now") this.pump();
    return ticket;
  }

  pump(): readonly LocalModelTicket[] {
    if (this.dictation) {
      for (const ticket of this.waiting) {
        ticket.reason = "deferred: whisper dictation holds interactive GPU priority";
      }
      return [];
    }
    const granted: LocalModelTicket[] = [];
    const remain: LocalModelTicket[] = [];
    for (const ticket of this.waiting) {
      if (ticket.vramMb <= this.headroomMb()) {
        ticket.state = "granted";
        ticket.reason = "granted";
        this.running.set(ticket.id, ticket);
        granted.push(ticket);
      } else {
        ticket.reason = "deferred: insufficient VRAM headroom";
        remain.push(ticket);
      }
    }
    this.waiting.length = 0;
    this.waiting.push(...remain);
    return granted;
  }

  releaseLocalModel(id: string): void {
    if (!this.running.delete(id)) {
      const index = this.waiting.findIndex((ticket) => ticket.id === id);
      if (index >= 0) this.waiting.splice(index, 1);
    }
  }
}
