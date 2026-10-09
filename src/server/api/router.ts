import 'server-only';
import { randomUUID } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { userDb, type Db } from '@/server/db/supabase';
import { env } from '@/server/env';
import { AppError } from '@/server/errors';
import { log } from '@/server/log';

export interface Ctx {
  req: NextRequest;
  params: Record<string, string>;
  query: URLSearchParams;
  requestId: string;
  ip: string;
  /** User-bound client (RLS). Only set for auth: 'user' routes. */
  db: Db;
  idempotencyKey: string | null;
  json: () => Promise<unknown>;
}

export type Handler = (ctx: Ctx) => Promise<unknown>;
export interface Route {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  auth: 'user' | 'public' | 'job';
  handler: Handler;
  /** Raw body limit for JSON in bytes (default 256KB). */
  maxBody?: number;
}

export const UUID = z.string().uuid();

/** Validate input; failures become VALIDATION with per-field messages. */
export function parse<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const r = schema.safeParse(input);
  if (!r.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of r.error.issues) {
      const key = issue.path.join('.') || '_';
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    throw new AppError('VALIDATION', '入力内容を確認してください', { fieldErrors });
  }
  return r.data;
}

export function requireIdempotencyKey(ctx: Ctx): string {
  const k = ctx.idempotencyKey;
  if (!k || !UUID.safeParse(k).success) throw new AppError('VALIDATION', 'Idempotency-Key ヘッダー(UUID)が必要です');
  return k;
}

function matchPath(pattern: string, segments: string[]): Record<string, string> | null {
  const parts = pattern.split('/').filter(Boolean);
  if (parts.length !== segments.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!;
    const s = segments[i]!;
    if (p.startsWith(':')) {
      params[p.slice(1)] = decodeURIComponent(s);
    } else if (p !== s) {
      return null;
    }
  }
  return params;
}

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}

/** Origin/Host check + custom header (forces CORS preflight; no CORS is allowed). */
export function checkCsrf(req: NextRequest) {
  const e = env();
  if (req.headers.get('x-requested-with') !== 'yorikado') throw new AppError('CSRF');
  const origin = req.headers.get('origin');
  const host = req.headers.get('host');
  if (origin) {
    if (origin === e.baseUrl.origin) return;
    if (!e.production && e.appEnv === 'demo' && host && new URL(origin).host === host) return;
    throw new AppError('CSRF');
  }
  const site = req.headers.get('sec-fetch-site');
  if (site === 'same-origin') return;
  throw new AppError('CSRF');
}

export function ok(data: unknown, requestId: string, status = 200) {
  return NextResponse.json({ data, requestId }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export function fail(err: AppError, requestId: string) {
  const fieldErrors = (err.details?.fieldErrors as Record<string, string> | undefined) ?? undefined;
  const details = err.details ? { ...err.details } : undefined;
  if (details) delete details.fieldErrors;
  return NextResponse.json(
    {
      error: {
        code: err.code,
        message: err.message,
        ...(fieldErrors ? { fieldErrors } : {}),
        ...(details && Object.keys(details).length ? { details } : {}),
        retryable: err.retryable,
      },
      requestId,
    },
    { status: err.status, headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function dispatch(routes: Route[], req: NextRequest, segments: string[]): Promise<Response> {
  const requestId = randomUUID();
  const method = req.method as Route['method'];
  let matched: { route: Route; params: Record<string, string> } | null = null;
  let pathMatched = false;
  for (const route of routes) {
    const params = matchPath(route.path, segments);
    if (!params) continue;
    pathMatched = true;
    if (route.method === method) {
      matched = { route, params };
      break;
    }
  }
  if (!matched) {
    return fail(new AppError(pathMatched ? 'VALIDATION' : 'NOT_FOUND', pathMatched ? 'メソッドが不正です' : undefined), requestId);
  }
  const { route, params } = matched;
  try {
    if (method !== 'GET' && route.auth !== 'job') checkCsrf(req);
    const max = route.maxBody ?? 256 * 1024;
    let bodyCache: unknown;
    let bodyRead = false;
    const json = async () => {
      if (bodyRead) return bodyCache;
      bodyRead = true;
      const text = await req.text();
      if (text.length > max) throw new AppError('VALIDATION', 'データが大きすぎます');
      if (!text) return (bodyCache = {});
      try {
        bodyCache = JSON.parse(text);
      } catch {
        throw new AppError('VALIDATION', 'JSONの形式が不正です');
      }
      return bodyCache;
    };
    const db = route.auth === 'user' ? await userDb(requestId) : (null as unknown as Db);
    if (route.auth === 'user') {
      const { data } = await db.auth.getClaims();
      if (!data?.claims?.sub) throw new AppError('UNAUTHENTICATED');
    }
    const ctx: Ctx = {
      req,
      params,
      query: req.nextUrl.searchParams,
      requestId,
      ip: clientIp(req),
      db,
      idempotencyKey: req.headers.get('idempotency-key'),
      json,
    };
    const result = await route.handler(ctx);
    if (result instanceof Response) return result;
    return ok(result, requestId, method === 'POST' && (result as { _status?: number })?._status === 202 ? 202 : 200);
  } catch (e) {
    if (e instanceof AppError) {
      if (e.status >= 500) log.error('api', { requestId, path: route.path, code: e.code });
      return fail(e, requestId);
    }
    log.error('api.unhandled', { requestId, path: route.path, error: e instanceof Error ? e.message : String(e) });
    return fail(new AppError('INTERNAL'), requestId);
  }
}
