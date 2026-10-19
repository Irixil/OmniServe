export type Locale = 'en' | 'zh';

export type InquiryState = {
  project_type: string;
  project_location: string;
  project_stage: string;
  service_interest: string;
  deliverable_type: string;
  estimated_view_count: string;
  viewpoints: string[];
  shot_scale: string;
  atmospheres: string[];
  target_milestone: string;
};

export type PublicCase = {
  id: string;
  title_en: string;
  title_zh: string;
  building_type: string;
  viewpoint: string;
  shot_scale: string;
  atmosphere: string[];
  description_en: string;
  description_zh: string;
  image_url: string;
  alt_en: string;
  alt_zh: string;
  disclosure: 'sample';
  visibility: 'public';
  rights_status: 'approved';
  rights_expires_at: string;
};

export type PublicKnowledgeSeed = {
  id: string;
  category: string;
  title_en: string;
  title_zh: string;
  content_en: string;
  content_zh: string;
  keywords: string[];
};

const EMPTY_INQUIRY: InquiryState = {
  project_type: '', project_location: '', project_stage: '', service_interest: '', deliverable_type: '',
  estimated_view_count: '', viewpoints: [], shot_scale: '', atmospheres: [], target_milestone: '',
};

const APPROVED_SAMPLE_RIGHTS = {
  visibility: 'public', rights_status: 'approved', rights_expires_at: '',
} as const;

const fieldMaps = {
  project_type: [
    ['Mixed-use Development', ['mixed-use', 'mixed use', '综合体']],
    ['Residential', ['residential', 'housing', 'apartment', '住宅', '公寓']],
    ['Commercial', ['commercial', 'shopping mall', 'retail', '商业', '商场']],
    ['Corporate Office', ['office', 'headquarters', 'corporate campus', '办公', '总部', '办公园区']],
    ['Hospitality', ['hotel', 'hospitality', 'resort', '酒店', '度假']],
    ['Cultural Venue', ['museum', 'cultural venue', 'art gallery', 'theatre', '文化建筑', '博物馆', '剧院']],
    ['Education', ['education', 'school', 'university', '教育建筑', '学校', '大学']],
    ['Industrial Campus', ['industrial campus', 'industrial park', '产业园区']],
    ['Public Building', ['public building', 'civic building', '公共建筑']],
  ],
  project_stage: [
    ['Concept Design', ['concept', 'early design', '概念', '前期']],
    ['Schematic Design', ['schematic', '方案阶段', '方案设计']],
    ['Design Development', ['design development', 'detailed design', '深化']],
    ['Tender / Competition', ['tender', 'competition', '投标', '竞赛']],
    ['Marketing', ['marketing', 'sales launch', '营销', '销售']],
  ],
  service_interest: [
    ['Exterior Architectural Visualization', ['exterior', 'facade', 'architectural visualization', '外观', '外立面', '建筑可视化']],
    ['Interior Visualization', ['interior', '室内']],
    ['Animation', ['animation', 'film', '动画', '影片']],
  ],
  deliverable_type: [
    ['Still Images', ['still image', 'stills', 'renders', 'renderings', 'images', 'views', '效果图', '静帧', '张图']],
    ['Animation', ['animation', 'film', 'fly-through', 'walkthrough', '动画', '影片', '漫游']],
  ],
  viewpoint: [
    ['Aerial Oblique', ['semi-aerial', 'semi aerial', 'aerial oblique', '半鸟瞰']],
    ['Bird’s-eye', ["bird's-eye", 'bird’s-eye', 'birds-eye', 'bird eye', 'top view', '鸟瞰']],
    ['Eye-level', ['eye-level', 'eye level', 'street-level', 'street level', 'human view', '人视', '街道视角']],
    ['Frontal', ['frontal', 'front view', 'elevation view', '正面', '立面']],
    ['Three-quarter', ['three-quarter', 'three quarter', '三分之四', '斜向']],
    ['Low-angle', ['low-angle', 'low angle', 'worm eye', '低角度仰视', '仰视']],
    ['High Aerial', ['high aerial', 'drone view', 'high-altitude', '高空航拍', '航拍']],
  ],
  shot_scale: [
    ['Panoramic', ['panoramic', 'panorama', '全景']],
    ['Wide', ['wide shot', 'wide view', 'establishing', 'wide', '远景', '广角']],
    ['Medium', ['medium shot', 'medium view', 'medium', '中景']],
    ['Close', ['close-up', 'close up', 'detail shot', 'close', '近景', '特写']],
  ],
  atmosphere: [
    ['Blue Hour', ['blue hour', 'blue-hour', '蓝调']],
    ['Dusk', ['dusk', 'sunset', 'golden hour', '黄昏', '日落']],
    ['Night', ['night', 'nighttime', '夜景', '夜间']],
    ['Daylight', ['daylight', 'daytime', 'sunny', 'day view', '日景', '白天', '晴天']],
    ['Overcast', ['overcast', 'cloudy', '阴天']],
    ['Rain', ['rain', 'rainy', '雨景', '下雨']],
    ['Fog', ['fog', 'mist', '雾景', '薄雾']],
    ['Morning', ['morning', 'sunrise', 'dawn', '清晨', '晨景']],
    ['Snow', ['snow', 'snowy', '雪景']],
    ['Warm', ['warm', 'welcoming', '温暖']],
    ['Vibrant', ['vibrant', 'active', 'busy', '繁华', '活力', '商业繁华']],
    ['Calm', ['calm', 'serene', 'quiet', '宁静', '克制', '冷静']],
    ['Airy', ['airy', 'transparent', '通透']],
    ['Soft Light', ['soft light', 'diffused light', '柔光']],
  ],
} as const;

