import { NextResponse } from 'next/server';
import { setupState } from '@/lib/setup/state';

// A route handler rather than a server action: the client calls this
// repeatedly across a dev-server restart, and needs the requests to fail
// plainly while the server is down rather than queue.
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json(setupState());
}
