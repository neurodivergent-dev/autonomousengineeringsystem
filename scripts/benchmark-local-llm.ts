/**
 * Real-world Local LLM Benchmark & GPU Telemetry
 * Measures:
 * 1. TTFT (Time to first token)
 * 2. Prompt Processing tokens/sec (Prefill speed)
 * 3. Generation tokens/sec (Autoregressive decode speed)
 * 4. Peak VRAM & Ollama Processor Allocation (100% GPU vs CPU Offload)
 * 5. Code Quality & TypeScript Compilation Verification
 */

import { execSync } from "child_process";
import * as ts from "typescript";

const promptText = `Aşağıdaki TypeScript kodunu üret. React için erişilebilir, responsive bir login modal oluştur. Email validation, password visibility toggle, remember me, loading ve error state ekle.
Tam ve eksiksiz çalışan production-ready TSX kodunu ver.`;

interface BenchmarkResult {
  contextSize: number;
  model: string;
  ttftMs: number;
  promptEvalTokPerSec: number;
  evalTokPerSec: number;
  totalTokensGenerated: number;
  totalDurationMs: number;
  ollamaProcessor: string;
  ollamaVramMb: string;
  nvidiaPeakVramMb: number;
  codeCompiled: boolean;
  tsDiagnostics: string[];
}

function getGpuMemory(): number {
  try {
    const out = execSync("nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits", { encoding: "utf-8" });
    return parseInt(out.trim(), 10) || 0;
  } catch {
    return 0;
  }
}

function getOllamaPs(): { processor: string; vram: string } {
  try {
    const out = execSync("ollama ps", { encoding: "utf-8" });
    const lines = out.trim().split("\n");
    if (lines.length > 1) {
      const parts = lines[1].trim().split(/\s{2,}/);
      // NAME  ID  SIZE  PROCESSOR  CONTEXT  RUNNER  UNTIL
      return {
        processor: parts[3] || "Unknown",
        vram: parts[2] || "Unknown",
      };
    }
  } catch {}
  return { processor: "Unknown", vram: "Unknown" };
}

