import { resolve, join, relative, basename, extname } from "path";
import { existsSync, readdirSync, readFileSync, writeFileSync, statSync, mkdirSync } from "fs";
import { exec } from "child_process";
import { ASTBridge } from "../../../src/intelligence/ast-bridge";
import { ASTIndexer } from "../../../src/intelligence/indexer";
import { TransactionalWorkspaceEngine } from "../../../src/intelligence/transactional-workspace";
import { GateRunner } from "../../../src/gates/gate-runner";
import { LeadOrchestrator } from "../../../src/agents/orchestrator";
import { SharedLLMClient } from "../../../src/llm/client";
import { SurgicalPatchEngine } from "../../../src/intelligence/surgical-patch";
import { SmartCodeIntegrator } from "../../../src/intelligence/code-integrator";
import { ASTPathResolver } from "../../../src/intelligence/ast-path-resolver";

function parseTargetArg(): string {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === "-t" || args[i] === "--target") && args[i + 1]) {
      return resolve(args[i + 1]);
    }
  }
  return resolve(process.env.TARGET_REPO || "C:/Users/Melih/Documents/Projects/landing-test");
}

let targetRepo = parseTargetArg();
let terminalCwd = targetRepo;
const systemRoot = resolve(__dirname, "../../..");
const workspaceEngine = new TransactionalWorkspaceEngine(targetRepo);

// Execute crash recovery on startup to roll back any uncommitted dangling transactions
const recovery = workspaceEngine.recoverCrash();
if (recovery.recoveredCount > 0) {
  console.log(`[Crash Recovery] Recovered ${recovery.recoveredCount} dangling transaction(s) on startup!`);
}

