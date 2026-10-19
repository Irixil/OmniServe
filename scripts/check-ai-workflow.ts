import assert from 'node:assert/strict';
import { analyzeConversation, createEmployeeReply, type TranscriptMessage } from '../lib/conversation-assist.ts';
import { handoffCopy, noEvidenceCopy, runModelControlledAgent } from '../lib/controlled-agent.ts';
import { createAIHubMixEmbedding, EMBEDDING_DIMENSIONS } from '../lib/embedding-provider.ts';
import { semanticGate, type SemanticSnapshot } from '../lib/model-contracts.ts';
import { controlledAgentTimeoutMs, publicConversationProcessingLeaseMs, routeModelComplexity } from '../lib/model-routing.ts';
import { aiHubMixConfig, aiHubMixVisionConfig, createAIHubMixModel, createDeepSeekModel, createRuntimeModel, createRuntimeVisionModel, deepSeekConfig, deepSeekVisionConfig, ModelProviderError, type AgentModel, type StructuredModel, type StructuredModelRequest } from '../lib/model-provider.ts';
import { parseInquiry } from '../lib/public-domain.ts';
import { searchPublicKnowledge } from '../lib/public-knowledge-search.ts';
import { analyzeImage, visionContext, visionGate } from '../lib/vision-analysis.ts';

const baseSnapshot = {
  language: 'en', intent: 'service_question', intent_confidence: 0.92,
  confirmed_facts: ['The project is in Dubai'], missing_facts: ['Required viewpoints'], entities: { location: 'Dubai' },
  pronoun_references: [], ambiguities: [], conflicts: [], tone: 'neutral', risks: [],
  human_requested: false, case_requested: false, summary_en: 'Dubai project enquiry', summary_zh: '迪拜项目咨询',
};

const runtimeConfig = aiHubMixConfig({ AI_MODEL_ENABLED: 'false' } as Cloudflare.Env);
assert.equal(runtimeConfig.model, undefined);
assert.equal(runtimeConfig.timeoutMs, 20_000);
const visionRuntimeConfig = aiHubMixVisionConfig({ AI_MODEL_ENABLED: 'true', AI_VISION_ENABLED: 'false' } as Cloudflare.Env);
assert.equal(visionRuntimeConfig.enabled, false);
assert.equal(visionRuntimeConfig.model, 'Qwen/Qwen2.5-VL-32B-Instruct');
const mutableProcessEnv = process.env as Record<string, string | undefined>;
const previousNodeEnv = mutableProcessEnv.NODE_ENV;
mutableProcessEnv.NODE_ENV = 'development';
try {
  const localRuntimeModel = createRuntimeModel({
    LOCAL_CODEX_ENABLED: 'true', AI_MODEL_ENABLED: 'true', LOCAL_CODEX_TOKEN: 'test-only',
  } as Cloudflare.Env);
  assert.equal(localRuntimeModel.provider, 'codex-local', 'Runtime provider metadata must identify the selected local Codex adapter');
  assert.equal(createDeepSeekModel({ enabled: true, apiKey: 'test-only' }).provider, 'deepseek', 'Vision/DeepSeek adapter metadata stays distinct');
  const localVision = createRuntimeVisionModel({
    LOCAL_CODEX_ENABLED: 'true', AI_MODEL_ENABLED: 'true', AI_VISION_ENABLED: 'true', LOCAL_CODEX_TOKEN: 'test-only',
  } as Cloudflare.Env);
  assert.equal(localVision.provider, 'codex-local', 'Local Vision uses the subscription bridge only when explicitly enabled');
  assert.equal(localVision.model, 'gpt-5.6-luna');
  const localVisionDisabled = createRuntimeVisionModel({
    LOCAL_CODEX_ENABLED: 'true', AI_MODEL_ENABLED: 'true', AI_VISION_ENABLED: 'false', LOCAL_CODEX_TOKEN: 'test-only',
  } as Cloudflare.Env);
  assert.equal(localVisionDisabled.provider, 'codex-local');
  await assert.rejects(() => localVisionDisabled.generate({
    instructions: 'Analyze.', input: [{ role: 'user', content: 'test' }], schemaName: 'vision', schema: { type: 'object' },
  }), (error: unknown) => error instanceof ModelProviderError && error.code === 'disabled', 'Local Vision respects AI_VISION_ENABLED');
  const hostedVision = createRuntimeVisionModel({ AI_MODEL_ENABLED: 'true', AI_VISION_ENABLED: 'true', DEEPSEEK_API_KEY: 'test-only' } as Cloudflare.Env);
  assert.equal(hostedVision.provider, 'deepseek', 'Hosted deployments keep their existing DeepSeek Vision provider');
  assert.equal(hostedVision.model, 'deepseek-v4-flash-vision-exp');
} finally {
  if (previousNodeEnv === undefined) delete mutableProcessEnv.NODE_ENV;
  else mutableProcessEnv.NODE_ENV = previousNodeEnv;
}
const defaultModelRequest: Record<string, unknown>[] = [];
const defaultProvider = createAIHubMixModel({ ...runtimeConfig, enabled: true, apiKey: 'test-only' }, async (_input, init) => {
  defaultModelRequest.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
  return Response.json({ choices: [{ message: { role: 'assistant', content: JSON.stringify(baseSnapshot) } }] });
});
await defaultProvider.generate({ instructions: 'Analyze.', input: [{ role: 'user', content: 'Test' }], schemaName: 'test', schema: { type: 'object' } });
assert.equal(defaultModelRequest[0]?.model, 'deepseek-v3.2');

