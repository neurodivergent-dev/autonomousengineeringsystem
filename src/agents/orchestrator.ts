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

export interface ConfidenceBreakdown {
  errorResolutionRate: number; // 40% weight
  zeroRegressionScore: number;  // 30% weight
  astPrecisionScore: number;    // 15% weight
  gateChainScore: number;       // 15% weight
  totalScore: number;           // 0 - 100%
  formulaDescription: string;
}

export interface HealingDiagnostics {
  baselineErrorsCount: number;
  failingGatesCount: number;
  filesTargeted: string[];
  retestErrorsCount: number;
  deltaErrors: number;
  iterationsCount: number;
  maxIterations: number;
  regressionDetected: boolean;
  rollbackOccurred: boolean;
  confidenceScore: number; // 0 - 100
  confidenceBreakdown?: ConfidenceBreakdown;
  recoveryStatus: "VERIFIED_RECOVERY" | "PARTIAL_RECOVERY" | "REGRESSION_ROLLED_BACK" | "CIRCUIT_BREAKER_TRIPPED" | "NO_ACTION";
}

export interface WorkflowResult {
  prd: PRD;
  adr: ADR;
  plan: ImplementationPlan;
  execution?: PlanExecutionSummary;
  verificationReport: VerificationReport;
  selfHealed?: boolean;
  healingDiagnostics?: HealingDiagnostics;
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

  constructor(repoRoot: string = process.cwd(), systemRoot?: string) {
    this.llm = new SharedLLMClient();
    this.astBridge = new ASTBridge(repoRoot, systemRoot);
    this.store = new KnowledgeStore(repoRoot);
    this.gateRunner = new GateRunner(repoRoot, systemRoot);

    this.discoveryAgent = new ProductDiscoveryAgent(this.llm);
    this.architectAgent = new SolutionsArchitectAgent(this.llm, this.astBridge);
    this.plannerAgent = new ImplementationPlannerAgent(this.llm, this.astBridge);
    this.codeExecutor = new CodeExecutorAgent(this.llm, repoRoot);
    this.codeHealer = new CodeHealerAgent(this.llm, repoRoot);
  }

