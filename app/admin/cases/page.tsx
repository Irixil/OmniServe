'use client';

import { FormEvent, useEffect, useState } from 'react';
import Image from 'next/image';

type Asset = {
  id: string;
  file_name: string;
  project_code?: string;
  project_name?: string;
  building_type: string;
  viewpoint: string;
  shot_scale: string;
  atmosphere: string;
  description: string;
  visibility: string;
  rights_status: string;
  rights_proof_ref: string;
  rights_approved_by: string;
  rights_approved_at: string;
  rights_expires_at: string;
  public_title_en: string;
  public_title_zh: string;
  public_description_en: string;
  public_description_zh: string;
  image_url: string;
};

function isPublic(asset: Asset) {
  return asset.visibility === 'public' && asset.rights_status === 'approved'
    && (!asset.rights_expires_at || asset.rights_expires_at > new Date().toISOString());
}

function publicStatus(asset: Asset) {
  if (isPublic(asset)) return '已公开';
  if (asset.visibility === 'public' && asset.rights_status === 'approved') return '展示权已过期';
  return asset.rights_status === 'revoked' ? '已撤回' : '仅内部';
}

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(body.error || '操作失败');
  return body as T;
}

export default function PublicCaseManager() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState('');

  useEffect(() => {
    let active = true;
    api<Asset[]>('/api/assets?scope=company')
      .then((items) => { if (active) setAssets(items); })
      .catch((error) => { if (active) setNotice(error instanceof Error ? error.message : '加载失败'); });
    return () => { active = false; };
  }, []);

  async function save(form: HTMLFormElement, asset: Asset, visibility: 'public' | 'internal') {
    const values = Object.fromEntries(new FormData(form).entries());
    const next = {
      visibility,
      rights_status: visibility === 'public' ? 'approved' : 'revoked',
      rights_proof_ref: values.rights_proof_ref,
      rights_expires_at: values.rights_expires_at,
      public_title_en: values.public_title_en,
      public_title_zh: values.public_title_zh,
      public_description_en: values.public_description_en,
      public_description_zh: values.public_description_zh,
    };
    setBusyId(asset.id); setNotice('');
    try {
      const saved = await api<Partial<Asset>>(`/api/assets/${asset.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(next) });
      setAssets((items) => items.map((item) => item.id === asset.id ? { ...item, ...next, ...saved } as Asset : item));
      setNotice(visibility === 'public' ? '案例已对外发布' : '案例已撤回');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '保存失败');
    } finally {
      setBusyId('');
    }
  }

  return <main className="case-manager-shell">
    <header className="case-manager-head"><div><a href="/admin/concierge">← 返回海外客服</a><span>公司内部</span></div><h1>公开案例发布</h1><p>内部素材默认不可见。确认展示授权并填写中英文公开内容后，案例才会提供给客户咨询使用。</p></header>
    {notice && <div className="admin-notice" role="status">{notice}<button onClick={() => setNotice('')} type="button">关闭</button></div>}
    <section className="case-manager-grid">
      {assets.map((asset) => <form className="case-publish-card" key={asset.id} onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); save(event.currentTarget, asset, 'public'); }}>
        <div className="case-publish-image"><Image alt={asset.description || asset.file_name} height={600} src={asset.image_url} unoptimized width={960} /><span className={isPublic(asset) ? 'published' : ''}>{publicStatus(asset)}</span></div>
        <div className="case-publish-body"><small>{asset.project_code || '未归档项目'} · {asset.building_type}</small><h2>{asset.project_name || asset.file_name}</h2><p>{asset.viewpoint} · {asset.shot_scale} · {asset.atmosphere}</p>
          <label>展示授权依据<input defaultValue={asset.rights_proof_ref} maxLength={300} name="rights_proof_ref" placeholder="合同编号、授权邮件或内部审批记录" required /></label>
          <label>展示权到期日（可不填）<input defaultValue={asset.rights_expires_at?.slice(0, 10)} min={new Date().toISOString().slice(0, 10)} name="rights_expires_at" type="date" /></label>
          <label>英文公开标题<input defaultValue={asset.public_title_en} name="public_title_en" required /></label>
          <label>中文公开标题<input defaultValue={asset.public_title_zh} name="public_title_zh" required /></label>
          <label>英文公开说明<textarea defaultValue={asset.public_description_en} name="public_description_en" /></label>
          <label>中文公开说明<textarea defaultValue={asset.public_description_zh} name="public_description_zh" /></label>
          {asset.rights_approved_at && <small>最近确认展示授权：{new Date(asset.rights_approved_at).toLocaleDateString('zh-CN')}{asset.rights_approved_by ? ` · ${asset.rights_approved_by}` : ''}</small>}
          <div className="case-publish-actions"><button disabled={busyId === asset.id} type="submit">确认展示授权并发布</button><button className="secondary" disabled={busyId === asset.id || asset.visibility !== 'public'} onClick={(event) => { if (event.currentTarget.form) save(event.currentTarget.form, asset, 'internal'); }} type="button">立即撤回</button></div>
        </div>
      </form>)}
      {!assets.length && <div className="admin-empty">先在素材库上传图片并完成建筑类型、视角、景别和氛围标注。</div>}
    </section>
  </main>;
}
