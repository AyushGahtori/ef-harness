import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

export interface HardwareGovernorSink {
  reportConsumer(sample: {
    readonly name: "wsl2_vm";
    readonly memoryBytes: number;
    readonly recommendedCapMb: number;
    readonly editedWslConfig: false;
    readonly advice: string;
  }): void;
}

export interface WslMemoryAdvice {
  readonly counted: true;
  readonly consumer: "wsl2_vm";
  readonly memoryBytes: number;
  readonly usageKnown: boolean;
  readonly recommendedCapMb: number;
  readonly editedWslConfig: false;
  readonly advice: string;
  readonly observedConfig: string | null;
}

export function parseWslConfigMemory(text: string | null): string | null {
  if (!text) return null;
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*memory\s*=\s*(\S+)\s*$/i.exec(line);
    if (match?.[1]) return match[1];
  }
  return null;
}

export function adviseWslMemory(input: {
  readonly totalMemoryBytes: number;
  readonly vmmemBytes: number | null;
  readonly wslConfigText: string | null;
}): WslMemoryAdvice {
  const recommendedCapMb = Math.max(512, Math.floor(input.totalMemoryBytes / 2 / (1024 * 1024)));
  const current = parseWslConfigMemory(input.wslConfigText);
  const advice = current
    ? `WSL2 is one Hardware Governor consumer. Existing .wslconfig memory=${current}. A cap around ${recommendedCapMb} MB is recommended. The harness does not edit .wslconfig.`
    : `WSL2 is one Hardware Governor consumer. Recommend a .wslconfig memory cap of ${recommendedCapMb} MB. The harness does not edit .wslconfig.`;
  return {
    counted: true,
    consumer: "wsl2_vm",
    memoryBytes: input.vmmemBytes ?? 0,
    usageKnown: input.vmmemBytes !== null,
    recommendedCapMb,
    editedWslConfig: false,
    advice,
    observedConfig: current,
  };
}

export async function readUserWslConfig(env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  const profile = env.USERPROFILE ?? env.HOME;
  if (!profile) return null;
  try {
    return await fs.readFile(path.join(profile, ".wslconfig"), "utf8");
  } catch {
    return null;
  }
}

export async function reportWslMemory(
  governor: HardwareGovernorSink,
  readConfig: () => Promise<string | null> = () => readUserWslConfig(),
  measureVm: () => Promise<number | null> = async () => null,
): Promise<WslMemoryAdvice> {
  const advice = adviseWslMemory({
    totalMemoryBytes: os.totalmem(),
    vmmemBytes: await measureVm(),
    wslConfigText: await readConfig(),
  });
  governor.reportConsumer({
    name: "wsl2_vm",
    memoryBytes: advice.memoryBytes,
    recommendedCapMb: advice.recommendedCapMb,
    editedWslConfig: false,
    advice: advice.advice,
  });
  return advice;
}
