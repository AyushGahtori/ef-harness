import { describe, expect, it } from "vitest";
import { resolveConnection } from "../../src/office/cast/index.js";

describe("connection desk pins", () => {
  it("pairs provider color with distinct icon shape", () => {
    const chatgpt = resolveConnection("ChatGPT Plus");
    const ollama = resolveConnection("Ollama Local");
    expect(chatgpt.shape).toBe("leaf");
    expect(chatgpt.color).toBe("emerald");
    expect(ollama.shape).toBe("hex");
    expect(ollama.color).toBe("slate");
    expect(chatgpt.shape).not.toBe(ollama.shape);
    expect(chatgpt.label).toBe("ChatGPT");
    expect(ollama.label).toBe("Ollama Local");
  });
});