  /**
   * Transparent, Multi-Factor Repair Confidence Score Calculator
   * Weighted Components:
   *  - Error Resolution Rate (40%)
   *  - Zero Regression Factor (30%)
   *  - AST Node Scope & Precision (15%)
   *  - Gate Chain Agreement (15%)
   */
  public calculateConfidence(
    baselineErrors: number,
    remainingErrors: number,
    passedGates: number,
    totalGates: number,
    regressionOccurred: boolean,
    astScopePreserved: boolean = true
  ): { score: number; breakdown: ConfidenceBreakdown } {
    if (regressionOccurred) {
      const breakdown: ConfidenceBreakdown = {
        errorResolutionRate: 0,
        zeroRegressionScore: 0,
        astPrecisionScore: 0,
        gateChainScore: Math.round((passedGates / totalGates) * 15),
        totalScore: 0,
        formulaDescription: "Regresyon (Hata artışı) tespit edildi → Güven skoru 0 olarak sıfırlandı.",
      };
      return { score: 0, breakdown };
    }

    if (remainingErrors === 0 && passedGates === totalGates) {
      const breakdown: ConfidenceBreakdown = {
        errorResolutionRate: 40,
        zeroRegressionScore: 30,
        astPrecisionScore: 15,
        gateChainScore: 15,
        totalScore: 100,
        formulaDescription: "Verified Recovery: 0 Hata + 0 Regresyon + 6/6 Kapı Onayı = %100",
      };
      return { score: 100, breakdown };
    }

    // 1. Error Resolution (40%)
    const resolutionFraction = baselineErrors > 0 ? Math.max(0, (baselineErrors - remainingErrors) / baselineErrors) : 0;
    const errorResolutionRate = Math.round(resolutionFraction * 40);

    // 2. Zero Regression (30%)
    const zeroRegressionScore = remainingErrors <= baselineErrors ? 30 : 0;

    // 3. AST Precision (15%)
    const astPrecisionScore = astScopePreserved ? 15 : 5;

    // 4. Gate Chain Agreement (15%)
    const gateChainScore = Math.round((passedGates / totalGates) * 15);

    const totalScore = Math.min(95, errorResolutionRate + zeroRegressionScore + astPrecisionScore + gateChainScore);

    const formulaDescription = `Multi-Factor Formula: Hata Çözümü (${errorResolutionRate}/40) + Sıfır Regresyon (${zeroRegressionScore}/30) + AST Kapsam (${astPrecisionScore}/15) + Kapı Uyumu (${gateChainScore}/15) = %${totalScore}`;

    return {
      score: totalScore,
      breakdown: {
        errorResolutionRate,
        zeroRegressionScore,
        astPrecisionScore,
        gateChainScore,
        totalScore,
        formulaDescription,
      },
    };
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
    this.llm.onStatusChange = (status) => {
      onProgress?.({
        type: "agent_activity",
        agent: "System",
        text: status.message,
      });
    };
    onProgress?.({ type: "start", prompt: featurePrompt });

    // 1. Gather AST Domain & Navigation context
    console.log(`\x1b[34m[1/${executeCode ? 5 : 4}] Querying AST Codebase Topology...\x1b[0m`);
    onProgress?.({ type: "phase", phase: 1, name: "Topology", message: "AST Kod Ağacı ve Etki Alanı Haritası Çıkarılıyor..." });
    onProgress?.({ type: "agent_activity", agent: "AST", text: "AST kod ağacı taranıyor; yönlendirmeler ve modül ilişkileri haritalanıyor..." });
    const routesSummary = this.astBridge.getRoutes();
    onProgress?.({ type: "agent_activity", agent: "AST", text: "AST haritası hazırlandı; mevcut rota ve sembol bağlantıları çözüldü." });
    onProgress?.({ type: "topology_complete", routes: routesSummary });

    // 2. Product Discovery
    console.log(`\x1b[34m[2/${executeCode ? 5 : 4}] Product Discovery Agent: Generating PRD...\x1b[0m`);
    onProgress?.({ type: "phase", phase: 2, name: "PRD", message: "Orion: Ürün Gereksinim Dokümanı (PRD) Yazılıyor..." });
    onProgress?.({ type: "agent_activity", agent: "Orion", text: "Kullanıcı talebi analiz ediliyor; kullanıcı hikayeleri ve kabul kriterleri oluşturuluyor..." });
    const prd = await this.discoveryAgent.createPRD(featurePrompt, routesSummary, (token) => {
      onProgress?.({ type: "agent_token", agent: "Orion", phase: 2, token });
    });
    this.store.savePRD(prd);
    console.log(`\x1b[32m  ✔ Generated ${prd.id}: "${prd.title}"\x1b[0m`);
    onProgress?.({ type: "agent_activity", agent: "Orion", text: `✔ PRD onaylandı: "${prd.title}" (${prd.userStories?.length || 0} kullanıcı hikayesi, ${prd.functionalRequirements?.length || 0} gereksinim)` });
    onProgress?.({ type: "prd_complete", prd });

    // 3. Solutions Architecture
    console.log(`\x1b[34m[3/${executeCode ? 5 : 4}] Solutions Architect Agent: Formulating ADR with Blast Radius...\x1b[0m`);
    onProgress?.({ type: "phase", phase: 3, name: "ADR", message: "Daedalus: AST Blast Radius Etki Analizi ve Mimari Karar (ADR) Alınıyor..." });
    onProgress?.({ type: "agent_activity", agent: "Daedalus", text: "AST etki alanı (blast radius) ve modül bağımlılıkları inceleniyor..." });
    const adr = await this.architectAgent.createADR(prd, candidateFiles, (token) => {
      onProgress?.({ type: "agent_token", agent: "Daedalus", phase: 3, token });
    });
    this.store.saveADR(adr);
    console.log(`\x1b[32m  ✔ Generated ${adr.id}: "${adr.title}" (Risk: ${adr.blastRadiusRisk})\x1b[0m`);
    onProgress?.({ type: "agent_activity", agent: "Daedalus", text: `✔ Mimari karar kabul edildi: "${adr.title}" [Risk: ${adr.blastRadiusRisk}]` });
    onProgress?.({ type: "adr_complete", adr });

    // 4. Implementation Planning
    console.log(`\x1b[34m[4/${executeCode ? 5 : 4}] Implementation Planner Agent: Producing atomic task plan...\x1b[0m`);
    onProgress?.({ type: "phase", phase: 4, name: "Plan", message: "Vulcan: Atomik Dosya ve Kod Uygulama Planı Hazırlanıyor..." });
    onProgress?.({ type: "agent_activity", agent: "Vulcan", text: "Mimari karara göre adım adım dosya bazlı uygulama planı ve test kriterleri çıkarılıyor..." });
    const plan = await this.plannerAgent.createPlan(prd, adr, candidateFiles, (token) => {
      onProgress?.({ type: "agent_token", agent: "Vulcan", phase: 4, token });
    });
    this.store.savePlan(plan);
    console.log(`\x1b[32m  ✔ Generated ${plan.id} (${plan.steps.length} steps planned)\x1b[0m`);
    onProgress?.({ type: "agent_activity", agent: "Vulcan", text: `✔ Uygulama Planı hazır: ${plan.steps?.length || 0} atomik görev yapılandırıldı.` });
    onProgress?.({ type: "plan_complete", plan });

    let execution: PlanExecutionSummary | undefined;

    // 5. Autonomous Code Execution (Optional / Build Mode)
    if (executeCode) {
      console.log(`\x1b[34m[5/5] Code Executor Agent: Generating code & writing to disk via ${this.llm.modelName}...\x1b[0m`);
      onProgress?.({
        type: "phase",
        phase: 5,
        name: "CodeExecution",
        message: `Groq LPU: Canlı Kod Üretimi Başlatıldı (${this.llm.modelName} ~500 tok/s)...`,
      });

      execution = await this.codeExecutor.executePlan(
        plan,
        prd,
        adr,
        undefined, // Avoid double token emission; onStepProgress emits code_token with targetFile
        (event) => {
          onProgress?.(event);
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
    onProgress?.({ type: "agent_activity", agent: "Aegis", text: "6 aşamalı deterministik kalite kapısı doğrulaması başlatıldı..." });
    const primaryTarget = candidateFiles[0] || (execution?.executedSteps[0]?.filePath) || undefined;
    let report = this.gateRunner.runAllGates(primaryTarget);

    report.gates.forEach((g) => {
      const statusIcon = g.passed ? "\x1b[32m✔ PASS\x1b[0m" : "\x1b[31m✖ FAIL\x1b[0m";
      console.log(`  ${statusIcon} ${g.gateName} (${g.durationMs}ms)`);
      onProgress?.({
        type: "agent_activity",
        agent: "Aegis",
        text: `Kapı [${g.gateName}]: ${g.passed ? "✔ GEÇTİ" : `✖ İHLAL (${g.errors.length} hata)`} (${g.durationMs}ms)`,
      });
      onProgress?.({ type: "gate_result", gate: g });
    });

    // 7. Self-Healing Closed Loop (Iterative Multi-Pass Convergence & Regression Guard)
    let selfHealed = false;
    let healingDiagnostics: HealingDiagnostics | undefined;

    if (!report.overallPassed && executeCode) {
      const MAX_REPAIR_ITERATIONS = 3;
      let iteration = 1;
      let currentReport = report;
      const initialFailingGates = currentReport.gates.filter((g) => !g.passed && g.errors.length > 0);
      const baselineErrorsCount = initialFailingGates.reduce((sum, g) => sum + g.errors.length, 0);

      if (initialFailingGates.length > 0) {
        console.log(`\n\x1b[33m[Self-Healing Loop]\x1b[0m ⚠ Başlangıç Teşhisi: ${initialFailingGates.length} kapı ihlali (Baseline: ${baselineErrorsCount} hata) tespit edildi.`);
        onProgress?.({
          type: "self_heal_start",
          failingGates: initialFailingGates.map((g) => g.gateName),
          baselineErrorsCount,
          maxIterations: MAX_REPAIR_ITERATIONS,
          message: `[Iterative Repair Loop] Başlangıç: ${baselineErrorsCount} hata tespit edildi. Maksimum ${MAX_REPAIR_ITERATIONS} iterasyonlu yakınsama döngüsü başlatılıyor...`,
        });
        onProgress?.({
          type: "agent_activity",
          agent: "Healer",
          text: `[Baseline Diagnostics] ${baselineErrorsCount} hata kaydedildi. İteratif cerrahi onarım başlatılıyor (Maks ${MAX_REPAIR_ITERATIONS} iterasyon)...`,
        });

        const allTargetedFiles = new Set<string>();

        while (iteration <= MAX_REPAIR_ITERATIONS) {
          const currentFailingGates = currentReport.gates.filter((g) => !g.passed && g.errors.length > 0);
          const currentErrorsCount = currentFailingGates.reduce((sum, g) => sum + g.errors.length, 0);

          if (currentErrorsCount === 0 && currentReport.overallPassed) {
            break;
          }

          // 1. Isolate failing files for current remaining errors
          const iterationFailingFiles = new Set<string>();
          for (const gate of currentFailingGates) {
            for (const err of gate.errors) {
              const match = err.match(/(?:^|\s)([a-zA-Z0-9_\-./\\]+\.(?:tsx?|jsx?|css|json))\b(?::|\()/);
              if (match && match[1]) {
                iterationFailingFiles.add(match[1].replace(/\\/g, "/"));
                allTargetedFiles.add(match[1].replace(/\\/g, "/"));
              }
            }
          }

          const isInfraError = currentFailingGates.some((g) =>
            g.errors.some((e) => e.includes("spawnSync") || e.includes("ETIMEDOUT") || e.includes("ENOENT"))
          );

          if (iterationFailingFiles.size === 0 && primaryTarget && !isInfraError) {
            iterationFailingFiles.add(primaryTarget);
            allTargetedFiles.add(primaryTarget);
          }

          const targetFileList = Array.from(iterationFailingFiles);

          if (targetFileList.length === 0) {
            console.warn(`\x1b[33m[Iterative Loop]\x1b[0m ⚠ Hata dosya kaynağı AST üzerinde izole edilemedi (Altyapı/Süre aşımı). İterasyon durduruldu.`);
            onProgress?.({
              type: "agent_activity",
              agent: "Healer",
              text: `⚠ [İterasyon ${iteration}] Hata kaynağı dosya izole edilemedi. Gereksiz dosya müdahalesi engellendi.`,
            });
            break;
          }

          console.log(`\n\x1b[36m[Iterative Loop - Pasaj ${iteration}/${MAX_REPAIR_ITERATIONS}]\x1b[0m Hedef: ${targetFileList.join(", ")} (${currentErrorsCount} hata)`);
          onProgress?.({
            type: "agent_activity",
            agent: "Healer",
            text: `[İterasyon ${iteration}/${MAX_REPAIR_ITERATIONS}] Kalan ${currentErrorsCount} hata için ${targetFileList.join(", ")} dosyalarına minimal cerrahi yama uygulanıyor...`,
          });

          // 2. Snapshot target files before this iteration (Regression Guard)
          const iterationSnapshots = new Map<string, string | null>();
          for (const f of targetFileList) {
            iterationSnapshots.set(f, this.codeHealer.createSnapshot(f));
          }

          // 3. Surgical repair on target files
          let anyHealed = false;
          for (const fileToHeal of targetFileList) {
            const healResult = await this.codeHealer.healFile(fileToHeal, currentFailingGates);
            if (healResult.healed) {
              anyHealed = true;
            } else if (healResult.integrity && !healResult.integrity.passed) {
              onProgress?.({
                type: "agent_activity",
                agent: "Healer",
                text: `✖ [Patch Integrity Monitor] ${fileToHeal} yaması reddedildi: ${healResult.integrity.violations.join(" | ")}`,
              });
            } else if (healResult.behavioral && !healResult.behavioral.passed) {
              onProgress?.({
                type: "agent_activity",
                agent: "Healer",
                text: `✖ [Behavioral Integrity Engine] ${fileToHeal} yaması reddedildi: ${healResult.behavioral.summary}`,
              });
            }
          }

          if (!anyHealed) {
            console.warn(`[Iterative Loop] İterasyon ${iteration}: Hiçbir dosyaya yama uygulanamadı.`);
            break;
          }

          // 4. Retest 6-Gate safety chain
          onProgress?.({
            type: "agent_activity",
            agent: "Healer",
            text: `[İterasyon ${iteration}] Cerrahi yama uygulandı; kalite kapıları doğrulanıyor...`,
          });
          const retestReport = this.gateRunner.runAllGates(primaryTarget);
          const retestErrorsCount = retestReport.gates
            .filter((g) => !g.passed)
            .reduce((sum, g) => sum + g.errors.length, 0);

          const stepDelta = retestErrorsCount - currentErrorsCount;

          retestReport.gates.forEach((g) => {
            const statusIcon = g.passed ? "\x1b[32m✔ PASS\x1b[0m" : "\x1b[31m✖ FAIL\x1b[0m";
            console.log(`  ${statusIcon} [İterasyon ${iteration}] ${g.gateName} (${g.durationMs}ms)`);
            onProgress?.({
              type: "agent_activity",
              agent: "Aegis",
              text: `[İterasyon ${iteration}] Doğrulama [${g.gateName}]: ${g.passed ? "✔ GEÇTİ" : `✖ BAŞARISIZ (${g.errors.length} hata)`}`,
            });
            onProgress?.({ type: "gate_result", gate: g, isRetest: true });
          });

          // 5. Regression Guard Check
          if (stepDelta > 0) {
            // REGRESSION: Errors increased during this step!
            console.warn(`\x1b[31m[Regression Guard] ⚠ İterasyon ${iteration}'de hata sayısı arttı! (${currentErrorsCount} → ${retestErrorsCount}, Delta: +${stepDelta})\x1b[0m`);
            console.warn(`\x1b[35m[Regression Guard] ↩ Otomatik Rollback devrede...\x1b[0m`);

            for (const [f, snap] of iterationSnapshots.entries()) {
              this.codeHealer.rollback(f, snap);
            }

            const { score, breakdown } = this.calculateConfidence(
              baselineErrorsCount,
              currentErrorsCount,
              currentReport.gates.filter((g) => g.passed).length,
              currentReport.gates.length,
              true
            );

            healingDiagnostics = {
              baselineErrorsCount,
              failingGatesCount: initialFailingGates.length,
              filesTargeted: Array.from(allTargetedFiles),
              retestErrorsCount: currentErrorsCount,
              deltaErrors: currentErrorsCount - baselineErrorsCount,
              iterationsCount: iteration,
              maxIterations: MAX_REPAIR_ITERATIONS,
              regressionDetected: true,
              rollbackOccurred: true,
              confidenceScore: score,
              confidenceBreakdown: breakdown,
              recoveryStatus: "REGRESSION_ROLLED_BACK",
            };

            onProgress?.({
              type: "agent_activity",
              agent: "Healer",
              text: `⚠ [Regression Guard] İterasyon ${iteration}'de hata sayısı arttığı için yama geri alındı (Rollback). Güven Skoru: %0. Mimar veya Debugger Modu'na eskalasyon öneriliyor.`,
            });
            break;
          }

          // Convergence: Check if 0 errors reached
          currentReport = retestReport;

          if (retestReport.overallPassed) {
            selfHealed = true;
            report = retestReport;

            const { score, breakdown } = this.calculateConfidence(
              baselineErrorsCount,
              0,
              retestReport.gates.length,
              retestReport.gates.length,
              false
            );

            healingDiagnostics = {
              baselineErrorsCount,
              failingGatesCount: initialFailingGates.length,
              filesTargeted: Array.from(allTargetedFiles),
              retestErrorsCount: 0,
              deltaErrors: -baselineErrorsCount,
              iterationsCount: iteration,
              maxIterations: MAX_REPAIR_ITERATIONS,
              regressionDetected: false,
              rollbackOccurred: false,
              confidenceScore: score,
              confidenceBreakdown: breakdown,
              recoveryStatus: "VERIFIED_RECOVERY",
            };

            console.log(`\x1b[32m✔ [Verified Recovery] ${iteration}. iterasyonda tüm kapılar temizlendi! Repair Confidence: %100\x1b[0m`);
            onProgress?.({
              type: "agent_activity",
              agent: "Healer",
              text: `✔ [Verified Recovery] ${iteration}. iterasyonda 0 hata ile onarım tamamlandı! Repair Confidence: %100 (${breakdown.formulaDescription})`,
            });
            onProgress?.({ type: "self_heal_success", message: `Cerrahi yama ${iteration}. iterasyonda başarıyla doğrulandı, tüm kapılar temiz!` });
            break;
          }

          // Errors reduced but still > 0: proceed to next iteration!
          if (stepDelta < 0) {
            const { score, breakdown } = this.calculateConfidence(
              baselineErrorsCount,
              retestErrorsCount,
              retestReport.gates.filter((g) => g.passed).length,
              retestReport.gates.length,
              false
            );

            console.log(`\x1b[32m✔ [Iterative Convergence]\x1b[0m İterasyon ${iteration} başarılı: Hata sayısı ${currentErrorsCount} → ${retestErrorsCount} oldu [Delta: ${stepDelta}, Güven: %${score}].`);
            onProgress?.({
              type: "agent_activity",
              agent: "Healer",
              text: `✔ İterasyon ${iteration} başarılı: Hatalar ${currentErrorsCount} → ${retestErrorsCount} seviyesine indi [Delta: ${stepDelta}]. Güven: %${score} (${breakdown.formulaDescription}). Kalan ${retestErrorsCount} hata için ${iteration + 1}. iterasyon başlatılıyor...`,
            });
          } else {
            // stepDelta === 0: Stagnation
            console.warn(`[Iterative Loop] İterasyon ${iteration}: Hata sayısı değişmedi (${retestErrorsCount}). Döngü sonlandırılıyor.`);
            onProgress?.({
              type: "agent_activity",
              agent: "Healer",
              text: `⚠ İterasyon ${iteration}: Kalan ${retestErrorsCount} hata bu aşamada giderilemedi. Döngü kilitlenmesini önlemek için durduruldu.`,
            });
            break;
          }

          iteration++;
        }

        // Final diagnostics if still not overallPassed
        if (!currentReport.overallPassed && !healingDiagnostics) {
          const finalErrorsCount = currentReport.gates
            .filter((g) => !g.passed)
            .reduce((sum, g) => sum + g.errors.length, 0);

          const { score, breakdown } = this.calculateConfidence(
            baselineErrorsCount,
            finalErrorsCount,
            currentReport.gates.filter((g) => g.passed).length,
            currentReport.gates.length,
            false
          );

          healingDiagnostics = {
            baselineErrorsCount,
            failingGatesCount: initialFailingGates.length,
            filesTargeted: Array.from(allTargetedFiles),
            retestErrorsCount: finalErrorsCount,
            deltaErrors: finalErrorsCount - baselineErrorsCount,
            iterationsCount: Math.min(iteration, MAX_REPAIR_ITERATIONS),
            maxIterations: MAX_REPAIR_ITERATIONS,
            regressionDetected: false,
            rollbackOccurred: false,
            confidenceScore: score,
            confidenceBreakdown: breakdown,
            recoveryStatus: finalErrorsCount < baselineErrorsCount ? "PARTIAL_RECOVERY" : "CIRCUIT_BREAKER_TRIPPED",
          };

          report = currentReport;
        }
      }
    } else if (report.overallPassed) {
      onProgress?.({
        type: "agent_activity",
        agent: "Aegis",
        text: "✔ Tüm kalite kapıları ilk denemede 0 hata ile eksiksiz onaylandı!",
      });
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
      healingDiagnostics,
      success: report.overallPassed && (execution ? execution.overallSuccess : true),
    };

    onProgress?.({ type: "finish", result: finalResult });

    return finalResult;
  }
}
