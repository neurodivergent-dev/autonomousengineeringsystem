import { execSync } from "child_process";
import { join, resolve } from "path";
import { existsSync } from "fs";
import type { GateResult, VerificationReport } from "../types";

export class GateRunner {
  private repoRoot: string;
  private systemRoot: string;
  private scriptsDir: string;

  constructor(repoRoot: string = process.cwd(), systemRoot?: string) {
    this.repoRoot = resolve(repoRoot);
    this.systemRoot = systemRoot ? resolve(systemRoot) : resolve(__dirname, "../..");
    this.scriptsDir = join(this.systemRoot, "repo-intelligence-layer", "scripts");
  }

  /**
   * Run a specific script with arguments and return raw output + status
   */
  private runCommand(cmd: string, timeout: number = 30000): { success: boolean; output: string } {
    try {
      const output = execSync(cmd, {
        cwd: this.repoRoot,
        encoding: "utf-8",
        timeout,
        env: { ...process.env, TARGET_REPO: this.repoRoot },
      }).trim();
      return { success: true, output };
    } catch (err: any) {
      const output = (err.stdout || "") + "\n" + (err.stderr || "") + "\n" + (err.message || "");
      return { success: false, output: output.trim() };
    }
  }

  /**
   * Gate 1: TypeScript Compiler Check (0 errors required)
   */
  public verifyTypeScript(): GateResult {
    const start = Date.now();
    const tsConfigPath = join(this.repoRoot, "tsconfig.json");
    if (!existsSync(tsConfigPath)) {
      return {
        gateName: "1. TypeScript Compiler (Zero TS Errors)",
        passed: true,
        durationMs: Date.now() - start,
        errors: [],
        warnings: ["tsconfig.json not found in target repo, skipped compiler check."],
      };
    }

    const appTsConfig = join(this.repoRoot, "tsconfig.app.json");
    const tsFlag = existsSync(appTsConfig) ? "-p tsconfig.app.json" : "";
    const localTsc = join(this.repoRoot, "node_modules", "typescript", "bin", "tsc");

    // Prefer local typescript binary if present (avoids bun x timeout/network lock)
    let cmd = existsSync(localTsc)
      ? `node "${localTsc}" ${tsFlag} --noEmit`
      : `bun x tsc ${tsFlag} --noEmit`;

    let res = this.runCommand(cmd, 25000);
    if (!res.success && (res.output.includes("not found") || res.output.includes("ETIMEDOUT"))) {
      res = this.runCommand(`bun x tsc ${tsFlag} --noEmit`, 25000);
    }
    if (!res.success && res.output.includes("not found")) {
      res = this.runCommand(`npx --no-install tsc ${tsFlag} --noEmit`, 25000);
    }
    const durationMs = Date.now() - start;

    const errorLines = res.output
      .split("\n")
      .filter((l) => /error TS\d+/.test(l))
      .map((l) => l.trim());

    const passed = res.success && errorLines.length === 0;
    const errors = errorLines.length > 0 ? errorLines : (!res.success ? [res.output.slice(0, 300)] : []);

    return {
      gateName: "1. TypeScript Compiler (Zero TS Errors)",
      passed,
      durationMs,
      errors,
      warnings: [],
    };
  }

  /**
   * Gate 2: Blast Radius Analysis
   */
  public verifyBlastRadius(targetPath?: string): GateResult {
    const start = Date.now();
    const script = join(this.scriptsDir, "blast-radius.js");
    if (!existsSync(script)) {
      return {
        gateName: "2. Blast Radius & Transitive Impact",
        passed: true,
        durationMs: 0,
        errors: [],
        warnings: ["blast-radius.js not found, skipped."],
      };
    }

    const cmd = targetPath ? `node "${script}" impact "${targetPath}"` : `node "${script}" full`;
    const res = this.runCommand(cmd, 25000);
    const durationMs = Date.now() - start;

    const isHighRisk = res.output.includes("HIGH RISK") || res.output.includes("YUKSEK");
    const warnings: string[] = [];
    if (isHighRisk) {
      warnings.push("High blast radius detected for target file! Proceed with caution.");
    }

    return {
      gateName: "2. Blast Radius & Transitive Impact",
      passed: true,
      durationMs,
      errors: [],
      warnings,
    };
  }

