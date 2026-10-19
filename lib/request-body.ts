async function readBodyBytes(request: Request, maxBytes: number) {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) throw new Response('请求内容过大', { status: 413 });
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Response('请求内容过大', { status: 413 });
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function readJsonBody<T>(request: Request, maxBytes: number): Promise<T> {
  if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
    throw new Response('仅支持 JSON 请求', { status: 415 });
  }
  const bytes = await readBodyBytes(request, maxBytes);
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    throw new Response('JSON 格式不正确', { status: 400 });
  }
}

export async function readFormBody(request: Request, maxBytes: number) {
  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.split(';', 1)[0].trim().toLowerCase() !== 'multipart/form-data') {
    throw new Response('仅支持表单上传', { status: 415 });
  }
  const bytes = await readBodyBytes(request, maxBytes);
  try {
    return await new Response(bytes, { headers: { 'content-type': contentType } }).formData();
  } catch {
    throw new Response('表单格式不正确', { status: 400 });
  }
}
