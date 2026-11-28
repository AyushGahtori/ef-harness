import {
  InMemoryAudioCapture,
  InMemoryGpuWhisperPriorityArbiter,
  InMemoryMachineCalibration,
  InMemorySignedComponentDownloader,
  InMemorySingleComposer,
  InMemoryWindowsJobSupervisor,
  LocalWhisperSttEngine,
  MemoryVocabulary,
  ScriptedOsSpeechRecognizer,
  ScriptedWhisperDecoder,
  blockedWhisperComponent,
  readyWhisperComponent,
} from "../../src/stt/index.js";
import type {
  HypothesisToken,
  MachineCalibrationSnapshot,
  WhisperComponentStatus,
} from "../../src/stt/index.js";

export interface SessionOptions {
  readonly calibration?: MachineCalibrationSnapshot;
  readonly component?: WhisperComponentStatus;
  readonly targetKey?: string;
  readonly vocabulary?: readonly string[];
}

export function speechPcm(length = 320): Int16Array {
  const samples = new Int16Array(length);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = index % 2 === 0 ? 12_000 : -12_000;
  }
  return samples;
}

export function silencePcm(length = 320): Int16Array {
  return new Int16Array(length);
}

export function words(
  text: string,
  probability = 0.96,
): HypothesisToken[] {
  return text
    .split(" ")
    .filter((word) => word.length > 0)
    .map((word) => ({ text: word, probability }));
}

export function createSession(options: SessionOptions = {}) {
  const calibration = new InMemoryMachineCalibration(
    options.calibration ?? { totalRamMb: 32_768, gpuVramMb: 8_192, pressure: "Green" },
  );
  const gpu = new InMemoryGpuWhisperPriorityArbiter();
  const components = new InMemorySignedComponentDownloader(options.component ?? readyWhisperComponent());
  const jobs = new InMemoryWindowsJobSupervisor();
  const decoder = new ScriptedWhisperDecoder();
  const speech = new ScriptedOsSpeechRecognizer();
  const composer = new InMemorySingleComposer(options.targetKey ?? "question:Q-41");
  const capture = new InMemoryAudioCapture();
  const engine = new LocalWhisperSttEngine(
    { jobs, gpu, components, calibration, decoder, capture, composer, speech },
    options.vocabulary === undefined ? {} : { vocabulary: new MemoryVocabulary(options.vocabulary) },
  );
  return { engine, calibration, gpu, components, jobs, decoder, speech, composer, capture };
}

export function blocked(reason: "not_downloaded" | "quarantined" | "hash_mismatch") {
  return blockedWhisperComponent(reason);
}
