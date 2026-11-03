import { SharedLLMClient } from "../llm/client";
import { ASTBridge } from "../intelligence/ast-bridge";
import type { PRD, ADR } from "../types";

export class SolutionsArchitectAgent {
  private llm: SharedLLMClient;
  private astBridge: ASTBridge;

  constructor(llm: SharedLLMClient, astBridge: ASTBridge) {
    this.llm = llm;
    this.astBridge = astBridge;
  }

  public async createADR(
    prd: PRD,
    candidateFiles: string[] = [],
    onToken?: (chunk: string) => void
  ): Promise<ADR> {
    const timestamp = new Date().toISOString();
    const adrId = `ADR-${Date.now().toString().slice(-4)}`;

    // Calculate blast radius for candidate files if any
    let blastRadiusRisk: "LOW" | "MEDIUM" | "HIGH" = "LOW";
    const impactedModules: string[] = [];

    for (const file of candidateFiles) {
      const impact = this.astBridge.getImpact(file);
      if (impact.risk === "HIGH") blastRadiusRisk = "HIGH";
      else if (impact.risk === "MEDIUM" && blastRadiusRisk !== "HIGH") blastRadiusRisk = "MEDIUM";
      impactedModules.push(...impact.affectedFiles);
    }

    // Query existing source files for grounding
    const existingFiles = this.astBridge.getSourceFiles();

    // Query relevant source files with actual code content
    const relevantFiles = this.astBridge.findRelevantSourceFiles(
      `${prd.title} ${prd.overview} ${(prd.functionalRequirements || []).join(" ")}`,
      candidateFiles
    );

    const systemPrompt = `You are the Solutions Architect Agent in the MetaFrame Autonomous Engineering System.
Your responsibility is to formulate an Architecture Decision Record (ADR) based on an approved PRD and AST codebase intelligence.
You rigorously analyze trade-offs, stability, and blast radius.

CRITICAL ARCHITECTURAL DIRECTIVES:
1. REUSE EXISTING COMPONENTS & PREVENT DUPLICATION:
   Existing Source Files in Repository:
   ${existingFiles.length > 0 ? existingFiles.join("\n   ") : "No existing source files."}
   - NEVER architect duplicate components (e.g. creating src/components/layout/Navbar.tsx when src/components/Navbar.tsx exists).
   - If a requested feature enhances an existing part of the app (Navbar, Hero, Features, Modal), explicitly decide to MODIFY the existing component!

2. ZERO OVER-ENGINEERING (KISS - KEEP IT SIMPLE):
   - Do NOT architect auxiliary layers like custom persistent hooks (e.g. usePersistentToggle), isolated context providers (e.g. ThemeContext.tsx), or separate token files unless explicitly demanded by the user.
   - If a component already manages or can manage the state directly (e.g. document.documentElement.dataset.theme or local state), do NOT create external state abstractions.

3. INSPECT ACTUAL CODE BEFORE DECIDING:
${relevantFiles.length > 0 ? relevantFiles.map((f) => `--- File: ${f.path} ---\n${f.content}`).join("\n\n") : "No relevant code files found."}
   - Review the actual code above carefully. Check what is already implemented and where the real breakdown is (e.g. check if the button already exists in Navbar, whether index.css defines required CSS variables, or if App.tsx uses hardcoded inline styles that block theming). Target only the files that need fixing!

PRD ID: ${prd.id}
PRD Title: ${prd.title}
PRD Functional Requirements: ${JSON.stringify(prd.functionalRequirements)}
Detected Blast Radius Risk: ${blastRadiusRisk}
Candidate Impacted Modules: ${JSON.stringify(Array.from(new Set(impactedModules)))}

Return ONLY a valid JSON object matching this schema:
{
  "id": "${adrId}",
  "prdRef": "${prd.id}",
  "title": "Architectural approach for ${prd.title}",
  "status": "ACCEPTED",
  "context": "Why this architectural decision is needed given codebase structure",
  "decision": "Explicit architectural decision taken",
  "alternativesConsidered": ["Alternative 1 (and why discarded)", "Alternative 2"],
  "consequences": {
    "positive": ["Positive consequence 1", "Positive consequence 2"],
    "negative": ["Trade-off / negative consequence"],
    "risks": ["Risk factor 1", "Risk factor 2"]
  },
  "impactedModules": ${JSON.stringify(candidateFiles.length > 0 ? candidateFiles : ["src/core"])},
  "blastRadiusRisk": "${blastRadiusRisk}",
  "createdAt": "${timestamp}"
}`;

    const rawResponse = await this.llm.chatStream(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Evaluate architecture and produce ADR for PRD: ${prd.id}` },
      ],
      onToken
    );

    const fallback: ADR = {
      id: adrId,
      prdRef: prd.id,
      title: `Architecture Decision for ${prd.title}`,
      status: "ACCEPTED",
      context: prd.overview,
      decision: `Adopt modular, AST-grounded implementation conforming to existing repository architecture.`,
      alternativesConsidered: ["Direct monolithic modification (discarded: increases blast radius)"],
      consequences: {
        positive: ["Preserves clean module boundaries", "Passes deterministic verification gates"],
        negative: ["Requires explicit interface updates across callers"],
        risks: blastRadiusRisk === "HIGH" ? ["High transitive caller impact detected"] : [],
      },
      impactedModules: candidateFiles.length > 0 ? candidateFiles : prd.targetDomains,
      blastRadiusRisk,
      createdAt: timestamp,
    };

    return this.llm.extractJSON<ADR>(rawResponse, fallback);
  }
}
