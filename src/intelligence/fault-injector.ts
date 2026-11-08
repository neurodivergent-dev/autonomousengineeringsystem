import {
  TransactionalWorkspaceEngine,
  type FaultInjectionConfig,
  type FaultInjectionPoint,
} from "./transactional-workspace";
import { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync, readdirSync, appendFileSync } from "fs";
import { join } from "path";

export interface ChaosIterationResult {
  iteration: number;
  scenario: string;
  injectedFault?: FaultInjectionConfig;
  success: boolean;
  recovered: boolean;
  invariantsPassed: boolean;
  error?: string;
}

export interface ChaosSuiteSummary {
  totalIterations: number;
  crashesInjected: number;
  ioErrorsInjected: number;
  tornWALsInjected: number;
  concurrencyRacesExecuted: number;
  recoverySuccessCount: number;
  invariantViolations: number;
  durationMs: number;
  allInvariantsMaintained: boolean;
  details: string[];
}

/**
 * FaultInjectionFramework (Chaos Monkey for MetaFrame Transactional Engine)
 * Runs randomized Monte Carlo simulations injecting process crashes, disk I/O errors,
 * WAL corruptions, and concurrent write collisions to verify enterprise invariants.
 */
export class FaultInjectionFramework {
  private sandboxDir: string;
  private engine: TransactionalWorkspaceEngine;

  constructor(sandboxDir: string) {
    this.sandboxDir = sandboxDir;
    if (!existsSync(this.sandboxDir)) {
      mkdirSync(this.sandboxDir, { recursive: true });
    }
    this.engine = new TransactionalWorkspaceEngine(this.sandboxDir);
  }

  /**
   * Initializes baseline files in the sandbox
   */
  public initBaseline(fileMap: Record<string, string>): void {
    for (const [relPath, content] of Object.entries(fileMap)) {
      const full = join(this.sandboxDir, relPath);
      writeFileSync(full, content, "utf-8");
    }
  }