const fakeModel: StructuredModel = {
  model: 'test-model',
  async generate<T>({ schemaName }: StructuredModelRequest) {
    const value = schemaName === 'semantic_snapshot' ? baseSnapshot : {
      english: 'Thank you. Could you confirm the required viewpoints?',
      chinese_meaning: '感谢。请确认需要哪些视角。', meaning_changes: [], ambiguities: [], risk_sentences: [],
    };
    return { value: value as T, provider: 'aihubmix', model: 'test-model', usage: { inputTokens: 10, outputTokens: 5 }, latencyMs: 1 };
  },
};

const messages: TranscriptMessage[] = [
  { id: 'm1', sender: 'customer', content: 'We have a project in Dubai.', createdAt: '2026-09-02T00:00:00.000Z' },
  { id: 'm2', sender: 'customer', content: 'How much will it cost?', createdAt: '2026-09-02T00:01:00.000Z' },
];
const analyzed = await analyzeConversation(messages, fakeModel);
assert.equal(analyzed.value.risks.includes('pricing'), true, 'Server risk rules must override an omitted model risk');
assert.equal(semanticGate(analyzed.value), 'handoff');

const ambiguous: SemanticSnapshot = { ...analyzed.value, risks: [], intentConfidence: 0.8 };
assert.equal(semanticGate(ambiguous), 'clarify');
const safe: SemanticSnapshot = { ...ambiguous, intentConfidence: 0.9 };
assert.equal(semanticGate(safe), 'agent');
assert.match(noEvidenceCopy('en'), /enough confirmed information.*project specialist/i);
assert.match(handoffCopy('en', 'human'), /saved your enquiry.*project specialist/i);
assert.doesNotMatch(`${noEvidenceCopy('en')} ${handoffCopy('en', 'risk')}`, /approved information|team queue|brief|tool/i);
assert.equal(routeModelComplexity(safe).mode, 'simple');
assert.equal(controlledAgentTimeoutMs('codex-local'), 280_000, 'Local Codex must have a bounded budget for three 90-second turns plus overhead');
assert.equal(controlledAgentTimeoutMs('deepseek'), 7_500, 'Hosted provider timeout behavior must remain unchanged');
assert.ok(publicConversationProcessingLeaseMs >= 100_000 * 2 + controlledAgentTimeoutMs('codex-local') + 60_000, 'Conversation lease must cover sequential local vision, semantic, and agent budgets plus margin');
assert.equal(routeModelComplexity({ ...safe, risks: ['contract'] }).mode, 'complex');
assert.equal(routeModelComplexity({ ...safe, conflicts: ['The requested viewpoint conflicts with the approved brief.'] }).mode, 'complex');

