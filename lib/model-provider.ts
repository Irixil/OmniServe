export type ModelUsage = { inputTokens: number; outputTokens: number };
export type ModelProviderName = 'deepseek' | 'aihubmix' | 'codex-local' | 'human-review';

export type StructuredModelResult<T> = {
  value: T;
  provider: ModelProviderName;
  model: string;
  usage: ModelUsage;
  latencyMs: number;
};

export type ModelContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' | 'auto' | 'original' } };

export type StructuredModelRequest = {
  instructions: string;
  input: Array<{ role: 'user' | 'assistant'; content: string | ModelContentPart[] }>;
  schemaName: string;
  schema: Record<string, unknown>;
  maxOutputTokens?: number;
};

export type StructuredModel = {
  model: string;
  provider?: ModelProviderName;
  generate<T>(request: StructuredModelRequest): Promise<StructuredModelResult<T>>;
};

export type AgentToolDefinition = { name: string; description: string; parameters: Record<string, unknown> };
export type AgentTurnResult = {
  text: string;
  calls: Array<{ callId: string; name: string; arguments: string }>;
  provider: ModelProviderName;
  model: string;
  usage: ModelUsage;
  latencyMs: number;
  reasoningContent?: string;
};
export type AgentModel = StructuredModel & {
  turn(request: {
    instructions: string;
    input: Array<Record<string, unknown>>;
    tools: AgentToolDefinition[];
    finalSchemaName: string;
    finalSchema: Record<string, unknown>;
    maxOutputTokens?: number;
  }): Promise<AgentTurnResult>;
};

export class ModelProviderError extends Error {
  readonly code: 'disabled' | 'timeout' | 'http_error' | 'invalid_response' | 'network_error';
  readonly status?: number;
  readonly detail?: string;

  constructor(code: ModelProviderError['code'], options: { status?: number; detail?: string } = {}) {
    super(`Model provider failed: ${code}`);
    this.code = code;
    this.status = options.status;
    this.detail = options.detail;
  }
}

export type DeepSeekThinking = 'enabled' | 'disabled';
export type DeepSeekConfig = {
  enabled: boolean;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  thinking?: DeepSeekThinking;
  reasoningEffort?: 'low' | 'high' | 'max';
  timeoutMs?: number;
};

type CompatibleConfig = DeepSeekConfig & { provider: ModelProviderName; structuredMode: 'json_object' | 'json_schema' };

function firstMessage(payload: Record<string, unknown>) {
  const choice = Array.isArray(payload.choices) ? payload.choices[0] : undefined;
  return choice && typeof choice === 'object' && (choice as { message?: unknown }).message && typeof (choice as { message?: unknown }).message === 'object'
    ? (choice as { message: Record<string, unknown> }).message
    : undefined;
}

function messageText(message?: Record<string, unknown>) {
  if (typeof message?.content === 'string') return message.content;
  return Array.isArray(message?.content)
    ? message.content.flatMap((part) => part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string' ? [(part as { text: string }).text] : []).join('')
    : '';
}

function parseJsonText<T>(text: string): T {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1)) as T;
    throw new ModelProviderError('invalid_response', { detail: 'json_parse' });
  }
}

function safeImagePart(value: Record<string, unknown>): ModelContentPart | undefined {
  if (value.type === 'text' && typeof value.text === 'string') return { type: 'text', text: value.text };
  const image = value.image_url && typeof value.image_url === 'object' ? value.image_url as Record<string, unknown> : undefined;
  if (value.type !== 'image_url' || typeof image?.url !== 'string' || !/^data:image\/(?:jpeg|png|webp);base64,/i.test(image.url)) return undefined;
  const detail = ['low', 'high', 'auto', 'original'].includes(String(image.detail))
    ? image.detail as 'low' | 'high' | 'auto' | 'original'
    : 'auto';
  return { type: 'image_url', image_url: { url: image.url, detail } };
}

function chatInput(instructions: string, input: Array<Record<string, unknown>>) {
  const messages: Array<Record<string, unknown>> = [{ role: 'system', content: instructions }];
  for (const row of input) {
    if ((row.role === 'user' || row.role === 'assistant') && (typeof row.content === 'string' || Array.isArray(row.content))) {
      const content = Array.isArray(row.content)
        ? row.content.flatMap((part) => part && typeof part === 'object' ? [safeImagePart(part as Record<string, unknown>)].filter(Boolean) as ModelContentPart[] : [])
        : row.content;
      if (typeof content === 'string' || content.length) messages.push({ role: row.role, content });
    } else if (row.type === 'function_call') {
      messages.push({
        role: 'assistant', content: null,
        ...(typeof row.reasoning_content === 'string' ? { reasoning_content: row.reasoning_content } : {}),
        tool_calls: [{ id: row.call_id, type: 'function', function: { name: row.name, arguments: row.arguments } }],
      });
    } else if (row.type === 'function_call_output') {
      messages.push({ role: 'tool', tool_call_id: row.call_id, content: row.output });
    }
  }
  return messages;
}

