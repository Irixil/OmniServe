import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const assets = sqliteTable('assets', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  fileKey: text('file_key').notNull(),
  fileName: text('file_name').notNull(),
  mimeType: text('mime_type').notNull(),
  projectId: text('project_id').notNull().default(''),
  assetKind: text('asset_kind').notNull().default('效果图'),
  phase: text('phase').notNull().default('方案'),
  buildingType: text('building_type').notNull(),
  viewpoint: text('viewpoint').notNull(),
  shotScale: text('shot_scale').notNull(),
  atmosphere: text('atmosphere').notNull(),
  style: text('style').notNull().default(''),
  environment: text('environment').notNull().default(''),
  description: text('description').notNull().default(''),
  visibility: text('visibility').notNull().default('internal'),
  rightsStatus: text('rights_status').notNull().default('pending'),
  rightsProofRef: text('rights_proof_ref').notNull().default(''),
  rightsApprovedBy: text('rights_approved_by').notNull().default(''),
  rightsApprovedAt: text('rights_approved_at').notNull().default(''),
  rightsExpiresAt: text('rights_expires_at').notNull().default(''),
  publicTitleEn: text('public_title_en').notNull().default(''),
  publicTitleZh: text('public_title_zh').notNull().default(''),
  publicDescriptionEn: text('public_description_en').notNull().default(''),
  publicDescriptionZh: text('public_description_zh').notNull().default(''),
  createdAt: text('created_at').notNull(),
}, (table) => [
  index('idx_assets_owner_created').on(table.ownerId, table.createdAt),
  index('idx_assets_owner_building').on(table.ownerId, table.buildingType),
  index('idx_assets_owner_project').on(table.ownerId, table.projectId),
]);

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  projectCode: text('project_code').notNull(),
  name: text('name').notNull(),
  clientName: text('client_name').notNull().default(''),
  city: text('city').notNull().default(''),
  buildingType: text('building_type').notNull().default(''),
  status: text('status').notNull().default('接洽中'),
  contactName: text('contact_name').notNull().default(''),
  notes: text('notes').notNull().default(''),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('idx_projects_owner_updated').on(table.ownerId, table.updatedAt),
  index('idx_projects_owner_status').on(table.ownerId, table.status),
  uniqueIndex('idx_projects_owner_code').on(table.ownerId, table.projectCode),
]);

export const documents = sqliteTable('documents', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  title: text('title').notNull(),
  category: text('category').notNull(),
  content: text('content').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => [index('idx_documents_owner_created').on(table.ownerId, table.createdAt)]);

export const requirements = sqliteTable('requirements', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  projectId: text('project_id').notNull().default(''),
  originalText: text('original_text').notNull(),
  parsedJson: text('parsed_json').notNull(),
  selectedAssetIds: text('selected_asset_ids').notNull().default('[]'),
  createdAt: text('created_at').notNull(),
}, (table) => [index('idx_requirements_owner_created').on(table.ownerId, table.createdAt)]);

export const publicKnowledge = sqliteTable('public_knowledge', {
  id: text('id').primaryKey(),
  category: text('category').notNull(),
  titleEn: text('title_en').notNull(),
  titleZh: text('title_zh').notNull(),
  contentEn: text('content_en').notNull(),
  contentZh: text('content_zh').notNull(),
  keywordsJson: text('keywords_json').notNull().default('[]'),
  status: text('status').notNull().default('draft'),
  version: integer('version').notNull().default(1),
  checksum: text('checksum').notNull().default(''),
  expiresAt: text('expires_at').notNull().default(''),
  updatedAt: text('updated_at').notNull(),
});

export const conversations = sqliteTable('conversations', {
  id: text('id').primaryKey(),
  accessTokenHash: text('access_token_hash').notNull(),
  locale: text('locale').notNull().default('en'),
  status: text('status').notNull().default('ai'),
  assignedTo: text('assigned_to').notNull().default(''),
  priority: text('priority').notNull().default('normal'),
  nextAction: text('next_action').notNull().default(''),
  inquiryJson: text('inquiry_json').notNull().default('{}'),
  messageCount: integer('message_count').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  expiresAt: text('expires_at').notNull().default(''),
  clientTimezone: text('client_timezone').notNull().default(''),
  clientTimezoneSource: text('client_timezone_source').notNull().default(''),
}, (table) => [index('idx_conversations_updated').on(table.updatedAt)]);

export const chatMessages = sqliteTable('chat_messages', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull(),
  sender: text('sender').notNull(),
  content: text('content').notNull(),
  citationsJson: text('citations_json').notNull().default('[]'),
  casesJson: text('cases_json').notNull().default('[]'),
  mode: text('mode').notNull().default('grounded'),
  createdAt: text('created_at').notNull(),
}, (table) => [index('idx_chat_messages_conversation_created').on(table.conversationId, table.createdAt)]);