const draft = await createEmployeeReply({ messages, snapshot: safe, model: fakeModel });
assert.match(draft.value.english, /confirm the required viewpoints/i);
assert.match(draft.value.chineseMeaning, /确认/);

const simpleConfig = deepSeekConfig({ AI_MODEL_ENABLED: 'true', DEEPSEEK_API_KEY: 'test-only' } as Cloudflare.Env, 'simple');
assert.equal(simpleConfig.model, 'deepseek-v4-flash');
assert.equal(simpleConfig.baseUrl, 'https://api.deepseek.com');
assert.equal(simpleConfig.thinking, 'disabled');
const complexConfig = deepSeekConfig({ AI_MODEL_ENABLED: 'true', DEEPSEEK_API_KEY: 'test-only' } as Cloudflare.Env, 'complex');
assert.equal(complexConfig.thinking, 'enabled');
assert.equal(complexConfig.reasoningEffort, 'high');
const directVisionConfig = deepSeekVisionConfig({ AI_MODEL_ENABLED: 'true', AI_VISION_ENABLED: 'true', DEEPSEEK_API_KEY: 'test-only' } as Cloudflare.Env);
assert.equal(directVisionConfig.model, 'deepseek-v4-flash-vision-exp');

let deepSeekSimpleBody: Record<string, unknown> | undefined;
const deepSeekSimple = createDeepSeekModel(simpleConfig, async (input, init) => {
  assert.equal(String(input), 'https://api.deepseek.com/chat/completions');
  deepSeekSimpleBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
  return Response.json({ choices: [{ message: { role: 'assistant', content: JSON.stringify({ semantic_snapshot: baseSnapshot }) } }] });
});
const deepSeekSimpleResult = await deepSeekSimple.generate<typeof baseSnapshot>({
  instructions: 'Analyze.', input: [{ role: 'user', content: 'Test' }], schemaName: 'semantic_snapshot', schema: { type: 'object' },
});
assert.equal(deepSeekSimpleResult.provider, 'deepseek');
assert.deepEqual(deepSeekSimpleBody?.thinking, { type: 'disabled' });
assert.deepEqual(deepSeekSimpleBody?.response_format, { type: 'json_object' });
assert.equal(deepSeekSimpleBody?.reasoning_effort, undefined);
assert.match(String((deepSeekSimpleBody?.messages as Array<Record<string, unknown>>)[0]?.content), /semantic_snapshot/);

let deepSeekToolTurn = 0;
const deepSeekComplex = createDeepSeekModel(complexConfig, async (_input, init) => {
  deepSeekToolTurn += 1;
  const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
  assert.deepEqual(body.thinking, { type: 'enabled' });
  assert.equal(body.reasoning_effort, 'high');
  if (deepSeekToolTurn === 1) {
    return Response.json({ choices: [{ message: {
      role: 'assistant', content: null, reasoning_content: 'private reasoning',
      tool_calls: [{ id: 'deep-call-1', type: 'function', function: { name: 'search_approved_knowledge', arguments: '{"query":"services"}' } }],
    } }] });
  }
  const messages = body.messages as Array<Record<string, unknown>>;
  const assistantCall = messages.find((message) => message.role === 'assistant' && Array.isArray(message.tool_calls));
  assert.equal(assistantCall?.reasoning_content, 'private reasoning');
  return Response.json({ choices: [{ message: { role: 'assistant', content: '{"answer":"Please clarify.","sentence_sources":[],"stop_reason":"clarify"}' } }] });
});
const deepFirst = await deepSeekComplex.turn({
  instructions: 'Use tools.', input: [{ role: 'user', content: 'Test' }],
  tools: [{ name: 'search_approved_knowledge', description: 'Search.', parameters: { type: 'object' } }],
  finalSchemaName: 'agent_final', finalSchema: { type: 'object' },
});
assert.equal(deepFirst.reasoningContent, 'private reasoning');
const deepFinal = await deepSeekComplex.turn({
  instructions: 'Use tools.',
  input: [
    { role: 'user', content: 'Test' },
    { type: 'function_call', call_id: 'deep-call-1', name: 'search_approved_knowledge', arguments: '{"query":"services"}', reasoning_content: deepFirst.reasoningContent },
    { type: 'function_call_output', call_id: 'deep-call-1', output: '{"results":[]}' },
  ],
  tools: [{ name: 'search_approved_knowledge', description: 'Search.', parameters: { type: 'object' } }],
  finalSchemaName: 'agent_final', finalSchema: { type: 'object' },
});
assert.match(deepFinal.text, /"stop_reason":"clarify"/);

