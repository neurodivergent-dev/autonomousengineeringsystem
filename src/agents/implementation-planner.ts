import { SharedLLMClient } from "../llm/client";
import { ASTBridge } from "../intelligence/ast-bridge";
import type { PRD, ADR, ImplementationPlan } from "../types";

export class ImplementationPlannerAgent {
  private llm: SharedLLMClient;
  private astBridge: ASTBridge;

  constructor(llm: SharedLLMClient, astBridge: ASTBridge) {
    this.llm = llm;
    this.astBridge = astBridge;
  }

  public async createPlan(
    prd: PRD,
    adr: ADR,
    candidateFiles: string[] = [],
    onToken?: (chunk: string) => void
  ): Promise<ImplementationPlan> {
    const timestamp = new Date().toISOString();
    const planId = `PLAN-${Date.now().toString().slice(-4)}`;

    // Query existing source files for AST grounding
    const existingFiles = this.astBridge.getSourceFiles();
    // Query relevant source files with actual code content
    const relevantFiles = this.astBridge.findRelevantSourceFiles(
      `${prd.title} ${adr.decision}`,
      candidateFiles
    );
    // Query caller/identity cards for candidate files
    const fileCards = candidateFiles.slice(0, 5).map((f) => this.astBridge.getFileCard(f));

    const systemPrompt = `You are the Implementation Planner Agent in the MetaFrame Autonomous Engineering System.
Your job is to convert an approved PRD and ADR into an atomic, ordered, file-by-file implementation plan.

CRITICAL RULES FOR ATOMIC IMPLEMENTATION:
1. REUSE EXISTING FILES (MODIFY OVER CREATE):
   Existing Source Files in Repository:
   ${existingFiles.length > 0 ? existingFiles.join("\n   ") : "No existing source files."}
   - NEVER create a file that duplicates or overlaps with an existing file! (e.g. NEVER create src/components/layout/Navbar.tsx if src/components/Navbar.tsx exists).
   - If an existing component can be modified to fulfill the requirement (e.g. adding a theme toggle button or a sign-in modal trigger to Navbar), use actionType: "MODIFY" on that exact file!
2. ZERO OVER-ENGINEERING (NO AUXILIARY HOOKS/CONTEXTS/TOKENS):
   - Do NOT create separate files for simple hooks (e.g. usePersistentToggle.ts), isolated context providers (ThemeContext.tsx), or separate token files (tokens.ts, variables.css) unless explicitly demanded by the user.
   - Implement state cleanly using standard inline React hooks (useState) inside the component.
3. GROUNDING IN ACTUAL CODE:
${relevantFiles.length > 0 ? relevantFiles.map((f) => `--- File: ${f.path} ---\n${f.content}`).join("\n\n") : "No existing relevant code found."}
   - Inspect the actual code above before planning! If a theme toggle or UI adjustment is requested, plan modifications to existing files: src/index.css (add required light/dark CSS variables), src/App.tsx (use CSS variables instead of hardcoded dark background), and src/components/Navbar.tsx. Do NOT plan unused abstractions!
4. STANDALONE NEW COMPONENTS:
   - Only use actionType: "CREATE" when introducing a genuinely new component that does NOT exist in the codebase (e.g. src/components/Pricing.tsx).
   - If creating a new component, also add a step with actionType: "MODIFY" targeting the parent (e.g. src/App.tsx) to import and render it.
5. Each step MUST target a DISTINCT file (e.g. src/components/Navbar.tsx).
6. Target files: ${candidateFiles.length > 0 ? candidateFiles.join(", ") : "determine appropriate target file(s) from existing source files or genuine new components"}

PRD ID: ${prd.id} (${prd.title})
ADR ID: ${adr.id} (${adr.title})
ADR Decision: ${adr.decision}
File Cards / Context:
${JSON.stringify(fileCards, null, 2)}

Return ONLY a valid JSON object matching this schema:
{
  "id": "${planId}",
  "adrRef": "${adr.id}",
  "title": "Implementation Plan for ${prd.title}",
  "status": "APPROVED",
  "targetFiles": ${candidateFiles.length > 0 ? JSON.stringify(candidateFiles) : '["relative/path/to/target/file.html"]'},
  "steps": [
    {
      "order": 1,
      "description": "Specific task description",
      "targetFile": "path/to/file.html",
      "targetSymbols": ["symbol1"],
      "actionType": "CREATE",
      "testCriteria": "Assertion or gate to pass"
    }
  ],
  "blastRadiusRisk": "${adr.blastRadiusRisk}",
  "verificationGateChecklist": [
    "TypeScript 0 errors (tsc --noEmit)",
    "Transitive blast radius within bounds",
    "Theme token compliance",
    "Zero-emoji linter clean",
    "AST code health clean (no empty catch, no any)"
  ],
  "createdAt": "${timestamp}"
}`;

    const rawResponse = await this.llm.chatStream(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Generate step-by-step implementation plan for ADR ${adr.id}` },
      ],
      onToken
    );

    const fallback: ImplementationPlan = {
      id: planId,
      adrRef: adr.id,
      prdRef: prd.id,
      title: `Plan: ${prd.title}`,
      status: "APPROVED",
      targetFiles: candidateFiles.length > 0 ? candidateFiles : ["src/index.ts"],
      steps: candidateFiles.map((file, i) => ({
        order: i + 1,
        description: `Implement required changes in ${file}`,
        targetFile: file,
        targetSymbols: [],
        actionType: "MODIFY",
        testCriteria: "Must compile with 0 TypeScript errors and pass safety gates",
      })),
      blastRadiusRisk: adr.blastRadiusRisk,
      verificationGateChecklist: [
        "Gate 1: TypeScript zero-error compilation",
        "Gate 2: Blast radius verification",
        "Gate 3: Theme design token enforcement",
        "Gate 4: Zero-emoji UX compliance",
        "Gate 5: i18n translation integrity",
        "Gate 6: AST code health & anti-pattern clean",
      ],
      createdAt: timestamp,
    };

    return this.llm.extractJSON<ImplementationPlan>(rawResponse, fallback);
  }
}
