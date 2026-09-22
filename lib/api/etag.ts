import { createHash } from 'crypto';
import { NextResponse, type NextRequest } from 'next/server';

export function computeEtag(data: unknown): string {
  const hash = createHash('sha1').update(JSON.stringify(data)).digest('hex').slice(0, 16);
  return `"${hash}"`;
}

function normalizeEtag(tag: string): string {
  return tag.trim().replace(/^W\//, '');
}

export function checkEtagMatch(req: NextRequest, etag: string): boolean {
  const header = req.headers.get('if-none-match');
  if (!header) return false;
  const clean = normalizeEtag(etag);
  const tags = header.split(',').map(normalizeEtag);
  return tags.includes(clean) || tags.includes('*');
}

export function createEtagResponse(
  req: NextRequest,
  data: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): NextResponse {
  const etag = computeEtag(data);
  const filtered: Record<string, string> = {};
  for (const [k, v] of Object.entries(extraHeaders)) {
    const lk = k.toLowerCase();
    if (lk === 'etag' || lk === 'cache-control') continue;
    filtered[k] = v;
  }
  const headers = {
    ETag: etag,
    'Cache-Control': 'private, no-cache, must-revalidate',
    ...filtered,
  };
  const cacheableMethod = req.method === 'GET' || req.method === 'HEAD';
  const successStatus = status >= 200 && status < 300;
  if (cacheableMethod && successStatus && checkEtagMatch(req, etag)) {
    return new NextResponse(null, { status: 304, headers });
  }
  return NextResponse.json(data, { status, headers });
}
