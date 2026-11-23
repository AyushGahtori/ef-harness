import { PerformanceAndScaleCertifier } from "./certifier.ts";

async function main(): Promise<void> {
  const certifier = new PerformanceAndScaleCertifier();
  const result = await certifier.runAll();
  process.stdout.write(result.markdown);
  process.stdout.write("\n");
  process.stdout.write(`${JSON.stringify(result.scorecard, null, 2)}\n`);
  process.exit(result.exitCode);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});