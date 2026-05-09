import { gateway as aiGateway } from "ai";
import { getPooledApiKey } from "../credential-pool.js";
import type { ProviderDefinition, ProviderModelInfo } from "./types.js";

export const vercelGatewayProvider: ProviderDefinition = {
  id: "vercel_gateway",
  name: "Vercel AI Gateway",
  envVar: "AI_GATEWAY_API_KEY",
  icon: "󰒍", // nf-md-cloud_sync U+F048D
  secretKey: "vercel-gateway-api-key",
  keyUrl: "vercel.com/ai-gateway",
  asciiIcon: "☁",
  description: "Vercel AI Gateway",
  grouped: true,
  gatewayFrom: "anthropic",
  family: "anthropic",

  createModel(modelId: string) {
    const apiKey = getPooledApiKey("vercel_gateway");
    if (!apiKey) {
      throw new Error("AI_GATEWAY_API_KEY is not set");
    }
    return aiGateway(modelId);
  },

  async fetchModels(): Promise<ProviderModelInfo[] | null> {
    return null;
  },

  fallbackModels: [],
  contextWindows: [],
};
