import { execSync } from "child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";

export interface TestBaseline {
  runner: "bun" | "vitest" | "jest" | "npm" | "contract-smoke" | "none";
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  failedTestNames: string[];
  rawOutput?: string;
}

export interface BehavioralIntegrityReport {
  passed: boolean;
  preBaseline: TestBaseline;
  postBaseline: TestBaseline;
  regressionsDetected: string[];
  newFailuresCount: number;
  passedDelta: number;
  durationDeltaMs: number;
  rollbackRecommended: boolean;
  summary: string;
}

/**
 * BehavioralIntegrityEngine
 * Verifies that code modifications do not introduce behavioral regressions.
 * Executes pre-patch baseline and compares against post-patch test/smoke results.
 */
export class BehavioralIntegrityEngine {
  private repoRoot: string;

  constructor(repoRoot: string = process.cwd()) {
    this.repoRoot = resolve(repoRoot);
  }

  /**
   * Discovers whether test files (*.test.ts, *.spec.ts, etc.) exist in the repo
   */
  public hasTestFiles(dir: string = this.repoRoot, depth: number = 0): boolean {
    if (depth > 4) return false;
    if (!existsSync(dir)) return false;

    try {
      const entries = readdirSync(dir);
      for (const entry of entries) {
        if (entry === "node_modules" || entry === ".git" || entry === "dist" || entry === ".gemini") {
          continue;
        }
        const full = join(dir, entry);
        const st = statSync(full);
        if (st.isDirectory()) {
          if (this.hasTestFiles(full, depth + 1)) return true;
        } else if (/\.(test|spec)\.(ts|tsx|js|jsx)$/.test(entry)) {
          return true;
        }
      }
    } catch {
      return false;
    }
    return false;
  }

