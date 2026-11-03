#!/usr/bin/env bun
import { resolve, join } from "path";
import { existsSync } from "fs";
import { LeadOrchestrator } from "./agents/orchestrator";
import { GateRunner } from "./gates/gate-runner";
import { ASTBridge } from "./intelligence/ast-bridge";
import { KnowledgeStore } from "./knowledge/store";

let rawArgs = process.argv.slice(2);

// Extract --target or -t
let targetRepo = process.cwd();
const targetIdx = rawArgs.findIndex((a) => a === "--target" || a === "-t");
if (targetIdx !== -1 && rawArgs[targetIdx + 1]) {
  targetRepo = resolve(rawArgs[targetIdx + 1]);
  rawArgs.splice(targetIdx, 2);
} else if (process.env.TARGET_REPO) {
  targetRepo = resolve(process.env.TARGET_REPO);
}

if (!existsSync(targetRepo)) {
  console.error(`\x1b[31mError: Target directory does not exist: ${targetRepo}\x1b[0m`);
  process.exit(1);
}

const systemRoot = resolve(__dirname, "..");
const command = rawArgs[0] || "help";
const args = rawArgs;

console.log(`
\x1b[35m╭─────────────────────────────────────────────────────────────╮
│          MetaFrame Autonomous Engineering System            │
│  AST-Grounded Multi-Agent Orchestrator & Deterministic Gates│
╰─────────────────────────────────────────────────────────────╯\x1b[0m
\x1b[90mTarget Workspace:\x1b[0m \x1b[36m${targetRepo}\x1b[0m
\x1b[90mEngine Root:\x1b[0m      \x1b[90m${systemRoot}\x1b[0m
`);

async function main() {
  const orchestrator = new LeadOrchestrator(targetRepo, systemRoot);
  const gateRunner = new GateRunner(targetRepo, systemRoot);
  const astBridge = new ASTBridge(targetRepo, systemRoot);
  const store = new KnowledgeStore(targetRepo);

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
        console.error('\x1b[31mError: Please specify a feature prompt. Example: bun run src/cli.ts plan "Add dark mode toggle" -t <path>\x1b[0m');
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
        console.error('\x1b[31mError: Please specify a feature prompt. Example: bun run src/cli.ts build "Create cyber matrix dashboard" -t <path>\x1b[0m');
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
      console.log(`Running 6-Gate Closed-Loop Verification ${targetPath ? `for: ${targetPath}` : "full project"} in ${targetRepo}...`);
      const report = gateRunner.runAllGates(targetPath);

      report.gates.forEach((g) => {
        const icon = g.passed ? "\x1b[32m✔ PASS\x1b[0m" : "\x1b[31m✖ FAIL\x1b[0m";
        console.log(`  ${icon} ${g.gateName} (${g.durationMs}ms)`);
        if (g.warnings.length > 0) {
          g.warnings.forEach((w) => console.log(`      \x1b[33m⚠ ${w}\x1b[0m`));
        }
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
        console.log("No traceability entries recorded yet. Run `plan` to generate one.");
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
        console.log("Usage: bun run src/cli.ts query <term> [-t <repo>]");
        return;
      }
      console.log(astBridge.queryTool("query", term));
      break;
    }

    case "impact": {
      const file = args[1] || "";
      if (!file) {
        console.log("Usage: bun run src/cli.ts impact <file_path> [-t <repo>]");
        return;
      }
      const impact = astBridge.getImpact(file);
      console.log(`\nImpact Analysis for: \x1b[1m${file}\x1b[0m`);
      console.log(`Risk Rating: \x1b[33m${impact.risk}\x1b[0m`);
      console.log(`Affected Files (${impact.affectedFiles.length}):`);
      impact.affectedFiles.forEach((f) => console.log(`  • ${f}`));
      break;
    }

    case "index": {
      console.log(`\x1b[36m[AST Knowledge Graph Indexing for: ${targetRepo}]\x1b[0m`);
      const res = astBridge.indexGraph();
      console.log(`\n\x1b[32m✔ Knowledge Graph generated successfully in ${res.durationMs}ms!\x1b[0m`);
      console.log(`  • Indexed Files (Nodes): \x1b[1m${res.nodeCount}\x1b[0m`);
      console.log(`  • Dependency Edges:      \x1b[1m${res.edgeCount}\x1b[0m`);
      console.log(`  • Target File:           \x1b[36m${res.outputPath}\x1b[0m`);
      break;
    }

    case "analyze": {
      console.log(`\x1b[36m[AST Topology Analysis for: ${targetRepo}]\x1b[0m`);
      const hasGraph = astBridge.hasKnowledgeGraph();
      console.log(`Knowledge Graph: ${hasGraph ? "\x1b[32mFound\x1b[0m" : "\x1b[33mNot pre-computed. Run 'bun run src/cli.ts index -t <repo>' to build!\x1b[0m"}`);

      console.log(`\n\x1b[34m[Route Map]\x1b[0m`);
      const routes = astBridge.getRoutes();
      console.log(routes.split("\n").slice(0, 15).join("\n"));

      console.log(`\n\x1b[34m[Supabase / Data Map]\x1b[0m`);
      const supa = astBridge.getSupabaseOverview();
      console.log(supa.split("\n").slice(0, 15).join("\n"));

      console.log(`\n\x1b[34m[6-Gate Health Check]\x1b[0m`);
      const report = gateRunner.runAllGates();
      report.gates.forEach((g) => {
        const icon = g.passed ? "\x1b[32m✔ PASS\x1b[0m" : "\x1b[31m✖ FAIL\x1b[0m";
        console.log(`  ${icon} ${g.gateName} (${g.durationMs}ms)`);
      });
      break;
    }

    case "help":
    default: {
      console.log(`
\x1b[1mKullanım:\x1b[0m
  bun run src/cli.ts index [-t <repo>]            Hedef repo için AST Knowledge Graph üretir (ai-reports/knowledge_graph.json)
  bun run src/cli.ts verify [dosya] [-t <repo>]   6 kapılı deterministik güvenlik zincirini çalıştır
  bun run src/cli.ts plan "<istek>" [-t <repo>]   Planlama akışını başlat (PRD -> ADR -> Plan -> Kapılar)
  bun run src/cli.ts build "<istek>" [-t <repo>]  Tam otonom kod üretimi (PRD -> ADR -> Plan -> Kod Yazımı -> Kapılar)
  bun run src/cli.ts analyze [-t <repo>]          Hedef kod tabanının topolojisini ve kapılarını analiz et
  bun run src/cli.ts trace [-t <repo>]            PRD -> ADR -> Plan -> Kod izlenebilirlik tablosunu göster
  bun run src/cli.ts query <kelime> [-t <repo>]   AST kod tabanı semantik araması yap
  bun run src/cli.ts impact <dosya> [-t <repo>]   Bir dosyanın etki alanını (blast radius) hesapla
  bun run src/cli.ts help                         Bu yardım mesajını göster

\x1b[1mSeçenekler:\x1b[0m
  -t, --target <path>   Hedef depo yolu (varsayılan: geçerli dizin)
  --files <f1,f2>       İlgili aday dosyalar
  --execute             Plan komutunda kod üretimini de tetikle
`);
      break;
    }
  }
}

main().catch((err) => {
  console.error("MetaFrame Error:", err);
  process.exit(1);
});