type AliasEntries = readonly (readonly [string, readonly string[]])[];

function aliasHits(text: string, entries: AliasEntries) {
  const hits: Array<{ value: string; alias: string; index: number }> = [];
  for (const [value, aliases] of entries) {
    for (const alias of aliases) {
      let index = text.indexOf(alias);
      while (index >= 0) {
        hits.push({ value, alias, index });
        index = text.indexOf(alias, index + Math.max(alias.length, 1));
      }
    }
  }
  hits.sort((left, right) => left.index - right.index || right.alias.length - left.alias.length);
  const specific: typeof hits = [];
  for (const hit of hits) {
    const overlapsLonger = specific.some((kept) => {
      const overlaps = hit.index < kept.index + kept.alias.length && kept.index < hit.index + hit.alias.length;
      return overlaps && kept.alias.length > hit.alias.length;
    });
    if (!overlapsLonger) specific.push(hit);
  }
  return specific;
}

function allMatches(text: string, entries: AliasEntries) {
  return [...new Set(aliasHits(text, entries).map((hit) => hit.value))];
}

function firstMatch(text: string, entries: AliasEntries) {
  return aliasHits(text, entries)[0]?.value ?? '';
}

function mergeUnique(left: string[], right: string[]) {
  return [...new Set([...left, ...right])];
}

function lastMatch(text: string, entries: AliasEntries) {
  return aliasHits(text, entries).at(-1)?.value ?? '';
}

function correctionTarget(text: string, entries: AliasEntries) {
  const segment = text.match(/\b(?:keep|use|change(?:d)? to|switch(?:ed)? to|rather(?: use)?)\s+(.{1,40}?)(?=\s+(?:instead of|not|without)\b|[,.;]|$)/)?.[1]
    ?? text.match(/(?:保留|改为|改成|换成)\s*([^，。；,.;]{1,30})/)?.[1]
    ?? '';
  return firstMatch(segment, entries);
}