  /**
   * Reads current sandbox file state
   */
  public captureDiskState(): Record<string, string> {
    const state: Record<string, string> = {};
    const scan = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (entry === ".metaframe" || entry === "node_modules" || entry === ".git") continue;
        const full = join(dir, entry);
        if (existsSync(full)) {
          const stat = require("fs").statSync(full);
          if (stat.isDirectory()) {
            scan(full);
          } else {
            const rel = full.replace(this.sandboxDir, "").replace(/^[\\/]/, "").replace(/\\/g, "/");
            state[rel] = readFileSync(full, "utf-8");
          }
        }
      }
    };
    scan(this.sandboxDir);
    return state;
  }

  /**
   * Invariant Verifier: Verifies that either all files of a transaction are applied,
   * or all files remain at pre-transaction baseline (All-or-Nothing Atomicity).
   */
  public verifyAtomicityInvariant(
    preState: Record<string, string>,
    postState: Record<string, string>,
    targetChanges: Record<string, string>
  ): { valid: boolean; reason?: string } {
    const files = Object.keys(targetChanges);
    let allPre = true;
    let allPost = true;

    for (const f of files) {
      const current = postState[f];
      const pre = preState[f];
      const target = targetChanges[f];

      if (current !== pre) allPre = false;
      if (current !== target) allPost = false;
    }

    if (!allPre && !allPost) {
      return {
        valid: false,
        reason: `Atomicity Invariant Violated! Mixed partial state detected on files: ${files.join(", ")}`,
      };
    }

    return { valid: true };
  }

  /**
   * Runs an individual chaos iteration
   */
  public async runChaosIteration(i: number, faultType: string): Promise<ChaosIterationResult> {
    const fileA = `file_${(i % 5) + 1}.ts`;
    const fileB = `file_${((i + 1) % 5) + 1}.ts`;

    const preState = this.captureDiskState();

    const changes = {
      [fileA]: `// Iteration ${i}\nexport const ValA = ${i * 10};`,
      [fileB]: `// Iteration ${i}\nexport const ValB = ${i * 20};`,
    };

    let faultConfig: FaultInjectionConfig | undefined;
    let expectedCrash = false;

    if (faultType === "CRASH_MID_COMMIT") {
      faultConfig = { point: "DURING_FILE_WRITE", fileIndex: 1, errorType: "CRASH" };
      expectedCrash = true;
    } else if (faultType === "CRASH_AFTER_PREPARE") {
      faultConfig = { point: "AFTER_PREPARE" };
      expectedCrash = true;
    } else if (faultType === "CRASH_BEFORE_COMMIT") {
      faultConfig = { point: "BEFORE_COMMIT" };
      expectedCrash = true;
    } else if (faultType === "IO_DISK_FULL") {
      faultConfig = { point: "DURING_FILE_WRITE", fileIndex: 0, errorType: "ENOSPC" };
      expectedCrash = false; // Graceful rollback expected
    } else if (faultType === "CORRUPT_WAL") {
      faultConfig = { point: "CORRUPT_WAL_ON_PREPARE" };
      expectedCrash = true;
    }

    let txnError: string | undefined;

    try {
      await this.engine.executeTransaction({
        author: "ai-agent",
        description: `Chaos Run ${i} - ${faultType}`,
        changes,
        skipBehavioralCheck: true,
        fault: faultConfig,
      });
    } catch (err: any) {
      txnError = err.message;
    }

    // If a crash was simulated, run crash recovery
    let recovered = false;
    if (expectedCrash) {
      const recovery = this.engine.recoverCrash();
      recovered = recovery.recoveredCount > 0 || faultType === "CORRUPT_WAL";

      // Idempotency check: A second recovery run should do 0 changes
      const secondRecovery = this.engine.recoverCrash();
      if (secondRecovery.recoveredCount !== 0) {
        return {
          iteration: i,
          scenario: faultType,
          injectedFault: faultConfig,
          success: false,
          recovered: false,
          invariantsPassed: false,
          error: "Idempotent Recovery Invariant Failed: Second recovery run made additional changes!",
        };
      }
    }

    const postState = this.captureDiskState();
    const atomicity = this.verifyAtomicityInvariant(preState, postState, changes);

    return {
      iteration: i,
      scenario: faultType,
      injectedFault: faultConfig,
      success: !expectedCrash && !txnError,
      recovered: expectedCrash ? recovered : true,
      invariantsPassed: atomicity.valid,
      error: atomicity.valid ? undefined : atomicity.reason,
    };
  }

  /**
   * Executes a high-concurrency race condition test (simultaneous writes from multiple actors)
   */
  public async runConcurrencyHammer(workersCount: number = 30): Promise<{
    workersRun: number;
    committed: number;
    abortedByConflict: number;
    invariantsPassed: boolean;
  }> {
    const sharedFile = "concurrent_target.ts";
    const initialContent = `export const initial = 0;`;
    writeFileSync(join(this.sandboxDir, sharedFile), initialContent, "utf-8");
    const baseHash = this.engine.hash(initialContent);

    let committed = 0;
    let abortedByConflict = 0;

    // Launch workers in parallel
    const promises = Array.from({ length: workersCount }).map(async (_, idx) => {
      const res = await this.engine.executeTransaction({
        author: idx % 2 === 0 ? "user" : "ai-agent",
        description: `Worker ${idx} save`,
        changes: { [sharedFile]: `export const count = ${idx + 1};` },
        expectedBaseHashes: { [sharedFile]: baseHash }, // All racing on same base
        skipBehavioralCheck: true,
      });

      if (res.success) committed++;
      else if (res.status === "ABORTED") abortedByConflict++;
    });

    await Promise.all(promises);

    // INVARIANT: Exactly 1 worker should commit successfully; all other racing workers must be aborted with conflicts!
    const invariantsPassed = committed === 1 && abortedByConflict === workersCount - 1;

    return {
      workersRun: workersCount,
      committed,
      abortedByConflict,
      invariantsPassed,
    };
  }

  /**
   * Runs Monte Carlo Chaos Simulation over N iterations
   */
  public async runMonteCarloSimulation(iterations: number = 1000): Promise<ChaosSuiteSummary> {
    const startTime = Date.now();

    // Initialize baseline files
    for (let f = 1; f <= 5; f++) {
      writeFileSync(join(this.sandboxDir, `file_${f}.ts`), `export const v = 0;`, "utf-8");
    }

    let crashesInjected = 0;
    let ioErrorsInjected = 0;
    let tornWALsInjected = 0;
    let recoverySuccessCount = 0;
    let invariantViolations = 0;
    const details: string[] = [];

    const faultScenarios = [
      "CLEAN_COMMIT",
      "CRASH_MID_COMMIT",
      "CRASH_AFTER_PREPARE",
      "CRASH_BEFORE_COMMIT",
      "IO_DISK_FULL",
      "CORRUPT_WAL",
    ];

    for (let i = 1; i <= iterations; i++) {
      const scenario = faultScenarios[i % faultScenarios.length];

      if (scenario.startsWith("CRASH")) crashesInjected++;
      else if (scenario === "IO_DISK_FULL") ioErrorsInjected++;
      else if (scenario === "CORRUPT_WAL") tornWALsInjected++;

      const res = await this.runChaosIteration(i, scenario);

      if (res.recovered) recoverySuccessCount++;
      if (!res.invariantsPassed) {
        invariantViolations++;
        details.push(`Iteration ${i} [${scenario}] FAILED: ${res.error}`);
      }
    }

    // Run Concurrency Hammer (50 parallel racing transactions)
    const hammer = await this.runConcurrencyHammer(50);
    if (!hammer.invariantsPassed) {
      invariantViolations++;
      details.push(
        `Concurrency Hammer failed! Committed: ${hammer.committed}, Aborted: ${hammer.abortedByConflict}`
      );
    }

    const durationMs = Date.now() - startTime;

    return {
      totalIterations: iterations,
      crashesInjected,
      ioErrorsInjected,
      tornWALsInjected,
      concurrencyRacesExecuted: hammer.workersRun,
      recoverySuccessCount,
      invariantViolations,
      durationMs,
      allInvariantsMaintained: invariantViolations === 0,
      details,
    };
  }
}
