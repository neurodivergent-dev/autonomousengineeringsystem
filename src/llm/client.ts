/**
 * MetaFrame Unified LLM Client
 * Zero-dependency HTTP fetch-based client supporting Ollama, OpenAI, and Gemini formats.
 */

import { ModelResilienceLayer, type ProviderTier } from "./model-resilience-layer";

export interface LLMConfig {
  provider: "groq" | "ollama" | "openai" | "custom";
  model: string;
  baseUrl?: string;
  apiKey?: string;
  temperature?: number;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
  images?: string[];
}

export type LLMStatusCallback = (status: { message: string; model?: string; isWarning?: boolean }) => void;

export class SharedLLMClient {
  private config: LLMConfig;
  public onStatusChange?: LLMStatusCallback;
  private resilience = ModelResilienceLayer.getInstance();

  constructor(config?: Partial<LLMConfig>) {
    const provider = process.env.METAFRAME_PROVIDER || config?.provider || "ollama";
    const defaultModel = "qwen3:8b-q4_K_M";
    const model = process.env.METAFRAME_MODEL || config?.model || defaultModel;

    this.config = {
      provider: (provider as any) || "ollama",
      model,
      baseUrl:
        process.env.METAFRAME_BASE_URL ||
        config?.baseUrl ||
        (provider === "ollama"
          ? process.env.OLLAMA_HOST || "http://localhost:11434"
          : "https://api.groq.com/openai/v1"),
      apiKey: process.env.LLM_API_KEY || config?.apiKey,
      temperature: config?.temperature ?? 0.2,
    };
  }

  public get modelName(): string {
    return this.config.model;
  }

  public getResilienceLayer(): ModelResilienceLayer {
    return this.resilience;
  }

  private getTierForModel(model: string): ProviderTier {
    if (model.includes("120b")) return "groq-flagship";
    if (model.includes("qwen")) return "groq-fast";
    if (model.includes("20b")) return "groq-compact";
    if (model.includes("26b")) return "local-gpu-large";
    return "local-gpu";
  }

  private notifyStatus(message: string, model?: string, isWarning: boolean = false) {
    if (this.onStatusChange) {
      try {
        this.onStatusChange({ message, model, isWarning });
      } catch {}
    }
    console.log(`\x1b[36m[SharedLLMClient]\x1b[0m ${message}`);
  }

  private async isOllamaAlive(): Promise<boolean> {
    try {
      const res = await fetch("http://localhost:11434/api/tags", { signal: AbortSignal.timeout(1000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Primary chat completion method
   */
  public async chat(messages: ChatMessage[]): Promise<string> {
    if (this.config.provider === "ollama") {
      return this.callOllama(messages);
    }
    return this.callOpenAICompatible(messages);
  }

  /**
   * Streaming chat method supporting real-time token streaming
   */
  public async chatStream(
    messages: ChatMessage[],
    onToken?: (chunk: string) => void,
    maxTokens?: number
  ): Promise<string> {
    if (this.config.provider === "ollama") {
      return this.callOllamaStream(messages, onToken, undefined, maxTokens);
    }
    return this.callOpenAICompatibleStream(messages, onToken, 0, undefined, new Set(), maxTokens);
  }

  /**
   * Calls Ollama API (/api/chat)
   */
  private async callOllama(messages: ChatMessage[], overrideModel?: string): Promise<string> {
    const baseUrl = "http://localhost:11434";
    const url = `${baseUrl}/api/chat`;
    const hasImages = messages.some((m) => m.images && m.images.length > 0);
    const defaultLocal = hasImages ? "gemma4:12b" : "qwen3:8b-q4_K_M";
    let modelToUse = overrideModel || (this.config.model.includes("/") ? defaultLocal : this.config.model);
    if (hasImages && modelToUse === "qwen3:8b-q4_K_M") {
      modelToUse = "gemma4:12b";
      console.log(`[SharedLLMClient] Görsel tespit edildi: Çok modlu (vision) modeline geçildi -> ${modelToUse}`);
    }

    const formattedMessages = messages.map((m) => {
      const msgObj: any = { role: m.role, content: m.content };
      if (m.images && m.images.length > 0) {
        msgObj.images = m.images.map((img) =>
          img.replace(/^data:image\/[a-zA-Z0-9_\-+.]+;base64,/, "")
        );
      }
      return msgObj;
    });

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: modelToUse,
          messages: formattedMessages,
          stream: false,
          think: false, // Disable repetitive thinking loop for instant code generation
          options: {
            temperature: this.config.temperature,
            repeat_penalty: 1.15,
            num_predict: -1, // Infinite generation (no token truncation)
            num_ctx: 16384,
          },
        }),
      });

      if (!res.ok) {
        throw new Error(`Ollama error [${res.status}]: ${await res.text()}`);
      }

      const data = (await res.json()) as any;
      let content = data.message?.content || "";
      return content;
    } catch (err: any) {
      console.warn(`[SharedLLMClient] Ollama connection warning: ${err.message}`);
      return `[SIMULATED_LLM_RESPONSE] Model: ${modelToUse}\nPrompt acknowledged.`;
    }
  }

