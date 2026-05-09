import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  getPooledApiKey,
  hasPooledCredentials,
  getCredentialDiagnostics,
} from "../src/core/llm/credential-pool.js";
import { getProvider, getAllProviders, registerCustomProviders } from "../src/core/llm/providers/index.js";
import { setSecret, deleteSecret, fileRead, getStorageBackend } from "../src/core/secrets.js";
import type { ProviderDefinition } from "../src/core/llm/providers/types.js";

// Reset state between tests
beforeEach(() => {
  // Clear env vars used by tests
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  delete process.env.XAI_API_KEY;
  delete process.env.MISTRAL_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.GROQ_API_KEY;
  delete process.env.FIREWORKS_API_KEY;
  delete process.env.LLM_GATEWAY_API_KEY;
  delete process.env.AI_GATEWAY_API_KEY;
  delete process.env.OPENCODE_ZEN_API_KEY;
  delete process.env.OPENCODE_GO_API_KEY;
  delete process.env.TESTPOOL_API_KEY;

  // Clear any custom providers
  registerCustomProviders([]);

  // Clear secrets store changes from previous tests
  // (We can't easily clear fileRead cache, but we can work with env vars in tests)
});

describe("getPooledApiKey", () => {
  test("returns undefined when no keys are set anywhere", () => {
    // Default built-in providers with no env vars set
    const result = getPooledApiKey("anthropic");
    expect(result).toBeUndefined();
  });

  test("returns key from direct env var for provider", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-direct-12345";
    const result = getPooledApiKey("anthropic");
    expect(result).toBe("sk-ant-direct-12345");
  });

  test("returns key from direct env var for openrouter", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-direct-67890";
    const result = getPooledApiKey("openrouter");
    expect(result).toBe("sk-or-direct-67890");
  });

  test("returns key from gateway fallback when direct env var is not set", () => {
    // openrouter has gatewayFrom: "anthropic"
    // If OPENROUTER_API_KEY is not set but ANTHROPIC_API_KEY is, it should use the anthropic key
    delete process.env.OPENROUTER_API_KEY;
    process.env.ANTHROPIC_API_KEY = "sk-ant-gateway-fallback";

    const result = getPooledApiKey("openrouter");
    expect(result).toBe("sk-ant-gateway-fallback");
  });

  test("prefers direct key over gateway fallback", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-direct";
    process.env.ANTHROPIC_API_KEY = "sk-ant-upstream";

    const result = getPooledApiKey("openrouter");
    expect(result).toBe("sk-or-direct");
  });

  test("llmgateway falls back to anthropic key", () => {
    delete process.env.LLM_GATEWAY_API_KEY;
    process.env.ANTHROPIC_API_KEY = "sk-ant-for-llmgw";

    const result = getPooledApiKey("llmgateway");
    expect(result).toBe("sk-ant-for-llmgw");
  });

  test("vercel_gateway falls back to anthropic key", () => {
    delete process.env.AI_GATEWAY_API_KEY;
    process.env.ANTHROPIC_API_KEY = "sk-ant-for-vgw";

    const result = getPooledApiKey("vercel_gateway");
    expect(result).toBe("sk-ant-for-vgw");
  });

  test("opencode-zen uses family match to get anthropic key", () => {
    delete process.env.OPENCODE_ZEN_API_KEY;
    process.env.ANTHROPIC_API_KEY = "sk-ant-family-match";

    const result = getPooledApiKey("opencode-zen");
    expect(result).toBe("sk-ant-family-match");
  });

  test("opencode-go uses gatewayFrom + family match for anthropic key", () => {
    delete process.env.OPENCODE_GO_API_KEY;
    process.env.ANTHROPIC_API_KEY = "sk-ant-go";

    const result = getPooledApiKey("opencode-go");
    expect(result).toBe("sk-ant-go");
  });

  test("returns undefined for provider with no env var (e.g. ollama)", () => {
    const result = getPooledApiKey("ollama");
    expect(result).toBeUndefined();
  });

  test("custom provider with envVar and family match to anthropic", () => {
    registerCustomProviders([
      {
        id: "my-anthropic-proxy",
        baseURL: "https://my-proxy.com/v1",
        envVar: "MY_ANTHROPIC_PROXY_KEY",
        family: "anthropic",
      },
    ]);

    // Custom provider without a key set, but should get key via family matching
    process.env.ANTHROPIC_API_KEY = "sk-ant-custom-family";
    const result = getPooledApiKey("my-anthropic-proxy");
    expect(result).toBe("sk-ant-custom-family");
  });
});

