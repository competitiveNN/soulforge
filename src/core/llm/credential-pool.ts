/**
 * Credential Pool — share API keys across providers with compatible auth.
 *
 * Use cases:
 *   - OpenRouter and other gateways may forward credentials to upstream providers.
 *   - If the user sets ANTHROPIC_API_KEY, we can reuse it for anthropic/ and
 *     any gateway that routes to Anthropic (openrouter/, llmgateway/, etc.)
 *   - Avoids duplicate env vars and "key not set" errors when the model ID
 *     includes a gateway prefix but the user only configured the upstream provider.
 *
 * Pool rules (checked in order):
 *   1. Direct env var / stored key for the provider (existing behavior).
 *   2. Gateway forwarding via `gatewayFrom` on the ProviderDefinition.
 *   3. Family match — any provider sharing a `family` falls back to that family's key.
 *
 * Round-robin:
 *   When multiple keys are available (comma-separated env var or multiple
 *   entries in secrets.json), keys are rotated on each call so that
 *   consecutive requests use different keys when available.
 */

import { getAllKeys } from "../secrets.js";
import { getAllProviders, getProvider } from "./providers/index.js";

/** Track the last-used key index per provider for round-robin selection. */
const keyIndexCounters = new Map<string, number>();

/**
 * Pick the next key index using round-robin for the given provider.
 * Returns the index and advances the counter.
 */
function nextKeyIndex(providerId: string, keyCount: number): number {
  if (keyCount <= 1) return 0;
  const current = keyIndexCounters.get(providerId) ?? 0;
  const next = (current + 1) % keyCount;
  keyIndexCounters.set(providerId, next);
  return current;
}

/**
 * Resolve a key from all available sources for an env var,
 * applying round-robin when multiple keys are available.
 */
function resolveKeyRotating(envVar: string, providerId: string): string | undefined {
  const keys = getAllKeys(envVar);
  if (keys.length === 0) return undefined;
  const idx = nextKeyIndex(providerId, keys.length);
  return keys[idx];
}

/**
 * Resolve an API key for a provider, with pool fallback.
 *
 * Order:
 *   1. Direct env var / stored key for the provider (with round-robin).
 *   2. Gateway forwarding — if the provider declares `gatewayFrom`,
 *      use the upstream provider's key.
 *   3. Family match — if the provider declares `family`, use that
 *      family's canonical provider key.
 *
 * When multiple keys are available (comma-separated env var or pooled
 * storage in secrets.json), keys are rotated round-robin per provider.
 *
 * @param providerId - The provider ID (e.g. "anthropic", "openrouter")
 * @param directEnvVar - Optional direct env var name to check when the
 *   provider isn't yet registered in the global provider map.
 *
 * Returns the key string, or undefined if not found.
 */
export function getPooledApiKey(providerId: string, directEnvVar?: string): string | undefined {
  const provider = getProvider(providerId);

  // 1. Direct key for this provider (with round-robin if multiple keys)
  const envVar = provider?.envVar ?? directEnvVar;
  if (envVar) {
    const key = resolveKeyRotating(envVar, providerId);
    if (key) return key;
  }

  // If no provider definition found, we can't do gateway/family lookups
  if (!provider) return undefined;

  // 2. Gateway forwarding: use the upstream provider's key
  //    (e.g. openrouter has gatewayFrom: "anthropic" → uses ANTHROPIC_API_KEY)
  if (provider.gatewayFrom) {
    const upstream = getProvider(provider.gatewayFrom);
    if (upstream?.envVar) {
      const key = resolveKeyRotating(upstream.envVar, provider.gatewayFrom);
      if (key) return key;
    }
  }

  // 3. Family match: any provider sharing a family uses that family's key
  if (provider.family) {
    for (const p of getAllProviders()) {
      if (p.id === providerId) continue; // skip self, already checked above
      if (p.family === provider.family && p.envVar) {
        const key = resolveKeyRotating(p.envVar, p.id);
        if (key) return key;
      }
    }
  }

  return undefined;
}

/**
 * Check if a provider has credentials available (direct or pooled).
 */
export function hasPooledCredentials(providerId: string): boolean {
  return Boolean(getPooledApiKey(providerId));
}

/**
 * Get diagnostic info about credential resolution for a provider.
 * Useful for debugging and user-facing messages.
 */
export function getCredentialDiagnostics(providerId: string): {
  providerId: string;
  directEnvVar: string | undefined;
  directKeySet: boolean;
  pooledFrom: string | undefined;
  effectiveKeySet: boolean;
} {
  const provider = getProvider(providerId);
  const directEnvVar = provider?.envVar;
  const directKeySet = directEnvVar ? Boolean(getAllKeys(directEnvVar).length) : false;

  let pooledFrom: string | undefined;
  if (!directKeySet && provider?.gatewayFrom) {
    const upstream = getProvider(provider.gatewayFrom);
    if (upstream?.envVar) {
      const upstreamKeys = getAllKeys(upstream.envVar);
      if (upstreamKeys.length > 0) {
        pooledFrom = provider.gatewayFrom;
      }
    }
  }

  const effectiveKeySet = directKeySet || Boolean(pooledFrom);

  return {
    providerId,
    directEnvVar,
    directKeySet,
    pooledFrom,
    effectiveKeySet,
  };
}
