import { create, insertMultiple, search } from '@orama/orama';
import { rankKnowledge, type Locale } from './public-domain.ts';

export type PublicKnowledgeRecord = {
  id: string;
  category: string;
  title_en: string;
  title_zh: string;
  content_en: string;
  content_zh: string;
  keywords: string[];
  status?: string;
  checksum?: string;
  expires_at?: string;
  embedding?: number[];
  updated_at?: string;
};

export type KnowledgeSearchResult<T extends PublicKnowledgeRecord> = {
  matches: Array<T & { score: number; retrievalBand?: 'answer' | 'assist' }>;
  strategy: 'hybrid' | 'orama-bm25' | 'han-ngram' | 'safe-fallback';
};

const GENERIC_ENGLISH_TERMS = new Set([
  'about', 'and', 'are', 'architectural', 'assistant', 'can', 'do', 'does', 'explain', 'for', 'help', 'how', 'is', 'of',
  'our', 'please', 'project', 'projects', 'tell', 'the', 'this', 'to', 'visualization', 'we', 'what', 'when', 'where',
  'which', 'who', 'why', 'with', 'you', 'your',
]);

function englishTerms(value: string) {
  return [...new Set((value.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter((term) => term.length > 2 && !GENERIC_ENGLISH_TERMS.has(term)))];
}

function hasEvidenceSignal(query: string, record: PublicKnowledgeRecord) {
  const queryTerms = englishTerms(query);
  const similar = (left: string, right: string) => left === right
    || (left.length > 3 && right.length > 3 && (left.startsWith(right) || right.startsWith(left)));
  const keywordTerms = englishTerms(record.keywords.join(' '));
  if (queryTerms.some((term) => keywordTerms.some((keyword) => similar(term, keyword)))) return true;
  const bodyTerms = englishTerms(`${record.title_en} ${record.content_en}`);
  return queryTerms.filter((term) => bodyTerms.some((bodyTerm) => similar(term, bodyTerm))).length >= 2;
}

export async function searchPublicKnowledge<T extends PublicKnowledgeRecord>(
  query: string,
  locale: Locale,
  records: T[],
  queryEmbedding?: number[],
): Promise<KnowledgeSearchResult<T>> {
  const now = new Date().toISOString();
  const approved = records.filter((record) => (!record.status || record.status === 'published') && (!record.expires_at || record.expires_at > now)).slice(0, 200);
  if (!query.trim() || !approved.length) return { matches: [], strategy: locale === 'zh' ? 'han-ngram' : 'orama-bm25' };

  const cosine = (left: number[], right: number[]) => {
    if (!left.length || left.length !== right.length) return -1;
    let dot = 0; let leftLength = 0; let rightLength = 0;
    for (let index = 0; index < left.length; index += 1) {
      dot += left[index] * right[index]; leftLength += left[index] ** 2; rightLength += right[index] ** 2;
    }
    return leftLength && rightLength ? dot / Math.sqrt(leftLength * rightLength) : -1;
  };

  if (queryEmbedding?.length && approved.some((record) => record.embedding?.length === queryEmbedding.length)) {
    const lexical = locale === 'zh' ? rankKnowledge(query, approved) : await (async () => {
      const index = create({ schema: { id: 'string', title: 'string', content: 'string', keywords: 'string' } });
      await insertMultiple(index, approved.map((record) => ({ id: record.id, title: record.title_en, content: record.content_en, keywords: record.keywords.join(' ') })));
      const result = await search(index, { term: query, properties: ['title', 'content', 'keywords'], boost: { title: 2.4, keywords: 2 }, limit: 20, tolerance: 1 });
      const byId = new Map(approved.map((record) => [record.id, record]));
      return result.hits.flatMap((hit) => byId.has(String(hit.document.id)) ? [{ ...byId.get(String(hit.document.id))!, score: hit.score }] : []);
    })();
    const lexicalScores = new Map(lexical.map((record) => [record.id, record.score]));
    const maxLexical = Math.max(0, ...lexicalScores.values());
    const matches = approved.flatMap((record) => {
      if (record.embedding?.length !== queryEmbedding.length) return [];
      const semantic = Math.max(0, cosine(queryEmbedding, record.embedding));
      const keyword = maxLexical ? (lexicalScores.get(record.id) ?? 0) / maxLexical : 0;
      const weighted = (keyword * 0.55) + (semantic * 0.45);
      const score = Math.max(semantic, weighted);
      return score >= 0.68 ? [{ ...record, score, retrievalBand: score >= 0.78 ? 'answer' as const : 'assist' as const }] : [];
    }).sort((left, right) => right.score - left.score).slice(0, 5);
    return { matches, strategy: 'hybrid' };
  }

  if (locale === 'zh') return { matches: rankKnowledge(query, approved), strategy: 'han-ngram' };

  try {
    const index = create({ schema: { id: 'string', title: 'string', content: 'string', keywords: 'string' } });
    await insertMultiple(index, approved.map((record) => ({
      id: record.id,
      title: record.title_en,
      content: record.content_en,
      keywords: record.keywords.join(' '),
    })));
    const result = await search(index, {
      term: query,
      properties: ['title', 'content', 'keywords'],
      boost: { title: 2.4, keywords: 2 },
      limit: 3,
      tolerance: 1,
    });
    const byId = new Map(approved.map((record) => [record.id, record]));
    const matches = result.hits
      .filter((hit) => hit.score >= 0.05)
      .map((hit) => ({ ...byId.get(String(hit.document.id))!, score: hit.score }))
      .filter((record) => record.id && hasEvidenceSignal(query, record));
    return { matches, strategy: 'orama-bm25' };
  } catch {
    return { matches: rankKnowledge(query, approved).filter((record) => hasEvidenceSignal(query, record)), strategy: 'safe-fallback' };
  }
}
