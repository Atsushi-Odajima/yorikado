import 'server-only';
import { z } from 'zod';
import { sha256Hex } from '@/domain/identity/crypto';
import { adminDb, requireUser, rpc, userDb } from '@/server/db/supabase';
import { env } from '@/server/env';
import { AppError } from '@/server/errors';
import { accountBucket, enforce, LIMITS } from '@/server/ratelimit';
import { parse, type Route } from '../router';

const Email = z.string().trim().toLowerCase().email('メールアドレスの形式を確認してください').max(254);
const Password = z.string().min(10, 'パスワードは10文字以上にしてください').max(128);

export const TERMS_VERSION = 'v1-draft-2026-10';

async function nextPath(db: Awaited<ReturnType<typeof userDb>>): Promise<string> {
  const me = await rpc<{
    offices: unknown[];
    shops: unknown[];
    aal: string;
    profile: { displayName: string; termsAcceptedAt: string | null } | null;
  }>(db, 'api_me');
  if (!me.profile?.termsAcceptedAt || !me.profile.displayName) return '/welcome';
  if (me.offices.length > 0 && me.aal !== 'aal2') return '/mfa';
  if (me.shops.length > 0) return me.shops.length > 1 ? '/m/shops' : '/m';
  if (me.offices.length > 0) return '/o';
  return '/login?no_access=1';
}

function maskEmail(email: string): string {
  const [u, d] = email.split('@');
  if (!u || !d) return '***';
  return `${u.slice(0, 2)}***@${d}`;
}

