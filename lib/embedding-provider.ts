export const EMBEDDING_DIMENSIONS = 512;

export type EmbeddingResult = { vector: number[]; model: string; inputTokens: number; latencyMs: number };
export type EmbeddingModel = { model: string; embed(input: string): Promise<EmbeddingResult> };

export class EmbeddingProviderError extends Error {
  readonly code: 'disabled' | 'timeout' | 'http_error' | 'invalid_response' | 'network_error';

  constructor(code: EmbeddingProviderError['code']) {
    super(`Embedding provider failed: ${code}`);
    this.code = code;
  }
}

export function createAIHubMixEmbedding(config: {
  enabled: boolean; apiKey?: string; baseUrl?: string; model?: string; timeoutMs?: number;
}, request = fetch): EmbeddingModel {
  const model = config.model || 'text-embedding-3-small';
  return {
    model,
    async embed(input: string) {
      if (!config.enabled || !config.apiKey) throw new EmbeddingProviderError('disabled');
      const normalized = input.trim().slice(0, 12_000);
      if (!normalized) throw new EmbeddingProviderError('invalid_response');
      const base = (config.baseUrl || 'https://aihubmix.com/v1').replace(/\/$/, '');
      const endpoint = `${base.endsWith('/v1') ? base : `${base}/v1`}/embeddings`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 2500);
      const started = performance.now();
      let response: Response;
      try {
        response = await request(endpoint, {
          method: 'POST',
          headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({ input: normalized, model, dimensions: EMBEDDING_DIMENSIONS, encoding_format: 'float' }),
          signal: controller.signal,
        });
      } catch (error) {
        throw new EmbeddingProviderError(error instanceof DOMException && error.name === 'AbortError' ? 'timeout' : 'network_error');
      } finally {
        clearTimeout(timeout);
      }
      if (!response.ok) throw new EmbeddingProviderError('http_error');
      let payload: Record<string, unknown>;
      try {
        payload = await response.json() as Record<string, unknown>;
      } catch {
        throw new EmbeddingProviderError('invalid_response');
      }
      const first = Array.isArray(payload.data) ? payload.data[0] as Record<string, unknown> | undefined : undefined;
      const vector = Array.isArray(first?.embedding) ? first.embedding.map(Number) : [];
      if (vector.length !== EMBEDDING_DIMENSIONS || vector.some((value) => !Number.isFinite(value))) throw new EmbeddingProviderError('invalid_response');
      const usage = payload.usage && typeof payload.usage === 'object' ? payload.usage as Record<string, unknown> : {};
      return { vector, model, inputTokens: Number(usage.prompt_tokens || 0), latencyMs: Math.round(performance.now() - started) };
    },
  };
}

export function aiHubMixEmbeddingConfig(env: Cloudflare.Env) {
  return {
    enabled: env.AI_MODEL_ENABLED === 'true',
    apiKey: env.AIHUBMIX_API_KEY,
    baseUrl: env.AIHUBMIX_BASE_URL,
    model: env.AIHUBMIX_EMBEDDING_MODEL,
    timeoutMs: 1500,
  };
}

export async function contentChecksum(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
