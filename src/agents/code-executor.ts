import { join, dirname } from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { SharedLLMClient } from "../llm/client";
import type { ImplementationPlan, PlanStep, PRD, ADR } from "../types";
import { SurgicalPatchEngine, type LineDiffSummary } from "../intelligence/surgical-patch";

export interface ExecutionResult {
  step: PlanStep;
  filePath: string;
  codeLength: number;
  success: boolean;
  error?: string;
  originalCode?: string;
  generatedCode?: string;
  diffSummary?: LineDiffSummary;
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
  | { type: "code_step_done"; targetFile: string; codeLength: number; originalCode?: string; generatedCode?: string; diffSummary?: LineDiffSummary }
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
        const diffSummary = SurgicalPatchEngine.calculateLineDiff(existingContent, generatedCode);
        console.log(`  \x1b[32m✔ Written to disk:\x1b[0m ${step.targetFile} (${generatedCode.length} bytes, +${diffSummary.additions}/-${diffSummary.deletions} lines)`);

        results.push({
          step,
          filePath: step.targetFile,
          codeLength: generatedCode.length,
          success: true,
          originalCode: existingContent,
          generatedCode,
          diffSummary,
        });

        onStepProgress?.({
          type: "code_step_done",
          targetFile: step.targetFile,
          codeLength: generatedCode.length,
          originalCode: existingContent,
          generatedCode,
          diffSummary,
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
    const isExistingFile = !!(existingContent && existingContent.trim().length > 120);

    const systemPrompt = isExistingFile
      ? `You are the Ultra-Fast Surgical Code Patch Agent in the MetaFrame Autonomous Engineering System.
Philosophy: ULTRA-CONCISE SURGICAL REPLACEMENT.
DO NOT REWRITE THE ENTIRE FILE! DO NOT COPY UNCHANGED CODE!

STRICT FORMAT:
<<<<<<< SEARCH
[exact 3-7 lines from the existing file to replace]
=======
[new replacement lines]
>>>>>>> REPLACE

CRITICAL RULES:
1. BREVITY IS MANDATORY: The SEARCH block MUST contain ONLY the 3 to 7 specific lines being modified (with 1 line of context before and after).
2. NEVER include more than 8 lines inside a SEARCH block!
3. NEVER start from line 1 of the file unless you are specifically modifying line 1! Jump directly to the lines that change.
4. Match exact indentation and syntax from the existing file.
5. If modifying multiple places, use multiple small SEARCH/REPLACE blocks.
6. Output ZERO markdown commentary, ZERO explanation. Output ONLY the search/replace block(s).`
      : `You are the Code Executor Agent in the MetaFrame Autonomous Engineering System.
You generate complete, working, production-grade source code for requested files.
Your code must be clean, robust, and directly runnable without placeholders or pseudo-code.

STRICT INSTRUCTIONS:
1. Do NOT think. Do NOT output any chain-of-thought, thought tags, or reasoning process. Output ONLY code.
2. Return ONLY the complete, production-ready source code for "${step.targetFile}".
3. If code blocks are used, wrap only in \`\`\`${fileExt} and \`\`\`.
4. Do NOT include any conversational preamble, explanations, or sign-offs.
5. Adhere to TypeScript/JavaScript/HTML/CSS best practices. Avoid unused variables or broken imports.
6. CRITICAL: Never replace existing functionality with placeholders. Ensure all existing imports, components, and props continue to function.`;

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
${existingContent.length > 35000 ? existingContent.slice(0, 35000) + "\n// ... [Remainder truncated for context window] ..." : existingContent}
\`\`\`` : "This is a brand new file."}

${isExistingFile
  ? `Provide the surgical <<<<<<< SEARCH ... ======= ... >>>>>>> REPLACE diff block(s) for "${step.targetFile}" now:`
  : `Generate the full, complete source code for "${step.targetFile}" now:`}`;

    const raw = await this.llm.chatStream(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      onToken
    );

    if (isExistingFile) {
      const hunks = SurgicalPatchEngine.parseHunks(raw);
      if (hunks.length > 0) {
        const patchRes = SurgicalPatchEngine.applyHunks(existingContent, hunks);
        if (patchRes.success) {
          console.log(`  \x1b[35m[Surgical Patch]\x1b[0m Applied ${patchRes.appliedCount}/${patchRes.totalCount} hunks cleanly to ${step.targetFile}`);
          return patchRes.patchedContent;
        }
        throw new Error(`Cerrahi yama uygulanamadı: Modelin aradığı SEARCH bloğu ${step.targetFile} içinde bulunamadı (${patchRes.error}). Orijinal dosya korundu.`);
      } else if (raw.includes("<<<<<<< SEARCH")) {
        throw new Error(`Yarıda kesilen çıktı: Model ${step.targetFile} için SEARCH/REPLACE diff bloğunu kapatamadı veya token limitine takıldı. Orijinal dosya korundu.`);
      }
    }

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
