import type { MachineCalibrationSnapshot, WhisperModelId } from "./types.js";

/**
 * Quantized GGML/GGUF choice from Task 118 calibration.
 * `medium` needs 4 GB of VRAM so desktop compositing keeps headroom.
 * Otherwise `small.en` when the GPU has 2 GB or the machine has 16 GB of RAM.
 * Everything smaller stays on `base.en`. RED pressure never reaches this helper.
 */
export function selectWhisperModel(snapshot: MachineCalibrationSnapshot): WhisperModelId {
  if (snapshot.gpuVramMb >= 4096) return "medium";
  if (snapshot.gpuVramMb >= 2048 || snapshot.totalRamMb >= 16_384) return "small.en";
  return "base.en";
}