const requestBodies: Record<string, unknown>[] = [];
const provider = createAIHubMixModel({ enabled: true, apiKey: 'test-only', baseUrl: 'https://aihubmix.example/v1', model: 'glm-4.6' }, async (input, init) => {
  assert.equal(String(input), 'https://aihubmix.example/v1/chat/completions');
  requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
  return Response.json({
    choices: [{ message: { role: 'assistant', content: JSON.stringify(baseSnapshot) } }],
    usage: { prompt_tokens: 12, completion_tokens: 8 },
  });
});
const providerResult = await provider.generate<typeof baseSnapshot>({
  instructions: 'Analyze.', input: [{ role: 'user', content: 'Test' }], schemaName: 'semantic_snapshot', schema: { type: 'object' },
});
assert.equal(providerResult.usage.inputTokens, 12);
assert.equal(requestBodies[0]?.model, 'glm-4.6');
assert.equal(((requestBodies[0]?.response_format as { json_schema?: { strict?: boolean } })?.json_schema?.strict), true);

let gptRequest: Record<string, unknown> | undefined;
const gptProvider = createAIHubMixModel({ enabled: true, apiKey: 'test-only', model: 'gpt-5-mini' }, async (_input, init) => {
  gptRequest = JSON.parse(String(init?.body)) as Record<string, unknown>;
  return new Response('{"error":{"message":"test failure"}}', { status: 400 });
});
await assert.rejects(
  () => gptProvider.generate({ instructions: 'Analyze.', input: [{ role: 'user', content: 'Test' }], schemaName: 'test', schema: { type: 'object' } }),
  (error) => error instanceof ModelProviderError && error.status === 400 && error.detail?.includes('test failure') === true,
);
assert.equal(gptRequest?.max_completion_tokens, 1200);
assert.equal(gptRequest?.max_tokens, undefined);

let doubaoRequest: Record<string, unknown> | undefined;
const doubaoProvider = createAIHubMixModel({ enabled: true, apiKey: 'test-only', model: 'doubao-seed-1-6-flash' }, async (_input, init) => {
  doubaoRequest = JSON.parse(String(init?.body)) as Record<string, unknown>;
  return Response.json({ choices: [{ message: { role: 'assistant', content: JSON.stringify(baseSnapshot) } }] });
});
await doubaoProvider.generate({
  instructions: 'Analyze.', input: [{ role: 'user', content: 'Test' }], schemaName: 'test',
  schema: { type: 'object', properties: { items: { type: 'array', maxItems: 2, uniqueItems: true, items: { type: 'string', maxLength: 20 } } } },
});
assert.equal(/maxItems|uniqueItems|maxLength/.test(JSON.stringify(doubaoRequest)), false, 'Doubao requests must omit its unsupported schema keywords');

const fencedProvider = createAIHubMixModel({ enabled: true, apiKey: 'test-only', model: 'glm-4.6' }, async () => Response.json({
  choices: [{ message: { role: 'assistant', content: `\`\`\`json\n${JSON.stringify(baseSnapshot)}\n\`\`\`` } }],
}));
assert.equal((await fencedProvider.generate<typeof baseSnapshot>({
  instructions: 'Analyze.', input: [{ role: 'user', content: 'Test' }], schemaName: 'semantic_snapshot', schema: { type: 'object' },
})).value.intent, baseSnapshot.intent);

