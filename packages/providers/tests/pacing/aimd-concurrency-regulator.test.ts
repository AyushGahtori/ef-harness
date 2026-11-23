import { describe, expect, it } from "vitest";
import {
  AIMD_COOLDOWN_MS,
  AIMD_START_CWND,
  AimdConcurrencyRegulator,
  RETRY_AFTER_CAP_MS,
} from "../../src/pacing/index.js";

function regulator(caps: { connectionMaxCap?: number; hardwareCap?: number } = {}) {
  let now = 0;
  const aimd = new AimdConcurrencyRegulator({
    connectionMaxCap: caps.connectionMaxCap ?? 8,
    hardwareCap: caps.hardwareCap ?? 8,
    now: () => now,
    random: () => 0,
  });
  return {
    aimd,
    set(value: number) {
      now = value;
    },
    advance(delta: number) {
      now += delta;
    },
  };
}

describe("pacing AIMD concurrency regulator", () => {
  it("starts every connection at cwnd 2", () => {
    const { aimd } = regulator();
    expect(aimd.value).toBe(AIMD_START_CWND);
    expect(aimd.value).toBe(2);
    expect(aimd.cap).toBe(8);
  });

  it("adds 1 after 6 clean completions and not before", () => {
    const { aimd } = regulator();
    for (let index = 0; index < 5; index += 1) {
      expect(aimd.noteCleanCompletion().increased).toBe(false);
      expect(aimd.value).toBe(2);
    }
    expect(aimd.noteCleanCompletion()).toEqual({ increased: true, cwnd: 3 });
  });

  it("adds 1 after a 60s clean window with zero 429s", () => {
    const { aimd, set } = regulator();
    set(59_999);
    expect(aimd.pulse().increased).toBe(false);
    set(60_000);
    expect(aimd.pulse()).toEqual({ increased: true, cwnd: 3 });
    expect(aimd.pulse().increased).toBe(false);
  });

  it("caps cwnd at min(connectionMaxCap, hardwareCap)", () => {
    const { aimd } = regulator({ connectionMaxCap: 8, hardwareCap: 3 });
    expect(aimd.cap).toBe(3);
    for (let index = 0; index < 30; index += 1) aimd.noteCleanCompletion();
    expect(aimd.value).toBe(3);
  });

  it("halves with floor and never drops below 1 on a transient 429", () => {
    const { aimd } = regulator();
    for (let index = 0; index < 18; index += 1) aimd.noteCleanCompletion();
    expect(aimd.value).toBe(5);
    const halved = aimd.noteTransient429(15_000);
    expect(halved.cwnd).toBe(2);
    expect(aimd.value).toBe(2);
    aimd.noteTransient429(15_000);
    expect(aimd.value).toBe(1);
    aimd.noteTransient429(15_000);
    expect(aimd.value).toBe(1);
  });

  it("waits Retry-After plus jitter and holds additive increase for 60s", () => {
    const random = { value: 1 };
    let now = 0;
    const aimd = new AimdConcurrencyRegulator({
      connectionMaxCap: 8,
      hardwareCap: 8,
      now: () => now,
      random: () => random.value,
    });
    for (let index = 0; index < 6; index += 1) aimd.noteCleanCompletion();
    expect(aimd.value).toBe(3);
    const halved = aimd.noteTransient429(15_000);
    expect(halved.cwnd).toBe(1);
    expect(halved.waitMs).toBe(18_000);
    expect(halved.backoffUntilMs).toBe(18_000);
    expect(halved.cooldownUntilMs).toBe(AIMD_COOLDOWN_MS);
    now = 59_000;
    for (let index = 0; index < 6; index += 1) {
      expect(aimd.noteCleanCompletion().increased).toBe(false);
    }
    expect(aimd.value).toBe(1);
    now = AIMD_COOLDOWN_MS;
    expect(aimd.pulse().increased).toBe(false);
    for (let index = 0; index < 6; index += 1) aimd.noteCleanCompletion();
    expect(aimd.value).toBe(2);
  });

  it("caps a huge Retry-After before adding jitter", () => {
    const { aimd } = regulator();
    const halved = aimd.noteTransient429(1_000_000);
    expect(halved.waitMs).toBe(RETRY_AFTER_CAP_MS);
  });

  it("usage exhaustion sets cwnd to 0 and restart returns to 2", () => {
    const { aimd } = regulator();
    aimd.exhaust();
    expect(aimd.value).toBe(0);
    expect(aimd.noteCleanCompletion().cwnd).toBe(0);
    expect(aimd.noteTransient429(1_000).cwnd).toBe(0);
    aimd.restartAtStart();
    expect(aimd.value).toBe(2);
  });
});