// Explicitly load .env from system root if present
const envFile = join(systemRoot, ".env");
if (existsSync(envFile)) {
  const envContent = readFileSync(envFile, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#") && trimmed.includes("=")) {
      const idx = trimmed.indexOf("=");
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim();
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}

export function detectComponentNameFromCode(code: string): string | null {
  if (!code || typeof code !== "string") return null;

  // 1. export default function ComponentName
  const m1 = code.match(/export\s+default\s+function\s+([A-Za-z0-9_]+)/);
  if (m1 && m1[1] && m1[1] !== "function") return m1[1];

  // 2. export default ComponentName;
  const m2 = code.match(/export\s+default\s+([A-Za-z0-9_]+)\s*;?/);
  if (m2 && m2[1] && m2[1] !== "React") return m2[1];

  // 3. const ComponentName: React.FC ... or function ComponentName()
  const m3 = code.match(/(?:const|function)\s+([A-Z][a-zA-Z0-9_]*)\s*(?::\s*React\.FC|:\s*FC|\s*=\s*\([^)]*\)\s*=>|\s*\()/);
  if (m3 && m3[1]) return m3[1];

  // 4. export const ComponentName
  const m4 = code.match(/export\s+(?:const|function)\s+([A-Z][a-zA-Z0-9_]*)/);
  if (m4 && m4[1]) return m4[1];

  return null;
}

export function resolveComponentFileFromPrompt(prompt: string, targetRepo: string): string | null {
  const lowerPrompt = prompt.toLowerCase();

  // Handle compound words like "herokartı", "herokart", "hero kart", "heroyu", "navbarı"
  if (lowerPrompt.includes("herokart") || lowerPrompt.includes("hero card") || (lowerPrompt.includes("hero") && lowerPrompt.includes("kart"))) {
    return "src/components/HeroCard.tsx";
  }
  if (lowerPrompt.includes("herocard")) {
    return "src/components/HeroCard.tsx";
  }
  if (lowerPrompt.includes("hero")) {
    return "src/components/Hero.tsx";
  }
  if (lowerPrompt.includes("navbar") || lowerPrompt.includes("header") || lowerPrompt.includes("menü") || lowerPrompt.includes("nav")) {
    return "src/components/Navbar.tsx";
  }
  if (lowerPrompt.includes("footer")) {
    return "src/components/Footer.tsx";
  }
  if (lowerPrompt.includes("card") || lowerPrompt.includes("kart")) {
    return "src/components/ui/Card.tsx";
  }
  if (lowerPrompt.includes("button") || lowerPrompt.includes("buton")) {
    return "src/components/ui/Button.tsx";
  }
  if (lowerPrompt.includes("settings") || lowerPrompt.includes("ayar")) {
    return "src/components/Settings.tsx";
  }
  if (lowerPrompt.includes("features") || lowerPrompt.includes("özellik")) {
    return "src/components/Features.tsx";
  }
  if (lowerPrompt.includes("contact") || lowerPrompt.includes("iletişim")) {
    return "src/components/Contact.tsx";
  }
  if (lowerPrompt.includes("auth") || lowerPrompt.includes("login") || lowerPrompt.includes("giriş")) {
    return "src/components/AuthModal.tsx";
  }

  // Regex for Turkish accusative suffixes: "X'i uygula", "X'i yap", "X'i ekle", "X'i değiştir"
  const suffixMatch = prompt.match(/\b([A-Z][a-zA-Z0-9_]+|[a-z][a-z0-9_]+)(?:'[ıiuü]|y[ıiuü]|[ıiuü])\s*(?:uygula|yap|ekle|değiştir|yaz|oluştur)/iu);
  if (suffixMatch && suffixMatch[1]) {
    const raw = suffixMatch[1].trim();
    const skip = ["yeni", "bir", "kodu", "kod", "bunu", "onu", "şunu", "herhangi"];
    if (!skip.includes(raw.toLowerCase())) {
      const capitalized = raw.charAt(0).toUpperCase() + raw.slice(1);
      return `src/components/${capitalized}.tsx`;
    }
  }

  return null;
}

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

if (!process.env.METAFRAME_PROVIDER) {
  process.env.METAFRAME_PROVIDER = process.env.GROQ_API_KEY ? "groq" : "ollama";
}
if (!process.env.METAFRAME_MODEL) {
  process.env.METAFRAME_MODEL = process.env.GROQ_API_KEY ? "qwen/qwen3.8-27b" : "gemma4:12b";
}

const server = Bun.serve({
  port: 5180,
  idleTimeout: 255, // Set max idleTimeout (255s in Bun) to prevent SSE disconnects during LLM inference
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
        provider: process.env.METAFRAME_PROVIDER,
        model: process.env.METAFRAME_MODEL,
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
        terminalCwd = targetRepo;
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
        let contentToSave = body.content || "";

        // 1. Auto-Normalize import paths and export signatures
        const astBridge = new ASTBridge(targetRepo, systemRoot);
        const allFiles = astBridge.getSourceFiles();
        const pathRes = ASTPathResolver.normalizeImports(contentToSave, filePath, targetRepo, allFiles);
        contentToSave = pathRes.code;

        // 2. Anti-Truncation & Smart Surgical Integration (Blocks accidental deletion of 100 lines with 1 line)
        if (existsSync(fullPath) && !body.force) {
          const currentDiskContent = readFileSync(fullPath, "utf-8");
          const intRes = SmartCodeIntegrator.integrate(currentDiskContent, contentToSave, filePath);
          if (!intRes.success) {
            return json({ success: false, error: intRes.reason }, 400);
          }
          contentToSave = intRes.finalCode;
        }

        try {
          const txnResult = await workspaceEngine.executeTransaction({
            author: "user",
            description: `Monaco Save: ${filePath}`,
            changes: { [filePath]: contentToSave },
            expectedBaseHashes: body.baseHash ? { [filePath]: body.baseHash } : undefined,
            skipBehavioralCheck: true, // Manual user saves don't block on test runner
          });

          if (!txnResult.success) {
            return json({ success: false, error: txnResult.error, violations: txnResult.violations }, 409);
          }

          const runner = new GateRunner(targetRepo, systemRoot);
          const gateResult = runner.runAllGates(filePath);
          return json({ success: true, txId: txnResult.txId, gateResult, content: contentToSave });
        } catch (e: any) {
          return json({ error: e.message }, 500);
        }
      }
    }

    // 2b. Transactional Workspace Journal & Undo / Redo
    if (url.pathname === "/api/transactions/journal" && req.method === "GET") {
      try {
        const journal = workspaceEngine.getJournal(50);
        return json({ success: true, journal });
      } catch (e: any) {
        return json({ error: e.message }, 500);
      }
    }

    if (url.pathname === "/api/transactions/undo" && req.method === "POST") {
      try {
        const body = (await req.json()) as any;
        if (!body.txId) return json({ error: "txId required" }, 400);
        const undoRes = workspaceEngine.undoTransaction(body.txId);
        return json(undoRes);
      } catch (e: any) {
        return json({ error: e.message }, 500);
      }
    }

    if (url.pathname === "/api/transactions/redo" && req.method === "POST") {
      try {
        const body = (await req.json()) as any;
        if (!body.txId) return json({ error: "txId required" }, 400);
        const redoRes = workspaceEngine.redoTransaction(body.txId);
        return json(redoRes);
      } catch (e: any) {
        return json({ error: e.message }, 500);
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

    // 7. Vibe Coding Mode — Direct Single-Turn Code Generation (Zero-Ceremony)
    if (url.pathname === "/api/vibe/stream") {
      let prompt = url.searchParams.get("prompt") || "";
      let activeFile = url.searchParams.get("file") || "";
      const ctxParam = url.searchParams.get("contextFiles");
      let vibeContextFiles: string[] = [];
      let images: string[] = [];

      if (req.method === "POST") {
        try {
          const body = (await req.json()) as any;
          if (body.prompt) prompt = body.prompt;
          if (body.file) activeFile = body.file;
          if (Array.isArray(body.contextFiles)) vibeContextFiles = body.contextFiles;
          if (Array.isArray(body.images)) images = body.images;
        } catch {}
      } else {
        if (ctxParam) {
          try {
            vibeContextFiles = JSON.parse(ctxParam);
          } catch {}
        }
      }

      const stream = new ReadableStream({
        async start(controller) {
          const send = (event: any) => {
            try {
              controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
            } catch {}
          };

          const startTime = Date.now();
          const heartbeat = setInterval(() => {
            send({ type: "heartbeat", timestamp: Date.now() });
          }, 2500);

          try {
            // Step 1: Context Retrieval & Target File Resolution
            const astBridge = new ASTBridge(targetRepo, systemRoot);
            const allSourceFiles = astBridge.getSourceFiles();

            send({ type: "vibe_start", prompt, activeFile });

            // Intelligent Target File Resolution: User prompt intent always overrides background activeFile
            let targetFile = "";
            const lowerPrompt = prompt.toLowerCase();

            // 1. Explicit file mentioned in prompt
            const explicitMatch = prompt.match(/\b([a-zA-Z0-9_\-./\\]+\.(?:tsx?|jsx?|css|html|json))\b/i);
            if (explicitMatch) {
              const raw = explicitMatch[1].replace(/\\/g, "/");
              targetFile = raw.startsWith("src/") ? raw : `src/${raw}`;
            }

            // 2. Component or Page creation intent: "X sayfası yap", "X componenti yap", "create X page", etc.
            if (!targetFile) {
              const pageMatch = prompt.match(/\b([A-Za-z0-9_-]+)\s*(?:sayfas[ıi]|sayfa|bile[şs]eni|bile[şs]en|componenti|component|view|paneli|modal[ıi])(?:\s|$|[,.])/iu)
                || prompt.match(/(?:create|make|add|build|generate)\s+([A-Za-z0-9_-]+)\s*(?:page|component|modal|view)?(?:\s|$|[,.])/iu);

              if (pageMatch && pageMatch[1]) {
                const name = pageMatch[1].trim();
                const skipWords = ["yeni", "bir", "new", "a", "the", "bu", "o", "şu", "herhangi"];
                if (!skipWords.includes(name.toLowerCase())) {
                  const capitalized = name.charAt(0).toUpperCase() + name.slice(1);
                  const isPageIntent = lowerPrompt.includes("sayfa") || lowerPrompt.includes("page");
                  const hasPagesDir = existsSync(resolve(targetRepo, "src/pages"));
                  const folder = (isPageIntent && hasPagesDir) ? "src/pages" : "src/components";
                  targetFile = `${folder}/${capitalized}.tsx`;
                }
              }
            }

            // 3. Known component and page keywords in prompt (including "herokartı", "herocard", etc.)
            if (!targetFile) {
              targetFile = resolveComponentFileFromPrompt(prompt, targetRepo) || "";
            }

            // 4. Fallback to activeFile from UI if set, otherwise default to App.tsx
            if (!targetFile) {
              targetFile = (activeFile && activeFile.trim().length > 0) ? activeFile : "src/App.tsx";
            }

            const targetFullPath = resolve(targetRepo, targetFile);
            let existingCode = "";
            const fileExists = existsSync(targetFullPath);
            if (fileExists) {
              existingCode = readFileSync(targetFullPath, "utf-8");
            }

            send({
              type: "vibe_context",
              targetFile,
              fileExists,
              existingBytes: existingCode.length,
              message: `Bağlam alındı: ${targetFile} (${fileExists ? `${existingCode.length} bayt mevcut` : "Yeni dosya oluşturulacak"})`,
            });

            // Step 2: Direct Code Generation via SharedLLMClient (Single turn, fast streaming)
            const llm = new SharedLLMClient();
            const fileExt = targetFile.split(".").pop() || "tsx";
            const isRewriteIntent = /\b(?:komple|ba[şs]tan|s[ıi]f[ıi]rdan|yeniden|rewrite|recreate)\b/i.test(prompt);
            const isExisting = fileExists && existingCode.trim().length > 120 && !isRewriteIntent;

            const systemPrompt = isExisting
              ? `You are the Ultra-Fast Surgical Code Patch Engine in MetaFrame.
Philosophy: ULTRA-CONCISE SURGICAL REPLACEMENT.
DO NOT REWRITE THE ENTIRE FILE! DO NOT COPY UNCHANGED CODE!

STRICT FORMAT:
<<<<<<< SEARCH
[exact 3-7 lines from the existing file to replace]
=======
[new replacement lines]
>>>>>>> REPLACE

CRITICAL RULES:
1. BREVITY IS MANDATORY: The SEARCH block MUST contain ONLY the 3 to 7 specific lines being modified (with 1 line of context before and after).
2. NEVER include more than 8 lines inside a SEARCH block!
3. NEVER start from line 1 of the file unless you are specifically modifying line 1! Jump directly to the lines that change.
4. Match exact indentation and syntax from the existing file.
5. If modifying multiple places, use multiple small SEARCH/REPLACE blocks.
6. If fixing a syntax, parse, or compiler error, locate the exact corrupted or unclosed lines and provide the clean replacement. Ensure all opened JSX tags and brackets are matched and closed.
7. Output ZERO markdown commentary, ZERO explanation. Output ONLY the search/replace block(s).`
              : `You are the Ultra-Fast Vibe Coding Engine in MetaFrame Studio.
Philosophy: DIRECT CODE GENERATION ONLY.
User Intent → Context Retrieval → Direct Code Generation → Applied to Editor.

CRITICAL RULES:
1. Output ONLY the raw, production-ready code inside \`\`\`${fileExt} and \`\`\` code blocks.
2. ZERO markdown prose, ZERO planning steps, ZERO explanations, ZERO thinking tags.
3. Start immediately with the imports and code.
4. If modifying existing code, preserve exports, styles, and existing functionality while cleanly implementing the requested feature.
5. Code must be syntactically valid TypeScript/React, respecting verbatimModuleSyntax (use 'import type' for type-only imports) and noUnusedLocals.`;

            let attachedVibeContext = "";
            for (const vf of vibeContextFiles) {
              const fullVf = resolve(targetRepo, vf);
              if (existsSync(fullVf) && vf !== targetFile) {
                try {
                  const content = readFileSync(fullVf, "utf-8");
                  attachedVibeContext += `\n\nAttached Context File (\`${vf}\`):\n\`\`\`tsx\n${content.length > 12000 ? content.slice(0, 12000) + "\n// ... [truncated]" : content}\n\`\`\``;
                } catch {}
              }
            }

            const userPrompt = fileExists
              ? `Target File: ${targetFile}
User Request: ${prompt}${attachedVibeContext}

Existing File Content:
\`\`\`${fileExt}
${existingCode.length > 35000 ? existingCode.slice(0, 35000) + "\n// ... [Remainder truncated for context window] ..." : existingCode}
\`\`\`

${isExisting
  ? `Provide the surgical <<<<<<< SEARCH ... ======= ... >>>>>>> REPLACE diff block(s) for ${targetFile} now:`
  : `Generate the complete, updated code for ${targetFile} now:`}`
              : `Target File: ${targetFile}
User Request: ${prompt}${attachedVibeContext}

Generate the complete, production-ready code for ${targetFile} now:`;

            let accumulatedCode = "";
            let tokenCount = 0;
            let tokenBatch = "";
            let batchTimer: any = null;

            const flushVibeBatch = () => {
              if (batchTimer) {
                clearTimeout(batchTimer);
                batchTimer = null;
              }
              if (tokenBatch) {
                send({ type: "vibe_token", token: tokenBatch, tokenCount });
                tokenBatch = "";
              }
            };

            const maxTokens = isExisting ? 1000 : 4096;

            const vibeUserMsg: ChatMessage = {
              role: "user" as const,
              content: userPrompt,
              images: images.length > 0 ? images : undefined,
            };

            await llm.chatStream(
              [
                { role: "system", content: systemPrompt },
                vibeUserMsg,
              ],
              (token) => {
                accumulatedCode += token;
                tokenCount++;
                tokenBatch += token;
                if (tokenBatch.length >= 60) {
                  flushVibeBatch();
                } else if (!batchTimer) {
                  batchTimer = setTimeout(flushVibeBatch, 30);
                }
              },
              maxTokens
            );

            flushVibeBatch();

            // Step 3: Extract Clean Code & Apply Changes
            let finalCode = accumulatedCode.trim();
            const match = finalCode.match(/```(?:[a-zA-Z0-9_\-+]*)\r?\n([\s\S]*?)```/);
            if (match && match[1]) {
              finalCode = match[1].trim();
            } else if (finalCode.startsWith("```")) {
              finalCode = finalCode.replace(/^```[a-zA-Z0-9_\-+]*(?:\r?\n)?/, "");
              finalCode = finalCode.replace(/(?:\r?\n)?```\s*$/, "").trim();
            }

            // Smart Code Integration: Anti-truncation protection & surgical function merge
            if (existingCode.trim().length > 0) {
              if (finalCode.includes("<<<<<<< SEARCH") || isExisting) {
                const intRes = SmartCodeIntegrator.integrate(existingCode, finalCode, targetFile);
                if (!intRes.success) {
                  throw new Error(intRes.reason || "Kritik silme engellendi: Orijinal dosya korundu.");
                }
                finalCode = intRes.finalCode;
              } else {
                // Full rewrite requested: verify no lazy placeholders
                const phCheck = SmartCodeIntegrator.hasPlaceholders(finalCode);
                if (phCheck.found) {
                  throw new Error(`Kritik yer tutucu engellendi: Kod içinde '${phCheck.match}' tespit edildi. Orijinal dosya korundu.`);
                }
              }
            }

            // AST Path Normalizer: Automatically resolve broken relative paths and named/default export mismatches
            const pathRes = ASTPathResolver.normalizeImports(finalCode, targetFile, targetRepo, allSourceFiles);
            finalCode = pathRes.code;

            const diffSummary = SurgicalPatchEngine.calculateLineDiff(existingCode, finalCode);

            // ABSOLUTE App.tsx SAFETY GUARD: NEVER OVERWRITE App.tsx WITH A NON-APP COMPONENT!
            if (targetFile === "src/App.tsx" || targetFile === "src/App.jsx") {
              const comp = detectComponentNameFromCode(finalCode);
              if (comp && comp !== "App" && comp !== "Root") {
                console.warn(`[Vibe Safety Guard] Intercepted overwrite of App.tsx with component '${comp}'. Redirecting to src/components/${comp}.tsx`);
                targetFile = `src/components/${comp}.tsx`;
              }
            }

            // Ensure directory exists
            const resolvedTargetFullPath = resolve(targetRepo, targetFile);
            const targetDir = resolve(resolvedTargetFullPath, "..");
            if (!existsSync(targetDir)) {
              mkdirSync(targetDir, { recursive: true });
            }

            // Write via Transactional Workspace Engine (WAL logging, Undo/Redo, Crash Safety)
            const txnResult = await workspaceEngine.executeTransaction({
              author: "ai-agent",
              description: `Vibe Mode: ${targetFile}`,
              changes: { [targetFile]: finalCode },
              skipBehavioralCheck: true, // Vibe mode retains instant response
            });

            if (!txnResult.success) {
              throw new Error(txnResult.error || "Vibe transaction rejected by integrity guard");
            }

            const durationMs = Date.now() - startTime;

            console.log(`[Vibe Mode] ⚡ Applied direct code to ${targetFile} (${finalCode.length} bytes, tx: ${txnResult.txId}, +${diffSummary.additions}/-${diffSummary.deletions} lines in ${durationMs}ms)`);

            // Auto-Wire: If a new page or component was created, check if App.tsx needs a route
            const compName = basename(targetFile, extname(targetFile));
            const isPageIntent = targetFile.includes("pages/") || lowerPrompt.includes("sayfa") || lowerPrompt.includes("page");
            const appPath = resolve(targetRepo, "src/App.tsx");

            if (isPageIntent && existsSync(appPath) && targetFile !== "src/App.tsx") {
              try {
                let appContent = readFileSync(appPath, "utf-8");
                if (!appContent.includes(compName) && appContent.includes("<Routes>")) {
                  const relPath = `./${relative(resolve(targetRepo, "src"), resolve(targetRepo, targetFile)).replace(/\\/g, "/").replace(/\.tsx?$/, "")}`;
                  const importStmt = `import ${compName} from "${relPath}";\n`;
                  const routeSlug = compName.toLowerCase();
                  const routeStmt = `              <Route path="/${routeSlug}" element={<${compName} />} />\n`;

                  // Inject import after the last import statement
                  const lastImportIdx = appContent.lastIndexOf("\nimport ");
                  if (lastImportIdx !== -1) {
                    const nextLineIdx = appContent.indexOf("\n", lastImportIdx + 1);
                    appContent = appContent.slice(0, nextLineIdx + 1) + importStmt + appContent.slice(nextLineIdx + 1);
                  }

                  // Inject Route before <Route path="*" or before </Routes>
                  if (appContent.includes('<Route path="*"')) {
                    appContent = appContent.replace('<Route path="*"', `${routeStmt}              <Route path="*"`);
                  } else if (appContent.includes("</Routes>")) {
                    appContent = appContent.replace("</Routes>", `${routeStmt}            </Routes>`);
                  }

                  await workspaceEngine.executeTransaction({
                    author: "ai-agent",
                    description: `Auto-wire route for ${compName} in src/App.tsx`,
                    changes: { "src/App.tsx": appContent },
                    skipBehavioralCheck: true,
                  });

                  console.log(`[Vibe Auto-Wire] ⚡ Automatically wired route /${routeSlug} in src/App.tsx`);
                }
              } catch (wireErr: any) {
                console.warn(`[Vibe Auto-Wire Warning] ${wireErr?.message}`);
              }
            }

            // Step 4: Notify Client (Editor & Live Preview sync)
            send({
              type: "vibe_applied",
              targetFile,
              originalCode: existingCode,
              code: finalCode,
              bytes: finalCode.length,
              tokenCount,
              diffSummary,
              durationMs,
            });

            send({
              type: "vibe_finish",
              targetFile,
              bytes: finalCode.length,
              durationMs,
              message: `✔ ${targetFile} dosyasına uygulandı (${finalCode.length} bayt, ${Math.round(durationMs / 1000)}s)`,
            });

            clearInterval(heartbeat);
            controller.close();
          } catch (err: any) {
            clearInterval(heartbeat);
            send({ type: "vibe_error", message: err.message });
            try { controller.close(); } catch {}
          }
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          "Connection": "keep-alive",
          "X-Accel-Buffering": "no",
          ...corsHeaders,
        },
      });
    }

    // 7.5 AI Copilot Chat Stream (Interactive Conversation & Architecture Discussion)
    if (url.pathname === "/api/chat/stream") {
      let prompt = url.searchParams.get("prompt") || "";
      let activeFile = url.searchParams.get("file") || "";
      let rawHistory: Array<{ role: string; content: string }> = [];
      let contextFiles: string[] = [];
      let images: string[] = [];

      if (req.method === "POST") {
        try {
          const body = (await req.json()) as any;
          if (body.prompt) prompt = body.prompt;
          if (body.file) activeFile = body.file;
          if (Array.isArray(body.history)) rawHistory = body.history;
          if (Array.isArray(body.contextFiles)) contextFiles = body.contextFiles;
          if (Array.isArray(body.images)) images = body.images;
        } catch {}
      } else {
        const histParam = url.searchParams.get("history");
        if (histParam) {
          try {
            rawHistory = JSON.parse(histParam);
          } catch {}
        }
        const ctxParam = url.searchParams.get("contextFiles");
        if (ctxParam) {
          try {
            contextFiles = JSON.parse(ctxParam);
          } catch {}
        }
      }

      const stream = new ReadableStream({
        async start(controller) {
          const send = (event: any) => {
            try {
              controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
            } catch {}
          };

          const startTime = Date.now();
          const heartbeat = setInterval(() => {
            send({ type: "heartbeat", timestamp: Date.now() });
          }, 2500);

          try {
            send({ type: "chat_start", prompt, activeFile });

            // 1. Gather Project Context & Dependencies
            let stackSummary = "Modern Web Application (TypeScript)";
            const pkgPath = resolve(targetRepo, "package.json");
            if (existsSync(pkgPath)) {
              try {
                const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
                const deps = Object.keys(pkg.dependencies || {}).concat(Object.keys(pkg.devDependencies || {}));
                stackSummary = deps.slice(0, 20).join(", ");
              } catch {}
            }

            // 2. Full-Repo File Tree & AST Intelligence via ASTBridge
            const astBridge = new ASTBridge(targetRepo, systemRoot);
            const allSourceFiles = astBridge.getSourceFiles();

            // 3. User-Selected Explicit Context Files (Pinned via UI / @ mentions)
            let userContextBlock = "";
            const attachedFilesSummary: string[] = [];
            const includedPaths = new Set<string>();

            for (const cf of contextFiles) {
              const normalized = cf.replace(/\\/g, "/");
              const fullPath = resolve(targetRepo, normalized);
              if (existsSync(fullPath)) {
                try {
                  const content = readFileSync(fullPath, "utf-8");
                  const snippet = content.length > 25000 ? content.slice(0, 25000) + "\n// ... [Kalan satırlar kısaltıldı] ..." : content;
                  userContextBlock += `\n#### 📄 Kullanıcı Tarafından Bağlama Eklenen Dosya: \`${normalized}\`\n\`\`\`tsx\n${snippet}\n\`\`\`\n`;
                  includedPaths.add(normalized);
                  attachedFilesSummary.push(normalized);
                } catch {}
              }
            }

            send({ type: "chat_start", prompt, activeFile, attachedFiles: attachedFilesSummary });

            // 4. Dynamic Relevant Files Discovery (Reads multiple files mentioned in prompt and context files)
            const candidateFiles = [...new Set([activeFile, ...contextFiles].filter(Boolean))];
            const relevantFiles = astBridge.findRelevantSourceFiles(prompt, candidateFiles, 4);

            let relevantFilesBlock = "";

            // If active file is open, ensure it's included first
            if (activeFile) {
              const fullPath = resolve(targetRepo, activeFile);
              if (existsSync(fullPath)) {
                const content = readFileSync(fullPath, "utf-8");
                const snippet = content.length > 15000 ? content.slice(0, 15000) + "\n// ... [Kalan satırlar kısaltıldı] ..." : content;
                relevantFilesBlock += `\n### Editörde Açık Dosya: \`${activeFile}\`\n\`\`\`tsx\n${snippet}\n\`\`\`\n`;
                includedPaths.add(activeFile.replace(/\\/g, "/"));
              }
            }

            // Add other relevant files discovered by AST keywords
            for (const rel of relevantFiles) {
              const normalized = rel.path.replace(/\\/g, "/");
              if (!includedPaths.has(normalized)) {
                const snippet = rel.content.length > 8000 ? rel.content.slice(0, 8000) + "\n// ... [Kalan satırlar kısaltıldı] ..." : rel.content;
                relevantFilesBlock += `\n### İlgili Dosya: \`${normalized}\`\n\`\`\`tsx\n${snippet}\n\`\`\`\n`;
                includedPaths.add(normalized);
              }
            }

            // 4. File Structure Summary
            const fileListSummary = allSourceFiles.slice(0, 30).map((f) => `- ${f}`).join("\n");

            const systemPrompt = `Sen MetaFrame Studio AI Copilot'sun. Kullanıcıyla birlikte çalışan kıdemli bir yazılım mimarı ve samimi bir pair-programming ortağısın.
Kullanıcıyla Türkçe, teknik açıdan yetkin, pratik ve çözüm odaklı konuşursun.

Çalışma Alanı & Tüm Kod Tabanı Bağlamı (Full-Repo Context):
- Proje Konumu: ${targetRepo}
- Teknolojiler & Paketler: ${stackSummary}
- Projedeki Kaynak Dosyalar (${allSourceFiles.length} dosya):
${fileListSummary}
${userContextBlock ? `\n### 📎 KULLANICI TARAFINDAN BAĞLAMA (CONTEXT) EKLENEN DOSYALAR (${attachedFilesSummary.length} dosya):\nKullanıcı aşağıdaki dosyaları özellikle bağlama ekledi. Soruları yanıtlarken, kod önerirken veya değişiklik yaparken bu dosyaların içeriğini, export'larını, türlerini ve state yapılarını doğrudan temel al:\n${userContextBlock}` : ""}
${images.length > 0 ? `\n### 🖼️ KULLANICI GÖRSEL / EKRAN GÖRÜNTÜSÜ EKLEDİ (${images.length} adet görsel):\nKullanıcı mesaja ekran görüntüsü/tasarım görseli ekledi. Görseldeki UI elementlerini, renk paletini, boşlukları, butonları ve tasarım hiyerarşisini dikkatle analiz ederek istenen kodu bu tasarıma sadık kalarak üret.\n` : ""}
${relevantFilesBlock ? `\nKod Tabanından İlgili Diğer Dosya İçerikleri:\n${relevantFilesBlock}` : ""}

KRİTİK DAVRANIŞ KURALLARI:
1. Sen tüm projeyi ve dosya yapısını biliyorsun. Kullanıcının sorularına projenin gerçek kodlarına ve mimarisine dayanarak net, aydınlatıcı cevaplar ver.
2. Zengin GitHub-flavored Markdown kullan: Başlıklar, listeler, kalın yazılar ve syntax-highlighted kod blokları (\`\`\`tsx).
3. Asla cerrahi yama işaretleri (<<<<<<< SEARCH ... ======= ... >>>>>>> REPLACE) çıkarma! Doğrudan insan gibi sohbet et ve rehberlik yap.
4. KOD DEĞİŞTİRME VE ÖNERİLER (KESİN SIFIR TOLERANS KURALLARI):
   - KULLANICI SENİN KOD BLOKLARININ ÜSTÜNDEKİ '⚡ Editöre Uygula' BUTONUNA BASARAK KODU DOĞRUDAN DİSKE YAZAR.
   - 🚨 ASLA VE ASLA \`// ... (önceki kodlar)\`, \`// ...\`, \`{/* ... */}\`, \`/* kalan kodlar */\`, \`// TODO\` GİBİ YER TUTUCU YORUMLAR YAZMA!
   - EĞER BİR BİLEŞENİ VEYA DOSYAYI DEĞİŞTİRİYORSAN (Örn: Navbar, HeroCard, App, AuthModal):
     * Dosyadaki TÜM İMPORTLARI, TÜM STATE VE YARDIMCI FONKSİYONLARI VE TÜM JSX GÖVDESİNİ EKSİKSİZ, BAŞTAN SONA YAZACAKSIN!
     * Asla aradaki JSX veya mantık kodlarını '...' ile atlama! Atlarsan kullanıcının mevcut menüleri, butonları ve fonksiyonları silinir ve proje çöker.
   - EĞER SADECE TEK BİR FONKSİYON VEYA YARDIMCI KOD VERİYORSAN:
     * Tüm dosyanın iskeletini yarım yamalak açıp içine \`// ...\` koyma! Sadece o yeni bağımsız fonksiyonu ver.
   - Dosya yolunu İLK SATIRDA belirt: \`// src/components/Navbar.tsx\`.
   - İthalat yollarına dikkat et: \`src/components/\` içindeki bir dosya \`src/context/\` altındaki bir dosyayı import ediyorsa yolu \`./context\` DEĞİL, \`../context/AuthContext\` olmalıdır!
5. Kullanıcı selam verdiğinde veya sohbet ettiğinde samimi, enerjik bir mühendis gibi karşılık ver.`;

            const llm = new SharedLLMClient();
            let accumulatedText = "";
            let tokenBatch = "";
            let batchTimer: any = null;

            const flushBatch = () => {
              if (batchTimer) {
                clearTimeout(batchTimer);
                batchTimer = null;
              }
              if (tokenBatch) {
                send({ type: "chat_token", token: tokenBatch });
                tokenBatch = "";
              }
            };

            // Format recent multi-turn conversation history (last 10 messages)
            const sanitizedHistory = rawHistory
              .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim().length > 0)
              .slice(-10)
              .map((m) => ({
                role: m.role as "user" | "assistant",
                content: m.content.length > 4000 ? m.content.slice(0, 4000) + "\n// ... [kısaltıldı] ..." : m.content,
              }));

            const messages = [
              { role: "system" as const, content: systemPrompt },
              ...sanitizedHistory,
              { role: "user" as const, content: prompt, images: images.length > 0 ? images : undefined },
            ];

            await llm.chatStream(
              messages,
              (token) => {
                accumulatedText += token;
                tokenBatch += token;
                if (tokenBatch.length >= 40) {
                  flushBatch();
                } else if (!batchTimer) {
                  batchTimer = setTimeout(flushBatch, 30);
                }
              },
              -1 // Unlimited tokens for chat responses
            );

            flushBatch();
            const durationMs = Date.now() - startTime;

            // Detect code block and target file from accumulatedText
            const codeBlockMatch = accumulatedText.match(/```(?:[a-zA-Z0-9_\-]+)?\s*\n([\s\S]*?)```/);
            let detectedTargetFile: string | null = null;
            let extractedCode: string | null = null;

            if (codeBlockMatch) {
              extractedCode = codeBlockMatch[1];
              const compName = detectComponentNameFromCode(extractedCode);

              // 1. Check first lines of code block for explicit file comment
              const firstLines = extractedCode.split("\n").slice(0, 4).join("\n");
              const fileMatch = firstLines.match(/^(?:(?:\/\/|\/\*)\s*)([a-zA-Z0-9_\-./\\]+\.(?:tsx?|jsx?|css|html|json))\b/m);
              if (fileMatch) {
                const cand = fileMatch[1].replace(/\\/g, "/");
                // Only allow App.tsx if component is App
                if ((cand === "src/App.tsx" || cand === "App.tsx") && compName && compName !== "App") {
                  detectedTargetFile = `src/components/${compName}.tsx`;
                } else {
                  detectedTargetFile = cand.startsWith("src/") ? cand : `src/${cand}`;
                }
              }

              // 2. Component Name from Code (e.g. HeroCard, Navbar, etc.)
              if (!detectedTargetFile && compName) {
                if (compName === "App") {
                  detectedTargetFile = "src/App.tsx";
                } else {
                  // Check if existing file in allSourceFiles matches
                  const existing = allSourceFiles.find((f) => {
                    const b = f.split("/").pop()?.replace(/\.(?:tsx?|jsx?)$/, "");
                    return b?.toLowerCase() === compName.toLowerCase();
                  });
                  if (existing) {
                    detectedTargetFile = existing;
                  } else {
                    const isPage = /page|sayfa|view/i.test(compName) || /sayfa|page|view/i.test(prompt);
                    const folder = (isPage && existsSync(resolve(targetRepo, "src/pages"))) ? "src/pages" : "src/components";
                    detectedTargetFile = `${folder}/${compName}.tsx`;
                  }
                }
              }

              // 3. Check prompt intent (e.g. "herokartı uygula", "navbarı yap")
              if (!detectedTargetFile) {
                detectedTargetFile = resolveComponentFileFromPrompt(prompt, targetRepo);
              }

              // 4. Safe fallback to active file ONLY if activeFile is NOT App.tsx or if code is App
              if (!detectedTargetFile && activeFile) {
                if (activeFile !== "src/App.tsx" && activeFile !== "src/App.jsx") {
                  detectedTargetFile = activeFile;
                } else if (!compName || compName === "App") {
                  detectedTargetFile = activeFile;
                }
              }

              // 5. ABSOLUTE App.tsx GUARD: Never overwrite App.tsx with a subcomponent!
              if ((detectedTargetFile === "src/App.tsx" || detectedTargetFile === "src/App.jsx") && compName && compName !== "App") {
                console.warn(`[Chat Safety Guard] Intercepted overwrite of App.tsx with component '${compName}'. Redirecting to src/components/${compName}.tsx`);
                detectedTargetFile = `src/components/${compName}.tsx`;
              }
            }

            // 6. AST Path Resolver: Auto-correct relative paths & export imports in extracted code
            if (extractedCode && detectedTargetFile) {
              try {
                const originalSnippet = extractedCode;
                const pathRes = ASTPathResolver.normalizeImports(
                  extractedCode,
                  detectedTargetFile,
                  targetRepo,
                  allSourceFiles
                );
                extractedCode = pathRes.code;
                if (pathRes.changes.length > 0) {
                  console.log(`[Chat PathResolver] Auto-corrected ${pathRes.changes.length} imports for ${detectedTargetFile}:\n  - ${pathRes.changes.join("\n  - ")}`);
                  if (accumulatedText.includes(originalSnippet)) {
                    accumulatedText = accumulatedText.replace(originalSnippet, extractedCode);
                  }
                }
              } catch (e: any) {
                console.warn(`[Chat PathResolver] Import normalization skipped: ${e.message}`);
              }
            }

            send({
              type: "chat_finish",
              response: accumulatedText,
              durationMs,
              detectedTargetFile,
              extractedCode,
            });

            clearInterval(heartbeat);
            controller.close();
          } catch (err: any) {
            clearInterval(heartbeat);
            send({ type: "chat_error", message: err.message });
            try { controller.close(); } catch {}
          }
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          "Connection": "keep-alive",
          "X-Accel-Buffering": "no",
          ...corsHeaders,
        },
      });
    }

    // 8. Orchestrator Plan & Real-Time SSE Stream (Formal Multi-Agent Mode)
    if (url.pathname === "/api/orchestrate/stream") {
      const prompt = url.searchParams.get("prompt") || "";
      const candidateFiles = (url.searchParams.get("files") || "").split(",").filter(Boolean);
      const executeCode = url.searchParams.get("execute") !== "false";

      const stream = new ReadableStream({
        async start(controller) {
          let isClosed = false;

          const sendRaw = (event: any) => {
            if (isClosed) return;
            try {
              controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
            } catch {
              isClosed = true;
            }
          };

          // Smooth token batching buffer: Combines rapid GPU token frames into ~30ms / 60-char chunks
          // Eliminates WebView2 UI thread saturation and TCP connection drops
          let codeTokenBuffer = "";
          let codeTokenTarget = "";
          let codeTokenTimer: any = null;

          let agentTokenBuffer = "";
          let agentTokenAgent = "";
          let agentTokenPhase = 0;
          let agentTokenTimer: any = null;

          const flushCodeTokens = () => {
            if (codeTokenTimer) {
              clearTimeout(codeTokenTimer);
              codeTokenTimer = null;
            }
            if (codeTokenBuffer) {
              sendRaw({
                type: "code_token",
                token: codeTokenBuffer,
                targetFile: codeTokenTarget,
              });
              codeTokenBuffer = "";
            }
          };

          const flushAgentTokens = () => {
            if (agentTokenTimer) {
              clearTimeout(agentTokenTimer);
              agentTokenTimer = null;
            }
            if (agentTokenBuffer) {
              sendRaw({
                type: "agent_token",
                agent: agentTokenAgent,
                phase: agentTokenPhase,
                token: agentTokenBuffer,
              });
              agentTokenBuffer = "";
            }
          };

          const flushAll = () => {
            flushCodeTokens();
            flushAgentTokens();
          };

          const sendEvent = (event: any) => {
            if (isClosed) return;

            if (event.type === "code_token") {
              codeTokenBuffer += event.token;
              if (event.targetFile) codeTokenTarget = event.targetFile;
              if (codeTokenBuffer.length >= 60) {
                flushCodeTokens();
              } else if (!codeTokenTimer) {
                codeTokenTimer = setTimeout(flushCodeTokens, 30);
              }
              return;
            }

            if (event.type === "agent_token") {
              agentTokenBuffer += event.token;
              agentTokenAgent = event.agent;
              agentTokenPhase = event.phase;
              if (agentTokenBuffer.length >= 60) {
                flushAgentTokens();
              } else if (!agentTokenTimer) {
                agentTokenTimer = setTimeout(flushAgentTokens, 30);
              }
              return;
            }

            // Flush pending token batches immediately before sending lifecycle / state events
            flushAll();
            sendRaw(event);
          };

          // Keep-alive heartbeat every 2.5s so Bun/browser never drop the SSE stream
          const heartbeat = setInterval(() => {
            if (isClosed) {
              clearInterval(heartbeat);
              return;
            }
            sendRaw({ type: "heartbeat", timestamp: Date.now() });
          }, 2500);

          try {
            const orchestrator = new LeadOrchestrator(targetRepo, systemRoot);
            await orchestrator.executeWorkflow(prompt, candidateFiles, executeCode, (event) => {
              sendEvent(event);
            });
            flushAll();
            clearInterval(heartbeat);
            if (!isClosed) {
              try { controller.close(); } catch {}
              isClosed = true;
            }
          } catch (err: any) {
            flushAll();
            clearInterval(heartbeat);
            sendRaw({ type: "error", message: err.message });
            if (!isClosed) {
              try { controller.close(); } catch {}
              isClosed = true;
            }
          }
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          "Connection": "keep-alive",
          "X-Accel-Buffering": "no",
          ...corsHeaders,
        },
      });
    }

    // 9. Integrated Terminal Execution
    if (url.pathname === "/api/terminal/exec" && req.method === "POST") {
      try {
        const body = (await req.json()) as { command: string; cwd?: string };
        const cmd = (body.command || "").trim();
        if (!cmd) {
          return json({ stdout: "", stderr: "", cwd: terminalCwd, exitCode: 0 });
        }

        // Handle 'cd' commands directly to track state
        if (cmd === "cd" || cmd === "cd ~") {
          terminalCwd = targetRepo;
          return json({ stdout: `Directory changed to: ${terminalCwd}\n`, stderr: "", cwd: terminalCwd, exitCode: 0 });
        } else if (cmd.startsWith("cd ")) {
          const targetDir = cmd.slice(3).trim().replace(/^["']|["']$/g, "");
          const newPath = resolve(terminalCwd, targetDir);
          if (existsSync(newPath) && statSync(newPath).isDirectory()) {
            terminalCwd = newPath;
            return json({ stdout: `Directory changed to: ${terminalCwd}\n`, stderr: "", cwd: terminalCwd, exitCode: 0 });
          } else {
            return json({ stdout: "", stderr: `cd: no such file or directory: ${targetDir}\n`, cwd: terminalCwd, exitCode: 1 });
          }
        }

        // Handle 'clear' or 'cls'
        if (cmd === "clear" || cmd === "cls") {
          return json({ clear: true, stdout: "", stderr: "", cwd: terminalCwd, exitCode: 0 });
        }

        // Execute shell command
        const shell = process.platform === "win32" ? "powershell.exe" : "/bin/bash";
        const result = await new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolvePromise) => {
          exec(cmd, { cwd: terminalCwd, shell, maxBuffer: 10 * 1024 * 1024, timeout: 60000 }, (error, stdout, stderr) => {
            resolvePromise({
              stdout: stdout || "",
              stderr: stderr || (error && !stdout ? error.message : ""),
              exitCode: error ? error.code || 1 : 0,
            });
          });
        });

        return json({ ...result, cwd: terminalCwd });
      } catch (e: any) {
        return json({ stdout: "", stderr: e.message || "Failed to execute command", cwd: terminalCwd, exitCode: 1 }, 500);
      }
    }

    if (url.pathname === "/api/terminal/cwd") {
      return json({ cwd: terminalCwd });
    }

    if (url.pathname === "/api/orchestrate/plan" && req.method === "POST") {
      const body = (await req.json()) as any;
      const orchestrator = new LeadOrchestrator(targetRepo, systemRoot);
      const result = await orchestrator.executeWorkflow(body.prompt, body.candidateFiles || [], false);
      return json({ result });
    }

    // Static Asset Serving (Frontend SPA)
    if (!url.pathname.startsWith("/api/")) {
      const distDir = resolve(systemRoot, "apps/studio/dist");
      const reqPath = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      const filePath = resolve(distDir, reqPath);
      if (existsSync(filePath) && !statSync(filePath).isDirectory()) {
        return new Response(Bun.file(filePath));
      }
      const indexHtml = resolve(distDir, "index.html");
      if (existsSync(indexHtml)) {
        return new Response(Bun.file(indexHtml));
      }
    }

    return json({ error: "Not found" }, 404);
  },
});

console.log(`[MetaFrame Studio Backend] Running on http://localhost:${server.port}`);
console.log(`[Target Workspace] ${targetRepo}`);
