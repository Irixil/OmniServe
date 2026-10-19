'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  ASSET_KINDS, ATMOSPHERES, BUILDING_TYPES, parseRequirement,
  PROJECT_PHASES, PROJECT_STATUSES, SHOT_SCALES, VIEWPOINTS,
} from '../../lib/domain';

type Tab = 'projects' | 'intake' | 'gallery' | 'knowledge' | 'records';
type Project = {
  id: string; project_code: string; name: string; client_name: string; city: string; building_type: string;
  status: string; contact_name: string; notes: string; asset_count: number; requirement_count: number; updated_at: string;
};
type Asset = {
  id: string; project_id: string; project_code?: string; project_name?: string; file_name: string; asset_kind: string;
  phase: string; building_type: string; viewpoint: string; shot_scale: string; atmosphere: string; style: string;
  environment: string; description: string; image_url: string; visibility: string; rights_status: string;
  public_title_en: string; public_title_zh: string; public_description_en: string; public_description_zh: string; created_at: string;
};
type DocumentRecord = { id: string; title: string; category: string; preview: string; created_at: string };
type RequirementRecord = {
  id: string; project_id: string; project_code?: string; project_name?: string; original_text: string;
  parsed: ReturnType<typeof parseRequirement>; selected_asset_ids: string[]; created_at: string;
};
type KnowledgeAnswer = { status: string; answer: string; citations: Array<{ id: string; title: string; category: string; excerpt: string }> };

const tabs: Array<{ id: Tab; label: string; mark: string }> = [
  { id: 'projects', label: '项目台账', mark: '项' }, { id: 'intake', label: '需求接待', mark: '需' },
  { id: 'gallery', label: '素材库', mark: '素' }, { id: 'knowledge', label: '知识库', mark: '知' },
  { id: 'records', label: '工作记录', mark: '记' },
];

async function json<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(body.error || '操作失败');
  return body as T;
}

function download(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url; link.download = name; link.click(); URL.revokeObjectURL(url);
}

