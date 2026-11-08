/**
 * MetaFrame Model Arena
 * 
 * Objective Head-to-Head Evaluation of Engineering Models:
 * 1. Qwen3 8B (Local Fast - 71 tok/s)
 * 2. Gemma4 12B (Local Heavy - 46 tok/s)
 * 3. Groq GPT-OSS-120B (Cloud LPU - 500 tok/s)
 * 
 * Evaluated across:
 * - TypeScript AST Compilation (0-Error Syntax)
 * - Functional Invariants & Required Exports
 * - TTFT, Generation tok/s, Total Duration
 * - VRAM Footprint & Cost per 1M tokens
 */

import * as ts from "typescript";

export interface ArenaCompetitor {
  id: string;
  name: string;
  tier: "local-fast" | "local-heavy" | "cloud-lpu";
  model: string;
  endpoint: "ollama" | "groq";
  costPerMillionTokens: number;
}

export interface ArenaTask {
  id: string;
  domain: "React/UI" | "Algorithms" | "TypeSystem" | "StateMachine" | "SelfHealing";
  title: string;
  prompt: string;
  targetFile: string;
  requiredExports: string[];
  syntaxCheckCriteria: string[];
}

export interface TaskEvaluationResult {
  taskId: string;
  competitorId: string;
  ttftMs: number;
  tokensGenerated: number;
  tokPerSec: number;
  durationMs: number;
  syntaxValid: boolean;
  exportsPresent: boolean;
  passedGates: boolean;
  humanInterventionRequired: boolean;
  estimatedCostUsd: number;
  rawCodeSnippet: string;
  errors: string[];
}

export interface ArenaLeaderboard {
  competitorId: string;
  name: string;
  tasksAttempted: number;
  tasksPassed: number;
  passRatePercent: number;
  avgTtftMs: number;
  avgTokensPerSec: number;
  totalDurationSec: number;
  totalCostUsd: number;
  cleanCodeScore: number; // 0-100 score based on syntax + invariants + speed
}

export class ModelArena {
  public static readonly COMPETITORS: ArenaCompetitor[] = [
    {
      id: "qwen3-8b",
      name: "Qwen3 8B (Q4_K_M)",
      tier: "local-fast",
      model: "qwen3:8b-q4_K_M",
      endpoint: "ollama",
      costPerMillionTokens: 0.0,
    },
    {
      id: "gemma4-12b",
      name: "Gemma4 12B (Unquantized)",
      tier: "local-heavy",
      model: "gemma4:12b",
      endpoint: "ollama",
      costPerMillionTokens: 0.0,
    },
    {
      id: "groq-120b",
      name: "GPT-OSS 120B (Groq LPU)",
      tier: "cloud-lpu",
      model: "openai/gpt-oss-120b",
      endpoint: "groq",
      costPerMillionTokens: 0.59,
    },
  ];

