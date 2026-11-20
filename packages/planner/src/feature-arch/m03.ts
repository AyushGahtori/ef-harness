import { LOCAL_PORTS } from "./types.js";

/** Local port of the M03 screen-state matrix from Task 079. */
export const M03_SOURCE = LOCAL_PORTS.m03ScreenStates;

export const M03_ALWAYS_STATES = [
  "empty",
  "loading",
  "populated",
  "error",
  "validation_error",
  "unauthorized",
  "offline/slow",
] as const;

export const M03_TAGGED_STATES = ["print"] as const;

export const M03_STATES = [...M03_ALWAYS_STATES, ...M03_TAGGED_STATES] as const;

export type M03State = (typeof M03_STATES)[number];

export function isM03State(value: string): value is M03State {
  return (M03_STATES as readonly string[]).includes(value);
}

export function requiredScreenStates(tags: readonly string[]): string[] {
  const required: string[] = [...M03_ALWAYS_STATES];
  if (tags.includes("print")) required.push("print");
  return required;
}
