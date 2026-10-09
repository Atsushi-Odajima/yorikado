import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Runs before pages: per-request CSP nonce, security headers, request id, and
 * Supabase session cookie refresh (HttpOnly; tokens never reach browser JS).
 * Authorization is NOT decided here - every page/API re-checks in the DB.
 */
export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const requestId = crypto.randomUUID();
  const isDev = process.env.NODE_ENV === 'development';
  const supabase = process.env.SUPABASE_URL ?? '';
  const https = (process.env.APP_BASE_URL ?? '').startsWith('https://');
  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob: ${supabase}`,
    `media-src 'self' blob:`,
    `font-src 'self'`,
    `connect-src 'self' ${supabase}${isDev ? ' ws: wss:' : ''}`,
    `worker-src 'self'`,
    `manifest-src 'self'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    ...(https ? ['upgrade-insecure-requests'] : []),
  ].join('; ');

  const reqHeaders = new Headers(request.headers);
  reqHeaders.set('x-nonce', nonce);
  reqHeaders.set('x-request-id', requestId);
  reqHeaders.set('Content-Security-Policy', csp);

  let response = NextResponse.next({ request: { headers: reqHeaders } });

  if (supabase && process.env.SUPABASE_PUBLISHABLE_KEY) {
    const client = createServerClient(supabase, process.env.SUPABASE_PUBLISHABLE_KEY, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          for (const c of list) request.cookies.set(c.name, c.value);
          response = NextResponse.next({ request: { headers: reqHeaders } });
          for (const c of list) response.cookies.set(c.name, c.value, { ...c.options, httpOnly: true, sameSite: 'lax', secure: https, path: '/' });
        },
      },
      auth: { autoRefreshToken: false, detectSessionInUrl: false },
    });
    // Validates the JWT and refreshes an expired access token using the refresh cookie.
    await client.auth.getClaims().catch(() => undefined);
  }

  response.headers.set('Content-Security-Policy', csp);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(), payment=()');
  response.headers.set('Cache-Control', 'private, no-store');
  if (https) response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  return response;
}

export const config = {
  matcher: ['/((?!api/|_next/static|_next/image|fonts/|brand/|sw\\.js|manifest\\.webmanifest|offline\\.html|robots\\.txt).*)'],
};
