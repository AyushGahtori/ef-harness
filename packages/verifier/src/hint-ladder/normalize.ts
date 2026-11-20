import { HintLadderError } from "./errors.js";
import {
  FAILURE_TYPES,
  MODEL_LEVELS,
  type FailureType,
  type ModelLevel,
} from "./types.js";

export function normalizeFailureType(value: string): FailureType {
  const compact = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const aliases: Readonly<Record<string, FailureType>> = {
    wrongvalue: "wrong_value",
    missingitem: "missing_item",
    extraitem: "extra_item",
    wrongorder: "wrong_order",
  };
  const normalized = aliases[compact] ?? compact;
  if (isFailureType(normalized)) return normalized;
  throw new HintLadderError(`unknown failure type ${value}`);
}

export function parseModelLevel(value: string): ModelLevel {
  if (isModelLevel(value)) return value;
  throw new HintLadderError(`unknown model level ${value}`);
}

export function nextModelLevel(level: ModelLevel): ModelLevel | null {
  const index = MODEL_LEVELS.indexOf(level);
  if (index < 0 || index + 1 >= MODEL_LEVELS.length) return null;
  return MODEL_LEVELS[index + 1] ?? null;
}

function isFailureType(value: string): value is FailureType {
  return (FAILURE_TYPES as readonly string[]).includes(value);
}

function isModelLevel(value: string): value is ModelLevel {
  return (MODEL_LEVELS as readonly string[]).includes(value);
}
