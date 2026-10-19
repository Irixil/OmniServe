import { asError, getDb } from '../db';

export type PublicConversationRow = {
  id: string;
  access_token_hash: string;
  locale: 'en' | 'zh';
  status: string;
  assigned_to: string;
  inquiry_json: string;
  message_count: number;
  created_at: string;
  updated_at: string;
  expires_at: string;
  client_timezone: string;
  client_timezone_source: string;
};

export async function hashPublicValue(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function requirePublicConversation(id: string, token: string) {
  if (!id || !token) throw new Response('This conversation link is incomplete. Please reopen it and try again.', { status: 401 });
  const record = await getDb().prepare('SELECT * FROM conversations WHERE id = ?').bind(id).first<PublicConversationRow>();
  if (!record || record.access_token_hash !== await hashPublicValue(token)) throw new Response('This conversation link is no longer available. Please start a new conversation.', { status: 404 });
  if (record.status === 'closed' || (record.expires_at && record.expires_at <= new Date().toISOString())) {
    throw new Response('This conversation has closed. Please start a new conversation to continue.', { status: 410 });
  }
  return record;
}

export async function asPublicError(error: unknown, fallback: string) {
  const headers = { 'cache-control': 'no-store' };
  if (error instanceof Response) {
    const copy: Record<number, string> = {
      400: 'Please check your message and try again.',
      401: 'This conversation link is incomplete. Please reopen it and try again.',
      404: 'This conversation or image is no longer available. Start a new conversation, or upload the image again.',
      409: 'This conversation changed while you were sending. Refresh and try again.',
      410: 'This conversation has closed. Please start a new conversation to continue.',
      413: 'The request is too large. Shorten your message or choose a smaller image, then try again.',
      415: 'Please send your message in the chat or upload a supported image.',
      422: 'Please check the message details and try again.',
      429: 'Please wait a moment before trying again.',
    };
    let retryAfter: number | undefined;
    if (error.status === 429) {
      const body = await error.clone().json().catch(() => null) as { retry_after?: unknown } | null;
      if (typeof body?.retry_after === 'number' && Number.isFinite(body.retry_after)) retryAfter = body.retry_after;
    }
    return Response.json({ error: copy[error.status] ?? fallback, ...(retryAfter ? { retry_after: retryAfter } : {}) }, { status: error.status, headers });
  }
  const internal = asError(error);
  const body = await internal.clone().json().catch(() => null) as { reference?: unknown; retry_after?: unknown } | null;
  return Response.json({
    error: fallback,
    ...(typeof body?.reference === 'string' ? { reference: body.reference } : {}),
    ...(typeof body?.retry_after === 'number' ? { retry_after: body.retry_after } : {}),
  }, { status: internal.status, headers });
}

export async function enforcePublicRateLimit(request: Request, scope: string, limit: number, windowSeconds: number) {
  const forwarded = request.headers.get('cf-connecting-ip') || 'unverified-entry';
  const now = Date.now();
  const bucket = Math.floor(now / (windowSeconds * 1000));
  const key = await hashPublicValue(`${scope}:${forwarded}:${bucket}`);
  const expiresAt = new Date((bucket + 2) * windowSeconds * 1000).toISOString();
  await getDb().batch([
    getDb().prepare(`INSERT INTO public_rate_limits (key, bucket, count, expires_at) VALUES (?, ?, 1, ?)
      ON CONFLICT(key) DO UPDATE SET count = count + 1`).bind(key, bucket, expiresAt),
    getDb().prepare('DELETE FROM public_rate_limits WHERE expires_at < ?').bind(new Date(now).toISOString()),
  ]);
  const record = await getDb().prepare('SELECT count FROM public_rate_limits WHERE key = ?').bind(key).first<{ count: number }>();
  if (Number(record?.count ?? 0) > limit) {
    throw Response.json({ error: 'Please wait a moment before trying again.', retry_after: windowSeconds }, { status: 429 });
  }
}