export const authRoutes: Route[] = [
  {
    method: 'POST',
    path: '/auth/login',
    auth: 'public',
    handler: async (ctx) => {
      const body = parse(z.object({ email: Email, password: z.string().min(1).max(128) }), await ctx.json());
      await enforce('login:ip:' + ctx.ip, LIMITS.loginIp);
      await enforce(accountBucket(body.email), LIMITS.loginAccount);
      const db = await userDb(ctx.requestId);
      const { error } = await db.auth.signInWithPassword({ email: body.email, password: body.password });
      if (error) throw new AppError('UNAUTHENTICATED', 'メールアドレスまたはパスワードが違います');
      await rpc(db, 'api_session_start', { p_user_agent: ctx.req.headers.get('user-agent') ?? '' });
      return { next: await nextPath(db) };
    },
  },
  {
    method: 'POST',
    path: '/auth/logout',
    auth: 'public',
    handler: async (ctx) => {
      const body = parse(z.object({ scope: z.enum(['local', 'global']).default('local') }), await ctx.json());
      const db = await userDb(ctx.requestId);
      const { data } = await db.auth.getClaims();
      if (data?.claims) {
        if (body.scope === 'global') await rpc(db, 'api_session_revoke_all').catch(() => undefined);
        else await rpc(db, 'api_session_revoke_current').catch(() => undefined);
      }
      await db.auth.signOut({ scope: body.scope });
      return { next: '/login' };
    },
  },
  {
    method: 'POST',
    path: '/auth/recover',
    auth: 'public',
    handler: async (ctx) => {
      const body = parse(z.object({ email: Email }), await ctx.json());
      await enforce('recover:ip:' + ctx.ip, LIMITS.recover);
      await enforce('recover:' + accountBucket(body.email), LIMITS.recover);
      const db = await userDb(ctx.requestId);
      // Same response whether or not the account exists.
      await db.auth.resetPasswordForEmail(body.email, { redirectTo: new URL('/auth/reset', env().baseUrl).toString() }).catch(() => undefined);
      return { sent: true };
    },
  },
  {
    method: 'POST',
    path: '/auth/password',
    auth: 'user',
    handler: async (ctx) => {
      const body = parse(z.object({ password: Password }), await ctx.json());
      await requireUser(ctx.db);
      const { error } = await ctx.db.auth.updateUser({ password: body.password });
      if (error) throw new AppError('VALIDATION', 'このパスワードは使えません。別のものにしてください');
      await ctx.db.auth.signOut({ scope: 'others' }).catch(() => undefined);
      await rpc(ctx.db, 'api_session_start', { p_user_agent: ctx.req.headers.get('user-agent') ?? '' });
      return { next: await nextPath(ctx.db) };
    },
  },
  {
    method: 'GET',
    path: '/auth/mfa',
    auth: 'user',
    handler: async (ctx) => {
      await requireUser(ctx.db);
      const { data: factors } = await ctx.db.auth.mfa.listFactors();
      const { data: aal } = await ctx.db.auth.mfa.getAuthenticatorAssuranceLevel();
      return {
        currentLevel: aal?.currentLevel ?? null,
        nextLevel: aal?.nextLevel ?? null,
        factors: (factors?.all ?? []).filter((f) => f.factor_type === 'totp').map((f) => ({ id: f.id, status: f.status, friendlyName: f.friendly_name })),
      };
    },
  },
  {
    method: 'POST',
    path: '/auth/mfa/enroll',
    auth: 'user',
    handler: async (ctx) => {
      await requireUser(ctx.db);
      const { data: factors } = await ctx.db.auth.mfa.listFactors();
      for (const f of factors?.all ?? []) {
        if (f.factor_type === 'totp' && f.status === 'unverified') await ctx.db.auth.mfa.unenroll({ factorId: f.id });
      }
      if ((factors?.totp ?? []).some((f) => f.status === 'verified')) {
        throw new AppError('CONFLICT', '認証アプリは登録済みです');
      }
      const { data, error } = await ctx.db.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Yorikado ' + new Date().toISOString().slice(0, 10), issuer: 'Yorikado' });
      if (error || !data) throw new AppError('SERVICE_UNAVAILABLE', '二段階認証の登録を開始できませんでした');
      return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
    },
  },
  {
    method: 'POST',
    path: '/auth/mfa/verify',
    auth: 'user',
    handler: async (ctx) => {
      const body = parse(z.object({ factorId: z.string().uuid().optional(), code: z.string().regex(/^\d{6}$/, '6桁の数字を入力してください') }), await ctx.json());
      const user = await requireUser(ctx.db);
      await enforce('mfa:' + user.id, { limit: 10, window: 15 * 60 });
      let factorId = body.factorId;
      if (!factorId) {
        const { data } = await ctx.db.auth.mfa.listFactors();
        factorId = data?.totp.find((f) => f.status === 'verified')?.id;
      }
      if (!factorId) throw new AppError('VALIDATION', '認証アプリが登録されていません');
      const { error } = await ctx.db.auth.mfa.challengeAndVerify({ factorId, code: body.code });
      if (error) throw new AppError('VALIDATION', 'コードが違うか期限切れです', { fieldErrors: { code: 'もう一度入力してください' } });
      await rpc(ctx.db, 'api_session_start', { p_user_agent: ctx.req.headers.get('user-agent') ?? '' });
      return { verified: true, next: await nextPath(ctx.db) };
    },
  },
  {
    method: 'POST',
    path: '/invitations/lookup',
    auth: 'public',
    handler: async (ctx) => {
      const body = parse(z.object({ token: z.string().min(20).max(100) }), await ctx.json());
      await enforce('invite:ip:' + ctx.ip, LIMITS.invitation);
      const inv = await rpc<null | { email: string; role: string; tenantName: string; shopName: string | null; state: string; userExists: boolean }>(
        adminDb(),
        'svc_invitation_lookup',
        { p_token_digest: sha256Hex(body.token) },
      );
      if (!inv) throw new AppError('NOT_FOUND', '招待が見つかりません。事務局へ再発行を依頼してください');
      return { state: inv.state, tenantName: inv.tenantName, shopName: inv.shopName, role: inv.role, email: maskEmail(inv.email), userExists: inv.userExists };
    },
  },
  {
    method: 'POST',
    path: '/invitations/accept',
    auth: 'public',
    handler: async (ctx) => {
      const body = parse(
        z.object({
          token: z.string().min(20).max(100),
          password: Password.optional(),
          displayName: z.string().trim().min(1, '表示名を入力してください').max(60),
          acceptTerms: z.literal(true, { message: '利用条件への同意が必要です' }),
        }),
        await ctx.json(),
      );
      await enforce('invite:ip:' + ctx.ip, LIMITS.invitation);
      const digest = sha256Hex(body.token);
      const admin = adminDb();
      const inv = await rpc<null | { email: string; state: string; userExists: boolean }>(admin, 'svc_invitation_lookup', { p_token_digest: digest });
      if (!inv) throw new AppError('NOT_FOUND', '招待が見つかりません');
      if (inv.state === 'expired') throw new AppError('EXPIRED', '招待の有効期限(72時間)が切れています。事務局へ再発行を依頼してください');
      if (inv.state !== 'pending') throw new AppError('CONFLICT', 'この招待は使用済みか取り消されています');
      const db = await userDb(ctx.requestId);
      let userId: string;
      if (!inv.userExists) {
        if (!body.password) throw new AppError('VALIDATION', 'パスワードを設定してください', { fieldErrors: { password: '10文字以上' } });
        const created = await admin.auth.admin.createUser({ email: inv.email, password: body.password, email_confirm: true });
        if (created.error || !created.data.user) throw new AppError('CONFLICT', 'アカウントを作成できませんでした。事務局へご連絡ください');
        userId = created.data.user.id;
        const s = await db.auth.signInWithPassword({ email: inv.email, password: body.password });
        if (s.error) throw new AppError('SERVICE_UNAVAILABLE');
      } else {
        const { data } = await db.auth.getClaims();
        const email = (data?.claims as { email?: string } | undefined)?.email?.toLowerCase();
        if (!data?.claims || email !== inv.email) {
          throw new AppError('UNAUTHENTICATED', '既にアカウントがあります。招待されたメールアドレスでログインしてから、もう一度このリンクを開いてください');
        }
        userId = String(data.claims.sub);
      }
      await rpc(admin, 'svc_invitation_accept', { p_token_digest: digest, p_user: userId });
      await rpc(db, 'api_session_start', { p_user_agent: ctx.req.headers.get('user-agent') ?? '' });
      await rpc(db, 'api_profile_update', { p_display_name: body.displayName, p_accept_terms_version: TERMS_VERSION });
      return { next: await nextPath(db) };
    },
  },
  {
    method: 'PUT',
    path: '/profile',
    auth: 'user',
    handler: async (ctx) => {
      const body = parse(z.object({ displayName: z.string().trim().min(1).max(60), acceptTerms: z.boolean().optional() }), await ctx.json());
      await rpc(ctx.db, 'api_profile_update', { p_display_name: body.displayName, p_accept_terms_version: body.acceptTerms ? TERMS_VERSION : null });
      return { next: await nextPath(ctx.db) };
    },
  },
  {
    method: 'GET',
    path: '/me',
    auth: 'user',
    handler: async (ctx) => rpc(ctx.db, 'api_me'),
  },
];
