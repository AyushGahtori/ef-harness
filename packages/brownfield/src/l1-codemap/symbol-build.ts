import type { ExtractedSymbol } from "./types.js";

export function buildSymbol(
  input: Pick<ExtractedSymbol, "name" | "kind" | "line" | "exported"> & { signature?: string },
): ExtractedSymbol {
  const { signature, ...rest } = input;
  return signature ? { ...rest, signature } : rest;
}