function verifyTypeScriptSyntax(code: string, fileName: string = "LoginModal.tsx"): { valid: boolean; errors: string[] } {
  // Strip markdown fences
  let clean = code.trim();
  const match = clean.match(/```(?:tsx?|jsx?)?\r?\n([\s\S]*?)```/);
  if (match) clean = match[1].trim();
  else clean = clean.replace(/^```[a-zA-Z0-9_\-+]*\r?\n/, "").replace(/(?:\r?\n)?```\s*$/, "");

  const sourceFile = ts.createSourceFile(fileName, clean, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const diagnostics: string[] = [];

  // Check parsing syntax errors
  const parseDiagnostics = (sourceFile as any).parseDiagnostics || [];
  for (const diag of parseDiagnostics) {
    diagnostics.push(typeof diag.messageText === "string" ? diag.messageText : diag.messageText.messageText);
  }

  return {
    valid: diagnostics.length === 0,
    errors: diagnostics,
  };
}

async function runBenchmark(model: string, numCtx: number): Promise<BenchmarkResult> {
  console.log(`\n==================================================`);
  console.log(`🚀 Benchmarking ${model} with num_ctx = ${numCtx}`);
  console.log(`==================================================`);

  const initialVram = getGpuMemory();
  console.log(`[VRAM Baseline] Initial Used: ${initialVram} MiB`);

  const startTime = Date.now();
  let firstTokenTime = 0;
  let fullResponse = "";
  let streamClosed = false;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    if (!streamClosed) {
      console.warn("⚠ Generation timed out after 90 seconds.");
      controller.abort();
    }
  }, 90000);

  const res = await fetch("http://localhost:11434/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt: promptText,
      stream: true,
      options: {
        num_ctx: numCtx,
        temperature: 0.2,
      },
    }),
    signal: controller.signal,
  });

  if (!res.ok || !res.body) {
    clearTimeout(timeoutId);
    throw new Error(`Ollama API error: ${res.status} ${await res.text()}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let peakVram = initialVram;
  let finalStats: any = null;
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    if (!firstTokenTime) {
      firstTokenTime = Date.now();
      const currentVram = getGpuMemory();
      if (currentVram > peakVram) peakVram = currentVram;
      const ps = getOllamaPs();
      console.log(`[First Token] TTFT: ${firstTokenTime - startTime}ms | Ollama Processor: ${ps.processor} | VRAM: ${currentVram} MiB`);
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const json = JSON.parse(line);
        if (json.response) {
          fullResponse += json.response;
        }
        if (json.done) {
          finalStats = json;
        }
      } catch {}
    }

    const currentVram = getGpuMemory();
    if (currentVram > peakVram) peakVram = currentVram;
  }

  streamClosed = true;
  clearTimeout(timeoutId);
  const totalDurationMs = Date.now() - startTime;
  const ttftMs = firstTokenTime ? firstTokenTime - startTime : totalDurationMs;

  const ps = getOllamaPs();

  // Ollama timing stats (in nanoseconds)
  const promptEvalDurationSec = (finalStats?.prompt_eval_duration || 1) / 1e9;
  const promptEvalCount = finalStats?.prompt_eval_count || 0;
  const promptEvalTokPerSec = promptEvalDurationSec > 0 ? Math.round(promptEvalCount / promptEvalDurationSec) : 0;

  const evalDurationSec = (finalStats?.eval_duration || 1) / 1e9;
  const evalCount = finalStats?.eval_count || 0;
  const evalTokPerSec = evalDurationSec > 0 ? parseFloat((evalCount / evalDurationSec).toFixed(1)) : 0;

  // TypeScript AST Verification
  const syntaxCheck = verifyTypeScriptSyntax(fullResponse);

  console.log(`[Results]`);
  console.log(`  - TTFT                   : ${ttftMs} ms`);
  console.log(`  - Prompt Processing      : ${promptEvalTokPerSec} tok/s (${promptEvalCount} tokens in ${promptEvalDurationSec.toFixed(2)}s)`);
  console.log(`  - Token Generation       : ${evalTokPerSec} tok/s (${evalCount} tokens in ${evalDurationSec.toFixed(2)}s)`);
  console.log(`  - Total Elapsed          : ${(totalDurationMs / 1000).toFixed(2)} s`);
  console.log(`  - Ollama Processor       : ${ps.processor}`);
  console.log(`  - Ollama Size in Memory  : ${ps.vram}`);
  console.log(`  - Peak NVIDIA VRAM       : ${peakVram} MiB (~${(peakVram / 1024).toFixed(2)} GB)`);
  console.log(`  - TypeScript Syntax Valid: ${syntaxCheck.valid ? "✔ YES (0 Syntax Errors)" : "✖ SYNTAX ERRORS: " + syntaxCheck.errors.join(", ")}`);

  return {
    contextSize: numCtx,
    model,
    ttftMs,
    promptEvalTokPerSec,
    evalTokPerSec,
    totalTokensGenerated: evalCount,
    totalDurationMs,
    ollamaProcessor: ps.processor,
    ollamaVramMb: ps.vram,
    nvidiaPeakVramMb: peakVram,
    codeCompiled: syntaxCheck.valid,
    tsDiagnostics: syntaxCheck.errors,
  };
}

async function main() {
  const model = "gemma4:12b";
  const results: BenchmarkResult[] = [];

  for (const ctx of [4096, 8192, 16384]) {
    try {
      const res = await runBenchmark(model, ctx);
      results.push(res);
    } catch (e: any) {
      console.error(`Failed benchmark at ctx=${ctx}:`, e.message);
    }
  }

  console.log(`\n==================================================`);
  console.log(`📊 FINAL BENCHMARK SUMMARY TABLE (${model})`);
  console.log(`==================================================`);
  console.log(`| Context | TTFT (ms) | Prefill (tok/s) | Decode (tok/s) | Tokens | Peak VRAM | Processor | Syntax Valid |`);
  console.log(`|---------|-----------|-----------------|----------------|--------|-----------|-----------|--------------|`);
  for (const r of results) {
    console.log(
      `| ${(r.contextSize / 1024).toFixed(0)}K     | ${r.ttftMs.toString().padEnd(9)} | ${r.promptEvalTokPerSec.toString().padEnd(15)} | ${r.evalTokPerSec.toString().padEnd(14)} | ${r.totalTokensGenerated.toString().padEnd(6)} | ${(r.nvidiaPeakVramMb / 1024).toFixed(2)} GB   | ${r.ollamaProcessor.padEnd(9)} | ${r.codeCompiled ? "✔ PASS" : "✖ FAIL"}       |`
    );
  }
}

main().catch(console.error);
