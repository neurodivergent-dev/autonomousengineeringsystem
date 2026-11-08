import { join } from "path";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { SharedLLMClient } from "../llm/client";
import { PatchIntegrityMonitor, type PatchIntegrityReport } from "../intelligence/patch-integrity";
import { BehavioralIntegrityEngine, type BehavioralIntegrityReport } from "../intelligence/behavioral-integrity";
import type { GateResult } from "../types";

export interface HealResult {
  healed: boolean;
  filePath: string;
  fixesApplied: string[];
  integrity?: PatchIntegrityReport;
  behavioral?: BehavioralIntegrityReport;
  error?: string;
}

export class CodeHealerAgent {
  private llm: SharedLLMClient;
  private repoRoot: string;

  constructor(llm: SharedLLMClient, repoRoot: string = process.cwd()) {
    this.llm = llm;
    this.repoRoot = repoRoot;
  }

  /**
   * Captures an in-memory snapshot of a file prior to surgical modification (Regression Guard)
   */
  public createSnapshot(filePath: string): string | null {
    const fullPath = join(this.repoRoot, filePath);
    if (existsSync(fullPath)) {
      return readFileSync(fullPath, "utf-8");
    }
    return null;
  }

  /**
   * Restores a file to its snapshot if regression or compile error amplification occurs
   */
  public rollback(filePath: string, snapshot: string | null): boolean {
    const fullPath = join(this.repoRoot, filePath);
    try {
      if (snapshot !== null) {
        writeFileSync(fullPath, snapshot, "utf-8");
        console.log(`  \x1b[35m[CodeHealer]\x1b[0m ↩ Reverted ${filePath} to pre-healing snapshot.`);
      }
      return true;
    } catch (err: any) {
      console.error(`  \x1b[31m[CodeHealer] Rollback failed for ${filePath}: ${err.message}\x1b[0m`);
      return false;
    }
  }

