import { randomUUID } from 'node:crypto';
import pg from 'pg';

/**
 * Direct PostgreSQL access for seed scripts and integration tests. Calls the
 * same SECURITY DEFINER api_* functions PostgREST would call, with JWT claims
 * set exactly as PostgREST sets them (request.jwt.claims + role authenticated).
 * Only for local/DEMO databases.
 */
export function pool(url = process.env.DATABASE_URL): pg.Pool {
  if (!url) throw new Error('DATABASE_URL is required');
  return new pg.Pool({ connectionString: url, max: 30 });
}

export interface Identity {
  id: string;
  sessionId: string;
  aal2?: boolean;
  /** seconds since the TOTP verification (default 10). Use 9999 for "not recent". */
  mfaAgeSeconds?: number;
}

export class DbCallError extends Error {
  constructor(
    public readonly code: string,
    public readonly hint: string,
    public readonly details: Record<string, unknown> | null,
  ) {
    super(`${code}: ${hint}`);
  }
}

export async function ensureSession(p: pg.Pool, userId: string, opts: { sessionId?: string; kind?: 'merchant' | 'office'; startedAgoSeconds?: number } = {}): Promise<string> {
  const sid = opts.sessionId ?? randomUUID();
  await p.query(
    `insert into public.app_sessions (session_id, user_id, kind, started_at, absolute_expires_at)
     values ($1, $2, $3, now() - make_interval(secs => $4), now() + interval '7 days')
     on conflict (session_id) do update set revoked_at = null, absolute_expires_at = excluded.absolute_expires_at, started_at = excluded.started_at`,
    [sid, userId, opts.kind ?? 'merchant', opts.startedAgoSeconds ?? 0],
  );
  return sid;
}

function claims(who: Identity) {
  const now = Math.floor(Date.now() / 1000);
  return {
    sub: who.id,
    role: 'authenticated',
    aud: 'authenticated',
    session_id: who.sessionId,
    aal: who.aal2 ? 'aal2' : 'aal1',
    amr: who.aal2 ? [{ method: 'totp', timestamp: now - (who.mfaAgeSeconds ?? 10) }, { method: 'password', timestamp: now - 600 }] : [{ method: 'password', timestamp: now - 60 }],
    exp: now + 3600,
  };
}

/** Run fn in a transaction as the given user (role authenticated + JWT claims). */
export async function asUser<T>(p: pg.Pool, who: Identity, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await p.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('request.jwt.claims', $1, true), set_config('request.headers', '{"x-request-id":"test"}', true)`, [JSON.stringify(claims(who))]);
    await c.query('set local role authenticated');
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

/** Call public.<fn>(name => value, ...) and return its JSON result; DB errors become DbCallError. */
export async function call<T = any>(c: pg.PoolClient, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!/^api_[a-z_]+$|^svc_[a-z_]+$/.test(fn)) throw new Error('bad fn');
  const names = Object.keys(args);
  const sql = `select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) as r`;
  const values = names.map((n) => {
    const v = args[n];
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) return JSON.stringify(v);
    if (Array.isArray(v) && v.length && typeof v[0] === 'object') return JSON.stringify(v);
    return v;
  });
  try {
    const r = await c.query(sql, values);
    return r.rows[0]?.r as T;
  } catch (e) {
    const err = e as { message: string; hint?: string; detail?: string };
    let details: Record<string, unknown> | null = null;
    try {
      details = err.detail ? JSON.parse(err.detail) : null;
    } catch {
      details = null;
    }
    throw new DbCallError(err.message, err.hint ?? '', details);
  }
}

/** Convenience: one call as a user in its own transaction. */
export async function rpcAs<T = any>(p: pg.Pool, who: Identity, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  return asUser(p, who, (c) => call<T>(c, fn, args));
}