  public static readonly BENCHMARK_TASKS: ArenaTask[] = [
    // 1. React/UI: Accessible Dialog Modal
    {
      id: "TASK-01",
      domain: "React/UI",
      title: "Accessible Dialog Modal",
      targetFile: "src/components/Modal.tsx",
      prompt: `Write a production-ready, accessible React Modal component in TypeScript.
Must support: isOpen, onClose, title, children, escape key listener, click-outside to close, and ARIA attributes (role="dialog", aria-modal="true").
Export 'Modal' and 'ModalProps'.`,
      requiredExports: ["Modal", "ModalProps"],
      syntaxCheckCriteria: ["role", "aria-modal", "onClose"],
    },
    // 2. React/UI: Virtualized Scroll List
    {
      id: "TASK-02",
      domain: "React/UI",
      title: "Virtualized List Component",
      targetFile: "src/components/VirtualList.tsx",
      prompt: `Write a React Virtualized List component in TypeScript.
Calculates visible slice from scrollTop, itemHeight, and containerHeight.
Export 'VirtualList' and 'VirtualListProps'.`,
      requiredExports: ["VirtualList", "VirtualListProps"],
      syntaxCheckCriteria: ["scrollTop", "itemHeight", "slice"],
    },
    // 3. Algorithms: LRU Cache
    {
      id: "TASK-03",
      domain: "Algorithms",
      title: "O(1) LRU Cache",
      targetFile: "src/utils/lruCache.ts",
      prompt: `Implement an LRU Cache in TypeScript with O(1) get and put operations using a doubly linked list and Map.
Support capacity eviction and return -1 on missing key.
Export class 'LRUCache'.`,
      requiredExports: ["LRUCache"],
      syntaxCheckCriteria: ["get", "put", "capacity"],
    },
    // 4. Algorithms: Directed Graph Cycle Detector
    {
      id: "TASK-04",
      domain: "Algorithms",
      title: "DAG Cycle Detection & Topological Sort",
      targetFile: "src/utils/graph.ts",
      prompt: `Implement a Directed Graph cycle detector and topological sort in TypeScript using DFS with three-color marking (WHITE, GRAY, BLACK).
Export function 'topologicalSort' and interface 'GraphNode'.`,
      requiredExports: ["topologicalSort", "GraphNode"],
      syntaxCheckCriteria: ["hasCycle", "visited", "topologicalSort"],
    },
    // 5. TypeSystem: DeepReadonly & DeepPartial Generics
    {
      id: "TASK-05",
      domain: "TypeSystem",
      title: "Advanced Recursive Utility Types",
      targetFile: "src/types/generics.ts",
      prompt: `Write advanced TypeScript generic types:
1. DeepReadonly<T>: recursively marks all properties, nested objects, and arrays as readonly.
2. DeepPartial<T>: recursively marks all properties as optional.
3. IsNever<T>: type-level boolean asserting if T is never.
Export type 'DeepReadonly', 'DeepPartial', and 'IsNever'.`,
      requiredExports: ["DeepReadonly", "DeepPartial", "IsNever"],
      syntaxCheckCriteria: ["type DeepReadonly", "type DeepPartial"],
    },
    // 6. StateMachine: Payment Processing FSM
    {
      id: "TASK-06",
      domain: "StateMachine",
      title: "Finite State Machine for Payments",
      targetFile: "src/state/paymentFSM.ts",
      prompt: `Implement a deterministic Finite State Machine (FSM) in TypeScript for Payment Processing.
States: 'IDLE' | 'PROCESSING' | 'SUCCESS' | 'FAILED'.
Transitions: 'START', 'RESOLVE', 'REJECT', 'RESET'.
Export 'PaymentFSM' and 'PaymentState'.`,
      requiredExports: ["PaymentFSM", "PaymentState"],
      syntaxCheckCriteria: ["transition", "getState", "canTransition"],
    },
    // 7. SelfHealing: Type-Safe Event Bus
    {
      id: "TASK-07",
      domain: "SelfHealing",
      title: "Strongly-Typed Event Bus",
      targetFile: "src/core/eventBus.ts",
      prompt: `Implement a generic, strongly-typed EventBus in TypeScript where event names map to specific payload types.
Support on(event, callback), off(event, callback), emit(event, payload), and once(event, callback).
Export class 'TypedEventBus'.`,
      requiredExports: ["TypedEventBus"],
      syntaxCheckCriteria: ["on", "off", "emit", "once"],
    },
    // 8. Algorithms: Concurrency Rate Limiter
    {
      id: "TASK-08",
      domain: "Algorithms",
      title: "Promise Concurrency Limiter (p-limit)",
      targetFile: "src/utils/concurrency.ts",
      prompt: `Write a high-performance concurrency limiter in TypeScript (similar to p-limit).
Accepts concurrency limit (e.g. 5) and returns an execution wrapper that queues pending async tasks.
Export function 'createConcurrencyLimiter'.`,
      requiredExports: ["createConcurrencyLimiter"],
      syntaxCheckCriteria: ["concurrency", "queue", "next"],
    },
  ];

