#!/usr/bin/env bun
import { LeadOrchestrator } from "./agents/orchestrator";
import { GateRunner } from "./gates/gate-runner";
import { ASTBridge } from "./intelligence/ast-bridge";
import { KnowledgeStore } from "./knowledge/store";

const args = process.argv.slice(2);
const command = args[0] || "help";

console.log(`
\x1b[35m╭─────────────────────────────────────────────────────────────╮
│          MetaFrame Autonomous Engineering System            │
│  AST-Grounded Multi-Agent Orchestrator & Deterministic Gates│
╰─────────────────────────────────────────────────────────────╯\x1b[0m
`);

async function main() {
  const orchestrator = new LeadOrchestrator();
  const gateRunner = new GateRunner();
  const astBridge = new ASTBridge();
  const store = new KnowledgeStore();

  switch (command) {
    case "plan": {
      let promptArgs = args.slice(1);
      const shouldExecute = promptArgs.includes("--execute");
      promptArgs = promptArgs.filter((a) => a !== "--execute");

      let candidateFiles: string[] = [];
      const filesIdx = promptArgs.indexOf("--files");
      if (filesIdx !== -1) {
        candidateFiles = (promptArgs[filesIdx + 1] || "").split(",").map((s) => s.trim()).filter(Boolean);
        promptArgs.splice(filesIdx, 2);
      }

      const prompt = promptArgs.join(" ").trim();
      if (!prompt) {
        console.error('\x1b[31mError: Please specify a feature prompt. Example: bun run metaframe plan "Add dark mode toggle"\x1b[0m');
        process.exit(1);
      }
      const result = await orchestrator.executeWorkflow(prompt, candidateFiles, shouldExecute);
      console.log(`\n\x1b[32mWorkflow complete!\x1b[0m Artifacts stored in \`.metaframe/\`:`);
      console.log(`  • PRD: .metaframe/prds/${result.prd.id}.md`);
      console.log(`  • ADR: .metaframe/adrs/${result.adr.id}.md`);
      console.log(`  • PLAN: .metaframe/plans/${result.plan.id}.md`);
      if (result.execution) {
        console.log(`\n\x1b[36mExecuted Files (${result.execution.executedSteps.length}):\x1b[0m`);
        result.execution.executedSteps.forEach((s) => {
          const icon = s.success ? "\x1b[32m✔\x1b[0m" : "\x1b[31m✖\x1b[0m";
          console.log(`  ${icon} ${s.filePath} (${s.codeLength} chars)`);
        });
      }
      break;
    }

    case "build": {
      let promptArgs = args.slice(1);
      let candidateFiles: string[] = [];
      const filesIdx = promptArgs.indexOf("--files");
      if (filesIdx !== -1) {
        candidateFiles = (promptArgs[filesIdx + 1] || "").split(",").map((s) => s.trim()).filter(Boolean);
        promptArgs.splice(filesIdx, 2);
      }

      const prompt = promptArgs.join(" ").trim();
      if (!prompt) {
        console.error('\x1b[31mError: Please specify a feature prompt. Example: bun run src/cli.ts build "Create cyber matrix dashboard in apps/dashboard/index.html"\x1b[0m');
        process.exit(1);
      }
      console.log(`\x1b[36m[MetaFrame Autonomous Build Mode]\x1b[0m Generating plan & writing code directly to disk...`);
      const result = await orchestrator.executeWorkflow(prompt, candidateFiles, true);
      console.log(`\n\x1b[32mBuild complete!\x1b[0m Artifacts stored in \`.metaframe/\`:`);
      console.log(`  • PRD: .metaframe/prds/${result.prd.id}.md`);
      console.log(`  • ADR: .metaframe/adrs/${result.adr.id}.md`);
      console.log(`  • PLAN: .metaframe/plans/${result.plan.id}.md`);
      if (result.execution) {
        console.log(`\n\x1b[36mAutonomous Code Generation Results (${result.execution.executedSteps.length}):\x1b[0m`);
        result.execution.executedSteps.forEach((s) => {
          const icon = s.success ? "\x1b[32m✔\x1b[0m" : "\x1b[31m✖\x1b[0m";
          console.log(`  ${icon} ${s.filePath} (${s.codeLength} chars)`);
        });
      }
      break;
    }

    case "verify": {
      const targetPath = args[1];
      console.log(`Running 6-Gate Closed-Loop Verification ${targetPath ? `for: ${targetPath}` : "full project"}...`);
      const report = gateRunner.runAllGates(targetPath);

      report.gates.forEach((g) => {
        const icon = g.passed ? "\x1b[32m✔ PASS\x1b[0m" : "\x1b[31m✖ FAIL\x1b[0m";
        console.log(`  ${icon} ${g.gateName} (${g.durationMs}ms)`);
        if (g.errors.length > 0) {
          g.errors.slice(0, 5).forEach((e) => console.log(`      \x1b[31m${e}\x1b[0m`));
        }
      });
      console.log(`\nVerdict: ${report.overallPassed ? "\x1b[32mAll gates passed!\x1b[0m" : "\x1b[31mQuality gates failed.\x1b[0m"}`);
      break;
    }

    case "trace": {
      const trace = store.getTraceability();
      console.log(`\x1b[36mTraceability Matrix (Last updated: ${trace.updatedAt})\x1b[0m\n`);
      if (trace.entries.length === 0) {
        console.log("No traceability entries recorded yet. Run `metaframe plan <prompt>` to generate one.");
        return;
      }
      console.table(
        trace.entries.map((e) => ({
          PRD: e.prdId,
          ADR: e.adrId || "None",
          Plan: e.planId || "None",
          Files: e.targetFiles.join(", ") || "General",
          Status: e.status,
        }))
      );
      break;
    }

    case "query": {
      const term = args[1] || "";
      if (!term) {
        console.log("Usage: bun run metaframe query <term>");
        return;
      }
      console.log(astBridge.queryTool("query", term));
      break;
    }

    case "impact": {
      const file = args[1] || "";
      if (!file) {
        console.log("Usage: bun run metaframe impact <file_path>");
        return;
      }
      const impact = astBridge.getImpact(file);
      console.log(`\nImpact Analysis for: \x1b[1m${file}\x1b[0m`);
      console.log(`Risk Rating: \x1b[33m${impact.risk}\x1b[0m`);
      console.log(`Affected Files (${impact.affectedFiles.length}):`);
      impact.affectedFiles.forEach((f) => console.log(`  • ${f}`));
      break;
    }

    case "help":
    default: {
      console.log(`
\x1b[1mKullanım:\x1b[0m
  bun run src/cli.ts build "<istek>"    Tam otonom kod üretimi: PRD -> ADR -> Plan -> Yerel LLM Kod Yazımı -> 6 Kapı
  bun run src/cli.ts plan "<istek>"     Planlama akışını başlat (PRD -> ADR -> Plan -> Kapılar)
  bun run src/cli.ts verify [dosya]     6 kapılı deterministik güvenlik zincirini çalıştır
  bun run src/cli.ts trace              PRD -> ADR -> Plan -> Kod izlenebilirlik tablosunu göster
  bun run src/cli.ts query <kelime>     AST kod tabanı semantik araması yap
  bun run src/cli.ts impact <dosya>     Bir dosyanın etki alanını (blast radius) hesapla
  bun run src/cli.ts help               Bu yardım mesajını göster
`);
      break;
    }
  }
}

main().catch((err) => {
  console.error("MetaFrame Error:", err);
  process.exit(1);
});
