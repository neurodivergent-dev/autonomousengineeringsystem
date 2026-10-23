import { join } from "path";
import { PromptRefinerAgent } from "../src/agents/prompt-refiner";
import { LeadOrchestrator } from "../src/agents/orchestrator";

const PORT = 5960;
const CITY_PATH = join(import.meta.dir, "cyberpunk-city", "index.html");
const WORKFORCE_PATH = join(import.meta.dir, "agent-workforce", "index.html");
const SUBWAY_PATH = join(import.meta.dir, "subway-ast", "index.html");
const FACTORY_PATH = join(import.meta.dir, "code-factory", "index.html");
const PORTAL_PATH = join(import.meta.dir, "portal-ast", "index.html");
const PORTFOLIO_PATH = join(import.meta.dir, "..", "apps", "cyber-portfolio", "index.html");
const STUDIO_PATH = join(import.meta.dir, "studio", "index.html");
const LEGO_PATH = join(import.meta.dir, "cyber-lego", "index.html");

const promptRefiner = new PromptRefinerAgent();
const orchestrator = new LeadOrchestrator();

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    // API Routes
    if (req.method === "POST" && url.pathname === "/api/refine") {
      try {
        const body = (await req.json()) as { prompt?: string };
        const rawPrompt = body.prompt || "";
        if (!rawPrompt) {
          return Response.json({ success: false, error: "Prompt is required" }, { status: 400 });
        }
        const result = await promptRefiner.refinePrompt(rawPrompt);
        return Response.json({ success: true, result });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message }, { status: 500 });
      }
    }

    if (url.pathname === "/api/build-stream") {
      const prompt = url.searchParams.get("prompt") || "";
      const targetFile = url.searchParams.get("targetFile") || "";
      if (!prompt) {
        return new Response("Prompt is required", { status: 400 });
      }

      const stream = new ReadableStream({
        async start(controller) {
          const send = (data: any) => {
            try {
              controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`));
            } catch {}
          };

          try {
            const candidateFiles = targetFile ? [targetFile] : [];
            await orchestrator.executeWorkflow(prompt, candidateFiles, true, (event) => {
              send(event);
            });
            send({ type: "done" });
            controller.close();
          } catch (err: any) {
            send({ type: "error", error: err.message });
            controller.close();
          }
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        },
      });
    }

    // Static Web App Routes
    if (url.pathname === "/lego" || url.pathname === "/blocks") {
      return new Response(Bun.file(LEGO_PATH), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    if (url.pathname === "/studio" || url.pathname === "/app" || url.pathname === "/builder") {
      return new Response(Bun.file(STUDIO_PATH), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    if (url.pathname === "/" || url.pathname === "/city" || url.pathname === "/index.html") {
      return new Response(Bun.file(CITY_PATH), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    if (url.pathname === "/portfolio" || url.pathname === "/blog" || url.pathname === "/me") {
      return new Response(Bun.file(PORTFOLIO_PATH), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    if (url.pathname === "/workforce" || url.pathname === "/agents") {
      return new Response(Bun.file(WORKFORCE_PATH), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    if (url.pathname === "/surf" || url.pathname === "/subway" || url.pathname === "/runner") {
      return new Response(Bun.file(SUBWAY_PATH), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    if (url.pathname === "/factory" || url.pathname === "/factorio") {
      return new Response(Bun.file(FACTORY_PATH), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    if (url.pathname === "/portal" || url.pathname === "/glados") {
      return new Response(Bun.file(PORTAL_PATH), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    if (url.pathname === "/lego" || url.pathname === "/cyber-lego") {
      return new Response(Bun.file(LEGO_PATH), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    if (url.pathname.startsWith("/apps/")) {
      const relPath = url.pathname.replace(/^\/apps\//, "");
      const filePath = join(import.meta.dir, "..", "apps", relPath);
      return new Response(Bun.file(filePath));
    }
    return new Response("Not Found", { status: 404 });
  },
});

console.log(`\n🎛️ MetaFrame Studio (Neural Refiner): http://localhost:${PORT}/studio`);
console.log(`🚀 Cyber Portfolio & Blog:           http://localhost:${PORT}/portfolio`);
console.log(`🌆 Cyberpunk AST Spatial City:      http://localhost:${PORT}/city`);
console.log(`🤖 Agent Spatial Workforce:          http://localhost:${PORT}/workforce`);
console.log(`🏭 Cyber Code Factory:               http://localhost:${PORT}/factory`);
console.log(`🌀 Aperture AST Portal Gun:          http://localhost:${PORT}/portal`);
console.log(`🚇 Subway AST Surfers Runner:        http://localhost:${PORT}/surf\n`);