let toolTurn = 0;
const toolProvider = createAIHubMixModel({ enabled: true, apiKey: 'test-only', baseUrl: 'https://aihubmix.example/v1', model: 'glm-4.6' }, async (_input, init) => {
  toolTurn += 1;
  const body = JSON.parse(String(init?.body)) as { messages: Array<Record<string, unknown>>; tools?: unknown[] };
  if (toolTurn === 1) {
    assert.equal(body.tools?.length, 1);
    return Response.json({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'search_approved_knowledge', arguments: '{"query":"services"}' } }] } }], usage: { prompt_tokens: 4, completion_tokens: 2 } });
  }
  assert.equal(body.messages.at(-1)?.role, 'tool');
  return Response.json({ choices: [{ message: { role: 'assistant', content: '{"answer":"Done","sentence_sources":[],"stop_reason":"clarify"}' } }], usage: { prompt_tokens: 6, completion_tokens: 3 } });
});
const firstToolTurn = await toolProvider.turn({ instructions: 'Use tools.', input: [{ role: 'user', content: 'Test' }], tools: [{ name: 'search_approved_knowledge', description: 'Search.', parameters: { type: 'object' } }], finalSchemaName: 'agent_final', finalSchema: { type: 'object' } });
assert.equal(firstToolTurn.calls[0]?.name, 'search_approved_knowledge');
const finalToolTurn = await toolProvider.turn({ instructions: 'Use tools.', input: [{ role: 'user', content: 'Test' }, { type: 'function_call', call_id: 'call-1', name: 'search_approved_knowledge', arguments: '{"query":"services"}' }, { type: 'function_call_output', call_id: 'call-1', output: '{"results":[]}' }], tools: [{ name: 'search_approved_knowledge', description: 'Search.', parameters: { type: 'object' } }], finalSchemaName: 'agent_final', finalSchema: { type: 'object' } });
assert.match(finalToolTurn.text, /"stop_reason":"clarify"/);

const embeddingBodies: Record<string, unknown>[] = [];
const embeddingModel = createAIHubMixEmbedding({ enabled: true, apiKey: 'test-only', baseUrl: 'https://aihubmix.example/v1', model: 'text-embedding-3-small' }, async (input, init) => {
  assert.equal(String(input), 'https://aihubmix.example/v1/embeddings');
  embeddingBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
  return Response.json({ data: [{ embedding: Array.from({ length: EMBEDDING_DIMENSIONS }, (_, index) => index ? 0 : 1) }], usage: { prompt_tokens: 3 } });
});
assert.equal((await embeddingModel.embed('architectural visualization')).vector.length, EMBEDDING_DIMENSIONS);
assert.equal(embeddingBodies[0]?.dimensions, EMBEDDING_DIMENSIONS);

const hybrid = await searchPublicKnowledge('similar project', 'en', [{
  id: 'K1', category: 'cases', title_en: 'Comparable work', title_zh: '类似项目', content_en: 'Approved case matching.', content_zh: '案例匹配。',
  keywords: ['case'], status: 'published', embedding: [1, 0],
}], [1, 0]);
assert.equal(hybrid.strategy, 'hybrid');
assert.equal(hybrid.matches[0]?.id, 'K1');
const strongSemantic = await searchPublicKnowledge('services scope wording', 'en', [{
  id: 'K-SEMANTIC', category: 'services', title_en: 'Service wording', title_zh: '服务措辞', content_en: 'Scope information.', content_zh: '范围信息。',
  keywords: ['wording'], status: 'published', embedding: [1, 0],
}, {
  id: 'K-LEXICAL', category: 'other', title_en: 'Services scope', title_zh: '其他', content_en: 'Unrelated wording repeated services scope.', content_zh: '其他。',
  keywords: ['services', 'scope'], status: 'published', embedding: [0, 1],
}], [1, 0]);
assert.equal(strongSemantic.matches.some((item) => item.id === 'K-SEMANTIC'), true, 'A strong semantic match must not be pushed below threshold by a weak lexical score');