describe("hasPooledCredentials", () => {
  test("returns false when no credentials are available", () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(hasPooledCredentials("anthropic")).toBe(false);
  });

  test("returns true when direct credentials are set", () => {
    process.env.ANTHROPIC_API_KEY = "sk-test-123";
    expect(hasPooledCredentials("anthropic")).toBe(true);
  });

  test("returns true when gateway fallback credentials are set", () => {
    delete process.env.OPENROUTER_API_KEY;
    process.env.ANTHROPIC_API_KEY = "sk-test-456";
    expect(hasPooledCredentials("openrouter")).toBe(true);
  });
});

describe("getCredentialDiagnostics", () => {
  test("reports direct key when set", () => {
    process.env.ANTHROPIC_API_KEY = "sk-diag-123";
    const result = getCredentialDiagnostics("anthropic");
    expect(result.providerId).toBe("anthropic");
    expect(result.directEnvVar).toBe("ANTHROPIC_API_KEY");
    expect(result.directKeySet).toBe(true);
    expect(result.pooledFrom).toBeUndefined();
    expect(result.effectiveKeySet).toBe(true);
  });

  test("reports gateway fallback when direct key not set", () => {
    delete process.env.OPENROUTER_API_KEY;
    process.env.ANTHROPIC_API_KEY = "sk-diag-gw-456";
    const result = getCredentialDiagnostics("openrouter");
    expect(result.providerId).toBe("openrouter");
    expect(result.directEnvVar).toBe("OPENROUTER_API_KEY");
    expect(result.directKeySet).toBe(false);
    expect(result.pooledFrom).toBe("anthropic");
    expect(result.effectiveKeySet).toBe(true);
  });

  test("reports no credentials when nothing is set", () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    const result = getCredentialDiagnostics("openrouter");
    expect(result.directKeySet).toBe(false);
    expect(result.effectiveKeySet).toBe(false);
  });
});

describe("provider definitions", () => {
  test("openrouter has gatewayFrom: 'anthropic'", () => {
    const p = getProvider("openrouter")!;
    expect(p.gatewayFrom).toBe("anthropic");
  });

  test("llmgateway has gatewayFrom: 'anthropic'", () => {
    const p = getProvider("llmgateway")!;
    expect(p.gatewayFrom).toBe("anthropic");
  });

  test("vercel_gateway has gatewayFrom: 'anthropic'", () => {
    const p = getProvider("vercel_gateway")!;
    expect(p.gatewayFrom).toBe("anthropic");
  });

  test("opencode-go has gatewayFrom: 'anthropic'", () => {
    const p = getProvider("opencode-go")!;
    expect(p.gatewayFrom).toBe("anthropic");
  });

  test("anthropic provider has family: 'anthropic'", () => {
    const p = getProvider("anthropic")!;
    expect(p.family).toBe("anthropic");
  });

  test("openrouter has family: 'anthropic'", () => {
    const p = getProvider("openrouter")!;
    expect(p.family).toBe("anthropic");
  });

  test("opencode-zen has family: 'anthropic'", () => {
    const p = getProvider("opencode-zen")!;
    expect(p.family).toBe("anthropic");
  });

  test("opencode-go has family: 'anthropic'", () => {
    const p = getProvider("opencode-go")!;
    expect(p.family).toBe("anthropic");
  });

  test("anthropic does not have gatewayFrom (it is the origin)", () => {
    const p = getProvider("anthropic")!;
    expect(p.gatewayFrom).toBeUndefined();
  });
});