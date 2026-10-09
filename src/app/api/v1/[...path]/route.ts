import type { NextRequest } from 'next/server';
import { dispatch } from '@/server/api/router';
import { routes } from '@/server/api/routes';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Params = { params: Promise<{ path: string[] }> };

async function handle(req: NextRequest, { params }: Params) {
  const { path } = await params;
  return dispatch(routes, req, path);
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
