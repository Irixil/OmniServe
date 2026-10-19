export const SEMANTIC_PROMPT_VERSION = 'semantic-v2';
export const REPLY_PROMPT_VERSION = 'employee-reply-v1';

export type SemanticRisk =
  | 'pricing' | 'schedule' | 'guarantee' | 'contract' | 'copyright' | 'privacy'
  | 'confidentiality' | 'complaint' | 'local_regulation' | 'prompt_injection';

export type SemanticSnapshot = {
  language: 'en' | 'other';
  intent: 'service_question' | 'case_search' | 'brief_update' | 'human_request' | 'commercial_question' | 'unknown';
  intentConfidence: number;
  confirmedFacts: string[];
  missingFacts: string[];
  entities: Record<string, string | string[]>;
  pronounReferences: Array<{ expression: string; refersTo: string; confidence: number }>;
  ambiguities: string[];
  conflicts: string[];
  tone: 'neutral' | 'positive' | 'urgent' | 'frustrated' | 'formal';
  risks: SemanticRisk[];
  humanRequested: boolean;
  caseRequested: boolean;
  summaryEn: string;
  summaryZh: string;
};

export type EmployeeReplyDraft = {
  english: string;
  chineseMeaning: string;
  meaningChanges: string[];
  ambiguities: string[];
  riskSentences: string[];
};

const stringArray = { type: 'array', items: { type: 'string' }, maxItems: 20 };

export const SEMANTIC_SCHEMA: Record<string, unknown> = {
  type: 'object', additionalProperties: false,
  required: ['language', 'intent', 'intent_confidence', 'confirmed_facts', 'missing_facts', 'entities', 'pronoun_references', 'ambiguities', 'conflicts', 'tone', 'risks', 'human_requested', 'case_requested', 'summary_en', 'summary_zh'],
  properties: {
    language: { type: 'string', enum: ['en', 'other'] },
    intent: { type: 'string', enum: ['service_question', 'case_search', 'brief_update', 'human_request', 'commercial_question', 'unknown'] },
    intent_confidence: { type: 'number', minimum: 0, maximum: 1 },
    confirmed_facts: stringArray,
    missing_facts: stringArray,
    entities: { type: 'object', additionalProperties: { oneOf: [{ type: 'string' }, stringArray] } },
    pronoun_references: {
      type: 'array', maxItems: 20,
      items: {
        type: 'object', additionalProperties: false, required: ['expression', 'refers_to', 'confidence'],
        properties: { expression: { type: 'string' }, refers_to: { type: 'string' }, confidence: { type: 'number', minimum: 0, maximum: 1 } },
      },
    },
    ambiguities: stringArray,
    conflicts: stringArray,
    tone: { type: 'string', enum: ['neutral', 'positive', 'urgent', 'frustrated', 'formal'] },
    risks: { type: 'array', uniqueItems: true, items: { type: 'string', enum: ['pricing', 'schedule', 'guarantee', 'contract', 'copyright', 'privacy', 'confidentiality', 'complaint', 'local_regulation', 'prompt_injection'] } },
    human_requested: { type: 'boolean' },
    case_requested: { type: 'boolean' },
    summary_en: { type: 'string', maxLength: 1200 },
    summary_zh: { type: 'string', maxLength: 1200 },
  },
};

export const EMPLOYEE_REPLY_SCHEMA: Record<string, unknown> = {
  type: 'object', additionalProperties: false,
  required: ['english', 'chinese_meaning', 'meaning_changes', 'ambiguities', 'risk_sentences'],
  properties: {
    english: { type: 'string', maxLength: 3000 },
    chinese_meaning: { type: 'string', maxLength: 3000 },
    meaning_changes: stringArray,
    ambiguities: stringArray,
    risk_sentences: stringArray,
  },
};

function strings(value: unknown, max = 20) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, max) : [];
}

export function parseSemanticSnapshot(value: unknown): SemanticSnapshot {
  if (!value || typeof value !== 'object') throw new Error('semantic_shape');
  const item = value as Record<string, unknown>;
  const confidence = Number(item.intent_confidence);
  const intents = new Set(['service_question', 'case_search', 'brief_update', 'human_request', 'commercial_question', 'unknown']);
  const tones = new Set(['neutral', 'positive', 'urgent', 'frustrated', 'formal']);
  const risks = new Set<SemanticRisk>(['pricing', 'schedule', 'guarantee', 'contract', 'copyright', 'privacy', 'confidentiality', 'complaint', 'local_regulation', 'prompt_injection']);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1 || !intents.has(String(item.intent)) || !tones.has(String(item.tone))) throw new Error('semantic_fields');
  const entities = item.entities && typeof item.entities === 'object' && !Array.isArray(item.entities) ? item.entities as Record<string, unknown> : {};
  const normalizedEntities: Record<string, string | string[]> = {};
  for (const [key, entry] of Object.entries(entities)) {
    if (typeof entry === 'string') normalizedEntities[key] = entry.slice(0, 500);
    else if (Array.isArray(entry)) normalizedEntities[key] = strings(entry, 20);
  }
  const pronouns = Array.isArray(item.pronoun_references) ? item.pronoun_references.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const row = entry as Record<string, unknown>;
    const pronounConfidence = Number(row.confidence);
    return typeof row.expression === 'string' && typeof row.refers_to === 'string' && Number.isFinite(pronounConfidence)
      ? [{ expression: row.expression, refersTo: row.refers_to, confidence: Math.max(0, Math.min(1, pronounConfidence)) }]
      : [];
  }).slice(0, 20) : [];
  return {
    language: item.language === 'en' ? 'en' : 'other',
    intent: String(item.intent) as SemanticSnapshot['intent'],
    intentConfidence: confidence,
    confirmedFacts: strings(item.confirmed_facts),
    missingFacts: strings(item.missing_facts),
    entities: normalizedEntities,
    pronounReferences: pronouns,
    ambiguities: strings(item.ambiguities),
    conflicts: strings(item.conflicts),
    tone: String(item.tone) as SemanticSnapshot['tone'],
    risks: strings(item.risks).filter((risk): risk is SemanticRisk => risks.has(risk as SemanticRisk)),
    humanRequested: item.human_requested === true,
    caseRequested: item.case_requested === true,
    summaryEn: String(item.summary_en ?? '').slice(0, 1200),
    summaryZh: String(item.summary_zh ?? '').slice(0, 1200),
  };
}

export function parseEmployeeReply(value: unknown): EmployeeReplyDraft {
  if (!value || typeof value !== 'object') throw new Error('reply_shape');
  const item = value as Record<string, unknown>;
  const english = String(item.english ?? '').trim().slice(0, 3000);
  const chineseMeaning = String(item.chinese_meaning ?? '').trim().slice(0, 3000);
  if (!english || !chineseMeaning) throw new Error('reply_fields');
  return {
    english,
    chineseMeaning,
    meaningChanges: strings(item.meaning_changes),
    ambiguities: strings(item.ambiguities),
    riskSentences: strings(item.risk_sentences),
  };
}

export function semanticGate(snapshot: SemanticSnapshot) {
  if (snapshot.humanRequested || snapshot.risks.length) return 'handoff' as const;
  if (snapshot.intentConfidence < 0.6) return 'handoff' as const;
  if (snapshot.intentConfidence < 0.85 || snapshot.ambiguities.length || snapshot.conflicts.length) return 'clarify' as const;
  return 'agent' as const;
}
