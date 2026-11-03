import { join, dirname } from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { SharedLLMClient } from "../llm/client";
import type { ImplementationPlan, PlanStep, PRD, ADR } from "../types";

export interface ExecutionResult {
  step: PlanStep;
  filePath: string;
  codeLength: number;
  success: boolean;
  error?: string;
  originalCode?: string;
  generatedCode?: string;
}

export interface PlanExecutionSummary {
  planId: string;
  model: string;
  executedSteps: ExecutionResult[];
  overallSuccess: boolean;
  errors: string[];
}

export type CodeStepCallback = (event:
  | { type: "code_step_start"; step: PlanStep; index: number; total: number; targetFile: string }
  | { type: "code_token"; token: string; targetFile: string }
  | { type: "code_step_done"; targetFile: string; codeLength: number; originalCode?: string; generatedCode?: string }
) => void;

export class CodeExecutorAgent {
  private llm: SharedLLMClient;
  private repoRoot: string;

  constructor(llm: SharedLLMClient, repoRoot: string = process.cwd()) {
    this.llm = llm;
    this.repoRoot = repoRoot;
  }

  /**
   * Executes an ImplementationPlan by generating and writing actual files to disk.
   */
  public async executePlan(
    plan: ImplementationPlan,
    prd?: PRD,
    adr?: ADR,
    onToken?: (token: string) => void,
    onStepProgress?: CodeStepCallback
  ): Promise<PlanExecutionSummary> {
    console.log(`\n\x1b[35m[CodeExecutorAgent]\x1b[0m Executing ${plan.steps.length} plan steps using model \x1b[1m${this.llm.modelName}\x1b[0m...`);

    const results: ExecutionResult[] = [];
    const errors: string[] = [];
    const executedMemory: Array<{ targetFile: string; actionType: string; summary: string }> = [];

    for (const step of plan.steps) {
      console.log(`\n\x1b[34m[Step ${step.order}/${plan.steps.length}]\x1b[0m ${step.actionType} -> \x1b[36m${step.targetFile}\x1b[0m`);
      console.log(`  Description: ${step.description}`);

      onStepProgress?.({
        type: "code_step_start",
        step,
        index: step.order || (results.length + 1),
        total: plan.steps.length,
        targetFile: step.targetFile,
      });

      try {
        const fullPath = join(this.repoRoot, step.targetFile);

        if (step.actionType === "DELETE") {
          let originalCode = "";
          if (existsSync(fullPath)) {
            originalCode = readFileSync(fullPath, "utf-8");
            unlinkSync(fullPath);
            console.log(`  \x1b[33m✔ Deleted file: ${step.targetFile}\x1b[0m`);
          }
          results.push({
            step,
            filePath: step.targetFile,
            codeLength: 0,
            success: true,
            originalCode,
            generatedCode: "",
          });
          onStepProgress?.({
            type: "code_step_done",
            targetFile: step.targetFile,
            codeLength: 0,
            originalCode,
            generatedCode: "",
          });
          executedMemory.push({
            targetFile: step.targetFile,
            actionType: step.actionType,
            summary: step.description,
          });
          continue;
        }

        let existingContent = "";
        if (existsSync(fullPath)) {
          existingContent = readFileSync(fullPath, "utf-8");
        }

        const generatedCode = await this.generateCodeForStep(
          step,
          existingContent,
          prd,
          adr,
          (token) => {
            onToken?.(token);
            onStepProgress?.({ type: "code_token", token, targetFile: step.targetFile });
          },
          executedMemory
        );

        if (!generatedCode || generatedCode.trim().length === 0) {
          throw new Error(`LLM generated empty content for ${step.targetFile}`);
        }

        // Ensure target directory exists
        const dir = dirname(fullPath);
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }

        writeFileSync(fullPath, generatedCode, "utf-8");
        console.log(`  \x1b[32m✔ Written to disk:\x1b[0m ${step.targetFile} (${generatedCode.length} bytes)`);

        results.push({
          step,
          filePath: step.targetFile,
          codeLength: generatedCode.length,
          success: true,
          originalCode: existingContent,
          generatedCode,
        });

        onStepProgress?.({
          type: "code_step_done",
          targetFile: step.targetFile,
          codeLength: generatedCode.length,
          originalCode: existingContent,
          generatedCode,
        });

        executedMemory.push({
          targetFile: step.targetFile,
          actionType: step.actionType,
          summary: step.description,
        });
      } catch (err: any) {
        const errMsg = `Failed step ${step.order} (${step.targetFile}): ${err.message}`;
        console.error(`  \x1b[31m✖ ${errMsg}\x1b[0m`);
        errors.push(errMsg);
        results.push({
          step,
          filePath: step.targetFile,
          codeLength: 0,
          success: false,
          error: err.message,
        });
      }
    }

