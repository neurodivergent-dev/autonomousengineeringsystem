/**
 * MetaFrame Autonomous Engineering System — Core Domain Types
 */

export type EntityStatus = "DRAFT" | "PROPOSED" | "APPROVED" | "ACCEPTED" | "REJECTED" | "SUPERSEDED";

export interface UserStory {
  persona: string;
  want: string;
  soThat: string;
}

export interface PRD {
  id: string; // e.g. "PRD-2026-001"
  title: string;
  version: string;
  status: EntityStatus;
  overview: string;
  userStories: UserStory[];
  functionalRequirements: string[];
  nonFunctionalRequirements: string[];
  acceptanceCriteria: string[];
  targetDomains: string[];
  createdAt: string;
}

export interface ADR {
  id: string; // e.g. "ADR-2026-001"
  prdRef: string; // References PRD.id
  title: string;
  status: EntityStatus;
  context: string;
  decision: string;
  alternativesConsidered: string[];
  consequences: {
    positive: string[];
    negative: string[];
    risks: string[];
  };
  impactedModules: string[];
  blastRadiusRisk: "LOW" | "MEDIUM" | "HIGH";
  createdAt: string;
}

export interface PlanStep {
  order: number;
  description: string;
  targetFile: string;
  targetSymbols: string[];
  actionType: "CREATE" | "MODIFY" | "DELETE" | "REFACTOR";
  testCriteria: string;
}

export interface ImplementationPlan {
  id: string; // e.g. "PLAN-2026-001"
  adrRef: string; // References ADR.id
  prdRef: string; // References PRD.id
  title: string;
  status: EntityStatus;
  targetFiles: string[];
  steps: PlanStep[];
  blastRadiusRisk: "LOW" | "MEDIUM" | "HIGH";
  verificationGateChecklist: string[];
  createdAt: string;
}

export interface GateResult {
  gateName: string;
  passed: boolean;
  durationMs: number;
  errors: string[];
  warnings: string[];
}

export interface VerificationReport {
  timestamp: string;
  targetPath?: string;
  overallPassed: boolean;
  gates: GateResult[];
}

export interface ASTFileCard {
  filePath: string;
  framework?: string;
  role?: "Component" | "Hook" | "Store" | "Service" | "Util" | "Config" | "Unknown";
  risk?: "LOW" | "MEDIUM" | "HIGH";
  sizeLines?: number;
  exports: string[];
  callers: string[];
  dependencies: string[];
  dependents: string[];
}

export interface TraceabilityEntry {
  prdId: string;
  adrId: string;
  planId: string;
  targetFiles: string[];
  status: EntityStatus;
  lastVerifiedAt?: string;
}

export interface TraceabilityStore {
  version: string;
  updatedAt: string;
  entries: TraceabilityEntry[];
}
