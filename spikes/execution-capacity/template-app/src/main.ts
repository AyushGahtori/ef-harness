import { banner } from "./format.ts";

export function describeCapacity(thinking: number, execution: number): string {
  return `${banner(thinking)}; execution ${execution}`;
}