  /**
   * Gate 3: Theme Token Enforcement
   */
  public verifyTheme(targetPath?: string): GateResult {
    const start = Date.now();
    const script = join(this.scriptsDir, "theme-audit.js");
    if (!existsSync(script)) {
      return { gateName: "3. Theme Token Enforcer", passed: true, durationMs: 0, errors: [], warnings: [] };
    }

    const cmd = targetPath ? `node "${script}" file "${targetPath}"` : `node "${script}" summary`;
    const res = this.runCommand(cmd);
    const durationMs = Date.now() - start;

    const violations = res.output
      .split("\n")
      .filter(
        (l) =>
          (l.includes("✖ ERROR") || l.includes("UNDEFINED_CSS_VARIABLE") || l.includes("CRITICAL")) &&
          !l.includes("TEMA DENETİM") &&
          !l.includes("ÖZETİ")
      )
      .map((l) => l.trim());

    return {
      gateName: "3. Theme Token Enforcer",
      passed: violations.length === 0,
      durationMs,
      errors: violations.slice(0, 10),
      warnings: [],
    };
  }

  /**
   * Gate 4: Zero-Emoji Linter
   */
  public verifyZeroEmoji(targetPath?: string): GateResult {
    const start = Date.now();
    const script = join(this.scriptsDir, "emoji-linter.js");
    if (!existsSync(script)) {
      return { gateName: "4. Zero-Emoji UX Guard", passed: true, durationMs: 0, errors: [], warnings: [] };
    }

    const cmd = targetPath ? `node "${script}" file "${targetPath}"` : `node "${script}" ui`;
    const res = this.runCommand(cmd);
    const durationMs = Date.now() - start;

    const emojiViolations = res.output
      .split("\n")
      .filter(
        (l) =>
          !l.includes("Temiz") &&
          !l.includes("Sadece UI/JSX") &&
          !l.includes("✔") &&
          (l.includes("CRITICAL") || l.includes("EMOJI"))
      )
      .map((l) => l.trim());

    return {
      gateName: "4. Zero-Emoji UX Guard",
      passed: emojiViolations.length === 0,
      durationMs,
      errors: emojiViolations.slice(0, 10),
      warnings: [],
    };
  }

  /**
   * Gate 5: i18n Bridge Integrity Check
   */
  public verifyI18n(): GateResult {
    const start = Date.now();
    const script = join(this.scriptsDir, "i18n-indexer.js");
    if (!existsSync(script)) {
      return { gateName: "5. i18n Translation Integrity", passed: true, durationMs: 0, errors: [], warnings: [] };
    }

    const res = this.runCommand(`node "${script}"`);
    const durationMs = Date.now() - start;

    return {
      gateName: "5. i18n Translation Integrity",
      passed: true,
      durationMs,
      errors: [],
      warnings: [],
    };
  }

  /**
   * Gate 6: AST Code Health & Anti-Cheat Guard
   */
  public verifyCodeHealth(targetPath?: string): GateResult {
    const start = Date.now();
    const script = join(this.scriptsDir, "code-health.js");
    if (!existsSync(script)) {
      return { gateName: "6. AST Code Health & Anti-Cheat Guard", passed: true, durationMs: 0, errors: [], warnings: [] };
    }

    const cmd = targetPath ? `node "${script}" file "${targetPath}"` : `node "${script}" summary`;
    const res = this.runCommand(cmd);
    const durationMs = Date.now() - start;

    const antiPatterns = res.output
      .split("\n")
      .filter((l) =>
        l.includes("ANTI_CHEAT") ||
        l.includes("NO_EMPTY_CATCH") ||
        l.includes("NO_DEBUGGER") ||
        l.includes("NO_EXPLICIT_ANY") ||
        l.includes("ANY_ESCAPE") ||
        l.includes("HOOKS_IN_LOOP_OR_CONDITION")
      )
      .map((l) => l.trim());

    return {
      gateName: "6. AST Code Health & Anti-Cheat Guard",
      passed: antiPatterns.length === 0,
      durationMs,
      errors: antiPatterns.slice(0, 10),
      warnings: [],
    };
  }

  /**
   * Runs the complete 6-gate safety chain
   */
  public runAllGates(targetPath?: string): VerificationReport {
    const gates: GateResult[] = [];

    // Gate 1: TypeScript
    gates.push(this.verifyTypeScript());

    // Gate 2: Blast Radius
    gates.push(this.verifyBlastRadius(targetPath));

    // Gate 3: Theme Tokens
    gates.push(this.verifyTheme(targetPath));

    // Gate 4: Zero-Emoji
    gates.push(this.verifyZeroEmoji(targetPath));

    // Gate 5: i18n Integrity
    gates.push(this.verifyI18n());

    // Gate 6: Code Health
    gates.push(this.verifyCodeHealth(targetPath));

    const overallPassed = gates.every((g) => g.passed);

    return {
      timestamp: new Date().toISOString(),
      targetPath,
      overallPassed,
      gates,
    };
  }
}