export const conversationAttachments = sqliteTable('conversation_attachments', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull(),
  messageId: text('message_id').notNull().default(''),
  fileKey: text('file_key').notNull(),
  mimeType: text('mime_type').notNull(),
  byteSize: integer('byte_size').notNull(),
  sha256: text('sha256').notNull(),
  status: text('status').notNull().default('uploaded'),
  analysisJson: text('analysis_json').notNull().default('{}'),
  confidence: integer('confidence').notNull().default(0),
  provider: text('provider').notNull().default(''),
  model: text('model').notNull().default(''),
  errorCode: text('error_code').notNull().default(''),
  createdAt: text('created_at').notNull(),
  analyzedAt: text('analyzed_at').notNull().default(''),
  expiresAt: text('expires_at').notNull(),
}, (table) => [
  index('idx_conversation_attachments_conversation_created').on(table.conversationId, table.createdAt),
  uniqueIndex('idx_conversation_attachments_conversation_sha').on(table.conversationId, table.sha256),
]);

export const leads = sqliteTable('leads', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  contactName: text('contact_name').notNull(),
  organization: text('organization').notNull().default(''),
  email: text('email').notNull(),
  country: text('country').notNull().default(''),
  timezone: text('timezone').notNull().default(''),
  consentAt: text('consent_at').notNull(),
  status: text('status').notNull().default('new'),
  summaryEn: text('summary_en').notNull(),
  summaryZh: text('summary_zh').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('idx_leads_conversation').on(table.conversationId),
  uniqueIndex('idx_leads_idempotency').on(table.idempotencyKey),
  index('idx_leads_status_updated').on(table.status, table.updatedAt),
]);

export const auditEvents = sqliteTable('audit_events', {
  id: text('id').primaryKey(),
  actorId: text('actor_id').notNull().default(''),
  eventType: text('event_type').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  metadataJson: text('metadata_json').notNull().default('{}'),
  createdAt: text('created_at').notNull(),
}, (table) => [index('idx_audit_entity_created').on(table.entityType, table.entityId, table.createdAt)]);

export const publicRateLimits = sqliteTable('public_rate_limits', {
  key: text('key').primaryKey(),
  bucket: integer('bucket').notNull(),
  count: integer('count').notNull().default(0),
  expiresAt: text('expires_at').notNull(),
}, (table) => [index('idx_public_rate_limits_expires').on(table.expiresAt)]);

export const semanticAnalyses = sqliteTable('semantic_analyses', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull(),
  sourceMessageId: text('source_message_id').notNull(),
  sourceMessageCount: integer('source_message_count').notNull(),
  purpose: text('purpose').notNull(),
  status: text('status').notNull().default('valid'),
  snapshotJson: text('snapshot_json').notNull(),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  promptVersion: text('prompt_version').notNull(),
  latencyMs: integer('latency_ms').notNull().default(0),
  createdBy: text('created_by').notNull().default(''),
  createdAt: text('created_at').notNull(),
}, (table) => [index('idx_semantic_analyses_conversation_created').on(table.conversationId, table.createdAt)]);

export const replyDrafts = sqliteTable('reply_drafts', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull(),
  analysisId: text('analysis_id').notNull(),
  previousDraftId: text('previous_draft_id').notNull().default(''),
  version: integer('version').notNull(),
  englishContent: text('english_content').notNull(),
  chineseMeaning: text('chinese_meaning').notNull(),
  meaningChangesJson: text('meaning_changes_json').notNull().default('[]'),
  risksJson: text('risks_json').notNull().default('[]'),
  casesJson: text('cases_json').notNull().default('[]'),
  status: text('status').notNull().default('draft'),
  createdBy: text('created_by').notNull(),
  confirmedBy: text('confirmed_by').notNull().default(''),
  confirmedAt: text('confirmed_at').notNull().default(''),
  sentMessageId: text('sent_message_id').notNull().default(''),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [index('idx_reply_drafts_conversation_version').on(table.conversationId, table.version)]);

export const conversationNotes = sqliteTable('conversation_notes', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull(),
  authorId: text('author_id').notNull(),
  content: text('content').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => [index('idx_conversation_notes_conversation_created').on(table.conversationId, table.createdAt)]);

export const modelRuns = sqliteTable('model_runs', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull().default(''),
  operation: text('operation').notNull(),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  status: text('status').notNull(),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  latencyMs: integer('latency_ms').notNull().default(0),
  estimatedCostMicros: integer('estimated_cost_micros').notNull().default(0),
  retryCount: integer('retry_count').notNull().default(0),
  errorCode: text('error_code').notNull().default(''),
  createdAt: text('created_at').notNull(),
}, (table) => [index('idx_model_runs_conversation_created').on(table.conversationId, table.createdAt)]);

export const knowledgeEmbeddings = sqliteTable('knowledge_embeddings', {
  knowledgeId: text('knowledge_id').primaryKey(),
  checksum: text('checksum').notNull(),
  model: text('model').notNull(),
  dimensions: integer('dimensions').notNull(),
  embeddingJson: text('embedding_json').notNull(),
  updatedAt: text('updated_at').notNull(),
});
