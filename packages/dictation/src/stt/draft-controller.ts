import {
  HINT_AFTER_MS,
  MIC_OFF_AFTER_MS,
  MIC_OFF_AFTER_SILENCE,
  PAUSED_LISTENING_HINT,
  SPEECH_RMS,
} from "./constants.js";
import { DictationError } from "./errors.js";
import { LowConfidenceCriticalSpanHighlighter } from "./highlighter.js";
import type { SingleComposerViewPort } from "./ports.js";
import { findRetractionPreviews } from "./retraction.js";
import { DictationStabilityStream } from "./stability-stream.js";
import { audioLevelFromRms, renderTokens, tokenKey } from "./text.js";
import type {
  HighlightSpan,
  HypothesisToken,
  KeyboardEdit,
  RetractionPreview,
  StabilityFrame,
  StableToken,
  VocabularyLookup,
} from "./types.js";

export interface DraftSnapshot {
  readonly confirmed: string;
  readonly tentative: string;
  readonly fullText: string;
  readonly cursor: number;
  readonly micOn: boolean;
  readonly hint: string | null;
  readonly status: string | null;
  readonly submitted: boolean;
  readonly autoSend: false;
  readonly audioLevel: number;
  readonly highlights: readonly HighlightSpan[];
  readonly retractions: readonly RetractionPreview[];
  readonly retractionPreviewEnabled: boolean;
  readonly segments: readonly StableToken[];
}

/**
 * Unsubmitted composer draft. Silence, pauses, and new ASR frames never submit.
 * A keyboard edit inside confirmed text is kept when later frames extend the tail.
 */
export class EditableDictationDraftController {
  private readonly stream = new DictationStabilityStream();
  private readonly highlighter: LowConfidenceCriticalSpanHighlighter;
  private listening = false;
  private confirmedText = "";
  private tentativeText = "";
  private asrConfirmed = "";
  private lastAsrFull = "";
  private manual: { display: string; asrBase: string } | null = null;
  private cursor = 0;
  private cursorPinned = false;
  private hint: string | null = null;
  private status: string | null = null;
  private submitted = false;
  private audioLevel = 0;
  private retractionPreviewEnabled: boolean;
  private highlights: readonly HighlightSpan[] = [];
  private retractions: readonly RetractionPreview[] = [];
  private suppressedRetractions = new Set<string>();
  private lastFrame: StabilityFrame | null = null;
  private silenceArmed = false;
  private hintTimer: ReturnType<typeof setTimeout> | null = null;
  private offTimer: ReturnType<typeof setTimeout> | null = null;
  private micOffListener: (() => void) | null = null;

  constructor(
    private readonly composer: SingleComposerViewPort,
    options?: {
      readonly vocabulary?: VocabularyLookup;
      readonly retractionPreview?: boolean;
    },
  ) {
    this.highlighter = new LowConfidenceCriticalSpanHighlighter(options?.vocabulary);
    this.retractionPreviewEnabled = options?.retractionPreview ?? true;
  }

  onSilenceMicOff(listener: () => void): void {
    this.micOffListener = listener;
  }

  isListening(): boolean {
    return this.listening;
  }

  setListening(on: boolean): void {
    if (on) {
      if (this.listening) return;
      this.listening = true;
      this.status = null;
      this.armSilence();
      this.publish();
      return;
    }
    if (!this.listening) return;
    this.listening = false;
    this.disarm();
    this.hint = null;
    this.publish();
  }

  failMic(message: string): void {
    this.listening = false;
    this.disarm();
    this.hint = null;
    this.status = message;
    this.publish();
  }

  noteAudioRms(rms: number): void {
    this.audioLevel = audioLevelFromRms(rms);
    if (!this.listening) {
      this.publish();
      return;
    }
    if (rms >= SPEECH_RMS) this.markSpeech();
    else this.armSilence();
    this.publish();
  }

  pushHypothesis(tokens: readonly HypothesisToken[]): void {
    if (!this.listening) return;
    if (tokens.some((token) => tokenKey(token.text).length > 0)) this.markSpeech();
    this.applyFrame(this.stream.ingest(tokens));
  }

  applyKeyboardEdit(edit: KeyboardEdit): void {
    const full = this.fullText();
    if (edit.start < 0 || edit.end < edit.start || edit.end > full.length) {
      throw new DictationError("edit", "Keyboard edit is outside the draft.");
    }
    const next = `${full.slice(0, edit.start)}${edit.insert}${full.slice(edit.end)}`;
    const confirmedLen = this.confirmedText.length;
    const touchedTentative = edit.start > confirmedLen || edit.end > confirmedLen;
    if (!touchedTentative) {
      const delta = edit.insert.length - (edit.end - edit.start);
      const newConfirmedLen = Math.max(0, confirmedLen + delta);
      this.confirmedText = next.slice(0, newConfirmedLen);
      const rest = next.slice(this.confirmedText.length);
      this.tentativeText = rest.startsWith(" ") ? rest.slice(1) : rest;
      this.manual = { display: this.confirmedText, asrBase: this.asrConfirmed };
    } else {
      this.confirmedText = next;
      this.tentativeText = "";
      this.manual = { display: next, asrBase: this.lastAsrFull };
    }
    this.cursor = edit.start + edit.insert.length;
    this.cursorPinned = true;
    this.dismissOverlappingRetractions(edit.start, edit.end);
    this.retractions = this.computeRetractions();
    this.highlights = this.lastFrame ? this.computeHighlights(this.lastFrame) : [];
    this.publish();
  }