function compatibleSchema(model: string, schema: Record<string, unknown>) {
  if (!model.startsWith('doubao-')) return schema;
  return JSON.parse(JSON.stringify(schema, (key, value) => key === 'maxItems' || key === 'uniqueItems' || key === 'maxLength' ? undefined : value)) as Record<string, unknown>;
}

function schemaInstructions(instructions: string, schemaName: string, schema: Record<string, unknown>) {
  return `${instructions}\nReturn exactly one valid JSON object for the ${schemaName} contract. The root object itself must match the schema; never wrap it inside a ${schemaName} property. Schema: ${JSON.stringify(schema)}`;
}

function unwrapNamedObject<T>(value: T, schemaName: string): T {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const row = value as Record<string, unknown>;
  return Object.keys(row).length === 1 && row[schemaName] && typeof row[schemaName] === 'object' && !Array.isArray(row[schemaName])
    ? row[schemaName] as T
    : value;
}

function createCompatibleModel(config: CompatibleConfig, request = fetch): AgentModel {
  const model = config.model || (config.provider === 'deepseek' ? 'deepseek-v4-flash' : 'deepseek-v3.2');
  const thinking = config.thinking ?? 'disabled';
  const thinkingBody = config.provider === 'deepseek'
    ? { thinking: { type: thinking }, ...(thinking === 'enabled' ? { reasoning_effort: config.reasoningEffort ?? 'high' } : {}) }
    : {};

  async function call(body: Record<string, unknown>) {
    if (!config.enabled || !config.apiKey) throw new ModelProviderError('disabled');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 20_000);
    const started = performance.now();
    let response: Response;
    try {
      const fallbackBase = config.provider === 'deepseek' ? 'https://api.deepseek.com' : 'https://aihubmix.com/v1';
      const base = (config.baseUrl || fallbackBase).replace(/\/$/, '');
      response = await request(`${base}/chat/completions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model, ...thinkingBody, ...body }),
        signal: controller.signal,
      });
    } catch (error) {
      throw new ModelProviderError(error instanceof DOMException && error.name === 'AbortError' ? 'timeout' : 'network_error');
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) {
      const detail = (await response.text())
        .replace(/(?:sk-|Bearer\s+)[A-Za-z0-9._-]+/gi, '[redacted]')
        .replace(/\s+/g, ' ').slice(0, 300);
      throw new ModelProviderError('http_error', { status: response.status, detail });
    }
    let payload: Record<string, unknown>;
    try {
      payload = await response.json() as Record<string, unknown>;
    } catch {
      throw new ModelProviderError('invalid_response', { detail: 'response_json' });
    }
    const usage = payload.usage && typeof payload.usage === 'object' ? payload.usage as Record<string, unknown> : {};
    return {
      payload,
      usage: { inputTokens: Number(usage.prompt_tokens || 0), outputTokens: Number(usage.completion_tokens || 0) },
      latencyMs: Math.round(performance.now() - started),
    };
  }

  function responseFormat(schemaName: string, schema: Record<string, unknown>) {
    return config.structuredMode === 'json_object'
      ? { type: 'json_object' }
      : { type: 'json_schema', json_schema: { name: schemaName, strict: true, schema: compatibleSchema(model, schema) } };
  }

  return {
    model, provider: config.provider,
    async generate<T>({ instructions, input, schemaName, schema, maxOutputTokens = 1200 }: StructuredModelRequest) {
      const effectiveInstructions = config.structuredMode === 'json_object'
        ? schemaInstructions(instructions, schemaName, schema)
        : instructions;
      const result = await call({
        messages: chatInput(effectiveInstructions, input),
        ...(config.provider === 'aihubmix' && model.startsWith('gpt-5')
          ? { max_completion_tokens: maxOutputTokens }
          : { max_tokens: maxOutputTokens }),
        response_format: responseFormat(schemaName, schema),
      });
      const text = messageText(firstMessage(result.payload));
      if (!text) throw new ModelProviderError('invalid_response', { detail: 'empty_content' });
      let value: T;
      try {
        value = unwrapNamedObject(parseJsonText<T>(text), schemaName);
      } catch {
        throw new ModelProviderError('invalid_response', { detail: 'json_parse' });
      }
      return { value, provider: config.provider, model, usage: result.usage, latencyMs: result.latencyMs };
    },
    async turn({ instructions, input, tools, finalSchemaName, finalSchema, maxOutputTokens = 1200 }) {
      const effectiveInstructions = config.structuredMode === 'json_object'
        ? schemaInstructions(instructions, finalSchemaName, finalSchema)
        : instructions;
      const result = await call({
        messages: chatInput(effectiveInstructions, input),
        tools: tools.map((tool) => ({ type: 'function', function: tool })),
        tool_choice: 'auto',
        max_tokens: maxOutputTokens,
        response_format: responseFormat(finalSchemaName, finalSchema),
      });
      const message = firstMessage(result.payload);
      const calls = (Array.isArray(message?.tool_calls) ? message.tool_calls : []).flatMap((item) => {
        if (!item || typeof item !== 'object') return [];
        const row = item as Record<string, unknown>;
        const fn = row.function && typeof row.function === 'object' ? row.function as Record<string, unknown> : {};
        return typeof row.id === 'string' && typeof fn.name === 'string'
          ? [{ callId: row.id, name: fn.name, arguments: String(fn.arguments ?? '{}') }]
          : [];
      });
      return {
        text: messageText(message), calls, provider: config.provider, model, usage: result.usage, latencyMs: result.latencyMs,
        ...(typeof message?.reasoning_content === 'string' ? { reasoningContent: message.reasoning_content } : {}),
      };
    },
  };
}

export function createDeepSeekModel(config: DeepSeekConfig, request = fetch) {
  return createCompatibleModel({ ...config, provider: 'deepseek', structuredMode: 'json_object' }, request);
}

// Subscription access stays inside the official CLI on this computer; never deploy this bridge.
export function createRuntimeModel(env: Cloudflare.Env, mode: 'simple' | 'complex' = 'simple') {
  if (env.LOCAL_CODEX_ENABLED !== 'true') return createDeepSeekModel(deepSeekConfig(env, mode));
  const url = new URL(env.LOCAL_CODEX_BASE_URL || 'http://127.0.0.1:4011/v1');
  if (process.env.NODE_ENV !== 'development' || url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new ModelProviderError('disabled');
  }
  return createCompatibleModel({
    provider: 'codex-local', structuredMode: 'json_schema', enabled: env.AI_MODEL_ENABLED === 'true',
    apiKey: env.LOCAL_CODEX_TOKEN, baseUrl: url.href, model: 'gpt-5.6-luna', timeoutMs: 100_000,
  });
}

export function createRuntimeVisionModel(env: Cloudflare.Env) {
  if (env.LOCAL_CODEX_ENABLED !== 'true') return createDeepSeekModel(deepSeekVisionConfig(env));
  const url = new URL(env.LOCAL_CODEX_BASE_URL || 'http://127.0.0.1:4011/v1');
  if (process.env.NODE_ENV !== 'development' || url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new ModelProviderError('disabled');
  }
  return createCompatibleModel({
    provider: 'codex-local', structuredMode: 'json_schema', enabled: env.AI_MODEL_ENABLED === 'true' && env.AI_VISION_ENABLED === 'true',
    apiKey: env.LOCAL_CODEX_TOKEN, baseUrl: url.href, model: 'gpt-5.6-luna', timeoutMs: 100_000,
  });
}

export function deepSeekConfig(env: Cloudflare.Env, mode: 'simple' | 'complex' = 'simple'): DeepSeekConfig {
  return {
    enabled: env.AI_MODEL_ENABLED === 'true',
    apiKey: env.DEEPSEEK_API_KEY,
    baseUrl: env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    model: env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
    thinking: mode === 'complex' ? 'enabled' : 'disabled',
    reasoningEffort: mode === 'complex' ? 'high' : undefined,
    timeoutMs: 20_000,
  };
}

export function deepSeekVisionConfig(env: Cloudflare.Env): DeepSeekConfig {
  return {
    enabled: env.AI_MODEL_ENABLED === 'true' && env.AI_VISION_ENABLED === 'true',
    apiKey: env.DEEPSEEK_API_KEY,
    baseUrl: env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    model: env.DEEPSEEK_VISION_MODEL || 'deepseek-v4-flash-vision-exp',
    thinking: 'disabled',
    timeoutMs: 20_000,
  };
}

// Historical evaluation scripts still import this adapter. Production routes use createDeepSeekModel only.
export function createAIHubMixModel(config: DeepSeekConfig, request = fetch) {
  return createCompatibleModel({ ...config, provider: 'aihubmix', structuredMode: 'json_schema' }, request);
}

export function aiHubMixConfig(env: Cloudflare.Env) {
  return {
    enabled: env.AI_MODEL_ENABLED === 'true', apiKey: env.AIHUBMIX_API_KEY, baseUrl: env.AIHUBMIX_BASE_URL,
    model: env.AIHUBMIX_MODEL, timeoutMs: 20_000,
  };
}

export function aiHubMixVisionConfig(env: Cloudflare.Env) {
  return {
    enabled: env.AI_MODEL_ENABLED === 'true' && env.AI_VISION_ENABLED === 'true', apiKey: env.AIHUBMIX_API_KEY,
    baseUrl: env.AIHUBMIX_BASE_URL, model: env.AIHUBMIX_VISION_MODEL || 'Qwen/Qwen2.5-VL-32B-Instruct', timeoutMs: 20_000,
  };
}
