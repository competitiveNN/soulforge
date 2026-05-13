import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createReasoningFetchWrapper, buildOpenAICompatReasoningBody } from "./reasoning-fetch.js";
import { getPooledApiKey } from "../credential-pool.js";
import type {
  CustomProviderConfig,
  CustomReasoningConfig,
  ProviderDefinition,
  ProviderModelInfo,
} from "./types.js";

interface OpenAIModelListResponse {
  data: { id: string; owned_by?: string }[];
}

function normalizeModels(models?: (string | ProviderModelInfo)[]): ProviderModelInfo[] {
  if (!models || models.length === 0) return [];
  return models.map((m) => (typeof m === "string" ? { id: m, name: m } : m));
}

function buildReasoningBody(reasoning?: CustomReasoningConfig): Record<string, unknown> {
  if (!reasoning) return {};
  return buildOpenAICompatReasoningBody(reasoning.effort, {
    enabled: reasoning.enabled,
    budget: reasoning.budget,
    extraParams: reasoning.extraParams,
  });
}

export function buildCustomProvider(config: CustomProviderConfig): ProviderDefinition {
  const envVar = config.envVar ?? "";
  const reasoningBody = buildReasoningBody(config.reasoning);
  const reasoningFetch = createReasoningFetchWrapper(reasoningBody);

  return {
    id: config.id,
    name: config.name ?? config.id,
    envVar,
    secretKey: `${config.id}-api-key`,
    icon: "\uF29F", // nf-fa-diamond U+F29F
    asciiIcon: "◇",
    custom: true,
    customReasoning: config.reasoning,
    gatewayFrom: config.gatewayFrom,
    family: config.family,

    createModel(modelId: string) {
      const apiKey = envVar ? (getPooledApiKey(config.id, envVar) ?? "") : "custom";
      const client = createOpenAICompatible({
        name: config.id,
        baseURL: config.baseURL,
        apiKey,
        ...(reasoningFetch ? { fetch: reasoningFetch as typeof fetch } : {}),
      });
      return client.chatModel(modelId);
    },

    async fetchModels(): Promise<ProviderModelInfo[] | null> {
      if (!config.modelsAPI) return null;
      const apiKey = envVar ? (getPooledApiKey(config.id, envVar) ?? "") : "";
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

      const res = await fetch(config.modelsAPI, {
        headers,
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return null;

      const data = (await res.json()) as OpenAIModelListResponse;
      if (!Array.isArray(data.data)) return null;

      return data.data.map((m) => ({ id: m.id, name: m.id }));
    },

    fallbackModels: normalizeModels(config.models),
    contextWindows: [],

    async checkAvailability() {
      if (envVar) {
        const key = getPooledApiKey(config.id, envVar);
        if (key) return true;
      }
      try {
        const res = await fetch(config.baseURL, { signal: AbortSignal.timeout(2000) });
        return res.ok || res.status === 401 || res.status === 403;
      } catch {
        return false;
      }
    },
  };
}
