import { join } from "path";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { SharedLLMClient } from "../llm/client";
import type { GateResult } from "../types";

export interface HealResult {
  healed: boolean;
  filePath: string;
  fixesApplied: string[];
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
      .map((g) => `[${g.gateName}]\n${g.errors.slice(0, 5).join("\n")}`)
      .join("\n\n");

    console.log(`  \x1b[36m[CodeHealer]\x1b[0m Analyzing ${failingGates.length} failed gate(s) for \x1b[1m${filePath}\x1b[0m...`);

    const systemPrompt = `You are the Surgical Code Healer Agent in the MetaFrame Autonomous Engineering System.
Your job is to fix exact compilation, lint, or gate violations reported by automated verification gates.
Apply MINIMAL, SURGICAL fixes to resolve all errors while preserving 100% of existing logic, features, and styling.

STRICT INSTRUCTIONS:
1. Do NOT think. Do NOT output any chain-of-thought, thought tags, or explanations. Start immediately with the corrected code.
2. Return ONLY the complete, production-ready corrected source code for "${filePath}".
3. If code blocks are used, wrap only in \`\`\`${fileExt} and \`\`\`.
4. Resolve all reported gate violations (e.g. replace hardcoded color hex values with CSS variables or clean tokens, fix syntax errors, etc.).`;

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

      // Write the healed code
      writeFileSync(fullPath, cleanedCode, "utf-8");
      console.log(`  \x1b[32m✔ [CodeHealer] Applied surgical patch to ${filePath} (${cleanedCode.length} bytes)\x1b[0m`);

      return {
        healed: true,
        filePath,
        fixesApplied: failingGates.map((g) => `Fixed ${g.gateName}`),
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
