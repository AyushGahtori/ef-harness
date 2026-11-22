export interface KeyChord {
  readonly key: string;
  readonly ctrl?: boolean;
  readonly shift?: boolean;
  readonly alt?: boolean;
  readonly target?: "list" | "secret-input" | "other-input";
}

export type InboxCommand =
  | { readonly type: "next" }
  | { readonly type: "previous" }
  | { readonly type: "select-option"; readonly number: number }
  | { readonly type: "submit" };

export function interpretInboxKey(chord: KeyChord): InboxCommand | null {
  if (chord.alt === true || chord.shift === true) return null;
  const key = chord.key.toLowerCase();
  const typing = chord.target === "secret-input" || chord.target === "other-input";
  if (chord.ctrl === true && key === "enter") return { type: "submit" };
  if (typing) return null;
  if (chord.ctrl === true) return null;
  if (key === "j") return { type: "next" };
  if (key === "k") return { type: "previous" };
  if (key >= "1" && key <= "4") return { type: "select-option", number: Number(key) };
  return null;
}
