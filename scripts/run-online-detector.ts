import { runOnlineMetalDetector } from "../lib/scarcity-detector-runner";
import { onlineDetectorSummary } from "../lib/scarcity/online-detector";

async function main() {
  const result = await runOnlineMetalDetector();
  console.log(JSON.stringify({ run: result.run, summary: onlineDetectorSummary(result.state) }, null, 2));
  if (result.run.status === "failed") process.exitCode = 1;
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