function AssetCard({ asset, selected, onSelect, onDelete }: { asset: Asset; selected: boolean; onSelect: () => void; onDelete: () => void }) {
  return <article className={selected ? 'case-card selected' : 'case-card'}>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img className="real-image" src={asset.image_url} alt={asset.description || asset.file_name} />
    <div className="case-body"><div className="case-heading"><div><p className="case-id">{asset.project_code || '公共素材'} · {asset.asset_kind}</p><h3>{asset.project_name || asset.building_type}</h3></div><button className="select-button" onClick={onSelect} type="button">{selected ? '已选择' : '选择'}</button></div>
      <div className="tag-row compact">{[asset.phase, asset.viewpoint, asset.shot_scale, asset.atmosphere].map((tag) => <span key={tag}>{tag}</span>)}</div>
      <p className="case-reason">{asset.description || [asset.style, asset.environment].filter(Boolean).join(' · ') || asset.file_name}</p><div className={`publication-state ${asset.visibility === 'public' && asset.rights_status === 'approved' ? 'published' : ''}`}>{asset.visibility === 'public' && asset.rights_status === 'approved' ? '公开案例 · 展示权已确认' : '内部素材'}</div><button className="danger-link" onClick={onDelete} type="button">删除素材</button>
    </div>
  </article>;
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>('projects');
  const [projects, setProjects] = useState<Project[]>([]); const [assets, setAssets] = useState<Asset[]>([]);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]); const [requirements, setRequirements] = useState<RequirementRecord[]>([]);
  const [activeProjectId, setActiveProjectId] = useState(''); const [query, setQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]); const [answer, setAnswer] = useState<KnowledgeAnswer | null>(null);
  const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false);
  const parsed = useMemo(() => parseRequirement(query), [query]);
  const currentAssets = assets.filter((asset) => selectedIds.includes(asset.id));
  const activeProject = projects.find((project) => project.id === activeProjectId);

  useEffect(() => {
    let active = true;
    Promise.all([json<Project[]>('/api/projects'), json<Asset[]>('/api/assets'), json<DocumentRecord[]>('/api/documents'), json<RequirementRecord[]>('/api/requirements')])
      .then(([nextProjects, nextAssets, nextDocuments, nextRequirements]) => {
        if (!active) return; setProjects(nextProjects); setAssets(nextAssets); setDocuments(nextDocuments); setRequirements(nextRequirements); setActiveProjectId(nextProjects[0]?.id || '');
      }).catch((error) => { if (active) setNotice(error instanceof Error ? error.message : '数据加载失败'); });
    return () => { active = false; };
  }, []);

  const run = async (work: () => Promise<void>, success: string) => {
    setBusy(true); setNotice('');
    try { await work(); setNotice(success); } catch (error) { setNotice(error instanceof Error ? error.message : '操作失败'); } finally { setBusy(false); }
  };
  const createProject = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = event.currentTarget; run(async () => {
    const project = await json<Project>('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) });
    setProjects((items) => [project, ...items]); setActiveProjectId(project.id); form.reset();
  }, '项目已建立'); };
  const advanceProject = (project: Project) => run(async () => {
    const status = PROJECT_STATUSES[Math.min(PROJECT_STATUSES.indexOf(project.status) + 1, PROJECT_STATUSES.length - 1)];
    await json(`/api/projects/${project.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status }) });
    setProjects((items) => items.map((item) => item.id === project.id ? { ...item, status, updated_at: new Date().toISOString() } : item));
  }, '项目状态已更新');
  const searchFromRequirement = () => run(async () => { const params = new URLSearchParams(Object.entries(parsed.search_filters).filter(([, value]) => value)); if (activeProjectId) params.set('project_id', activeProjectId); setAssets(await json<Asset[]>(`/api/assets?${params}`)); setActiveTab('gallery'); }, '已按当前需求检索素材');
  const saveRequirement = () => run(async () => { const record = await json<RequirementRecord>('/api/requirements', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ project_id: activeProjectId, original_text: query, selected_asset_ids: selectedIds }) }); setRequirements((items) => [{ ...record, project_code: activeProject?.project_code, project_name: activeProject?.name }, ...items]); }, '需求记录已保存');
  const searchAssets = (event: FormEvent<HTMLFormElement>) => run(async () => { event.preventDefault(); const params = new URLSearchParams(); for (const [key, value] of new FormData(event.currentTarget).entries()) if (String(value).trim()) params.set(key, String(value).trim()); setAssets(await json<Asset[]>(`/api/assets?${params}`)); }, '检索完成');
  const uploadAsset = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = event.currentTarget; run(async () => { const asset = await json<Asset>('/api/assets', { method: 'POST', body: new FormData(form) }); const project = projects.find((item) => item.id === asset.project_id); setAssets((items) => [{ ...asset, project_code: project?.project_code, project_name: project?.name }, ...items]); setProjects((items) => items.map((item) => item.id === asset.project_id ? { ...item, asset_count: Number(item.asset_count) + 1 } : item)); form.reset(); }, '素材已入库'); };
  const addDocument = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = event.currentTarget; run(async () => { const data = new FormData(form); const file = data.get('file'); const content = file instanceof File && file.size ? await file.text() : String(data.get('content') ?? ''); const title = String(data.get('title') ?? '').trim() || (file instanceof File ? file.name : ''); const documentRecord = await json<DocumentRecord>('/api/documents', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title, category: data.get('category'), content }) }); setDocuments((items) => [documentRecord, ...items]); form.reset(); }, '知识文档已保存'); };
  const askKnowledge = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const data = new FormData(event.currentTarget); run(async () => setAnswer(await json<KnowledgeAnswer>('/api/knowledge', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: data.get('query') }) })), '已完成知识检索'); };
  const removeAsset = (id: string) => run(async () => { const asset = assets.find((item) => item.id === id); await json(`/api/assets/${id}`, { method: 'DELETE' }); setAssets((items) => items.filter((item) => item.id !== id)); setSelectedIds((items) => items.filter((item) => item !== id)); if (asset?.project_id) setProjects((items) => items.map((item) => item.id === asset.project_id ? { ...item, asset_count: Math.max(0, Number(item.asset_count) - 1) } : item)); }, '素材已删除');
  const removeDocument = (id: string) => run(async () => { await json(`/api/documents/${id}`, { method: 'DELETE' }); setDocuments((items) => items.filter((item) => item.id !== id)); }, '文档已删除');
  const toggleAsset = (id: string) => setSelectedIds((items) => items.includes(id) ? items.filter((item) => item !== id) : [...items, id]);

  return <main className="app-shell"><aside className="sidebar"><div className="brand"><div className="brand-mark" translate="no">OS</div><div><strong translate="no">OmniServe</strong><span>建筑公司工作中台</span></div></div><nav aria-label="产品功能"><a className="nav-item concierge-entry" href="/admin/concierge"><span>客</span>海外客服</a>{tabs.map((tab) => <button className={activeTab === tab.id ? 'nav-item active' : 'nav-item'} key={tab.id} onClick={() => setActiveTab(tab.id)} type="button"><span>{tab.mark}</span>{tab.label}</button>)}</nav><div className="library-status"><p>数据概览</p><dl><div><dt>项目</dt><dd>{projects.length}</dd></div><div><dt>素材</dt><dd>{assets.length}</dd></div><div><dt>知识文档</dt><dd>{documents.length}</dd></div><div><dt>需求记录</dt><dd>{requirements.length}</dd></div></dl></div></aside>
    <section className="workspace"><header className="topbar"><h1>{tabs.find((tab) => tab.id === activeTab)?.label}</h1><button className="avatar" type="button" aria-label="当前用户">PM</button></header>{notice && <div className="notice-banner" role="status">{busy ? '处理中…' : notice}<button aria-label="关闭提示" onClick={() => setNotice('')} type="button">×</button></div>}
      {activeTab === 'projects' && <section className="projects-view"><form className="panel form-panel" onSubmit={createProject}><div className="panel-title"><h2>建立项目档案</h2><button className="primary-button" disabled={busy} type="submit">新建项目</button></div><div className="form-grid project-form"><label>项目编号<input name="project_code" placeholder="例如 BJ-2026-018" required /></label><label>项目名称<input name="name" placeholder="例如 滨江商务中心" required /></label><label>客户名称<input name="client_name" /></label><label>所在城市<input name="city" /></label><label>建筑类型<select name="building_type"><option value="">请选择</option>{BUILDING_TYPES.map((item) => <option key={item}>{item}</option>)}</select></label><label>项目状态<select defaultValue={PROJECT_STATUSES[0]} name="status">{PROJECT_STATUSES.map((item) => <option key={item}>{item}</option>)}</select></label><label>客户联系人<input name="contact_name" /></label><label>备注<input name="notes" /></label></div></form><div className="section-heading"><h2>全部项目</h2><span>{projects.length} 个</span></div>{projects.length ? <div className="project-table panel"><div className="project-row project-head"><span>项目</span><span>客户与城市</span><span>建筑类型</span><span>资料</span><span>状态</span><span>操作</span></div>{projects.map((project) => <article className="project-row" key={project.id}><div><strong>{project.name}</strong><small>{project.project_code}</small></div><div><span>{project.client_name || '客户待补充'}</span><small>{project.city || '城市待补充'}</small></div><span>{project.building_type || '待补充'}</span><span>{project.asset_count} 素材 · {project.requirement_count} 需求</span><b className="project-status">{project.status}</b><button className="text-button" disabled={project.status === PROJECT_STATUSES.at(-1) || busy} onClick={() => advanceProject(project)} type="button">推进状态</button></article>)}</div> : <div className="empty-state"><strong>先建立第一个项目</strong><span>素材和客户需求会按项目归档。</span></div>}</section>}
      {activeTab === 'intake' && <div className="content-grid"><section className="primary-column"><div className="panel intake-panel"><div className="panel-title"><h2>录入、解析并保存需求</h2><span className="status-pill">{selectedIds.length} 张素材已选</span></div><label className="project-picker">归属项目<select value={activeProjectId} onChange={(event) => setActiveProjectId(event.target.value)}><option value="">公共需求</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.project_code} · {project.name}</option>)}</select></label><textarea aria-label="客户需求" placeholder="粘贴客户的文字或语音转录内容" value={query} onChange={(event) => setQuery(event.target.value)} /><div className="input-footer"><span>{query.length} 字</span><div className="action-row"><button className="secondary-button" disabled={!query || busy} onClick={searchFromRequirement} type="button">检索素材</button><button className="primary-button" disabled={!query || busy} onClick={saveRequirement} type="button">保存记录</button></div></div></div><div className="panel result-panel visible"><div className="panel-title"><h2>需求字段</h2></div><div className="field-grid"><div><span>建筑类型</span><strong>{parsed.confirmed.building_type || '待确认'}</strong></div><div><span>视角</span><strong>{parsed.confirmed.viewpoint || '待确认'}</strong></div><div><span>景别</span><strong>{parsed.confirmed.shot_scale || '待确认'}</strong></div><div><span>用途</span><strong>{parsed.confirmed.use_case || '待确认'}</strong></div></div><div className="label-section"><span>氛围</span><div className="tag-row">{parsed.confirmed.atmosphere.length ? parsed.confirmed.atmosphere.map((item) => <b key={item}>{item}</b>) : <b>待确认</b>}</div></div><div className={parsed.conflicts.length ? 'notice warning' : 'notice success'}><strong>{parsed.conflicts.length ? '要求冲突' : '核对结果'}</strong><span>{parsed.conflicts.join('；') || parsed.missing.join('、') || '核心字段完整'}</span></div></div>{currentAssets.length > 0 && <><div className="section-heading"><h2>随需求保存的素材</h2></div><div className="case-grid">{currentAssets.map((asset) => <AssetCard asset={asset} key={asset.id} selected onSelect={() => toggleAsset(asset.id)} onDelete={() => removeAsset(asset.id)} />)}</div></>}</section><aside className="context-column"><div className="panel citation-panel"><h2>{activeProject?.name || '公共需求记录'}</h2><p className="answer">{activeProject ? `${activeProject.project_code} · ${activeProject.status} · ${activeProject.building_type || '建筑类型待补充'}` : '选择项目后，需求和素材会归入同一档案。'}</p></div></aside></div>}
      {activeTab === 'gallery' && <section className="gallery-view"><div className="gallery-hero"><div><h2>建筑素材库</h2><p>按项目、阶段和画面标签统一管理公司图片。</p></div></div><form className="panel form-panel" onSubmit={uploadAsset}><div className="panel-title"><h2>上传并标注素材</h2><button className="primary-button" disabled={busy || !projects.length} type="submit">上传素材</button></div><div className="form-grid"><label>归属项目<select name="project_id" required><option value="">请选择</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.project_code} · {project.name}</option>)}</select></label><label>素材类型<select name="asset_kind">{ASSET_KINDS.map((item) => <option key={item}>{item}</option>)}</select></label><label>项目阶段<select name="phase">{PROJECT_PHASES.map((item) => <option key={item}>{item}</option>)}</select></label><label>图片<input accept="image/*" name="file" required type="file" /></label><label>建筑类型<select name="building_type" required><option value="">请选择</option>{BUILDING_TYPES.map((item) => <option key={item}>{item}</option>)}</select></label><label>视角<select name="viewpoint" required><option value="">请选择</option>{VIEWPOINTS.map((item) => <option key={item}>{item}</option>)}</select></label><label>景别<select name="shot_scale" required><option value="">请选择</option>{SHOT_SCALES.map((item) => <option key={item}>{item}</option>)}</select></label><label>氛围<select name="atmosphere" required><option value="">请选择</option>{ATMOSPHERES.map((item) => <option key={item}>{item}</option>)}</select></label><label>风格<input name="style" placeholder="现代、极简等" /></label><label>环境<input name="environment" placeholder="滨水、园区等" /></label><label className="wide">素材描述<input name="description" placeholder="补充空间、构图和可检索内容" /></label></div></form><form className="filter-bar search-form" onSubmit={searchAssets}><input name="q" placeholder="搜索文件名、描述、风格、环境" /><select name="project_id"><option value="">全部项目</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.project_code}</option>)}</select><select name="asset_kind"><option value="">全部类型</option>{ASSET_KINDS.map((item) => <option key={item}>{item}</option>)}</select><select name="building_type"><option value="">全部建筑</option>{BUILDING_TYPES.map((item) => <option key={item}>{item}</option>)}</select><select name="viewpoint"><option value="">全部视角</option>{VIEWPOINTS.map((item) => <option key={item}>{item}</option>)}</select><button className="primary-button" type="submit">检索</button></form><div className="gallery-summary"><strong>{assets.length} 个结果</strong><span>{selectedIds.length} 张已选择</span></div>{assets.length ? <div className="case-grid gallery">{assets.map((asset) => <AssetCard asset={asset} key={asset.id} selected={selectedIds.includes(asset.id)} onSelect={() => toggleAsset(asset.id)} onDelete={() => removeAsset(asset.id)} />)}</div> : <div className="empty-state"><strong>从第一个项目素材开始</strong><span>上传时完成标签，后续即可按条件检索。</span></div>}</section>}
      {activeTab === 'knowledge' && <section className="knowledge-workspace"><div className="panel form-panel"><form onSubmit={addDocument}><div className="panel-title"><h2>添加公司知识</h2><button className="primary-button" disabled={busy} type="submit">保存文档</button></div><div className="form-grid"><label>标题<input name="title" placeholder="不上传文件时必填" /></label><label>类别<input defaultValue="内部知识" name="category" /></label><label className="wide">读取文件<input accept=".txt,.md,.csv,text/plain,text/markdown,text/csv" name="file" type="file" /></label><label className="wide">或粘贴正文<textarea name="content" placeholder="粘贴制度、FAQ、资料清单等文字内容" /></label></div></form><div className="document-list">{documents.map((item) => <article key={item.id}><div><span>{item.category}</span><strong>{item.title}</strong><p>{item.preview}</p></div><button className="danger-link" onClick={() => removeDocument(item.id)} type="button">删除</button></article>)}</div></div><div className="answer-column"><form className="panel ask-panel" onSubmit={askKnowledge}><h2>查询内部资料</h2><textarea name="query" placeholder="输入业务问题" required /><button className="primary-button" disabled={busy} type="submit">查找答案</button></form>{answer && <div className="answer-surface"><span className={answer.status === 'grounded' ? 'answer-state' : 'answer-state warning'}>{answer.status === 'grounded' ? '已找到依据' : '需要补充资料'}</span><p>{answer.answer}</p>{answer.citations.map((item) => <div className="source-card" key={item.id}><span>{item.category}</span><strong>{item.title}</strong><p>{item.excerpt}</p></div>)}</div>}</div></section>}
      {activeTab === 'records' && <section className="evaluation-view"><div className="metric-grid"><div><span>项目</span><strong>{projects.length}</strong><p>当前台账</p></div><div><span>素材</span><strong>{assets.length}</strong><p>已入库</p></div><div><span>知识文档</span><strong>{documents.length}</strong><p>可查询</p></div><div><span>需求记录</span><strong>{requirements.length}</strong><p>已归档</p></div></div><div className="records-list">{requirements.map((record) => <article className="panel record-card" key={record.id}><div><span>{record.project_code ? `${record.project_code} · ${record.project_name}` : '公共记录'} · {new Date(record.created_at).toLocaleString('zh-CN')}</span><p>{record.original_text}</p><div className="tag-row compact">{Object.values(record.parsed.confirmed).flat().filter(Boolean).map((item) => <span key={String(item)}>{String(item)}</span>)}</div></div><button className="secondary-button" onClick={() => download(`需求记录-${record.id.slice(0, 8)}.json`, record)} type="button">导出 JSON</button></article>)}</div>{!requirements.length && <div className="empty-state"><strong>需求记录会集中显示在这里</strong><span>保存后可随时导出。</span></div>}</section>}
    </section>
  </main>;
}