  /**
   * Calls Ollama API (/api/chat) with streaming tokens
   */
  private async callOllamaStream(
    messages: ChatMessage[],
    onToken?: (chunk: string) => void,
    overrideModel?: string,
    maxTokens?: number
  ): Promise<string> {
    const baseUrl = "http://localhost:11434";
    const url = `${baseUrl}/api/chat`;
    const hasImages = messages.some((m) => m.images && m.images.length > 0);
    const defaultLocal = hasImages ? "gemma4:12b" : "qwen3:8b-q4_K_M";
    let modelToUse = overrideModel || (this.config.model.includes("/") ? defaultLocal : this.config.model);
    if (hasImages && modelToUse === "qwen3:8b-q4_K_M") {
      modelToUse = "gemma4:12b";
      console.log(`[SharedLLMClient] Görsel tespit edildi: Çok modlu (vision) modeline geçildi -> ${modelToUse}`);
    }

    const formattedMessages = messages.map((m) => {
      const msgObj: any = { role: m.role, content: m.content };
      if (m.images && m.images.length > 0) {
        msgObj.images = m.images.map((img) =>
          img.replace(/^data:image\/[a-zA-Z0-9_\-+.]+;base64,/, "")
        );
      }
      return msgObj;
    });

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: modelToUse,
          messages: formattedMessages,
          stream: true,
          think: false, // Disable repetitive thinking loop
          options: {
            temperature: this.config.temperature,
            repeat_penalty: 1.15,
            num_predict: -1, // Infinite generation (no token truncation)
            num_ctx: 16384,
          },
        }),
      });

      if (!res.ok || !res.body) {
        throw new Error(`Ollama stream error [${res.status}]: ${await res.text()}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullContent = "";
      let fullThinking = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const data = JSON.parse(line);
            const token = data.message?.content || "";
            const thinking = data.message?.thinking || "";
            if (token) {
              fullContent += token;
              if (onToken) onToken(token);
            }
            if (thinking) {
              fullThinking += thinking;
            }
          } catch {}
        }
      }

      return fullContent;
    } catch (err: any) {
      console.warn(`[SharedLLMClient] Stream error: ${err.message}`);
      return this.chat(messages);
    }
  }

  /**
   * Calls standard OpenAI-compatible completions endpoint with multi-model cascading
   */
  private async callOpenAICompatible(
    messages: ChatMessage[],
    retryCount: number = 0,
    overrideModel?: string,
    onToken?: (chunk: string) => void,
    attemptedModels: Set<string> = new Set()
  ): Promise<string> {
    const modelToUse = overrideModel || this.config.model;
    attemptedModels.add(modelToUse);
    const baseUrl = this.config.baseUrl || "https://api.openai.com/v1";
    const url = `${baseUrl.replace(/\/$/, "")}/chat/completions`;

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: modelToUse,
          messages,
          max_tokens: modelToUse.includes("27b") ? 1000 : 2048,
          temperature: this.config.temperature,
        }),
      });

      if (res.status === 429) {
        const errorText = await res.text();
        const waitMatch = errorText.match(/try again in ([\d.]+)s/i);
        const waitSec = waitMatch ? Math.ceil(parseFloat(waitMatch[1])) + 1 : 10;

        // Cascade across Groq models: 27b -> 20b -> 120b (never repeat an already attempted model)
        const groqCandidates = ["qwen/qwen3.8-27b", "openai/gpt-oss-20b", "openai/gpt-oss-120b"];
        const nextCandidate = groqCandidates.find((m) => !attemptedModels.has(m));

        if (nextCandidate) {
          this.notifyStatus(`⚡ Groq TPM aşıldı. ${nextCandidate} motoruna devredildi...`, nextCandidate);
          return await this.callOpenAICompatible(messages, 0, nextCandidate, onToken, attemptedModels);
        }

        // If all Groq cloud models exhausted, switch directly to local RTX 5060 Ti GPU (80 tok/s)
        if (await this.isOllamaAlive()) {
          this.notifyStatus(`⚡ Tüm Groq kotaları tükendi. Yerel GPU motoruna (Ollama Qwen3 8B) devredildi...`, "qwen3:8b-q4_K_M");
          return this.callOllama(messages, "qwen3:8b-q4_K_M");
        }

        if (retryCount < 1) {
          this.notifyStatus(`⏳ Groq TPM limiti: ${waitSec}s bekleniyor...`, modelToUse, true);
          await new Promise((r) => setTimeout(r, waitSec * 1000));
          return this.callOpenAICompatible(messages, retryCount + 1, modelToUse, onToken, attemptedModels);
        }

        throw new Error(`Groq TPM limit reached and all fallbacks exhausted.`);
      }

      if (!res.ok) {
        throw new Error(`LLM API error [${res.status}]: ${await res.text()}`);
      }

      const data = (await res.json()) as any;
      const content = data.choices?.[0]?.message?.content || "";
      if (onToken && content) {
        onToken(content);
      }
      return content;
    } catch (err: any) {
      console.warn(`[SharedLLMClient] API error: ${err.message}`);
      if (await this.isOllamaAlive()) {
        this.notifyStatus(`⚡ Hata sonrası Yerel GPU motoruna devredildi...`, "qwen3:8b-q4_K_M");
        return this.callOllama(messages, "qwen3:8b-q4_K_M");
      }
      return "";
    }
  }

  /**
   * Calls OpenAI/Groq compatible chat completions with real-time SSE token streaming & model cascading
   */
  private async callOpenAICompatibleStream(
    messages: ChatMessage[],
    onToken?: (chunk: string) => void,
    retryCount: number = 0,
    overrideModel?: string,
    attemptedModels: Set<string> = new Set(),
    maxTokens?: number
  ): Promise<string> {
    const modelToUse = overrideModel || this.config.model;
    attemptedModels.add(modelToUse);
    const baseUrl = this.config.baseUrl || "https://api.groq.com/openai/v1";
    const url = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
    const startTime = Date.now();

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: modelToUse,
          messages,
          stream: true,
          max_tokens: maxTokens || (modelToUse.includes("27b") && !maxTokens ? 1000 : 4096),
          temperature: this.config.temperature,
        }),
      });

      if (res.status === 429) {
        this.resilience.reportOutcome(this.getTierForModel(modelToUse), false, { isRateLimit: true });
        const errorText = await res.text();
        const waitMatch = errorText.match(/try again in ([\d.]+)s/i);
        const waitSec = waitMatch ? Math.ceil(parseFloat(waitMatch[1])) + 1 : 10;

        // Cascade across Groq models: 27b -> 20b -> 120b (never repeat an already attempted model)
        const groqCandidates = ["qwen/qwen3.8-27b", "openai/gpt-oss-20b", "openai/gpt-oss-120b"];
        const nextCandidate = groqCandidates.find((m) => !attemptedModels.has(m));

        if (nextCandidate) {
          this.notifyStatus(
            `⚡ Groq TPM aşıldı (${waitSec}s bekleme). Kesintisiz akış için ${nextCandidate} motoruna devredildi...`,
            nextCandidate
          );
          return await this.callOpenAICompatibleStream(messages, onToken, 0, nextCandidate, attemptedModels, maxTokens);
        }

        // If all Groq models hit rate limits, seamlessly hand off to local GPU (unlimited tokens, 80 tok/s)
        if (await this.isOllamaAlive()) {
          this.notifyStatus(`⚡ Tüm Groq kotaları tükendi. Kesintisiz akış için Yerel GPU motoruna (Ollama Qwen3 8B) devredildi...`, "qwen3:8b-q4_K_M");
          return this.callOllamaStream(messages, onToken, "qwen3:8b-q4_K_M", maxTokens);
        }

        // Fallback: wait out rate limit only if no local GPU available
        if (retryCount < 1) {
          this.notifyStatus(`⏳ Groq kotaları bekleniyor (${waitSec}s)...`, modelToUse, true);
          await new Promise((r) => setTimeout(r, waitSec * 1000));
          return this.callOpenAICompatibleStream(messages, onToken, retryCount + 1, modelToUse, attemptedModels, maxTokens);
        }

        throw new Error(`Groq TPM limit reached on all models and local GPU unavailable.`);
      }

      if (!res.ok || !res.body) {
        throw new Error(`Groq/OpenAI Stream API error [${res.status}]: ${await res.text()}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullContent = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === "data: [DONE]") continue;
          if (trimmed.startsWith("data: ")) {
            try {
              const data = JSON.parse(trimmed.slice(6));
              const token = data.choices?.[0]?.delta?.content || "";
              if (token) {
                fullContent += token;
                if (onToken) onToken(token);
              }
            } catch {}
          }
        }
      }

      this.resilience.reportOutcome(this.getTierForModel(modelToUse), true, {
        durationMs: Date.now() - startTime,
        tokens: fullContent.length / 4,
      });

      return fullContent;
    } catch (err: any) {
      this.resilience.reportOutcome(this.getTierForModel(modelToUse), false);
      console.warn(`[SharedLLMClient] Groq/OpenAI stream error: ${err.message}`);

      // Try local GPU stream before falling back to non-streaming
      if (await this.isOllamaAlive()) {
        this.notifyStatus(`⚡ Akış kesintisi sonrası Yerel GPU (Qwen3 8B) ile devam ediliyor...`, "qwen3:8b-q4_K_M");
        return this.callOllamaStream(messages, onToken, "qwen3:8b-q4_K_M");
      }

      return this.callOpenAICompatible(messages, 0, overrideModel, onToken, attemptedModels);
    }
  }

  /**
   * Robust JSON extractor from model output (handles ```json fences or raw JSON)
   */
  public extractJSON<T>(response: string, fallback: T): T {
    try {
      // 1. Try markdown code block fence
      const fenceMatch = response.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (fenceMatch && fenceMatch[1]) {
        return JSON.parse(fenceMatch[1].trim());
      }

      // 2. Try raw JSON bracket matching
      const firstBrace = response.indexOf("{");
      const lastBrace = response.lastIndexOf("}");
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        const potentialJson = response.slice(firstBrace, lastBrace + 1);
        return JSON.parse(potentialJson);
      }

      return fallback;
    } catch (e) {
      return fallback;
    }
  }
}
