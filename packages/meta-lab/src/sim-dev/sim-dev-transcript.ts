import type { SimDevTranscriptEntry } from "./types.js";

export class SimDevTranscriptRecorder {
  private turn = 0;
  private readonly entries: SimDevTranscriptEntry[] = [];

  record(
    triggerEvent: string,
    responseText: string,
    actionTaken: string,
    elapsedMs: number,
    personaTokens = 0,
  ): SimDevTranscriptEntry {
    this.turn += 1;
    const entry: SimDevTranscriptEntry = {
      turnSeq: this.turn,
      triggerEvent,
      responseText,
      actionTaken,
      elapsedMs,
      personaTokens,
    };
    this.entries.push(entry);
    return entry;
  }

  snapshot(): readonly SimDevTranscriptEntry[] {
    return [...this.entries];
  }
}