import { FaultInjectionFramework } from "../src/intelligence/fault-injector";
import { rmSync, existsSync } from "fs";
import { join } from "path";

console.log("==================================================");
console.log("💥 RUNNING MONTE CARLO FAULT INJECTION & CHAOS SUITE");
console.log("   (1,000 Injected Faults: Crashes, Disk Full, Torn WAL, Concurrency)");
console.log("==================================================\n");

const sandboxDir = join(process.cwd(), "temp-chaos-sandbox");
if (existsSync(sandboxDir)) {
  rmSync(sandboxDir, { recursive: true, force: true });
}

const framework = new FaultInjectionFramework(sandboxDir);

async function main() {
  const TOTAL_ITERATIONS = 1000;
  console.log(`Starting ${TOTAL_ITERATIONS} randomized chaos iterations...`);

  const summary = await framework.runMonteCarloSimulation(TOTAL_ITERATIONS);

  console.log("\n==================================================");
  console.log("🏁 CHAOS SUITE EXECUTION REPORT");
  console.log("==================================================");
  console.log(`Total Iterations Run       : ${summary.totalIterations}`);
  console.log(`Simulated Crashes Injected : ${summary.crashesInjected}`);
  console.log(`Disk I/O Errors Injected   : ${summary.ioErrorsInjected}`);
  console.log(`Torn WAL Writes Injected   : ${summary.tornWALsInjected}`);
  console.log(`Concurrency Racing Workers : ${summary.concurrencyRacesExecuted}`);
  console.log(`Crash Recoveries Succeeded : ${summary.recoverySuccessCount}`);
  console.log(`Invariant Violations       : ${summary.invariantViolations}`);
  console.log(`Total Execution Time       : ${summary.durationMs}ms (~${(summary.durationMs / 1000).toFixed(2)}s)`);
  console.log(`Throughput                 : ${Math.round((summary.totalIterations / (summary.durationMs / 1000)))} ops/sec`);
  console.log(`Status                     : ${summary.allInvariantsMaintained ? "✔ 100% INVARIANTS MAINTAINED (ZERO CORRUPTION)" : "✖ INVARIANTS VIOLATED"}`);
  console.log("==================================================\n");

  if (summary.details.length > 0) {
    console.error("Violations detected:", summary.details);
  }

  // Cleanup
  if (existsSync(sandboxDir)) {
    rmSync(sandboxDir, { recursive: true, force: true });
  }

  if (!summary.allInvariantsMaintained) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal chaos runner error:", err);
  if (existsSync(sandboxDir)) {
    rmSync(sandboxDir, { recursive: true, force: true });
  }
  process.exit(1);
});
