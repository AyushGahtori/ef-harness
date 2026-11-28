import { DOWNLOAD_LOCAL_WHISPER, OS_DICTATION_BADGE } from "./constants.js";
import type { OsSpeechRecognizerPort } from "./ports.js";
import type { HypothesisToken } from "./types.js";

/**
 * Windows speech / Web Speech path used when whisper.cpp is missing, quarantined,
 * or the machine is in RED memory pressure. The mic stays usable.
 */
export class OsFallbackDictationBridge {
  readonly badge = OS_DICTATION_BADGE;
  readonly downloadOffer = DOWNLOAD_LOCAL_WHISPER;
  active = false;

  constructor(private readonly speech: OsSpeechRecognizerPort) {}

  start(): void {
    this.speech.start();
    this.active = true;
  }

  stop(): void {
    if (!this.active) return;
    this.speech.stop();
    this.active = false;
  }

  transcribe(samples: Int16Array): readonly HypothesisToken[] {
    if (!this.active) return [];
    return this.speech.transcribe(samples);
  }
}