let agentTurn = 0;
const agentModel: AgentModel = {
  ...fakeModel,
  async turn() {
    agentTurn += 1;
    return agentTurn === 1
      ? { text: '', calls: [{ callId: 'call-1', name: 'search_approved_knowledge', arguments: '{"query":"services"}' }], provider: 'aihubmix', model: 'test-model', usage: { inputTokens: 5, outputTokens: 2 }, latencyMs: 1 }
      : { text: JSON.stringify({
        answer: 'We provide approved visualization services.',
        sentence_sources: [{ sentence: 'We provide approved visualization services.', source_ids: ['K-SERVICE'], case_ids: [] }],
        stop_reason: 'answer',
      }), calls: [], provider: 'aihubmix', model: 'test-model', usage: { inputTokens: 8, outputTokens: 4 }, latencyMs: 1 };
  },
};
const agent = await runModelControlledAgent({
  text: 'What services do you provide?', locale: 'en', previousInquiry: parseInquiry('').inquiry, semantic: safe,
  model: agentModel, maxModelTurns: 3,
  searchKnowledge: async () => ({ strategy: 'hybrid', matches: [{
    id: 'K-SERVICE', category: 'services', title_en: 'Service scope', title_zh: '服务范围', content_en: 'Approved visualization services.',
    content_zh: '已批准服务。', keywords: ['services'], score: 0.9, retrievalBand: 'answer',
  }] }),
  searchCases: async () => [],
});
assert.equal(agent.mode, 'grounded');
assert.equal(agent.citations[0]?.document_id, 'K-SERVICE');
assert.deepEqual(agent.agentTrace.map((item) => item.tool), ['search_approved_knowledge']);
assert.equal(agent.modelRuns.length, 2);
const inventedSourceModel: AgentModel = {
  ...fakeModel,
  async turn() {
    return {
      text: JSON.stringify({
        answer: 'We guarantee delivery tomorrow.',
        sentence_sources: [{ sentence: 'We guarantee delivery tomorrow.', source_ids: ['NOT-RETURNED'], case_ids: [] }],
        stop_reason: 'answer',
      }),
      calls: [], provider: 'aihubmix', model: 'test-model', usage: { inputTokens: 2, outputTokens: 2 }, latencyMs: 1,
    };
  },
};
const blockedOutput = await runModelControlledAgent({
  text: 'What services do you provide?', locale: 'en', previousInquiry: parseInquiry('').inquiry, semantic: safe,
  model: inventedSourceModel, maxModelTurns: 1,
  searchKnowledge: async () => ({ strategy: 'hybrid', matches: [] }), searchCases: async () => [],
});
assert.equal(blockedOutput.mode, 'handoff', 'Invented sources or commercial commitments must fail the output gate');
const scheduleCommitmentModel: AgentModel = {
  ...fakeModel,
  async turn() {
    return {
      text: JSON.stringify({
        answer: 'We will deliver the final images on Friday.',
        sentence_sources: [{ sentence: 'We will deliver the final images on Friday.', source_ids: ['K-SERVICE'], case_ids: [] }],
        stop_reason: 'answer',
      }),
      calls: [], provider: 'aihubmix', model: 'test-model', usage: { inputTokens: 2, outputTokens: 2 }, latencyMs: 1,
    };
  },
};
assert.equal((await runModelControlledAgent({
  text: 'What services do you provide?', locale: 'en', previousInquiry: parseInquiry('').inquiry, semantic: safe,
  model: scheduleCommitmentModel, maxModelTurns: 1,
  searchKnowledge: async () => ({ strategy: 'hybrid', matches: [{
    id: 'K-SERVICE', category: 'services', title_en: 'Service scope', title_zh: '服务范围', content_en: 'Approved services.',
    content_zh: '已批准服务。', keywords: ['services'], score: 0.9, retrievalBand: 'answer',
  }] }), searchCases: async () => [],
})).mode, 'handoff', 'A sourced sentence still cannot make a delivery commitment');
const turnsBeforeRisk = agentTurn;
const blockedBeforeLoop = await runModelControlledAgent({
  text: 'How much will it cost?', locale: 'en', previousInquiry: parseInquiry('').inquiry, semantic: analyzed.value,
  model: agentModel, searchKnowledge: async () => ({ strategy: 'hybrid', matches: [] }), searchCases: async () => [],
});
assert.equal(blockedBeforeLoop.mode, 'handoff');
assert.equal(agentTurn, turnsBeforeRisk, 'A risky semantic snapshot must never enter the Agent model loop');