  setRetractionPreviewEnabled(enabled: boolean): void {
    this.retractionPreviewEnabled = enabled;
    this.retractions = this.computeRetractions();
    this.publish();
  }

  submitFromUser(): void {
    this.submitted = true;
    this.composer.submitExplicit(this.fullText());
    this.publish();
  }

  snapshot(): DraftSnapshot {
    const frame = this.lastFrame;
    const segments = frame ? [...frame.confirmed, ...frame.tentative] : [];
    return {
      confirmed: this.confirmedText,
      tentative: this.tentativeText,
      fullText: this.fullText(),
      cursor: this.cursor,
      micOn: this.listening,
      hint: this.hint,
      status: this.status,
      submitted: this.submitted,
      autoSend: false,
      audioLevel: this.audioLevel,
      highlights: this.highlights,
      retractions: this.retractions,
      retractionPreviewEnabled: this.retractionPreviewEnabled,
      segments,
    };
  }

  private fullText(): string {
    if (this.confirmedText.length === 0) return this.tentativeText;
    if (this.tentativeText.length === 0) return this.confirmedText;
    return `${this.confirmedText} ${this.tentativeText}`;
  }

  private applyFrame(frame: StabilityFrame): void {
    const asrConfirmed = renderTokens(frame.confirmed);
    const asrTentative = renderTokens(frame.tentative);
    const previousCursor = this.cursor;
    const previousConfirmedLength = this.manual?.display.length ?? this.confirmedText.length;
    if (this.manual === null) {
      this.confirmedText = asrConfirmed;
      this.tentativeText = asrTentative;
    } else if (this.manual.asrBase.length > 0 && asrConfirmed.startsWith(this.manual.asrBase)) {
      const extension = asrConfirmed.slice(this.manual.asrBase.length);
      const display = `${this.manual.display}${extension}`;
      this.manual = { display, asrBase: asrConfirmed };
      this.confirmedText = display;
      this.tentativeText = asrTentative;
    } else {
      this.confirmedText = this.manual.display;
      this.tentativeText = asrTentative;
    }
    this.asrConfirmed = asrConfirmed;
    this.lastAsrFull = renderTokens([...frame.confirmed, ...frame.tentative]);
    this.lastFrame = frame;
    if (!this.cursorPinned) {
      this.cursor = this.fullText().length;
    } else if (previousCursor <= previousConfirmedLength) {
      this.cursor = previousCursor;
    } else {
      this.cursor = this.confirmedText.length;
    }
    this.highlights = this.computeHighlights(frame);
    this.retractions = this.computeRetractions();
    this.publish();
  }

  private computeHighlights(frame: StabilityFrame): readonly HighlightSpan[] {
    const asrTokens = [...frame.confirmed, ...frame.tentative];
    const asrText = renderTokens(asrTokens);
    if (asrText === this.fullText()) return this.highlighter.mark(asrTokens);
    const probabilities = new Map<string, number>();
    for (const token of asrTokens) {
      probabilities.set(tokenKey(token.text), token.probability);
    }
    const displayTokens: HypothesisToken[] = this.fullText()
      .split(" ")
      .filter((word) => word.length > 0)
      .map((text) => ({
        text,
        probability: probabilities.get(tokenKey(text)) ?? 1,
      }));
    return this.highlighter.mark(displayTokens);
  }

  private computeRetractions(): readonly RetractionPreview[] {
    if (!this.retractionPreviewEnabled) return [];
    return findRetractionPreviews(this.fullText()).filter((span) => !this.suppressedRetractions.has(span.id));
  }

  private dismissOverlappingRetractions(start: number, end: number): void {
    for (const span of this.retractions) {
      if (start < span.end && end > span.start) this.suppressedRetractions.add(span.id);
    }
  }

  private markSpeech(): void {
    if (!this.listening) return;
    const clearHint = this.hint === PAUSED_LISTENING_HINT;
    this.disarm();
    if (clearHint) this.hint = null;
    this.armSilence();
  }

  private armSilence(): void {
    if (!this.listening || this.silenceArmed) return;
    this.silenceArmed = true;
    this.hintTimer = setTimeout(() => {
      this.hintTimer = null;
      if (!this.listening) return;
      this.hint = PAUSED_LISTENING_HINT;
      this.publish();
    }, HINT_AFTER_MS);
    this.offTimer = setTimeout(() => {
      this.offTimer = null;
      this.silenceArmed = false;
      if (!this.listening) return;
      this.listening = false;
      this.hint = null;
      this.status = MIC_OFF_AFTER_SILENCE;
      if (this.hintTimer !== null) {
        clearTimeout(this.hintTimer);
        this.hintTimer = null;
      }
      this.micOffListener?.();
      this.publish();
    }, MIC_OFF_AFTER_MS);
  }

  private disarm(): void {
    if (this.hintTimer !== null) clearTimeout(this.hintTimer);
    if (this.offTimer !== null) clearTimeout(this.offTimer);
    this.hintTimer = null;
    this.offTimer = null;
    this.silenceArmed = false;
  }

  private publish(): void {
    this.composer.applyDictationDraft({
      confirmed: this.confirmedText,
      tentative: this.tentativeText,
      cursor: this.cursor,
      hint: this.hint,
      status: this.status,
    });
  }
}