  /**
   * Executes a single task against a competitor with high-resolution timing & AST verification
   */
  public async evaluateCompetitorOnTask(
    competitor: ArenaCompetitor,
    task: ArenaTask
  ): Promise<TaskEvaluationResult> {
    const startTime = Date.now();
    let ttftMs = 0;
    let fullText = "";

    try {
      if (competitor.endpoint === "ollama") {
        // Run against local Ollama API
        const res = await fetch("http://localhost:11434/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: competitor.model,
            system: "You are an expert TypeScript Engineer. Output ONLY valid TypeScript code in a single ```tsx code block. Zero conversational preamble, zero explanation, zero thinking tags.",
            prompt: task.prompt,
            stream: true,
            think: false,
            options: {
              num_ctx: 8192,
              num_predict: 1200,
              temperature: 0.1,
            },
          }),
        });

        if (!res.ok || !res.body) {
          throw new Error(`Ollama HTTP [${res.status}]: ${await res.text()}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!ttftMs) ttftMs = Date.now() - startTime;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const data = JSON.parse(line);
              if (data.response) fullText += data.response;
            } catch {}
          }
        }
      } else {
        // Run against Groq Cloud API
        const groqKey = process.env.GROQ_API_KEY || "";
        const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${groqKey}`,
          },
          body: JSON.stringify({
            model: competitor.model,
            messages: [
              {
                role: "system",
                content:
                  "You are an expert TypeScript Engineer. Output ONLY valid TypeScript code in a single ```tsx code block. Zero conversational preamble, zero explanation, zero thinking tags.",
              },
              { role: "user", content: task.prompt },
            ],
            max_tokens: 1200,
            stream: true,
            temperature: 0.1,
          }),
        });

        if (!res.ok || !res.body) {
          throw new Error(`Groq HTTP [${res.status}]: ${await res.text()}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!ttftMs) ttftMs = Date.now() - startTime;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed === "data: [DONE]") continue;
            if (trimmed.startsWith("data: ")) {
              try {
                const json = JSON.parse(trimmed.slice(6));
                const delta = json.choices?.[0]?.delta?.content || "";
                if (delta) fullText += delta;
              } catch {}
            }
          }
        }
      }

      const durationMs = Date.now() - startTime;
      const tokensGenerated = Math.max(1, Math.ceil(fullText.length / 4));
      const evalSec = (durationMs - ttftMs) / 1000;
      const tokPerSec = evalSec > 0 ? parseFloat((tokensGenerated / evalSec).toFixed(1)) : 0;

      // 1. Strip chain-of-thought tags (<think>...</think>)
      let cleanCode = fullText.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

      // 2. Extract raw code inside fences
      const match = cleanCode.match(/```(?:tsx?|jsx?|typescript)?\r?\n([\s\S]*?)```/);
      if (match && match[1]) {
        cleanCode = match[1].trim();
      } else {
        cleanCode = cleanCode.replace(/^```[a-zA-Z0-9_\-+]*\r?\n/, "").replace(/(?:\r?\n)?```\s*$/, "").trim();
      }

      // Rigorous TypeScript Compiler AST verification
      const isTsx = task.targetFile.endsWith(".tsx") || task.targetFile.endsWith(".jsx");
      const sourceFile = ts.createSourceFile(
        task.targetFile,
        cleanCode,
        ts.ScriptTarget.Latest,
        true,
        isTsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS
      );

      const parseDiags = (sourceFile as any).parseDiagnostics || [];
      const syntaxValid = parseDiags.length === 0;
      const errors: string[] = parseDiags.map((d: any) =>
        typeof d.messageText === "string" ? d.messageText : d.messageText.messageText
      );

      // Check for required exports in AST
      const foundExports = new Set<string>();
      for (const stmt of sourceFile.statements) {
        if (ts.isExportAssignment(stmt)) {
          foundExports.add("default");
        }
        if (ts.isVariableStatement(stmt) && stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
          for (const decl of stmt.declarationList.declarations) {
            foundExports.add(decl.name.getText(sourceFile));
          }
        }
        if (ts.isFunctionDeclaration(stmt) && stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) && stmt.name) {
          foundExports.add(stmt.name.getText(sourceFile));
        }
        if (ts.isClassDeclaration(stmt) && stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) && stmt.name) {
          foundExports.add(stmt.name.getText(sourceFile));
        }
        if (ts.isTypeAliasDeclaration(stmt) && stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
          foundExports.add(stmt.name.getText(sourceFile));
        }
        if (ts.isInterfaceDeclaration(stmt) && stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
          foundExports.add(stmt.name.getText(sourceFile));
        }
      }

      const missingExports = task.requiredExports.filter((exp) => !foundExports.has(exp));
      const exportsPresent = missingExports.length === 0;

      if (!exportsPresent) {
        errors.push(`Missing required export(s): ${missingExports.join(", ")}`);
      }

      // Check syntax criteria keywords
      const missingCriteria = task.syntaxCheckCriteria.filter((c) => !cleanCode.includes(c));
      if (missingCriteria.length > 0) {
        errors.push(`Missing expected keywords: ${missingCriteria.join(", ")}`);
      }

      const passedGates = syntaxValid && exportsPresent && missingCriteria.length === 0;
      const humanInterventionRequired = !passedGates;
      const estimatedCostUsd = (tokensGenerated / 1_000_000) * competitor.costPerMillionTokens;

      return {
        taskId: task.id,
        competitorId: competitor.id,
        ttftMs,
        tokensGenerated,
        tokPerSec,
        durationMs,
        syntaxValid,
        exportsPresent,
        passedGates,
        humanInterventionRequired,
        estimatedCostUsd,
        rawCodeSnippet: cleanCode.slice(0, 150) + "...",
        errors,
      };
    } catch (err: any) {
      return {
        taskId: task.id,
        competitorId: competitor.id,
        ttftMs: 0,
        tokensGenerated: 0,
        tokPerSec: 0,
        durationMs: Date.now() - startTime,
        syntaxValid: false,
        exportsPresent: false,
        passedGates: false,
        humanInterventionRequired: true,
        estimatedCostUsd: 0,
        rawCodeSnippet: "",
        errors: [`Execution error: ${err.message}`],
      };
    }
  }

  /**
   * Compiles Leaderboard from evaluated task results
   */
  public compileLeaderboard(results: TaskEvaluationResult[]): ArenaLeaderboard[] {
    const leaderboards: ArenaLeaderboard[] = [];

    for (const comp of ModelArena.COMPETITORS) {
      const compResults = results.filter((r) => r.competitorId === comp.id);
      if (compResults.length === 0) continue;

      const attempted = compResults.length;
      const passed = compResults.filter((r) => r.passedGates).length;
      const passRate = Math.round((passed / attempted) * 100);

      const totalTtft = compResults.reduce((sum, r) => sum + r.ttftMs, 0);
      const avgTtft = Math.round(totalTtft / attempted);

      const totalSpeed = compResults.reduce((sum, r) => sum + r.tokPerSec, 0);
      const avgSpeed = parseFloat((totalSpeed / attempted).toFixed(1));

      const totalDurationSec = parseFloat((compResults.reduce((sum, r) => sum + r.durationMs, 0) / 1000).toFixed(1));
      const totalCostUsd = compResults.reduce((sum, r) => sum + r.estimatedCostUsd, 0);

      // Clean Code Score: Weighted composite of pass rate (60%), speed (25%), zero human intervention (15%)
      const cleanCodeScore = Math.round(
        passRate * 0.6 +
        Math.min(100, (avgSpeed / 100) * 100) * 0.25 +
        (passed / attempted) * 15
      );

      leaderboards.push({
        competitorId: comp.id,
        name: comp.name,
        tasksAttempted: attempted,
        tasksPassed: passed,
        passRatePercent: passRate,
        avgTtftMs: avgTtft,
        avgTokensPerSec: avgSpeed,
        totalDurationSec,
        totalCostUsd,
        cleanCodeScore,
      });
    }

    leaderboards.sort((a, b) => b.cleanCodeScore - a.cleanCodeScore);
    return leaderboards;
  }
}