const rawVision = {
  image_type: 'reference', building_type: 'hospitality', setting: 'outdoor', viewpoints: ['aerial'], shot_scales: ['wide'],
  atmosphere: ['golden hour'], styles: ['contemporary'], weather: ['clear'], lighting: ['warm sunlight'], materials: ['stone'],
  visible_text: [], customer_marks: [], quality_concerns: [], observations: ['A resort beside the coast.'], uncertain_inferences: [],
  field_confidence: { building_type: 0.94, viewpoint: 0.92, shot_scale: 0.9, atmosphere: 0.91, style: 0.86, visible_text: 0.97, customer_marks: 0.95 },
  confidence: 0.91, requires_human_review: false, review_reasons: [], suggested_questions: [],
};
let visionRequest: Record<string, unknown> | undefined;
const visionProvider = createAIHubMixModel({ enabled: true, apiKey: 'test-only', model: 'Qwen/Qwen2.5-VL-32B-Instruct' }, async (_input, init) => {
  visionRequest = JSON.parse(String(init?.body)) as Record<string, unknown>;
  return Response.json({ choices: [{ message: { role: 'assistant', content: JSON.stringify(rawVision) } }] });
});
const vision = await analyzeImage({ bytes: new Uint8Array([137, 80, 78, 71]), mimeType: 'image/png', customerText: 'Use this as a reference.', model: visionProvider });
assert.equal(vision.value.imageType, 'reference');
assert.equal(visionGate(vision.value), 'semantic');
assert.equal(visionGate({ ...vision.value, fieldConfidence: { ...vision.value.fieldConfidence, style: 0.7 } }), 'clarify');
assert.match(visionContext(vision.value), /Untrusted image observation/);
const visionMessages = visionRequest?.messages as Array<{ content?: unknown }>;
assert.equal(Array.isArray(visionMessages?.at(-1)?.content), true);
assert.match(JSON.stringify(visionMessages?.at(-1)?.content), /data:image\/png;base64,/);
assert.equal(visionRequest?.tools, undefined, 'The vision model must not receive Agent tools');

let visionAttempts = 0;
const retryVisionModel: StructuredModel = {
  model: 'vision-test',
  async generate<T>() {
    visionAttempts += 1;
    if (visionAttempts === 1) throw new ModelProviderError('invalid_response');
    return { value: { ...rawVision, confidence: 0.7 } as T, provider: 'aihubmix', model: 'vision-test', usage: { inputTokens: 1, outputTokens: 1 }, latencyMs: 1 };
  },
};
const retriedVision = await analyzeImage({ bytes: new Uint8Array([1]), mimeType: 'image/webp', customerText: '', model: retryVisionModel });
assert.equal(retriedVision.retryCount, 1);
assert.equal(visionAttempts, 2);
assert.equal(visionGate(retriedVision.value), 'clarify');

const riskyVisionModel: StructuredModel = {
  model: 'vision-test',
  async generate<T>() {
    return { value: { ...rawVision, building_type: 'legally compliant hotel', observations: ['The exact price is approved.'], confidence: 0.95 } as T, provider: 'aihubmix', model: 'vision-test', usage: { inputTokens: 1, outputTokens: 1 }, latencyMs: 1 };
  },
};
const riskyVision = await analyzeImage({ bytes: new Uint8Array([1]), mimeType: 'image/jpeg', customerText: '', model: riskyVisionModel });
assert.equal(riskyVision.value.requiresHumanReview, true);
assert.equal(riskyVision.value.observations.length, 0);
assert.equal(riskyVision.value.buildingType, '');
assert.equal(visionGate(riskyVision.value), 'handoff');

const disabled = createAIHubMixModel({ enabled: false });
await assert.rejects(
  disabled.generate({ instructions: '', input: [], schemaName: 'test', schema: {} }),
  (error) => error instanceof ModelProviderError && error.code === 'disabled',
);

console.log('AI workflow checks passed');
