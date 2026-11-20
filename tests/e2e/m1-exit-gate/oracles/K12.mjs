export function toErrorBody(code, message, field) {
  if (typeof code !== "string" || code.length === 0 || typeof message !== "string" || message.length === 0) {
    throw new Error("X-11 requires a code and a message");
  }
  const error = { code, message };
  if (field !== undefined) error.field = field;
  return { error };
}
