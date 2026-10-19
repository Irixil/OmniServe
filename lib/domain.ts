export const BUILDING_TYPES = ['住宅', '商业', '办公', '文化建筑', '教育建筑', '酒店', '城市综合体', '产业园区', '公共建筑'];
export const VIEWPOINTS = ['人视', '低角度仰视', '半鸟瞰', '鸟瞰', '高空航拍', '平视立面'];
export const SHOT_SCALES = ['全景', '远景', '中景', '近景', '特写'];
export const ATMOSPHERES = ['日景', '清晨', '黄昏', '蓝调时刻', '夜景', '阴天', '雨景', '雪景', '雾景', '温暖', '冷静', '商业繁华', '通透', '柔光'];
export const PROJECT_STATUSES = ['接洽中', '需求确认', '方案进行', '客户评审', '已归档'];
export const ASSET_KINDS = ['效果图', '参考图', '平面图', '材质图', '现场照片'];
export const PROJECT_PHASES = ['概念', '方案', '深化', '交付'];

function matched(text: string, values: string[]) {
  return values.filter((value) => text.includes(value));
}

function bestMatch(text: string, values: string[]) {
  return matched(text, values).sort((a, b) => b.length - a.length)[0] ?? '';
}

export function parseRequirement(text: string) {
  const buildingType = bestMatch(text, BUILDING_TYPES);
  const viewpoint = bestMatch(text, VIEWPOINTS);
  const shotScale = bestMatch(text, SHOT_SCALES);
  const atmosphere = matched(text, ATMOSPHERES);
  const useCase = ['方案汇报', '投标', '营销', '设计确认', '内部评审'].find((value) => text.includes(value)) ?? '';
  const conflicts: string[] = [];
  if ((text.includes('日景') || text.includes('正午')) && (text.includes('夜景') || text.includes('夜间'))) conflicts.push('日景与夜景时间要求冲突');
  if (text.includes('鸟瞰') && (text.includes('地面高度') || text.includes('普通人站'))) conflicts.push('鸟瞰与地面人视高度冲突');
  if (text.includes('特写') && (text.includes('整个建筑群') || text.includes('完整场地'))) conflicts.push('特写与完整场地范围冲突');
  const missing = [
    !buildingType && 'building_type',
    !viewpoint && 'viewpoint',
    !shotScale && 'shot_scale',
    !atmosphere.length && 'atmosphere',
    !useCase && 'use_case',
  ].filter(Boolean) as string[];
  return {
    confirmed: { building_type: buildingType, viewpoint, shot_scale: shotScale, atmosphere, use_case: useCase },
    missing,
    conflicts,
    search_filters: { building_type: buildingType, viewpoint, shot_scale: shotScale, atmosphere: atmosphere[0] ?? '' },
  };
}

function grams(text: string) {
  const cleaned = text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '').slice(0, 120);
  const result = new Set<string>();
  for (let size = 2; size <= 4; size += 1) {
    for (let index = 0; index <= cleaned.length - size; index += 1) result.add(cleaned.slice(index, index + size));
  }
  return [...result];
}

export function rankDocuments<T extends { title: string; content: string }>(query: string, documents: T[]) {
  const terms = grams(query);
  return documents
    .map((document) => {
      const haystack = `${document.title}\n${document.content}`.toLowerCase();
      const score = terms.reduce((total, term) => total + (haystack.includes(term) ? term.length : 0), 0);
      const paragraphs = document.content.split(/\n+/).filter(Boolean);
      const excerpt = paragraphs.sort((a, b) => terms.filter((term) => b.includes(term)).length - terms.filter((term) => a.includes(term)).length)[0] ?? document.content;
      return { ...document, score, excerpt: excerpt.slice(0, 600) };
    })
    .filter((document) => document.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}
