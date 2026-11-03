import { SharedLLMClient } from "../llm/client";
import type { PRD } from "../types";

export class ProductDiscoveryAgent {
  private llm: SharedLLMClient;

  constructor(llm: SharedLLMClient) {
    this.llm = llm;
  }

  public async createPRD(
    featurePrompt: string,
    domainContext: string = "",
    onToken?: (chunk: string) => void
  ): Promise<PRD> {
    const timestamp = new Date().toISOString();
    const prdId = `PRD-${Date.now().toString().slice(-4)}`;

    const systemPrompt = `You are the Product Discovery Agent in the MetaFrame Autonomous Engineering System.
Your task is to transform a raw user request into a formal, highly-structured Product Requirements Document (PRD).

Existing Domain & Routing Context:
${domainContext || "No previous domain context provided."}

Return ONLY a valid JSON object matching this schema:
{
  "id": "${prdId}",
  "title": "Clear concise feature title",
  "version": "1.0.0",
  "status": "APPROVED",
  "overview": "Detailed overview of the product requirement",
  "userStories": [
    { "persona": "User type", "want": "Action wanted", "soThat": "Business benefit" }
  ],
  "functionalRequirements": ["Requirement 1", "Requirement 2"],
  "nonFunctionalRequirements": ["Performance, accessibility, or security constraint"],
  "acceptanceCriteria": ["Condition 1 to verify completeness", "Condition 2"],
  "targetDomains": ["Domain name (e.g. auth, navigation, i18n, ui)"],
  "createdAt": "${timestamp}"
}`;

    const rawResponse = await this.llm.chatStream(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Feature request:\n${featurePrompt}` },
      ],
      onToken
    );

    const fallback: PRD = {
      id: prdId,
      title: featurePrompt.slice(0, 50),
      version: "1.0.0",
      status: "APPROVED",
      overview: featurePrompt,
      userStories: [
        {
          persona: "Engineer/User",
          want: featurePrompt,
          soThat: "the application gains requested capabilities without regressions",
        },
      ],
      functionalRequirements: [featurePrompt],
      nonFunctionalRequirements: ["Must pass 0-error TypeScript compilation and theme guidelines."],
      acceptanceCriteria: ["Feature is implemented and verified by 6-gate safety chain."],
      targetDomains: ["core"],
      createdAt: timestamp,
    };

    return this.llm.extractJSON<PRD>(rawResponse, fallback);
  }
}
