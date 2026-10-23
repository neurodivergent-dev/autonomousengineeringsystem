import { SharedLLMClient } from "../llm/client";
import { ASTBridge } from "../intelligence/ast-bridge";
import { KnowledgeStore } from "../knowledge/store";
import { GateRunner } from "../gates/gate-runner";
import { ProductDiscoveryAgent } from "./product-discovery";
import { SolutionsArchitectAgent } from "./solutions-architect";
import { ImplementationPlannerAgent } from "./implementation-planner";
import { CodeExecutorAgent, PlanExecutionSummary } from "./code-executor";
import { CodeHealerAgent } from "./code-healer";
import type { PRD, ADR, ImplementationPlan, VerificationReport } from "../types";

export interface WorkflowResult {
  prd: PRD;
  adr: ADR;
  plan: ImplementationPlan;
  execution?: PlanExecutionSummary;
  verificationReport: VerificationReport;
  selfHealed?: boolean;
  success: boolean;
}

export type ProgressCallback = (event: { type: string; [key: string]: any }) => void;

export class LeadOrchestrator {
  private llm: SharedLLMClient;
  private astBridge: ASTBridge;
  private store: KnowledgeStore;
  private gateRunner: GateRunner;

  private discoveryAgent: ProductDiscoveryAgent;
  private architectAgent: SolutionsArchitectAgent;
  private plannerAgent: ImplementationPlannerAgent;
  private codeExecutor: CodeExecutorAgent;
  private codeHealer: CodeHealerAgent;

  constructor(repoRoot: string = process.cwd()) {
    this.llm = new SharedLLMClient();
    this.astBridge = new ASTBridge(repoRoot);
    this.store = new KnowledgeStore(repoRoot);
    this.gateRunner = new GateRunner(repoRoot);

    this.discoveryAgent = new ProductDiscoveryAgent(this.llm);
    this.architectAgent = new SolutionsArchitectAgent(this.llm, this.astBridge);
    this.plannerAgent = new ImplementationPlannerAgent(this.llm, this.astBridge);
    this.codeExecutor = new CodeExecutorAgent(this.llm, repoRoot);
    this.codeHealer = new CodeHealerAgent(this.llm, repoRoot);
  }

