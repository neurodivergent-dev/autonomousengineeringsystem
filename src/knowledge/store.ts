import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "fs";
import { join } from "path";
import type { PRD, ADR, ImplementationPlan, TraceabilityStore, TraceabilityEntry } from "../types";

export class KnowledgeStore {
  private baseDir: string;
  private prdsDir: string;
  private adrsDir: string;
  private plansDir: string;
  private tracePath: string;

  constructor(repoRoot: string = process.cwd()) {
    this.baseDir = join(repoRoot, ".metaframe");
    this.prdsDir = join(this.baseDir, "prds");
    this.adrsDir = join(this.baseDir, "adrs");
    this.plansDir = join(this.baseDir, "plans");
    this.tracePath = join(this.baseDir, "traceability.json");
    this.initDirs();
  }

  private initDirs(): void {
    if (!existsSync(this.baseDir)) mkdirSync(this.baseDir, { recursive: true });
    if (!existsSync(this.prdsDir)) mkdirSync(this.prdsDir, { recursive: true });
    if (!existsSync(this.adrsDir)) mkdirSync(this.adrsDir, { recursive: true });
    if (!existsSync(this.plansDir)) mkdirSync(this.plansDir, { recursive: true });
    if (!existsSync(this.tracePath)) {
      const initialStore: TraceabilityStore = {
        version: "1.0.0",
        updatedAt: new Date().toISOString(),
        entries: [],
      };
      writeFileSync(this.tracePath, JSON.stringify(initialStore, null, 2), "utf-8");
    }
  }

  // --- PRD Persistence ---
  public savePRD(prd: PRD): void {
    const jsonPath = join(this.prdsDir, `${prd.id}.json`);
    const mdPath = join(this.prdsDir, `${prd.id}.md`);
    writeFileSync(jsonPath, JSON.stringify(prd, null, 2), "utf-8");

    const mdContent = `# ${prd.id}: ${prd.title}
**Status:** ${prd.status} | **Version:** ${prd.version} | **Created:** ${prd.createdAt}

## Overview
${prd.overview}

## User Stories
${prd.userStories.map((s) => `- **As a** ${s.persona}, **I want to** ${s.want}, **so that** ${s.soThat}`).join("\n")}

## Functional Requirements
${prd.functionalRequirements.map((r, i) => `${i + 1}. ${r}`).join("\n")}

## Non-Functional Requirements
${prd.nonFunctionalRequirements.map((r, i) => `- ${r}`).join("\n")}

## Acceptance Criteria
${prd.acceptanceCriteria.map((c, i) => `- [ ] ${c}`).join("\n")}
`;
    writeFileSync(mdPath, mdContent, "utf-8");
    this.updateTraceability(prd.id, "", "", []);
  }

  public getPRD(id: string): PRD | null {
    const jsonPath = join(this.prdsDir, `${id}.json`);
    if (!existsSync(jsonPath)) return null;
    return JSON.parse(readFileSync(jsonPath, "utf-8"));
  }

  public listPRDs(): PRD[] {
    const files = readdirSync(this.prdsDir).filter((f) => f.endsWith(".json"));
    return files.map((f) => JSON.parse(readFileSync(join(this.prdsDir, f), "utf-8")));
  }