function negatedValues(text: string, entries: AliasEntries) {
  return entries.filter(([, aliases]) => aliases.some((alias) => {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:\\b(?:not|without|no)\\s+(?:a\\s+)?${escaped}\\b|不(?:要|是|用|保留).{0,6}${escaped})`).test(text);
  })).map(([value]) => value);
}

function isCorrection(text: string) {
  return /\b(?:actually|instead|change(?:d)? to|switch(?:ed)? to|rather|keep|not|without)\b|改为|改成|换成|保留|不要|不是|不用/.test(text);
}

function selectScalar(previous: string | undefined, text: string, entries: AliasEntries) {
  const detected = allMatches(text, entries);
  const negated = negatedValues(text, entries);
  const positive = detected.filter((value) => !negated.includes(value));
  if (!isCorrection(text)) return positive[0] || previous || '';
  const target = correctionTarget(text, entries);
  if (target && !negated.includes(target)) return target;
  const selected = lastMatch(text, entries.filter(([value]) => positive.includes(value)));
  if (selected) return selected;
  return previous && !negated.includes(previous) ? previous : '';
}

const atmosphereGroups = [
  ['Blue Hour', 'Dusk', 'Night', 'Daylight', 'Morning'],
  ['Overcast', 'Rain', 'Fog', 'Snow'],
] as const;

function mergeAtmospheres(previous: string[], detected: string[], text: string) {
  if (!isCorrection(text)) return mergeUnique(previous, detected);
  const negated = negatedValues(text, fieldMaps.atmosphere);
  const positive = detected.filter((value) => !negated.includes(value));
  const target = correctionTarget(text, fieldMaps.atmosphere)
    || lastMatch(text, fieldMaps.atmosphere.filter(([value]) => positive.includes(value)));
  let next = [...previous];
  for (const group of atmosphereGroups) {
    if (!detected.some((value) => group.includes(value as never))) continue;
    next = next.filter((value) => !group.includes(value as never));
    if (group.includes(target as never)) next.push(target);
  }
  next = next.filter((value) => !negated.includes(value));
  const ungrouped = positive.filter((value) => !atmosphereGroups.some((group) => group.includes(value as never)));
  return mergeUnique(next, ungrouped);
}

function mergeViewpoints(previous: string[], detected: string[], text: string) {
  if (!isCorrection(text)) return mergeUnique(previous, detected);
  const negated = negatedValues(text, fieldMaps.viewpoint);
  const positive = detected.filter((value) => !negated.includes(value));
  const target = correctionTarget(text, fieldMaps.viewpoint)
    || lastMatch(text, fieldMaps.viewpoint.filter(([value]) => positive.includes(value)));
  return target ? [target] : previous.filter((value) => !negated.includes(value));
}

export function normalizePublicCaseTaxonomy(input: Pick<PublicCase, 'building_type' | 'viewpoint' | 'shot_scale' | 'atmosphere'>) {
  return {
    building_type: firstMatch(input.building_type.toLowerCase(), fieldMaps.project_type) || input.building_type,
    viewpoint: firstMatch(input.viewpoint.toLowerCase(), fieldMaps.viewpoint) || input.viewpoint,
    shot_scale: firstMatch(input.shot_scale.toLowerCase(), fieldMaps.shot_scale) || input.shot_scale,
    atmosphere: input.atmosphere.map((value) => firstMatch(value.toLowerCase(), fieldMaps.atmosphere) || value),
  };
}

export function detectLocale(text: string, preferred?: string): Locale {
  if (preferred === 'zh') return 'zh';
  if (preferred === 'en') return 'en';
  return /[\u3400-\u9fff]/.test(text) ? 'zh' : 'en';
}

export function parseInquiry(text: string, previous: Partial<InquiryState> = {}): { inquiry: InquiryState; missing: string[]; conflicts: string[] } {
  const normalized = text.toLowerCase();
  const detectedAtmospheres = allMatches(normalized, fieldMaps.atmosphere);
  const countWord = '(\\d{1,3}|\\b(?:one|two|three|four|five|six|seven|eight|nine|ten)\\b)';
  const count = normalized.match(new RegExp(`(?:needs?|requires?|about|around)\\s+${countWord}(?:\\s+[a-z-]+){0,4}\\s+(?:views?|images?|stills?)`))?.[1]
    ?? normalized.match(new RegExp(`${countWord}\\s*(?:views?|images?|stills?)`))?.[1]
    ?? normalized.match(/(\d{1,3})\s*(?:张|个视角)/)?.[1]
    ?? '';
  const estimatedViewCount = ({ one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10' } as Record<string, string>)[count] ?? count;
  const englishLocation = normalized.match(/(?:located in|project in|site in)\s+([^,.，。;；\n]+?)(?=\s+(?:(?:and\s+)?(?:needs?|requires?)|with|for|at|by)\b|[,，.。;；\n]|$)/)?.[1];
  const chineseLocation = normalized.match(/(?:项目(?:位于|在)|地点(?:是|在))\s*([^,.，。;；\n]+?)(?=需要|希望|[,，.。;；\n]|$)/)?.[1];
  const location = (englishLocation || chineseLocation || '').trim();
  const milestone = normalized.match(/(?:by|before|target(?: date)?(?: is)?|deadline(?: is)?|目标(?:时间|节点)?(?:是|在)?|希望在)\s*([^,.，。;；\n]{3,40})/)?.[1]?.trim() ?? '';
  const next: InquiryState = {
    ...EMPTY_INQUIRY,
    ...previous,
    project_type: selectScalar(previous.project_type, normalized, fieldMaps.project_type),
    project_location: location || previous.project_location || '',
    project_stage: selectScalar(previous.project_stage, normalized, fieldMaps.project_stage),
    service_interest: selectScalar(previous.service_interest, normalized, fieldMaps.service_interest),
    deliverable_type: selectScalar(previous.deliverable_type, normalized, fieldMaps.deliverable_type),
    estimated_view_count: estimatedViewCount || previous.estimated_view_count || '',
    viewpoints: mergeViewpoints(previous.viewpoints ?? [], allMatches(normalized, fieldMaps.viewpoint), normalized),
    shot_scale: selectScalar(previous.shot_scale, normalized, fieldMaps.shot_scale),
    atmospheres: mergeAtmospheres(previous.atmospheres ?? [], detectedAtmospheres, normalized),
    target_milestone: milestone || previous.target_milestone || '',
  };
  const conflicts: string[] = [];
  if (next.atmospheres.includes('Daylight') && next.atmospheres.includes('Night')) conflicts.push('daylight_night');
  if (next.shot_scale === 'Close' && /(whole site|entire development|完整场地|整个建筑群)/.test(normalized)) conflicts.push('close_full_site');
  const missing = [
    !next.project_type && 'project_type', !next.project_location && 'project_location',
    !next.service_interest && 'service_interest', !next.viewpoints.length && 'viewpoints',
    !next.target_milestone && 'target_milestone',
  ].filter(Boolean) as string[];
  return { inquiry: next, missing, conflicts };
}

export const PUBLIC_CASES: PublicCase[] = [
  {
    id: 'CASE-CFG-01', title_en: 'Residential skyline at blue hour', title_zh: '蓝调时刻的住宅天际线',
    building_type: 'Residential', viewpoint: 'Aerial Oblique', shot_scale: 'Wide', atmosphere: ['Blue Hour', 'Calm'],
    description_en: 'A broad residential composition used to discuss skyline hierarchy, tower spacing and evening light.',
    description_zh: '用于讨论天际线层次、塔楼间距和傍晚灯光的住宅广角画面。', image_url: '/cases/residential-blue-hour.jpg',
    alt_en: 'Residential towers beneath a blue-hour sky', alt_zh: '蓝调时刻天空下的住宅塔楼', disclosure: 'sample', ...APPROVED_SAMPLE_RIGHTS,
  },
  {
    id: 'CASE-CFG-02', title_en: 'Mixed-use street arrival', title_zh: '城市综合体沿街入口',
    building_type: 'Mixed-use Development', viewpoint: 'Eye-level', shot_scale: 'Wide', atmosphere: ['Daylight', 'Vibrant'],
    description_en: 'A street-level direction for discussing pedestrian arrival, active frontage and commercial visibility.',
    description_zh: '用于讨论步行到达、活跃界面和商业展示度的街道人视方向。', image_url: '/cases/mixed-use-day.jpg',
    alt_en: 'Daylit mixed-use buildings viewed from the street', alt_zh: '从街道望向日景城市综合体', disclosure: 'sample', ...APPROVED_SAMPLE_RIGHTS,
  },
  {
    id: 'CASE-CFG-03', title_en: 'Hospitality landscape panorama', title_zh: '酒店度假景观全景',
    building_type: 'Hospitality', viewpoint: 'Bird’s-eye', shot_scale: 'Panoramic', atmosphere: ['Dusk', 'Warm', 'Calm'],
    description_en: 'A panoramic hospitality direction for discussing the relationship between architecture, terrain and warm evening light.',
    description_zh: '用于讨论建筑、地形与暖色傍晚光线关系的酒店度假全景。', image_url: '/cases/hospitality-golden-hour.jpg',
    alt_en: 'Hospitality resort among hills at golden hour', alt_zh: '金色时刻群山间的度假酒店', disclosure: 'sample', ...APPROVED_SAMPLE_RIGHTS,
  },
  {
    id: 'CASE-CFG-04', title_en: 'Office campus in soft overcast light', title_zh: '柔和阴天的办公园区',
    building_type: 'Corporate Office', viewpoint: 'Three-quarter', shot_scale: 'Medium', atmosphere: ['Overcast', 'Calm'],
    description_en: 'A restrained office-campus direction focused on façade legibility, landscape layers and material tone.',
    description_zh: '侧重立面识别、景观层次和材质色调的克制办公园区方向。', image_url: '/cases/office-overcast.jpg',
    alt_en: 'Office campus seen at an angle beneath an overcast sky', alt_zh: '阴天下斜向呈现的办公园区', disclosure: 'sample', ...APPROVED_SAMPLE_RIGHTS,
  },
  {
    id: 'CASE-CFG-05', title_en: 'Cultural venue after sunset', title_zh: '日落后的文化建筑',
    building_type: 'Cultural Venue', viewpoint: 'Frontal', shot_scale: 'Wide', atmosphere: ['Dusk'],
    description_en: 'A frontal approach used to discuss civic presence, entrance hierarchy and architectural lighting.',
    description_zh: '用于讨论公共形象、入口层级与建筑照明的正面到达画面。', image_url: '/cases/cultural-dusk.jpg',
    alt_en: 'Cultural venue entrance at dusk', alt_zh: '黄昏中的文化建筑入口', disclosure: 'sample', ...APPROVED_SAMPLE_RIGHTS,
  },
  {
    id: 'CASE-CFG-06', title_en: 'Retail evening close view', title_zh: '商业街区夜间近景',
    building_type: 'Commercial', viewpoint: 'Eye-level', shot_scale: 'Close', atmosphere: ['Night', 'Vibrant', 'Warm'],
    description_en: 'A closer retail view for discussing storefront rhythm, pedestrian scale and welcoming evening light.',
    description_zh: '用于讨论店面节奏、行人尺度与温暖夜间灯光的商业近景。', image_url: '/cases/retail-evening.jpg',
    alt_en: 'Street-level retail frontage illuminated in the evening', alt_zh: '夜间灯光映照下的商业街店面', disclosure: 'sample', ...APPROVED_SAMPLE_RIGHTS,
  },
  {
    id: 'CASE-CFG-07', title_en: 'Pavilion arrival walkthrough', title_zh: '公共展亭到达漫游',
    building_type: 'Cultural Venue', viewpoint: 'Eye-level', shot_scale: 'Wide', atmosphere: ['Daylight', 'Warm', 'Calm'],
    description_en: 'A camera-led arrival study moving from a planted courtyard through a deep threshold into a public atrium.',
    description_zh: '从种植庭院穿过深檐廊进入公共中庭的镜头到达研究。', image_url: '/generated/cultural-pavilion-walkthrough.png',
    alt_en: 'Architectural walkthrough frame approaching a stone and timber cultural pavilion', alt_zh: '走向石材与木材文化展亭的建筑漫游画面', disclosure: 'sample', ...APPROVED_SAMPLE_RIGHTS,
  },
  {
    id: 'CASE-CFG-08', title_en: 'Coastal hospitality masterplan', title_zh: '滨海酒店总图鸟瞰',
    building_type: 'Hospitality', viewpoint: 'High Aerial', shot_scale: 'Panoramic', atmosphere: ['Morning', 'Warm', 'Calm'],
    description_en: 'A high aerial direction showing arrival, courtyards, terrain and the relationship between a hospitality campus and the coast.',
    description_zh: '展示到达、庭院、地形以及酒店群与海岸关系的高空鸟瞰方向。', image_url: '/generated/coastal-hospitality-aerial.png',
    alt_en: 'High aerial architectural visualization of a low-rise coastal hospitality complex', alt_zh: '低层滨海酒店群高空鸟瞰建筑可视化', disclosure: 'sample', ...APPROVED_SAMPLE_RIGHTS,
  },
  {
    id: 'CASE-CFG-09', title_en: 'Courtyard hospitality interior', title_zh: '庭院酒店室内',
    building_type: 'Hospitality', viewpoint: 'Frontal', shot_scale: 'Medium', atmosphere: ['Overcast', 'Warm', 'Calm'],
    description_en: 'An interior atmosphere study using a deep threshold, tactile materials and a planted courtyard to organize the view.',
    description_zh: '通过深门洞、触感材料和种植庭院组织画面的室内氛围研究。', image_url: '/generated/courtyard-lounge-interior.png',
    alt_en: 'Warm hospitality lounge opening through a deep threshold to a planted courtyard', alt_zh: '穿过深门洞望向种植庭院的温暖酒店休息室', disclosure: 'sample', ...APPROVED_SAMPLE_RIGHTS,
  },
  {
    id: 'CASE-CFG-10', title_en: 'Civic plaza after rain', title_zh: '雨后公共广场',
    building_type: 'Mixed-use Development', viewpoint: 'Three-quarter', shot_scale: 'Wide', atmosphere: ['Dusk', 'Rain', 'Vibrant', 'Warm'],
    description_en: 'A dusk public-realm direction focused on active ground floors, pedestrian movement and warm reflections after rain.',
    description_zh: '聚焦活力首层、行人动线与雨后暖色反射的黄昏公共空间方向。', image_url: '/generated/civic-plaza-dusk.png',
    alt_en: 'Mixed-use civic plaza with pedestrians and warm interiors after rain at dusk', alt_zh: '黄昏雨后拥有行人与温暖室内灯光的混合功能公共广场', disclosure: 'sample', ...APPROVED_SAMPLE_RIGHTS,
  },
];

export const PUBLIC_KNOWLEDGE_SEED: PublicKnowledgeSeed[] = [
  {
    id: 'PK-001', category: 'services', title_en: 'Architectural visualization services', title_zh: '建筑可视化服务',
    content_en: 'The public service catalogue covers exterior and interior architectural stills, architectural animation and walkthroughs, visual direction, and post-production. The exact deliverables, duration, formats, programme and feasibility are confirmed by a project director after review.',
    content_zh: '公开服务目录覆盖建筑外观与室内静帧、建筑动画与漫游、视觉指导以及后期制作。具体交付内容、时长、格式、计划与可行性需在审核后由项目总监确认。',
    keywords: ['service', 'provide', 'offer', 'exterior', 'interior', 'visualization', 'animation', 'walkthrough', 'film', 'art direction', 'post-production', '服务', '能做', '外观', '室内', '效果图', '动画', '漫游', '后期'],
  },
  {
    id: 'PK-002', category: 'materials', title_en: 'Project information checklist', title_zh: '项目资料清单',
    content_en: 'A useful starting enquiry includes the project type and location, current design stage, required deliverables and number of views, target milestone, and materials currently available. A project specialist can advise how to share drawings, models, site photographs and other project files.',
    content_zh: '初步咨询可以包括项目类型与地点、当前设计阶段、所需成果和视角数量、目标节点及现有资料。项目专员可以告知如何提交图纸、模型、现场照片和其他项目文件。',
    keywords: ['information', 'files', 'prepare', 'drawings', 'model', 'materials', '资料', '文件', '图纸', '模型', '准备'],
  },
  {
    id: 'PK-003', category: 'cases', title_en: 'Public visual references', title_zh: '公开视觉参考',
    content_en: 'Public visual references can be searched by building type, viewpoint, framing and atmosphere. They illustrate possible visual directions and should not be read as a promise of a similar result or proof of a completed client project. If no reference fits every detail, the assistant says so rather than showing a looser match.',
    content_zh: '公开视觉参考可以按建筑类型、视角、景别和氛围查找，用于展示可能的视觉方向，不代表已交付的客户项目，也不承诺复现相同效果。如果没有完全符合需求的参考，客服会如实说明，不会放宽条件展示其他内容。',
    keywords: ['case', 'portfolio', 'similar', 'style', 'example', '案例', '作品', '类似', '参考'],
  },
  {
    id: 'PK-004', category: 'pricing', title_en: 'Commercial terms require review', title_zh: '商务条件需要人工审核',
    content_en: 'Pricing depends on the confirmed scope, deliverables, source-material readiness, schedule and revision requirements. A project specialist must review the enquiry before any commercial terms can be provided.',
    content_zh: '价格取决于确认后的范围、交付内容、资料准备程度、目标时间和修改要求。任何商务条件都需要由项目专员评估后提供。',
    keywords: ['price', 'pricing', 'cost', 'quote', 'budget', '报价', '价格', '费用', '预算'],
  },
  {
    id: 'PK-005', category: 'schedule', title_en: 'Schedule confirmation', title_zh: '项目周期确认',
    content_en: 'Availability and delivery dates can only be confirmed after the scope, materials, review process and current capacity have been assessed. The assistant can record a target milestone but cannot confirm a delivery commitment.',
    content_zh: '档期与交付日期只能在项目范围、资料、审核流程和当前产能完成评估后确认。客服可以记录目标节点，但不能作出交付承诺。',
    keywords: ['time', 'timeline', 'schedule', 'deadline', 'delivery', '周期', '工期', '时间', '交付日期'],
  },
  {
    id: 'PK-006', category: 'references', title_en: 'Using visual references', title_zh: '视觉参考的使用边界',
    content_en: 'Reference images can communicate mood, lighting, composition, material character and level of detail. Their suitability and usage rights must be reviewed before a direction is confirmed, and an exact copy of another creator’s work cannot be promised.',
    content_zh: '参考图可以表达氛围、灯光、构图、材质特征和细节程度。团队需要审核其适用性与使用权限，也不能承诺完全复制其他创作者的作品。',
    keywords: ['reference', 'style', 'copy', 'match', '参考图', '风格', '复刻'],
  },
  {
    id: 'PK-007', category: 'revisions', title_en: 'Review and revision arrangements', title_zh: '审核与修改安排',
    content_en: 'The project plan should confirm review stages and revision arrangements. I can note your preferred review process and decision-makers, but a project specialist must confirm revision counts and whether a change is included.',
    content_zh: '项目计划中需要确认审核阶段和修改安排。我可以记录你偏好的反馈流程和决策人，但修改次数及某项变更是否包含在范围内，需要由项目专员确认。',
    keywords: ['revision', 'feedback', 'changes', 'rounds', '修改', '反馈', '返修', '次数'],
  },
  {
    id: 'PK-008', category: 'confidentiality', title_en: 'Confidential information handling', title_zh: '机密信息处理',
    content_en: 'Please wait until a project specialist confirms a secure way to share confidential files and the applicable terms. They can also discuss access controls, data handling and any NDA requirements.',
    content_zh: '请先由项目专员确认机密文件的安全提交方式和适用条款，再发送相关文件。专员也可以说明访问控制、数据处理和保密协议要求。',
    keywords: ['confidential', 'nda', 'privacy', 'secure', '秘密', '保密', '隐私', '安全'],
  },
  {
    id: 'PK-009', category: 'availability', title_en: 'Initial markets and service hours', title_zh: '首批市场与服务时间',
    content_en: 'We currently provide customer assistance in English. Project specialists are available every day from 10:00 to 22:00 Beijing time. You can leave an enquiry at any time, and a specialist can follow up during the next service window.',
    content_zh: '目前客服使用英语提供服务。项目专员每天北京时间 10:00—22:00 可跟进咨询。你可以随时提交问题，专员会在下一个服务时段跟进。',
    keywords: ['market', 'region', 'country', 'hours', 'availability', 'Dubai', 'France', 'United Kingdom', 'United States', '市场', '地区', '国家', '服务时间', '值班时间', '迪拜', '法国', '英国', '美国'],
  },
];

export function findCases(inquiry: InquiryState, cases = PUBLIC_CASES) {
  const hasFilters = Boolean(inquiry.project_type || inquiry.viewpoints.length || inquiry.shot_scale || inquiry.atmospheres.length);
  if (!hasFilters) return [];
  const now = new Date().toISOString();
  return cases.filter((item) => {
    if (item.visibility !== 'public' || item.rights_status !== 'approved') return false;
    if (item.rights_expires_at && item.rights_expires_at < now) return false;
    if (inquiry.project_type && item.building_type !== inquiry.project_type) return false;
    if (inquiry.viewpoints.length && !inquiry.viewpoints.includes(item.viewpoint)) return false;
    if (inquiry.shot_scale && item.shot_scale !== inquiry.shot_scale) return false;
    if (inquiry.atmospheres.length && !inquiry.atmospheres.every((value) => item.atmosphere.includes(value))) return false;
    return true;
  });
}

export function missingCaseViewpoints(inquiry: InquiryState, cases: PublicCase[]) {
  return inquiry.viewpoints.filter((viewpoint) => !cases.some((item) => item.viewpoint === viewpoint));
}

function words(text: string) {
  const normalized = text.slice(0, 512).toLowerCase();
  const latinStopWords = new Set(['a', 'an', 'and', 'are', 'can', 'do', 'for', 'how', 'i', 'is', 'of', 'our', 'the', 'to', 'we', 'what', 'which', 'you']);
  const hanStopPhrases = ['一个', '什么', '可以', '哪些', '如何', '怎么', '我们', '你们', '项目', '需要', '请问', '是否', '支持'];
  const latin = (normalized.match(/[a-z0-9]+/g) ?? []).filter((term) => term.length > 1 && !latinStopWords.has(term));
  const hanText = hanStopPhrases.reduce((value, phrase) => value.replaceAll(phrase, ' '), normalized);
  const han = (hanText.match(/[\u3400-\u9fff]+/g) ?? []).flatMap((sequence) => {
    const grams: string[] = [];
    for (let size = 2; size <= Math.min(4, sequence.length); size += 1) {
      for (let index = 0; index <= sequence.length - size; index += 1) grams.push(sequence.slice(index, index + size));
    }
    return grams;
  });
  return [...new Set([...latin, ...han])].slice(0, 128);
}

export function hasCaseIntent(text: string) {
  return /(case|cases|portfolio|example|show me|similar work|案例|作品|参考方向|类似项目|看看)/i.test(text);
}

export function hasCaseFilters(inquiry: InquiryState) {
  return Boolean(inquiry.project_type || inquiry.viewpoints.length || inquiry.shot_scale || inquiry.atmospheres.length);
}

export function rankKnowledge<T extends { title_en: string; title_zh: string; content_en: string; content_zh: string; keywords: string[] }>(query: string, records: T[]) {
  const terms = words(query);
  return records.map((record) => {
    const haystack = `${record.title_en} ${record.title_zh} ${record.content_en} ${record.content_zh} ${record.keywords.join(' ')}`.toLowerCase();
    const score = terms.reduce((sum, term) => sum + (haystack.includes(term) ? Math.min(term.length, 8) : 0), 0);
    return { ...record, score };
  }).filter((record) => record.score >= 4).sort((a, b) => b.score - a.score).slice(0, 3);
}

export function classifyRisk(text: string) {
  const normalized = text.toLowerCase();
  if (/(ignore (?:all |the )?(?:previous|prior) instructions|ignore (?:all|every) (?:rule|instruction)|system prompt|internal clients?|private cases?|private files?|file keys?|server paths?|other visitors?|other customers?|send_email|内部客户|私有案例|未发布案例|私有文件|文件存储键|服务器路径|其他访客|其他客户|系统提示词)/.test(normalized)) return 'private_data';
  if (/(privacy policy|personal data|data processing|gdpr|隐私政策|个人信息|数据处理)/.test(normalized)) return 'privacy';
  if (/(\b(?:talk|speak|chat)\s+(?:to|with)\s+(?:a\s+)?(?:human|person|specialist|project specialist|someone|representative|project manager)\b|\b(?:connect|transfer)\s+(?:me\s+)?(?:to|with)\s+(?:a\s+)?(?:human|person|specialist|project specialist|representative|project manager)\b|\b(?:want|need|prefer)\s+(?:a\s+)?(?:human|project specialist|specialist|representative)(?=\s+(?:for|please|to\b)|[.!?,]|$)|\b(?:human|live)\s+(?:agent|support)\b(?!\s+(?:hours?|time|availability|schedule)\b)|\b(?:human|specialist|representative)\s+please\b|转人工|(?:我要|我需要|我想要)人工(?=$|[，。！？,.!?])|人工(?:客服|接待|处理)|真人客服|(?:联系|找|转给|交给|需要|想要|我要).{0,4}项目经理|项目经理(?:跟进|联系|接待))/.test(normalized)) return 'human';
  if (/(how much|price|pricing|cost|quote|quotation|discount|多少钱|报价|价格|费用|折扣)/.test(normalized)) return 'pricing';
  if (/(guarantee|promise|ensure|must deliver|保证|承诺|一定能)/.test(normalized)) return 'guarantee';
  if (/(nda|non-disclosure|confidential agreement|保密协议|签署保密)/.test(normalized)) return 'confidentiality';
  if (/(contract|terms and conditions|liabilit|indemn|合同|条款|违约|赔偿)/.test(normalized)) return 'contract';
  if (/(copyright|license rights|ownership rights|版权|著作权|授权归属)/.test(normalized)) return 'copyright';
  if (/(building code|local regulation|legal compliance|permit approval|当地法规|建筑规范|合规结论|审批许可)/.test(normalized)) return 'legal';
  if (/(complaint|refund|dispute|投诉|退款|争议)/.test(normalized)) return 'complaint';
  if (/(can (?:you|we).{0,30}deliver|(?:we|you)\s+(?:can|will|shall|are able to)\s+(?:deliver|complete|finish)|confirm.{0,20}(?:schedule|availability|delivery)|(?:delivery|completion|turnaround|deadline|schedule|availability)\s+(?:is|will be|by|within|on)|\b(?:by|before|within)\s+(?:tomorrow|next\s+(?:week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|(?:\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:business\s+)?(?:hours?|days?|weeks?)|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?)|确认.{0,12}(?:档期|交付日期|工期)|(?:我们|可以|将在|会在).{0,10}(?:交付|完成).{0,10}(?:明天|下周|\d{1,3}天))/.test(normalized)) return 'schedule';
  return '';
}

export const FIELD_LABELS = {
  en: { project_type: 'project type', project_location: 'project location', service_interest: 'required service', viewpoints: 'required viewpoints', target_milestone: 'target milestone' },
  zh: { project_type: '项目类型', project_location: '项目地点', service_interest: '所需服务', viewpoints: '所需视角', target_milestone: '目标节点' },
};

export function nextQuestion(locale: Locale, missing: string[]) {
  const first = missing[0] as keyof typeof FIELD_LABELS.en | undefined;
  if (!first) return locale === 'zh' ? '目前的项目信息已经比较完整。需要项目专员继续跟进吗？' : 'You’ve shared the key project details. Would you like a project specialist to follow up?';
  const label = FIELD_LABELS[locale][first];
  return locale === 'zh' ? `下一步请确认${label}。如果暂时不确定，可以直接说明。` : `Next, please confirm the ${label}. If it is not decided yet, you can say so.`;
}

export function summarizeInquiry(inquiry: InquiryState, locale: Locale) {
  const values = [inquiry.project_type, inquiry.project_location, inquiry.project_stage, inquiry.service_interest, inquiry.estimated_view_count && `${inquiry.estimated_view_count} views`, inquiry.viewpoints.join(', '), inquiry.shot_scale, inquiry.atmospheres.join(', '), inquiry.target_milestone].filter(Boolean);
  if (!values.length) return locale === 'zh' ? '尚未确认项目核心信息。' : 'No core project details have been confirmed yet.';
  return values.join(' · ');
}

export function buildLeadSummaries(inquiry: InquiryState, contact: { name: string; organization: string; email: string; country: string; timezone: string }) {
  const shared = [
    inquiry.project_type, inquiry.project_location, inquiry.project_stage, inquiry.service_interest, inquiry.deliverable_type,
    inquiry.estimated_view_count && `${inquiry.estimated_view_count} views`, inquiry.viewpoints.join(', '),
    inquiry.shot_scale, inquiry.atmospheres.join(', '), inquiry.target_milestone,
  ].filter(Boolean).join(' · ');
  return {
    summary_en: `Contact: ${contact.name}${contact.organization ? `, ${contact.organization}` : ''} (${contact.email}). Region and time zone: ${[contact.country, contact.timezone].filter(Boolean).join(', ') || 'To confirm'}. Confirmed project information: ${shared || 'Core project information remains to be confirmed'}.`,
    summary_zh: `联系人：${contact.name}${contact.organization ? `，${contact.organization}` : ''}（${contact.email}）。国家或地区及时区：${[contact.country, contact.timezone].filter(Boolean).join('，') || '待确认'}。已确认项目信息：${shared || '核心项目信息仍待确认'}。`,
  };
}

export function safeJson<T>(value: string | null | undefined, fallback: T): T {
  try { return value ? JSON.parse(value) as T : fallback; } catch { return fallback; }
}