    const overallSuccess = errors.length === 0;
    return {
      planId: plan.id,
      model: this.llm.modelName,
      executedSteps: results,
      overallSuccess,
      errors,
    };
  }

  /**
   * Generates code for a single step by calling the local LLM with high context
   */
  private async generateCodeForStep(
    step: PlanStep,
    existingContent: string,
    prd?: PRD,
    adr?: ADR,
    onToken?: (token: string) => void,
    executedMemory?: Array<{ targetFile: string; actionType: string; summary: string }>
  ): Promise<string> {
    const fileExt = step.targetFile.split(".").pop() || "ts";

    const systemPrompt = `You are the Code Executor Agent in the MetaFrame Autonomous Engineering System.
You generate complete, working, production-grade source code for requested files.
Your code must be clean, robust, and directly runnable without placeholders or pseudo-code.

STRICT INSTRUCTIONS:
1. Do NOT think. Do NOT output any chain-of-thought, thought tags, or reasoning process. Output ONLY code.
2. Return ONLY the complete, production-ready source code for "${step.targetFile}".
3. If code blocks are used, wrap only in \`\`\`${fileExt} and \`\`\`.
4. Do NOT include any conversational preamble, explanations, or sign-offs.
5. Adhere to TypeScript/JavaScript/HTML/CSS best practices. Avoid unused variables or broken imports.
6. If modifying an existing file, provide the complete, updated file content.
7. CRITICAL: Never replace existing functionality with placeholders. Ensure all existing imports, components, and props continue to function.

MANDATORY MODERN UI/UX DESIGN STANDARDS (FOR JSX/TSX/CSS):
- VERCEL / LINEAR / RAYCAST TIER AESTHETICS: Use deep obsidian dark surfaces (#090A0F, #111420), glassmorphic backdrops (rgba(18, 21, 31, 0.75), backdropFilter: "blur(12px)"), and refined borders (1px solid rgba(255, 255, 255, 0.08) or rgba(168, 85, 247, 0.2)).
- VIBRANT ACCENTS & GRADIENTS: Use sleek gradients (e.g. "linear-gradient(135deg, #a855f7 0%, #38bdf8 100%)") for key action buttons, badges, and gradient text highlights.
- NEVER CAUSE INVISIBLE TEXT OR UNRESOLVED TOKENS: If using WebkitBackgroundClip: "text" with WebkitTextFillColor: "transparent", ALWAYS ensure a valid gradient is provided. Never write undefined CSS variables without fallbacks (e.g., use var(--primary-600, #8b5cf6)).
- HIGH-DENSITY POLISHED CARDS: Cards must have 20-28px padding, icon glow badges, subtle box shadows (boxShadow: "0 8px 30px rgba(0,0,0,0.3)"), and smooth hover transitions.`;

    const userPrompt = `
Task: ${step.actionType} ${step.targetFile}
Description: ${step.description}
${step.targetSymbols?.length ? `Target Symbols / Exports: ${step.targetSymbols.join(", ")}` : ""}
${step.testCriteria ? `Test Criteria: ${step.testCriteria}` : ""}

${executedMemory && executedMemory.length > 0 ? `PREVIOUSLY EXECUTED STEPS IN THIS PLAN:
${executedMemory.map((m) => `- ${m.targetFile} (${m.actionType}): ${m.summary}`).join("\n")}
Ensure your code for "${step.targetFile}" aligns perfectly with these files, their exports, and CSS tokens!` : ""}

${prd ? `Context (PRD ${prd.id}):
Title: ${prd.title}
Overview: ${prd.overview}
Requirements: ${prd.functionalRequirements?.join("; ") || "Standard"}` : ""}

${adr ? `Architecture Decision (ADR ${adr.id}):
Decision: ${adr.decision}` : ""}

${existingContent ? `Existing File Content:
\`\`\`${fileExt}
${existingContent.slice(0, 3000)}
\`\`\`` : "This is a brand new file."}

Generate the full, complete source code for "${step.targetFile}" now:`;

    const raw = await this.llm.chatStream(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      onToken
    );

    return this.cleanCodeOutput(raw);
  }

  /**
   * Cleans fences and markdown text out of LLM code response
   */
  private cleanCodeOutput(raw: string): string {
    let clean = raw.trim();

    // If starts with ```, strip the opening fence
    if (clean.startsWith("```")) {
      clean = clean.replace(/^```[a-zA-Z0-9_\-+]*(?:\r?\n)?/, "");
      // If ends with ```, strip closing fence
      clean = clean.replace(/(?:\r?\n)?```\s*$/, "");
      return clean.trim();
    }

    // Check if there is an embedded code block ```...```
    const fenceMatch = clean.match(/```(?:[a-zA-Z0-9_\-+]*)\r?\n([\s\S]*?)```/);
    if (fenceMatch && fenceMatch[1]) {
      return fenceMatch[1].trim();
    }

    return clean;
  }
}
