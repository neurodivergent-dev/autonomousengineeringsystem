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

  public async createADR(prd: PRD, candidateFiles: string[] = []): Promise<ADR> {
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

    const systemPrompt = `You are the Solutions Architect Agent in the MetaFrame Autonomous Engineering System.
Your responsibility is to formulate an Architecture Decision Record (ADR) based on an approved PRD and AST codebase intelligence.
You rigorously analyze trade-offs, stability, and blast radius.

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

    const rawResponse = await this.llm.chat([
      { role: "system", content: systemPrompt },
      { role: "user", content: `Evaluate architecture and produce ADR for PRD: ${prd.id}` },
    ]);

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
