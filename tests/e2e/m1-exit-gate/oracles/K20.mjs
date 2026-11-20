export function kitchenErrorBanner(body) {
  if (!body || typeof body !== "object" || !body.error || typeof body.error.message !== "string" || body.error.message.length === 0) {
    throw new Error("X-11 banner requires error.message");
  }
  return { role: "alert", text: body.error.message };
}
