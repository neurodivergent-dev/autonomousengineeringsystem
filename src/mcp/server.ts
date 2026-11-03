#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { resolve } from "path";
import { existsSync } from "fs";
import { LeadOrchestrator } from "../agents/orchestrator";
import { GateRunner } from "../gates/gate-runner";
import { ASTBridge } from "../intelligence/ast-bridge";
import { ASTIndexer } from "../intelligence/indexer";

const systemRoot = resolve(__dirname, "../..");
const defaultTarget = process.env.TARGET_REPO ? resolve(process.env.TARGET_REPO) : process.cwd();

// Helper to resolve repo root per request
function getRepo(repo?: string): string {
  const r = repo ? resolve(repo) : defaultTarget;
  if (!existsSync(r)) {
    throw new Error(`Target repository not found: ${r}`);
  }
  return r;
}

const server = new McpServer({
  name: "metaframe-engine",
  version: "1.0.0",
});

// Tool 1: Index Codebase (AST Knowledge Graph Generator)
server.tool(
  "metaframe_index",
  "Scans a target repository with TypeScript AST, builds the full dependency graph and entity map, and outputs ai-reports/knowledge_graph.json.",
  {
    repoRoot: z.string().optional().describe("Target repository root path (defaults to active workspace)"),
  },
  async ({ repoRoot }) => {
    try {
      const repo = getRepo(repoRoot);
      const indexer = new ASTIndexer(repo);
      const res = indexer.generate();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: true,
                targetRepo: repo,
                nodeCount: res.nodeCount,
                edgeCount: res.edgeCount,
                durationMs: res.durationMs,
                outputPath: res.outputPath,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error indexing codebase: ${err.message}` }],
      };
    }
  }
);

// Tool 2: Verify Gates (6-Gate Safety Chain)
server.tool(
  "metaframe_verify_gates",
  "Runs the deterministic 6-Gate safety chain (TypeScript 0 errors, Blast Radius, Theme Token Enforcer, Zero-Emoji UX Guard, i18n Translation Integrity, AST Code Health).",
  {
    targetPath: z.string().optional().describe("Specific file path to verify (leave empty for full repo verification)"),
    repoRoot: z.string().optional().describe("Target repository root path"),
  },
  async ({ targetPath, repoRoot }) => {
    try {
      const repo = getRepo(repoRoot);
      const gateRunner = new GateRunner(repo, systemRoot);
      const report = gateRunner.runAllGates(targetPath);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(report, null, 2),
          },
        ],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error running verification gates: ${err.message}` }],
      };
    }
  }
);

// Tool 3: Blast Radius Analysis
server.tool(
  "metaframe_blast_radius",
  "Calculates the transitive blast radius, risk level (LOW/MEDIUM/HIGH), and all affected screens/files for a file in the repository.",
  {
    filePath: z.string().describe("Target file path to evaluate transitive impact for"),
    repoRoot: z.string().optional().describe("Target repository root path"),
  },
  async ({ filePath, repoRoot }) => {
    try {
      const repo = getRepo(repoRoot);
      const bridge = new ASTBridge(repo, systemRoot);
      const impact = bridge.getImpact(filePath);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                targetFile: filePath,
                targetRepo: repo,
                risk: impact.risk,
                affectedCount: impact.affectedFiles.length,
                affectedFiles: impact.affectedFiles,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error calculating blast radius: ${err.message}` }],
      };
    }
  }
);

// Tool 4: AST Semantic Query
server.tool(
  "metaframe_ast_query",
  "Queries the AST knowledge graph: find callers of a function, render sites of a JSX component, direct dependencies, or file cards.",
  {
    action: z
      .enum(["query", "file", "deps", "dependents", "callers", "where", "impact", "change"])
      .describe("Query action to execute"),
    argument: z.string().describe("Search term, function name, component name, or relative file path"),
    repoRoot: z.string().optional().describe("Target repository root path"),
  },
  async ({ action, argument, repoRoot }) => {
    try {
      const repo = getRepo(repoRoot);
      const bridge = new ASTBridge(repo, systemRoot);
      const result = bridge.queryTool(action, argument);
      return {
        content: [{ type: "text", text: result || "No results found." }],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error executing AST query: ${err.message}` }],
      };
    }
  }
);

// Tool 5: Supabase Schema & Usage Map
server.tool(
  "metaframe_supabase_map",
  "Maps Supabase database tables, SQL migration columns, and client service/screen usage across the repository.",
  {
    repoRoot: z.string().optional().describe("Target repository root path"),
  },
  async ({ repoRoot }) => {
    try {
      const repo = getRepo(repoRoot);
      const bridge = new ASTBridge(repo, systemRoot);
      const result = bridge.getSupabaseOverview();
      return {
        content: [{ type: "text", text: result }],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error mapping Supabase schema: ${err.message}` }],
      };
    }
  }
);

// Tool 6: Autonomous Planning Workflow
server.tool(
  "metaframe_orchestrate_plan",
  "Runs the LeadOrchestrator multi-agent workflow (ProductDiscovery -> SolutionsArchitect -> ImplementationPlanner) to produce PRD, ADR, and atomic implementation plan.",
  {
    prompt: z.string().describe("Feature request or refactoring goal prompt"),
    candidateFiles: z.array(z.string()).optional().describe("List of candidate file paths to ground the architecture in"),
    repoRoot: z.string().optional().describe("Target repository root path"),
  },
  async ({ prompt, candidateFiles = [], repoRoot }) => {
    try {
      const repo = getRepo(repoRoot);
      const orchestrator = new LeadOrchestrator(repo, systemRoot);
      const result = await orchestrator.executeWorkflow(prompt, candidateFiles, false);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: result.success,
                prd: { id: result.prd.id, title: result.prd.title, overview: result.prd.overview },
                adr: { id: result.adr.id, title: result.adr.title, blastRadiusRisk: result.adr.blastRadiusRisk },
                plan: { id: result.plan.id, stepCount: result.plan.steps.length, steps: result.plan.steps },
                verification: result.verificationReport,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error running orchestration plan: ${err.message}` }],
      };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[MetaFrame MCP] Server running on stdio transport.");
}

main().catch((err) => {
  console.error("[MetaFrame MCP Fatal]", err);
  process.exit(1);
});
