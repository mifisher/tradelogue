import fs from 'fs/promises';
import path from 'path';
import { NextResponse } from 'next/server';

const UPLOADS_DIR = path.join(process.cwd(), 'uploads');

const EXT_TO_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

interface RouteContext {
  params: Promise<{ name: string }>;
}

export async function GET(_req: Request, { params }: RouteContext) {
  // Next.js 15+ async params
  const { name } = await params;

  // Security: validate filename — no path traversal, no ".." components
  if (!/^[\w.-]+$/.test(name) || name.includes('..')) {
    return new NextResponse('Not Found', { status: 404 });
  }

  const filePath = path.join(UPLOADS_DIR, name);

  let arrayBuffer: ArrayBuffer;
  try {
    const buf = await fs.readFile(filePath);
    arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  } catch {
    return new NextResponse('Not Found', { status: 404 });
  }

  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const contentType = EXT_TO_MIME[ext] ?? 'application/octet-stream';

  return new NextResponse(arrayBuffer, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'private, max-age=31536000, immutable',
    },
  });
}
