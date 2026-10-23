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

  public async createPlan(prd: PRD, adr: ADR, candidateFiles: string[] = []): Promise<ImplementationPlan> {
    const timestamp = new Date().toISOString();
    const planId = `PLAN-${Date.now().toString().slice(-4)}`;

    // Query caller/identity cards for candidate files
    const fileCards = candidateFiles.slice(0, 5).map((f) => this.astBridge.getFileCard(f));

    const systemPrompt = `You are the Implementation Planner Agent in the MetaFrame Autonomous Engineering System.
Your job is to convert an approved PRD and ADR into an atomic, ordered, file-by-file implementation plan.

RULES:
1. Each step MUST target a DISTINCT file (e.g. index.html, styles.css, main.js).
2. If building a self-contained single-file web application, create exactly 1 comprehensive CREATE step that writes the full standalone file.
3. Target files: ${candidateFiles.length > 0 ? candidateFiles.join(", ") : "determine appropriate target file(s)"}

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

    const rawResponse = await this.llm.chat([
      { role: "system", content: systemPrompt },
      { role: "user", content: `Generate step-by-step implementation plan for ADR ${adr.id}` },
    ]);

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
