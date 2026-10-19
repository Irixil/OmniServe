import { env } from 'cloudflare:workers';
import { PUBLIC_KNOWLEDGE_SEED } from '../lib/public-domain';
import { memberAccess } from '../lib/access-control';
import { contentChecksum } from '../lib/embedding-provider';

export function getDb() {
  if (!env.DB) throw new Error('数据库尚未配置');
  return env.DB;
}

export function getFiles() {
  if (!env.FILES) throw new Error('文件存储尚未配置');
  return env.FILES;
}

class ClientError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export function clientError(message: string, status = 400) {
  return new ClientError(message, status);
}

export function requireUser(request: Request) {
  const isLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(request.url).hostname);
  const testUserId = process.env.NODE_ENV === 'development' && isLoopback ? request.headers.get('x-test-user-id') : null;
  if (testUserId) return testUserId;
  const userId = request.headers.get('oai-authenticated-user-id');
  if (!userId && process.env.NODE_ENV === 'development' && isLoopback) return 'local-development';
  if (!userId) throw new Response('请先登录', { status: 401 });
  return userId;
}

function isLocalDevelopment(request: Request) {
  const hostname = new URL(request.url).hostname;
  return process.env.NODE_ENV === 'development' && ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
}

export function requireStaff(request: Request) {
  const userId = requireUser(request);
  if (isLocalDevelopment(request)) return userId;
  const email = request.headers.get('oai-authenticated-user-email')?.trim().toLowerCase() ?? '';
  const access = memberAccess(userId, email, env.STAFF_USER_IDS, env.STAFF_EMAILS);
  if (access === 'unconfigured') throw new Response('公司员工访问名单尚未配置', { status: 503 });
  if (access === 'denied') throw new Response('你不在公司员工访问名单中', { status: 403 });
  return userId;
}

export function requirePublisher(request: Request) {
  const userId = requireStaff(request);
  if (isLocalDevelopment(request)) return userId;
  const email = request.headers.get('oai-authenticated-user-email')?.trim().toLowerCase() ?? '';
  const access = memberAccess(userId, email, env.PUBLISHER_USER_IDS, env.PUBLISHER_EMAILS);
  if (access === 'unconfigured') throw new Response('案例与公开知识发布人名单尚未配置', { status: 503 });
  if (access === 'denied') throw new Response('你没有公开发布权限', { status: 403 });
  return userId;
}

export function requireProjectLead(request: Request) {
  const userId = requireStaff(request);
  if (isLocalDevelopment(request)) return userId;
  const email = request.headers.get('oai-authenticated-user-email')?.trim().toLowerCase() ?? '';
  const access = memberAccess(userId, email, env.PROJECT_LEAD_USER_IDS, env.PROJECT_LEAD_EMAILS);
  if (access === 'unconfigured') throw new Response('项目负责人访问名单尚未配置', { status: 503 });
  if (access === 'denied') throw new Response('只有项目负责人可以重新分配会话', { status: 403 });
  return userId;
}

let schemaReady: Promise<void> | undefined;

export function ensureSchema() {
  schemaReady ??= initializeSchema().catch((error) => {
    schemaReady = undefined;
    throw error;
  });
  return schemaReady;
}