  // --- ADR Persistence ---
  public saveADR(adr: ADR): void {
    const jsonPath = join(this.adrsDir, `${adr.id}.json`);
    const mdPath = join(this.adrsDir, `${adr.id}.md`);
    writeFileSync(jsonPath, JSON.stringify(adr, null, 2), "utf-8");

    const mdContent = `# ${adr.id}: ${adr.title}
**Status:** ${adr.status} | **PRD Reference:** [${adr.prdRef}](../prds/${adr.prdRef}.md) | **Blast Radius Risk:** ${adr.blastRadiusRisk}

## Context
${adr.context}

## Decision
${adr.decision}

## Alternatives Considered
${adr.alternativesConsidered.map((a, i) => `${i + 1}. ${a}`).join("\n")}

## Consequences
### Positive
${adr.consequences.positive.map((p) => `- ${p}`).join("\n")}

### Negative & Trade-offs
${adr.consequences.negative.map((n) => `- ${n}`).join("\n")}

### Identified Risks
${adr.consequences.risks.map((r) => `- ${r}`).join("\n")}

## Impacted Modules
${adr.impactedModules.map((m) => `- \`${m}\``).join("\n")}
`;
    writeFileSync(mdPath, mdContent, "utf-8");
    this.updateTraceability(adr.prdRef, adr.id, "", adr.impactedModules);
  }

  public getADR(id: string): ADR | null {
    const jsonPath = join(this.adrsDir, `${id}.json`);
    if (!existsSync(jsonPath)) return null;
    return JSON.parse(readFileSync(jsonPath, "utf-8"));
  }

  public listADRs(): ADR[] {
    const files = readdirSync(this.adrsDir).filter((f) => f.endsWith(".json"));
    return files.map((f) => JSON.parse(readFileSync(join(this.adrsDir, f), "utf-8")));
  }

  // --- Implementation Plan Persistence ---
  public savePlan(plan: ImplementationPlan): void {
    const jsonPath = join(this.plansDir, `${plan.id}.json`);
    const mdPath = join(this.plansDir, `${plan.id}.md`);
    writeFileSync(jsonPath, JSON.stringify(plan, null, 2), "utf-8");

    const mdContent = `# ${plan.id}: ${plan.title}
**Status:** ${plan.status} | **ADR Ref:** [${plan.adrRef}](../adrs/${plan.adrRef}.md) | **PRD Ref:** [${plan.prdRef}](../prds/${plan.prdRef}.md) | **Risk:** ${plan.blastRadiusRisk}

## Target Files
${plan.targetFiles.map((f) => `- \`${f}\``).join("\n")}

## Execution Steps
${plan.steps
  .map(
    (s) => `### Step ${s.order}: ${s.description}
- **Action:** \`${s.actionType}\` on \`${s.targetFile}\`
- **Target Symbols:** ${s.targetSymbols.map((sym) => `\`${sym}\``).join(", ") || "N/A"}
- **Verification Criteria:** ${s.testCriteria}
`
  )
  .join("\n")}

## Verification Checklist
${plan.verificationGateChecklist.map((c) => `- [ ] ${c}`).join("\n")}
`;
    writeFileSync(mdPath, mdContent, "utf-8");
    this.updateTraceability(plan.prdRef, plan.adrRef, plan.id, plan.targetFiles);
  }

  public getPlan(id: string): ImplementationPlan | null {
    const jsonPath = join(this.plansDir, `${id}.json`);
    if (!existsSync(jsonPath)) return null;
    return JSON.parse(readFileSync(jsonPath, "utf-8"));
  }

  // --- Traceability Matrix ---
  private updateTraceability(prdId: string, adrId: string, planId: string, files: string[]): void {
    const trace = this.getTraceability();
    let entry = trace.entries.find((e) => e.prdId === prdId);

    if (!entry) {
      entry = {
        prdId,
        adrId: adrId || "",
        planId: planId || "",
        targetFiles: files,
        status: "DRAFT",
      };
      trace.entries.push(entry);
    } else {
      if (adrId) entry.adrId = adrId;
      if (planId) entry.planId = planId;
      if (files && files.length > 0) {
        entry.targetFiles = Array.from(new Set([...entry.targetFiles, ...files]));
      }
    }

    trace.updatedAt = new Date().toISOString();
    writeFileSync(this.tracePath, JSON.stringify(trace, null, 2), "utf-8");
  }

  public getTraceability(): TraceabilityStore {
    try {
      return JSON.parse(readFileSync(this.tracePath, "utf-8"));
    } catch {
      return { version: "1.0.0", updatedAt: new Date().toISOString(), entries: [] };
    }
  }
}