  /**
   * Detects the project test runner
   */
  public detectRunner(): "bun" | "vitest" | "jest" | "npm" | "contract-smoke" | "none" {
    const pkgPath = join(this.repoRoot, "package.json");
    const hasTests = this.hasTestFiles();

    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        const scripts = pkg.scripts || {};
        const testScript = scripts.test || "";

        if (testScript.includes("vitest")) return "vitest";
        if (testScript.includes("jest")) return "jest";
        if (testScript && !testScript.includes("no test specified") && !testScript.includes("exit 1")) {
          return "npm";
        }
      } catch {
        // ignore parse errors
      }
    }

    if (hasTests) {
      return "bun";
    }

    // Fallback to contract smoke check (tsc / oxlint)
    return "contract-smoke";
  }

  /**
   * Captures the baseline behavior of the target codebase
   */
  public captureBaseline(): TestBaseline {
    const start = Date.now();
    const runner = this.detectRunner();

    if (runner === "contract-smoke" || runner === "none") {
      return this.runContractSmoke(start, runner);
    }

    return this.runAutomatedTests(start, runner);
  }

  /**
   * Executes native or configured test suite
   */
  private runAutomatedTests(startTime: number, runner: "bun" | "vitest" | "jest" | "npm"): TestBaseline {
    let cmd = "bun test";
    if (runner === "npm") cmd = "npm test";
    else if (runner === "vitest") cmd = "bun x vitest run";
    else if (runner === "jest") cmd = "bun x jest";

    try {
      const output = execSync(cmd, {
        cwd: this.repoRoot,
        encoding: "utf-8",
        timeout: 25000,
        env: { ...process.env, CI: "true" },
      });

      const durationMs = Date.now() - startTime;
      return this.parseTestOutput(output, runner, durationMs);
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      const output = (err.stdout || "") + "\n" + (err.stderr || "") + "\n" + (err.message || "");
      return this.parseTestOutput(output, runner, durationMs);
    }
  }

  /**
   * Runs lightweight contract smoke test when dedicated test files are absent
   */
  private runContractSmoke(startTime: number, runner: "contract-smoke" | "none"): TestBaseline {
    let passed = true;
    let failedTestNames: string[] = [];

    try {
      // Check if tsc passes clean without emit
      const tsconfigPath = existsSync(join(this.repoRoot, "tsconfig.app.json"))
        ? "tsconfig.app.json"
        : existsSync(join(this.repoRoot, "tsconfig.json"))
        ? "tsconfig.json"
        : null;

      if (tsconfigPath) {
        execSync(`bun x tsc -p "${tsconfigPath}" --noEmit`, {
          cwd: this.repoRoot,
          encoding: "utf-8",
          timeout: 20000,
        });
      }
    } catch (err: any) {
      passed = false;
      failedTestNames.push("Contract Smoke / Type Invariants Check");
    }

    const durationMs = Date.now() - startTime;

    return {
      runner,
      total: 1,
      passed: passed ? 1 : 0,
      failed: passed ? 0 : 1,
      skipped: 0,
      durationMs,
      failedTestNames,
    };
  }

  /**
   * Parses test runner stdout to count passed/failed tests
   */
  private parseTestOutput(output: string, runner: string, durationMs: number): TestBaseline {
    let total = 0;
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    const failedTestNames: string[] = [];

    // Bun test pattern: "X pass", "Y fail", "Z skip"
    // Vitest pattern: "Tests 5 passed (5)" or "Tests 1 failed | 4 passed"
    const passMatch = output.match(/(\d+)\s+(?:pass|passed)/i);
    const failMatch = output.match(/(\d+)\s+(?:fail|failed)/i);
    const skipMatch = output.match(/(\d+)\s+(?:skip|skipped)/i);

    if (passMatch) passed = parseInt(passMatch[1], 10);
    if (failMatch) failed = parseInt(failMatch[1], 10);
    if (skipMatch) skipped = parseInt(skipMatch[1], 10);
    total = passed + failed + skipped;

    // Extract individual failing test titles
    const lines = output.split("\n");
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (line.startsWith("(fail)") || line.startsWith("✗") || line.startsWith("FAIL") || line.startsWith("×")) {
        const cleaned = line.replace(/^[✗×]|FAIL\s*|\(fail\)\s*/g, "").trim();
        if (cleaned && !failedTestNames.includes(cleaned)) {
          failedTestNames.push(cleaned.slice(0, 100));
        }
      }
    }

    return {
      runner: runner as any,
      total,
      passed,
      failed,
      skipped,
      durationMs,
      failedTestNames,
      rawOutput: output.slice(0, 500),
    };
  }

  /**
   * Evaluates if any behavioral regression occurred between pre-patch and post-patch
   */
  public evaluateRegression(pre: TestBaseline, post: TestBaseline): BehavioralIntegrityReport {
    // Tests that passed before but are failing now
    const regressionsDetected = post.failedTestNames.filter((name) => !pre.failedTestNames.includes(name));
    const newFailuresCount = Math.max(0, post.failed - pre.failed);
    const passedDelta = post.passed - pre.passed;
    const durationDeltaMs = post.durationMs - pre.durationMs;

    const hasRegression = regressionsDetected.length > 0 || newFailuresCount > 0;
    const rollbackRecommended = hasRegression;

    let summary = "";
    if (hasRegression) {
      summary = `BEHAVIORAL REGRESSION DETECTED! (${newFailuresCount} yeni başarısız test, ${regressionsDetected.length} gerileme).`;
    } else if (post.failed === 0) {
      summary = `Behavioral Integrity PASSED: Tüm testler (${post.passed}/${post.total}) sıfır gerilemeyle korundu.`;
    } else {
      summary = `Behavioral Integrity MAINTAINED: Yeni gerileme yok (Mevcut başarısızlıklar korundu: ${post.failed}).`;
    }

    return {
      passed: !hasRegression,
      preBaseline: pre,
      postBaseline: post,
      regressionsDetected,
      newFailuresCount,
      passedDelta,
      durationDeltaMs,
      rollbackRecommended,
      summary,
    };
  }
}