async function initializeSchema() {
  const db = getDb();
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, project_code TEXT NOT NULL,
      name TEXT NOT NULL, client_name TEXT NOT NULL DEFAULT '', city TEXT NOT NULL DEFAULT '',
      building_type TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT '接洽中',
      contact_name TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_projects_owner_updated ON projects(owner_id, updated_at)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_projects_owner_status ON projects(owner_id, status)'),
    db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_owner_code ON projects(owner_id, project_code)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, file_key TEXT NOT NULL,
      file_name TEXT NOT NULL, mime_type TEXT NOT NULL, project_id TEXT NOT NULL DEFAULT '',
      asset_kind TEXT NOT NULL DEFAULT '效果图', phase TEXT NOT NULL DEFAULT '方案', building_type TEXT NOT NULL,
      viewpoint TEXT NOT NULL, shot_scale TEXT NOT NULL, atmosphere TEXT NOT NULL,
      style TEXT NOT NULL DEFAULT '', environment TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '', visibility TEXT NOT NULL DEFAULT 'internal',
      rights_status TEXT NOT NULL DEFAULT 'pending', rights_proof_ref TEXT NOT NULL DEFAULT '',
      rights_approved_by TEXT NOT NULL DEFAULT '', rights_approved_at TEXT NOT NULL DEFAULT '',
      rights_expires_at TEXT NOT NULL DEFAULT '', public_title_en TEXT NOT NULL DEFAULT '',
      public_title_zh TEXT NOT NULL DEFAULT '', public_description_en TEXT NOT NULL DEFAULT '',
      public_description_zh TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_assets_owner_created ON assets(owner_id, created_at)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_assets_owner_building ON assets(owner_id, building_type)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, title TEXT NOT NULL,
      category TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_documents_owner_created ON documents(owner_id, created_at)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS requirements (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, project_id TEXT NOT NULL DEFAULT '', original_text TEXT NOT NULL,
      parsed_json TEXT NOT NULL, selected_asset_ids TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_requirements_owner_created ON requirements(owner_id, created_at)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS public_knowledge (
      id TEXT PRIMARY KEY, category TEXT NOT NULL, title_en TEXT NOT NULL, title_zh TEXT NOT NULL,
      content_en TEXT NOT NULL, content_zh TEXT NOT NULL, keywords_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'draft', version INTEGER NOT NULL DEFAULT 1,
      checksum TEXT NOT NULL DEFAULT '', expires_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY, access_token_hash TEXT NOT NULL, locale TEXT NOT NULL DEFAULT 'en',
      status TEXT NOT NULL DEFAULT 'ai', assigned_to TEXT NOT NULL DEFAULT '',
      priority TEXT NOT NULL DEFAULT 'normal', next_action TEXT NOT NULL DEFAULT '',
      inquiry_json TEXT NOT NULL DEFAULT '{}', message_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, expires_at TEXT NOT NULL DEFAULT '',
      client_timezone TEXT NOT NULL DEFAULT '', client_timezone_source TEXT NOT NULL DEFAULT ''
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, sender TEXT NOT NULL, content TEXT NOT NULL,
      citations_json TEXT NOT NULL DEFAULT '[]', cases_json TEXT NOT NULL DEFAULT '[]',
      mode TEXT NOT NULL DEFAULT 'grounded', created_at TEXT NOT NULL
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation_created ON chat_messages(conversation_id, created_at)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS conversation_attachments (
      id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, message_id TEXT NOT NULL DEFAULT '',
      file_key TEXT NOT NULL, mime_type TEXT NOT NULL, byte_size INTEGER NOT NULL, sha256 TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'uploaded', analysis_json TEXT NOT NULL DEFAULT '{}', confidence INTEGER NOT NULL DEFAULT 0,
      provider TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '', error_code TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL, analyzed_at TEXT NOT NULL DEFAULT '', expires_at TEXT NOT NULL
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_conversation_attachments_conversation_created ON conversation_attachments(conversation_id, created_at)'),
    db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_conversation_attachments_conversation_sha ON conversation_attachments(conversation_id, sha256)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS leads (
      id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, idempotency_key TEXT NOT NULL,
      contact_name TEXT NOT NULL, organization TEXT NOT NULL DEFAULT '', email TEXT NOT NULL,
      country TEXT NOT NULL DEFAULT '', timezone TEXT NOT NULL DEFAULT '', consent_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'new', summary_en TEXT NOT NULL, summary_zh TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`),
    db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_conversation ON leads(conversation_id)'),
    db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_idempotency ON leads(idempotency_key)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_leads_status_updated ON leads(status, updated_at)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY, actor_id TEXT NOT NULL DEFAULT '', event_type TEXT NOT NULL,
      entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_audit_entity_created ON audit_events(entity_type, entity_id, created_at)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS public_rate_limits (
      key TEXT PRIMARY KEY, bucket INTEGER NOT NULL, count INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT NOT NULL
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_public_rate_limits_expires ON public_rate_limits(expires_at)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS semantic_analyses (
      id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, source_message_id TEXT NOT NULL,
      source_message_count INTEGER NOT NULL, purpose TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'valid',
      snapshot_json TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
      prompt_version TEXT NOT NULL, latency_ms INTEGER NOT NULL DEFAULT 0,
      created_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_semantic_analyses_conversation_created ON semantic_analyses(conversation_id, created_at)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS reply_drafts (
      id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, analysis_id TEXT NOT NULL,
      previous_draft_id TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL,
      english_content TEXT NOT NULL, chinese_meaning TEXT NOT NULL,
      meaning_changes_json TEXT NOT NULL DEFAULT '[]', risks_json TEXT NOT NULL DEFAULT '[]',
      cases_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'draft', created_by TEXT NOT NULL,
      confirmed_by TEXT NOT NULL DEFAULT '', confirmed_at TEXT NOT NULL DEFAULT '',
      sent_message_id TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_reply_drafts_conversation_version ON reply_drafts(conversation_id, version)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS conversation_notes (
      id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, author_id TEXT NOT NULL,
      content TEXT NOT NULL, created_at TEXT NOT NULL
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_conversation_notes_conversation_created ON conversation_notes(conversation_id, created_at)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS model_runs (
      id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL DEFAULT '', operation TEXT NOT NULL,
      provider TEXT NOT NULL, model TEXT NOT NULL, status TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
      latency_ms INTEGER NOT NULL DEFAULT 0, estimated_cost_micros INTEGER NOT NULL DEFAULT 0,
      retry_count INTEGER NOT NULL DEFAULT 0, error_code TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_model_runs_conversation_created ON model_runs(conversation_id, created_at)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS knowledge_embeddings (
      knowledge_id TEXT PRIMARY KEY, checksum TEXT NOT NULL, model TEXT NOT NULL,
      dimensions INTEGER NOT NULL, embedding_json TEXT NOT NULL, updated_at TEXT NOT NULL
    )`),
  ]);

  const assetColumns = await db.prepare('PRAGMA table_info(assets)').all<{ name: string }>();
  const assetColumnNames = new Set(assetColumns.results.map((column) => column.name));
  if (!assetColumnNames.has('project_id')) await db.prepare("ALTER TABLE assets ADD COLUMN project_id TEXT NOT NULL DEFAULT ''").run();
  if (!assetColumnNames.has('asset_kind')) await db.prepare("ALTER TABLE assets ADD COLUMN asset_kind TEXT NOT NULL DEFAULT '效果图'").run();
  if (!assetColumnNames.has('phase')) await db.prepare("ALTER TABLE assets ADD COLUMN phase TEXT NOT NULL DEFAULT '方案'").run();
  if (!assetColumnNames.has('visibility')) await db.prepare("ALTER TABLE assets ADD COLUMN visibility TEXT NOT NULL DEFAULT 'internal'").run();
  if (!assetColumnNames.has('rights_status')) await db.prepare("ALTER TABLE assets ADD COLUMN rights_status TEXT NOT NULL DEFAULT 'pending'").run();
  if (!assetColumnNames.has('rights_proof_ref')) await db.prepare("ALTER TABLE assets ADD COLUMN rights_proof_ref TEXT NOT NULL DEFAULT ''").run();
  if (!assetColumnNames.has('rights_approved_by')) await db.prepare("ALTER TABLE assets ADD COLUMN rights_approved_by TEXT NOT NULL DEFAULT ''").run();
  if (!assetColumnNames.has('rights_approved_at')) await db.prepare("ALTER TABLE assets ADD COLUMN rights_approved_at TEXT NOT NULL DEFAULT ''").run();
  if (!assetColumnNames.has('rights_expires_at')) await db.prepare("ALTER TABLE assets ADD COLUMN rights_expires_at TEXT NOT NULL DEFAULT ''").run();
  if (!assetColumnNames.has('public_title_en')) await db.prepare("ALTER TABLE assets ADD COLUMN public_title_en TEXT NOT NULL DEFAULT ''").run();
  if (!assetColumnNames.has('public_title_zh')) await db.prepare("ALTER TABLE assets ADD COLUMN public_title_zh TEXT NOT NULL DEFAULT ''").run();
  if (!assetColumnNames.has('public_description_en')) await db.prepare("ALTER TABLE assets ADD COLUMN public_description_en TEXT NOT NULL DEFAULT ''").run();
  if (!assetColumnNames.has('public_description_zh')) await db.prepare("ALTER TABLE assets ADD COLUMN public_description_zh TEXT NOT NULL DEFAULT ''").run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_assets_owner_project ON assets(owner_id, project_id)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_assets_public_search ON assets(visibility, rights_status, building_type, viewpoint)').run();

  const requirementColumns = await db.prepare('PRAGMA table_info(requirements)').all<{ name: string }>();
  if (!requirementColumns.results.some((column) => column.name === 'project_id')) {
    await db.prepare("ALTER TABLE requirements ADD COLUMN project_id TEXT NOT NULL DEFAULT ''").run();
  }

  const conversationColumns = await db.prepare('PRAGMA table_info(conversations)').all<{ name: string }>();
  if (!conversationColumns.results.some((column) => column.name === 'expires_at')) {
    await db.prepare("ALTER TABLE conversations ADD COLUMN expires_at TEXT NOT NULL DEFAULT ''").run();
  }
  if (!conversationColumns.results.some((column) => column.name === 'priority')) {
    await db.prepare("ALTER TABLE conversations ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal'").run();
  }
  if (!conversationColumns.results.some((column) => column.name === 'next_action')) {
    await db.prepare("ALTER TABLE conversations ADD COLUMN next_action TEXT NOT NULL DEFAULT ''").run();
  }
  if (!conversationColumns.results.some((column) => column.name === 'client_timezone')) {
    await db.prepare("ALTER TABLE conversations ADD COLUMN client_timezone TEXT NOT NULL DEFAULT ''").run();
  }
  if (!conversationColumns.results.some((column) => column.name === 'client_timezone_source')) {
    await db.prepare("ALTER TABLE conversations ADD COLUMN client_timezone_source TEXT NOT NULL DEFAULT ''").run();
  }
  await db.prepare("UPDATE conversations SET expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+7 days') WHERE expires_at = ''").run();

  const draftColumns = await db.prepare('PRAGMA table_info(reply_drafts)').all<{ name: string }>();
  if (!draftColumns.results.some((column) => column.name === 'cases_json')) {
    await db.prepare("ALTER TABLE reply_drafts ADD COLUMN cases_json TEXT NOT NULL DEFAULT '[]'").run();
  }

  const knowledgeColumns = await db.prepare('PRAGMA table_info(public_knowledge)').all<{ name: string }>();
  const knowledgeColumnNames = new Set(knowledgeColumns.results.map((column) => column.name));
  if (!knowledgeColumnNames.has('version')) await db.prepare("ALTER TABLE public_knowledge ADD COLUMN version INTEGER NOT NULL DEFAULT 1").run();
  if (!knowledgeColumnNames.has('checksum')) await db.prepare("ALTER TABLE public_knowledge ADD COLUMN checksum TEXT NOT NULL DEFAULT ''").run();
  if (!knowledgeColumnNames.has('expires_at')) await db.prepare("ALTER TABLE public_knowledge ADD COLUMN expires_at TEXT NOT NULL DEFAULT ''").run();

  const now = new Date().toISOString();
  await db.batch(PUBLIC_KNOWLEDGE_SEED.map((item) => db.prepare(`INSERT OR IGNORE INTO public_knowledge
    (id, category, title_en, title_zh, content_en, content_zh, keywords_json, status, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'published', ?)`)
    .bind(item.id, item.category, item.title_en, item.title_zh, item.content_en, item.content_zh, JSON.stringify(item.keywords), now)));
  const checksumRows = await db.prepare("SELECT id, title_en, title_zh, content_en, content_zh, keywords_json FROM public_knowledge WHERE checksum = '' LIMIT 500")
    .all<{ id: string; title_en: string; title_zh: string; content_en: string; content_zh: string; keywords_json: string }>();
  if (checksumRows.results.length) {
    const updates = await Promise.all(checksumRows.results.map(async (item) => db.prepare('UPDATE public_knowledge SET checksum = ? WHERE id = ? AND checksum = ?')
      .bind(await contentChecksum([item.title_en, item.title_zh, item.content_en, item.content_zh, item.keywords_json].join('\n')), item.id, '')));
    await db.batch(updates);
  }
}

export function asError(error: unknown) {
  if (error instanceof Response) return error;
  if (error instanceof ClientError) return Response.json({ error: error.message }, { status: error.status });
  const reference = crypto.randomUUID();
  console.error(`[${reference}]`, error);
  return Response.json({ error: '服务暂时不可用，请稍后重试', reference }, { status: 500 });
}
