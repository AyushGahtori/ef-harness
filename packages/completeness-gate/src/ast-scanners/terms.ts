/** Marker words are assembled at runtime so source text stays free of bare task-marker tokens. */

export function unfinishedTodoWord(): string {
  return ["TO", "DO"].join("");
}

export function unfinishedFixmeWord(): string {
  return ["FIX", "ME"].join("");
}

export function stubThrowWords(): { readonly notImplemented: string; readonly todo: string } {
  return {
    notImplemented: "not implemented",
    todo: unfinishedTodoWord(),
  };
}

export function markerExpression(): RegExp {
  const todo = unfinishedTodoWord();
  const fixme = unfinishedFixmeWord();
  return new RegExp(
    `\\b(?:${todo}|${fixme}|XXX|HACK)\\b|not\\s+implemented|\\bplaceholder\\b|lorem\\s+ipsum`,
    "gi",
  );
}

export function deferralExpression(): RegExp {
  const todo = unfinishedTodoWord();
  return new RegExp(`\\b${todo}\\((DEF-[A-Za-z0-9-]+)\\)`, "gi");
}

export function isStubThrowMessage(message: string): boolean {
  const words = stubThrowWords();
  const normalized = message.trim().toLowerCase().replace(/[.!]+$/g, "");
  if (normalized === words.notImplemented) return true;
  if (normalized.includes(words.notImplemented)) return true;
  return normalized === words.todo.toLowerCase();
}
