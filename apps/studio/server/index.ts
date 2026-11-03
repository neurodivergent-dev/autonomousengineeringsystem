import { resolve, join, relative } from "path";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { ASTBridge } from "../../../src/intelligence/ast-bridge";
import { ASTIndexer } from "../../../src/intelligence/indexer";
import { GateRunner } from "../../../src/gates/gate-runner";
import { LeadOrchestrator } from "../../../src/agents/orchestrator";

let targetRepo = resolve(process.env.TARGET_REPO || "C:/Users/Melih/Documents/Projects/mindbook-pro");
const systemRoot = resolve(__dirname, "../../..");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

const IGNORED_DIRS = new Set([
  "node_modules", ".git", ".expo", ".next", "dist", "build",
  "ai-reports", ".metaframe", ".husky", "coverage", "android", "ios",
  ".agents", ".system_generated"
]);

export interface FileNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileNode[];
}

function getFileTree(dir: string, baseDir: string): FileNode[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const nodes: FileNode[] = [];
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const fullPath = join(dir, entry.name);
    const relPath = relative(baseDir, fullPath).replace(/\\/g, "/");

    if (entry.isDirectory()) {
      nodes.push({
        name: entry.name,
        path: relPath,
        isDirectory: true,
        children: getFileTree(fullPath, baseDir),
      });
    } else {
      nodes.push({
        name: entry.name,
        path: relPath,
        isDirectory: false,
      });
    }
  }

  return nodes.sort((a, b) => {
    if (a.isDirectory === b.isDirectory) return a.name.localeCompare(b.name);
    return a.isDirectory ? -1 : 1;
  });
}

const server = Bun.serve({
  port: 5180,
  async fetch(req: Request) {
    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(req.url);

    // 1. Status & Workspace
    if (url.pathname === "/api/status") {
      const bridge = new ASTBridge(targetRepo, systemRoot);
      return json({
        targetRepo,
        systemRoot,
        hasGraph: bridge.hasKnowledgeGraph(),
      });
    }

    if (url.pathname === "/api/workspace") {
      const tree = getFileTree(targetRepo, targetRepo);
      return json({ targetRepo, tree });
    }

    if (url.pathname === "/api/workspace/set" && req.method === "POST") {
      const body = (await req.json()) as any;
      if (body.path && existsSync(body.path)) {
        targetRepo = resolve(body.path);
        return json({ success: true, targetRepo });
      }
      return json({ error: "Invalid path" }, 400);
    }

    // 2. File Read & Write
    if (url.pathname === "/api/file") {
      const filePath = url.searchParams.get("path");
      if (!filePath) return json({ error: "Path required" }, 400);
      const fullPath = join(targetRepo, filePath);

      if (req.method === "GET") {
        if (!existsSync(fullPath)) return json({ error: "File not found" }, 404);
        try {
          const content = readFileSync(fullPath, "utf-8");
          return json({ path: filePath, content });
        } catch (e: any) {
          return json({ error: e.message }, 500);
        }
      }

      if (req.method === "POST") {
        const body = (await req.json()) as any;
        try {
          writeFileSync(fullPath, body.content, "utf-8");
          const runner = new GateRunner(targetRepo, systemRoot);
          const gateResult = runner.runAllGates(filePath);
          return json({ success: true, gateResult });
        } catch (e: any) {
          return json({ error: e.message }, 500);
        }
      }
    }

    // 3. AST Indexer (690ms generator)
    if (url.pathname === "/api/ast/index" && req.method === "POST") {
      try {
        const indexer = new ASTIndexer(targetRepo);
        const res = indexer.generate();
        return json({ success: true, result: res });
      } catch (e: any) {
        return json({ error: e.message }, 500);
      }
    }

    // 4. AST Impact (Blast Radius)
    if (url.pathname === "/api/ast/impact") {
      const file = url.searchParams.get("file");
      if (!file) return json({ error: "File required" }, 400);
      const bridge = new ASTBridge(targetRepo, systemRoot);
      const impact = bridge.getImpact(file);
      return json({ file, impact });
    }

    // 5. AST Semantic Query
    if (url.pathname === "/api/ast/query") {
      const action = url.searchParams.get("action") || "query";
      const arg = url.searchParams.get("arg") || "";
      const bridge = new ASTBridge(targetRepo, systemRoot);
      const result = bridge.queryTool(action, arg);
      return json({ action, arg, result });
    }

    // 6. 6-Gate Quality Chain
    if (url.pathname === "/api/gates/verify") {
      const file = url.searchParams.get("file") || undefined;
      const runner = new GateRunner(targetRepo, systemRoot);
      const report = runner.runAllGates(file);
      return json({ report });
    }

    // 7. Orchestrator Plan & Real-Time SSE Stream
    if (url.pathname === "/api/orchestrate/stream") {
      const prompt = url.searchParams.get("prompt") || "";
      const candidateFiles = (url.searchParams.get("files") || "").split(",").filter(Boolean);

      const stream = new ReadableStream({
        async start(controller) {
          const send = (event: any) => {
            try {
              controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
            } catch {
              // Ignore if client closed connection
            }
          };

          try {
            const orchestrator = new LeadOrchestrator(targetRepo, systemRoot);
            await orchestrator.executeWorkflow(prompt, candidateFiles, false, (event) => {
              send(event);
            });
            controller.close();
          } catch (err: any) {
            send({ type: "error", message: err.message });
            try { controller.close(); } catch {}
          }
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
          ...corsHeaders,
        },
      });
    }

    if (url.pathname === "/api/orchestrate/plan" && req.method === "POST") {
      const body = (await req.json()) as any;
      const orchestrator = new LeadOrchestrator(targetRepo, systemRoot);
      const result = await orchestrator.executeWorkflow(body.prompt, body.candidateFiles || [], false);
      return json({ result });
    }

    return json({ error: "Not found" }, 404);
  },
});

console.log(`[MetaFrame Studio Backend] Running on http://localhost:${server.port}`);
console.log(`[Target Workspace] ${targetRepo}`);