  /**
   * Runs the complete MetaFrame Autonomous Workflow with real-time streaming progress:
   */
  public async executeWorkflow(
    featurePrompt: string,
    candidateFiles: string[] = [],
    executeCode: boolean = false,
    onProgress?: ProgressCallback
  ): Promise<WorkflowResult> {
    console.log(`\n\x1b[35m[MetaFrame Orchestrator]\x1b[0m Starting workflow for: "${featurePrompt}"`);
    onProgress?.({ type: "start", prompt: featurePrompt });

    // 1. Gather AST Domain & Navigation context
    console.log(`\x1b[34m[1/${executeCode ? 5 : 4}] Querying AST Codebase Topology...\x1b[0m`);
    onProgress?.({ type: "phase", phase: 1, name: "Topology", message: "AST Kod Ağacı ve Etki Alanı Haritası Çıkarılıyor..." });
    const routesSummary = this.astBridge.getRoutes();

    // 2. Product Discovery
    console.log(`\x1b[34m[2/${executeCode ? 5 : 4}] Product Discovery Agent: Generating PRD...\x1b[0m`);
    onProgress?.({ type: "phase", phase: 2, name: "PRD", message: "Orion: Ürün Gereksinim Dokümanı (PRD) Yazılıyor..." });
    const prd = await this.discoveryAgent.createPRD(featurePrompt, routesSummary);
    this.store.savePRD(prd);
    console.log(`\x1b[32m  ✔ Generated ${prd.id}: "${prd.title}"\x1b[0m`);
    onProgress?.({ type: "prd_complete", prd });

    // 3. Solutions Architecture
    console.log(`\x1b[34m[3/${executeCode ? 5 : 4}] Solutions Architect Agent: Formulating ADR with Blast Radius...\x1b[0m`);
    onProgress?.({ type: "phase", phase: 3, name: "ADR", message: "Daedalus: AST Blast Radius Etki Analizi ve Mimari Karar (ADR) Alınıyor..." });
    const adr = await this.architectAgent.createADR(prd, candidateFiles);
    this.store.saveADR(adr);
    console.log(`\x1b[32m  ✔ Generated ${adr.id}: "${adr.title}" (Risk: ${adr.blastRadiusRisk})\x1b[0m`);
    onProgress?.({ type: "adr_complete", adr });

    // 4. Implementation Planning
    console.log(`\x1b[34m[4/${executeCode ? 5 : 4}] Implementation Planner Agent: Producing atomic task plan...\x1b[0m`);
    onProgress?.({ type: "phase", phase: 4, name: "Plan", message: "Vulcan: Atomik Dosya ve Kod Uygulama Planı Hazırlanıyor..." });
    const plan = await this.plannerAgent.createPlan(prd, adr, candidateFiles);
    this.store.savePlan(plan);
    console.log(`\x1b[32m  ✔ Generated ${plan.id} (${plan.steps.length} steps planned)\x1b[0m`);
    onProgress?.({ type: "plan_complete", plan });

    let execution: PlanExecutionSummary | undefined;

    // 5. Autonomous Code Execution (Optional / Build Mode)
    if (executeCode) {
      console.log(`\x1b[34m[5/5] Code Executor Agent: Generating code & writing to disk via ${this.llm.modelName}...\x1b[0m`);
      onProgress?.({
        type: "phase",
        phase: 5,
        name: "CodeExecution",
        message: `Gemma 12B: Canlı Kod Üretimi Başlatıldı (${this.llm.modelName} GPU)...`,
      });

      execution = await this.codeExecutor.executePlan(
        plan,
        prd,
        adr,
        (token) => {
          onProgress?.({ type: "code_token", token });
        }
      );

      if (execution.overallSuccess) {
        console.log(`\x1b[32m  ✔ All ${execution.executedSteps.length} files generated and written to disk!\x1b[0m`);
        onProgress?.({ type: "code_complete", execution });
      } else {
        console.warn(`\x1b[33m  ⚠ Code execution finished with ${execution.errors.length} error(s).\x1b[0m`);
        onProgress?.({ type: "code_error", errors: execution.errors });
      }
    }

    // 6. Run Verification Gates
    console.log(`\n\x1b[33m[Verification] Running Deterministic 6-Gate Safety Chain...\x1b[0m`);
    onProgress?.({ type: "phase", phase: 6, name: "Gates", message: "Aegis: 6 Deterministik Kalite ve Güvenlik Kapısı Koşuyor..." });
    const primaryTarget = candidateFiles[0] || (execution?.executedSteps[0]?.filePath) || undefined;
    let report = this.gateRunner.runAllGates(primaryTarget);

    report.gates.forEach((g) => {
      const statusIcon = g.passed ? "\x1b[32m✔ PASS\x1b[0m" : "\x1b[31m✖ FAIL\x1b[0m";
      console.log(`  ${statusIcon} ${g.gateName} (${g.durationMs}ms)`);
      onProgress?.({ type: "gate_result", gate: g });
    });

    // 7. Self-Healing Closed Loop (Surgical repair if gates failed)
    let selfHealed = false;
    if (!report.overallPassed && primaryTarget && executeCode) {
      const failingGates = report.gates.filter((g) => !g.passed && g.errors.length > 0);
      if (failingGates.length > 0) {
        console.log(`\n\x1b[33m[Self-Healing Loop]\x1b[0m ⚠ ${failingGates.length} gate failure(s) detected. Engaging Gemma 4 for targeted surgical fix...`);
        onProgress?.({
          type: "self_heal_start",
          failingGates: failingGates.map((g) => g.gateName),
          message: "Kapı ihlali tespit edildi! Gemma 4 cerrahi yama uyguluyor...",
        });

        const healResult = await this.codeHealer.healFile(primaryTarget, failingGates);
        if (healResult.healed) {
          selfHealed = true;
          console.log(`\x1b[33m[Self-Healing Loop]\x1b[0m Re-running 6-Gate safety chain on patched code...`);
          const retestReport = this.gateRunner.runAllGates(primaryTarget);
          retestReport.gates.forEach((g) => {
            const statusIcon = g.passed ? "\x1b[32m✔ PASS\x1b[0m" : "\x1b[31m✖ FAIL\x1b[0m";
            console.log(`  ${statusIcon} ${g.gateName} (${g.durationMs}ms)`);
            onProgress?.({ type: "gate_result", gate: g, isRetest: true });
          });
          if (retestReport.overallPassed) {
            console.log(`\x1b[32m✔ [Self-Healing Loop] All gates verified clean! Code self-healed successfully.\x1b[0m`);
            onProgress?.({ type: "self_heal_success", message: "Cerrahi yama başarıyla doğrulandı, tüm kapılar temiz!" });
            report = retestReport;
          }
        }
      }
    }

    console.log(
      `\n\x1b[36m[Traceability Matrix Updated]\x1b[0m Linked ${prd.id} -> ${adr.id} -> ${plan.id} -> Codebase`
    );

    const finalResult: WorkflowResult = {
      prd,
      adr,
      plan,
      execution,
      verificationReport: report,
      selfHealed,
      success: report.overallPassed && (execution ? execution.overallSuccess : true),
    };

    onProgress?.({ type: "finish", result: finalResult });

    return finalResult;
  }
}
