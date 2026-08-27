import { NextResponse } from 'next/server';
import { importFlexXml } from '@/lib/import';

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  }
  try {
    const result = await importFlexXml(await file.text(), 'file');
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Import failed';
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
