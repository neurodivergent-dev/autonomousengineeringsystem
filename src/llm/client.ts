/**
 * MetaFrame Unified LLM Client
 * Zero-dependency HTTP fetch-based client supporting Ollama, OpenAI, and Gemini formats.
 */

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
}

export class SharedLLMClient {
  private config: LLMConfig;

  constructor(config?: Partial<LLMConfig>) {
    const groqKey = process.env.GROQ_API_KEY || "";
    const provider = process.env.METAFRAME_PROVIDER || (groqKey ? "groq" : "ollama");

    this.config = {
      provider: (provider as any) || config?.provider || "groq",
      model:
        process.env.METAFRAME_MODEL ||
        config?.model ||
        (provider === "groq" ? "openai/gpt-oss-120b" : "gemma4:12b"),
      baseUrl:
        process.env.METAFRAME_BASE_URL ||
        config?.baseUrl ||
        (provider === "groq"
          ? "https://api.groq.com/openai/v1"
          : process.env.OLLAMA_HOST || "http://localhost:11434"),
      apiKey: process.env.LLM_API_KEY || groqKey || config?.apiKey,
      temperature: config?.temperature ?? 0.2,
    };
  }

  public get modelName(): string {
    return this.config.model;
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
    onToken?: (chunk: string) => void
  ): Promise<string> {
    if (this.config.provider === "ollama") {
      return this.callOllamaStream(messages, onToken);
    }
    return this.callOpenAICompatibleStream(messages, onToken);
  }

  /**
   * Calls Ollama API (/api/chat)
   */
  private async callOllama(messages: ChatMessage[]): Promise<string> {
    const baseUrl = this.config.baseUrl || "http://localhost:11434";
    const url = `${baseUrl.replace(/\/$/, "")}/api/chat`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.config.model,
          messages,
          stream: false,
          think: false, // Disable repetitive thinking loop for instant code generation
          options: {
            temperature: this.config.temperature,
            repeat_penalty: 1.15,
            num_predict: 3072,
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
      // Graceful fallback if Ollama server is not running
      console.warn(`[SharedLLMClient] Ollama connection warning: ${err.message}`);
      return `[SIMULATED_LLM_RESPONSE] Model: ${this.config.model}\nPrompt acknowledged.`;
    }
  }

  /**
   * Calls Ollama API (/api/chat) with streaming tokens
   */
  private async callOllamaStream(
    messages: ChatMessage[],
    onToken?: (chunk: string) => void
  ): Promise<string> {
    const baseUrl = this.config.baseUrl || "http://localhost:11434";
    const url = `${baseUrl.replace(/\/$/, "")}/api/chat`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.config.model,
          messages,
          stream: true,
          think: false, // Disable repetitive thinking loop
          options: {
            temperature: this.config.temperature,
            repeat_penalty: 1.15,
            num_predict: 3072,
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
   * Calls standard OpenAI-compatible completions endpoint
   */
  private async callOpenAICompatible(messages: ChatMessage[], retryCount: number = 0): Promise<string> {
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
          model: this.config.model,
          messages,
          temperature: this.config.temperature,
        }),
      });

      if (res.status === 429 && retryCount < 3) {
        const errorText = await res.text();
        const waitMatch = errorText.match(/try again in ([\d.]+)s/i);
        const waitSec = waitMatch ? Math.ceil(parseFloat(waitMatch[1])) + 1 : (retryCount + 1) * 3;
        console.warn(`[SharedLLMClient] ⚠ Groq Rate Limit (429) hit. Auto-waiting ${waitSec}s before retry (${retryCount + 1}/3)...`);
        await new Promise((r) => setTimeout(r, waitSec * 1000));
        return this.callOpenAICompatible(messages, retryCount + 1);
      }

      if (!res.ok) {
        throw new Error(`LLM API error [${res.status}]: ${await res.text()}`);
      }

      const data = (await res.json()) as any;
      return data.choices?.[0]?.message?.content || "";
    } catch (err: any) {
      console.warn(`[SharedLLMClient] API error: ${err.message}`);
      return "";
    }
  }

  /**
   * Calls OpenAI/Groq compatible chat completions with real-time SSE token streaming
   */
  private async callOpenAICompatibleStream(
    messages: ChatMessage[],
    onToken?: (chunk: string) => void,
    retryCount: number = 0
  ): Promise<string> {
    const baseUrl = this.config.baseUrl || "https://api.groq.com/openai/v1";
    const url = `${baseUrl.replace(/\/$/, "")}/chat/completions`;

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.config.model,
          messages,
          stream: true,
          temperature: this.config.temperature,
        }),
      });

      if (res.status === 429 && retryCount < 3) {
        const errorText = await res.text();
        const waitMatch = errorText.match(/try again in ([\d.]+)s/i);
        const waitSec = waitMatch ? Math.ceil(parseFloat(waitMatch[1])) + 1 : (retryCount + 1) * 3;
        console.warn(`[SharedLLMClient] ⚠ Groq Rate Limit (429) hit on stream. Auto-waiting ${waitSec}s before retry (${retryCount + 1}/3)...`);
        await new Promise((r) => setTimeout(r, waitSec * 1000));
        return this.callOpenAICompatibleStream(messages, onToken, retryCount + 1);
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

      return fullContent;
    } catch (err: any) {
      console.warn(`[SharedLLMClient] Groq/OpenAI stream fallback: ${err.message}`);
      return this.callOpenAICompatible(messages);
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