  /**
   * Applies surgical, fast fixes to resolve deterministic gate failures
   */
  public async healFile(
    filePath: string,
    failingGates: GateResult[]
  ): Promise<HealResult> {
    const fullPath = join(this.repoRoot, filePath);

    if (!existsSync(fullPath)) {
      return {
        healed: false,
        filePath,
        fixesApplied: [],
        error: `File not found at ${fullPath}`,
      };
    }

    const currentCode = readFileSync(fullPath, "utf-8");
    const fileExt = filePath.split(".").pop() || "html";

    // Format concise error report for the model
    const errorDetails = failingGates
      .map((g) => `[${g.gateName}]\n${g.errors.slice(0, 10).join("\n")}`)
      .join("\n\n");

    console.log(`  \x1b[36m[CodeHealer]\x1b[0m Analyzing ${failingGates.length} failed gate(s) for \x1b[1m${filePath}\x1b[0m...`);

    const systemPrompt = `You are the Surgical Code Healer Agent in the MetaFrame Autonomous Engineering System.
Your job is to fix exact compilation, lint, or gate violations reported by automated verification gates.
Apply MINIMAL, SURGICAL fixes to resolve all errors while preserving 100% of existing logic, features, and styling.

STRICT INSTRUCTIONS:
1. Do NOT think. Do NOT output any chain-of-thought, thought tags, or explanations. Start immediately with the corrected code.
2. Return ONLY the complete, production-ready corrected source code for "${filePath}".
3. If code blocks are used, wrap only in \`\`\`${fileExt} and \`\`\`.
4. Preserve TypeScript type safety (use 'import type' where required by verbatimModuleSyntax, eliminate unused locals).
5. Resolve all reported gate violations (e.g. replace hardcoded color hex values with CSS variables or clean tokens, fix syntax errors, etc.).
6. STRICT ZERO-CHEAT POLICY (AEGIS ANTI-CHEAT GUARD ENFORCED):
   - NEVER use ': any', 'as any', or '<any>'.
   - NEVER insert '// @ts-ignore', '// @ts-nocheck', or '// @ts-expect-error'.
   - NEVER use 'eslint-disable' to silence type safety.
   - You MUST declare authentic, production-grade TypeScript types (e.g. proper interfaces, generics, React.MouseEvent, ReactNode, Record<string, unknown>).
   - Any cheat will be detected and instantly rejected by Aegis Gate 6 Anti-Cheat Guard.`;

    const userPrompt = `
Target File: ${filePath}

Reported Gate Violations to Fix:
${errorDetails}

Existing Code:
\`\`\`${fileExt}
${currentCode}
\`\`\`

Return the complete, corrected code with all gate errors fixed now:`;

    try {
      const raw = await this.llm.chat([
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ]);

      const cleanedCode = this.cleanCodeOutput(raw);

      if (!cleanedCode || cleanedCode.trim().length === 0) {
        throw new Error("LLM returned empty healed content");
      }

      // Level 1: Pre-Patch Baseline & AST Integrity Check
      const behavioralEngine = new BehavioralIntegrityEngine(this.repoRoot);
      const preBehavior = behavioralEngine.captureBaseline();

      const monitor = new PatchIntegrityMonitor(this.repoRoot);
      const preFingerprint = monitor.fingerprintContent(filePath, currentCode);
      const postFingerprint = monitor.fingerprintContent(filePath, cleanedCode);
      const integrity = monitor.evaluate(preFingerprint, postFingerprint);

      if (!integrity.passed) {
        console.warn(`  \x1b[31m✖ [CodeHealer] Patch Integrity Monitor REJECTED patch for ${filePath}!\x1b[0m`);
        console.warn(`    İhlaller: ${integrity.violations.join(" | ")}`);
        return {
          healed: false,
          filePath,
          fixesApplied: [],
          integrity,
          error: `Patch Integrity Rejection: ${integrity.violations.join("; ")}`,
        };
      }

      // Write trial patch to disk for Behavioral Verification
      writeFileSync(fullPath, cleanedCode, "utf-8");

      // Level 2: Behavioral Regression Gate
      const postBehavior = behavioralEngine.captureBaseline();
      const behavioralReport = behavioralEngine.evaluateRegression(preBehavior, postBehavior);

      if (!behavioralReport.passed) {
        // Rollback immediately to prevent behavioral corruption
        writeFileSync(fullPath, currentCode, "utf-8");
        console.warn(`  \x1b[31m✖ [CodeHealer] Behavioral Regression detected! Rolling back ${filePath}!\x1b[0m`);
        console.warn(`    Gerilemeler: ${behavioralReport.regressionsDetected.join(" | ")}`);

        return {
          healed: false,
          filePath,
          fixesApplied: [],
          integrity,
          behavioral: behavioralReport,
          error: behavioralReport.summary,
        };
      }

      console.log(`  \x1b[32m✔ [CodeHealer] Applied surgical patch to ${filePath} (${cleanedCode.length} bytes, AST Integrity PASSED, Zero Regression PASSED)\x1b[0m`);

      return {
        healed: true,
        filePath,
        fixesApplied: failingGates.map((g) => `Fixed ${g.gateName}`),
        integrity,
        behavioral: behavioralReport,
      };
    } catch (err: any) {
      console.error(`  \x1b[31m✖ [CodeHealer] Healing failed: ${err.message}\x1b[0m`);
      return {
        healed: false,
        filePath,
        fixesApplied: [],
        error: err.message,
      };
    }
  }

  private cleanCodeOutput(raw: string): string {
    let clean = raw.trim();

    if (clean.startsWith("```")) {
      clean = clean.replace(/^```[a-zA-Z0-9_\-+]*(?:\r?\n)?/, "");
      clean = clean.replace(/(?:\r?\n)?```\s*$/, "");
      return clean.trim();
    }

    const fenceMatch = clean.match(/```(?:[a-zA-Z0-9_\-+]*)\r?\n([\s\S]*?)```/);
    if (fenceMatch && fenceMatch[1]) {
      return fenceMatch[1].trim();
    }

    return clean;
  }
}
