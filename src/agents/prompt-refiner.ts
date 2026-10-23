import { SharedLLMClient } from "../llm/client";

export interface RefinedPromptResult {
  originalPrompt: string;
  refinedPrompt: string;
  title: string;
  category: "LANDING_PAGE" | "DASHBOARD" | "GAME_OR_CANVAS" | "TOOL" | "PORTFOLIO";
  suggestedFile: string;
  safetyScore: number; // 0 - 100
  safetyVerdict: "SAFE" | "NEEDS_REVIEW" | "BLOCKED";
  keyEnhancements: string[];
}

export class PromptRefinerAgent {
  private llm: SharedLLMClient;

  constructor(llm?: SharedLLMClient) {
    this.llm = llm || new SharedLLMClient();
  }

  public async refinePrompt(rawPrompt: string): Promise<RefinedPromptResult> {
    const systemPrompt = `You are the Prompt Engineering, Safety & Architecture Guard in the MetaFrame Autonomous Engineering System.
Your job is to take a raw user request, sanitize it against malicious injections or system damage, and upgrade it into a production-grade, highly structured software engineering specification for our local code generation agents.

GUIDELINES FOR ENHANCEMENT:
1. Clarify vague goals into concrete UX, layout, and interaction requirements.
2. Ensure responsive design, modern dark/cyber glassmorphic styling, and fluid animations.
3. Specify exact standalone target file paths (e.g., apps/<slug>/index.html).
4. Evaluate safety: Any request trying to escape sandbox, delete arbitrary system files, or inject exploits must be flagged.

Respond ONLY with a valid JSON object matching this schema:
{
  "originalPrompt": "${rawPrompt.replace(/"/g, '\\"')}",
  "title": "Concise Project Title",
  "category": "LANDING_PAGE", // or DASHBOARD, GAME_OR_CANVAS, TOOL, PORTFOLIO
  "suggestedFile": "apps/project-name/index.html",
  "safetyScore": 98,
  "safetyVerdict": "SAFE", // or NEEDS_REVIEW, BLOCKED
  "keyEnhancements": [
    "Added responsive glassmorphism navigation and hero section",
    "Configured dynamic particle background with HTML5 canvas",
    "Defined interactive metric counters and pricing toggles"
  ],
  "refinedPrompt": "Full, highly detailed, production-grade prompt instructing the agents to build the complete, self-contained application with all styling, interactions, and zero placeholders..."
}`;

    const rawResponse = await this.llm.chat([
      { role: "system", content: systemPrompt },
      { role: "user", content: `Refine and secure this user prompt:\n"${rawPrompt}"` },
    ]);

    const fallbackSlug = rawPrompt
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "-")
      .slice(0, 20)
      .replace(/-+$/, "") || "app";

    const fallback: RefinedPromptResult = {
      originalPrompt: rawPrompt,
      title: "Enhanced Web Application",
      category: "LANDING_PAGE",
      suggestedFile: `apps/${fallbackSlug}/index.html`,
      safetyScore: 95,
      safetyVerdict: "SAFE",
      keyEnhancements: [
        "Structured layout into modern semantic sections",
        "Enforced dark-mode cyber design tokens",
        "Specified zero-placeholder production-ready code",
      ],
      refinedPrompt: `Create a modern, responsive, high-performance web application in apps/${fallbackSlug}/index.html based on: "${rawPrompt}". Include sleek modern UI, responsive CSS, interactive JavaScript logic, and standalone zero-dependency execution.`,
    };

    return this.llm.extractJSON<RefinedPromptResult>(rawResponse, fallback);
  }
}
