import type { SemanticSnapshot } from './model-contracts.ts';
import type { ModelProviderName } from './model-provider.ts';

export type ModelComplexity = 'simple' | 'complex';

// Covers local vision (100s), semantic analysis (100s), a three-turn agent (280s), and 60s margin.
export const publicConversationProcessingLeaseMs = 540_000;

export function controlledAgentTimeoutMs(provider: ModelProviderName) {
  return provider === 'codex-local' ? 280_000 : 7_500;
}

export function routeModelComplexity(snapshot: SemanticSnapshot): { mode: ModelComplexity; reasons: string[] } {
  const reasons = [
    ...(snapshot.risks.length ? [`risk:${snapshot.risks.join(',')}`] : []),
    ...(snapshot.conflicts.length ? ['context_conflict'] : []),
    ...(snapshot.ambiguities.length ? ['blocking_ambiguity'] : []),
    ...(snapshot.intent === 'commercial_question' ? ['commercial_question'] : []),
    ...(snapshot.intent === 'unknown' ? ['unknown_intent'] : []),
    ...(snapshot.tone === 'urgent' || snapshot.tone === 'frustrated' ? [`tone:${snapshot.tone}`] : []),
    ...(snapshot.caseRequested && snapshot.confirmedFacts.length >= 3 ? ['multi_step_case_search'] : []),
    ...(snapshot.intent === 'brief_update' && snapshot.confirmedFacts.length >= 4 ? ['multi_fact_brief'] : []),
  ];
  return { mode: reasons.length ? 'complex' : 'simple', reasons };
}
