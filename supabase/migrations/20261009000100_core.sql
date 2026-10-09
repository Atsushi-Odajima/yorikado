-- Yorikado core: tenancy, identity, sessions, rate limits, audit, outbox, notifications.
-- Money and state rules live in later migrations. All business writes go through
-- SECURITY DEFINER functions named api_* (user) or svc_* (server only).

create extension if not exists pgcrypto with schema extensions;

create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Errors: message = API error code, hint = human message, detail = JSON.
-- ---------------------------------------------------------------------------
create or replace function app.fail(p_code text, p_message text default null, p_details jsonb default null)
returns void language plpgsql volatile set search_path = '' as $$
begin
  raise exception using message = p_code, hint = coalesce(p_message, ''), detail = coalesce(p_details::text, '');
end $$;

-- ---------------------------------------------------------------------------
-- Deployment environment marker (DEMO / LIVE). Set by seed (DEMO) or by the
-- LIVE operations runbook. Never inferred from env vars alone.
-- ---------------------------------------------------------------------------
create table public.deployment_environment (
  id boolean primary key default true check (id),
  environment text not null check (environment in ('DEMO', 'LIVE')),
  updated_at timestamptz not null default now()
);

create or replace function app.environment() returns text
language sql stable security definer set search_path = '' as $$
  select environment from public.deployment_environment where id
$$;

-- ---------------------------------------------------------------------------
-- Tenants and people
-- ---------------------------------------------------------------------------
create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,50}$'),
  status text not null default 'active' check (status in ('active', 'suspended')),
  timezone text not null default 'Asia/Tokyo',
  contact text not null default '',
  office_hours text not null default '',
  reply_guidance text not null default '',
  email_notifications boolean not null default false,
  retention_policy_version text not null default 'v1-default',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  actor_id uuid
);

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete restrict,
  display_name text not null default '' check (char_length(display_name) <= 60),
  terms_accepted_at timestamptz,
  terms_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

create table public.memberships (
  tenant_id uuid not null references public.tenants (id),
  user_id uuid not null references auth.users (id) on delete restrict,
  role text not null check (role in ('office_operator', 'office_approver', 'tenant_admin', 'auditor')),
  status text not null default 'active' check (status in ('active', 'revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  actor_id uuid,
  primary key (tenant_id, user_id, role)
);
create index on public.memberships (user_id);

create table public.shops (
  tenant_id uuid not null references public.tenants (id),
  id uuid not null default gen_random_uuid() unique,
  display_name text not null check (char_length(display_name) between 1 and 100),
  legal_name text not null default '',
  address text not null default '',
  contact_phone text not null default '',
  search_name text not null default '',
  status text not null default 'active' check (status in ('active', 'suspended', 'closed')),
  external_code text check (external_code is null or external_code ~ '^[A-Za-z0-9_-]{1,40}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  actor_id uuid,
  primary key (tenant_id, id),
  unique (tenant_id, external_code)
);

create table public.shop_memberships (
  tenant_id uuid not null,
  shop_id uuid not null,
  user_id uuid not null references auth.users (id) on delete restrict,
  role text not null check (role in ('shop_staff', 'shop_owner')),
  status text not null default 'active' check (status in ('active', 'revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  actor_id uuid,
  primary key (tenant_id, shop_id, user_id, role),
  foreign key (tenant_id, shop_id) references public.shops (tenant_id, id)
);
create index on public.shop_memberships (user_id);

-- Invitations: 72h, single use. Token is stored only as SHA-256 digest.
create table public.invitations (
  tenant_id uuid not null references public.tenants (id),
  id uuid primary key default gen_random_uuid(),
  email text not null check (email ~ '^[^@\s]+@[^@\s]+$'),
  role text not null check (role in ('shop_staff', 'shop_owner', 'office_operator', 'office_approver', 'tenant_admin', 'auditor')),
  shop_id uuid,
  token_digest text not null unique,
  status text not null default 'pending' check (status in ('pending', 'used', 'revoked')),
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  check ((role in ('shop_staff', 'shop_owner')) = (shop_id is not null)),
  foreign key (tenant_id, shop_id) references public.shops (tenant_id, id)
);

-- Application sessions: absolute limits (merchant 7d / office 8h) and revocation.
create table public.app_sessions (
  session_id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('merchant', 'office')),
  started_at timestamptz not null default now(),
  absolute_expires_at timestamptz not null,
  revoked_at timestamptz,
  user_agent text not null default ''
);
create index on public.app_sessions (user_id);

-- Shared rate limiter (fixed window), usable from every server instance.
create table public.rate_limits (
  bucket text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (bucket, window_start)
);

-- Display number counters per tenant (gaps are acceptable; never back-filled).
create table public.counters (
  tenant_id uuid not null references public.tenants (id),
  kind text not null,
  value bigint not null default 0,
  primary key (tenant_id, kind)
);

-- Idempotency for non-monetary creates.
create table public.idempotency_keys (
  actor_id uuid not null,
  idem_key uuid not null,
  tenant_id uuid,
  kind text not null,
  request_hash text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (actor_id, idem_key)
);

-- Audit (append-only; no update/delete grants to any API role).
create table public.audit_events (
  tenant_id uuid references public.tenants (id),
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  acting_for_shop_id uuid,
  action text not null,
  entity text not null,
  entity_id uuid,
  before_summary jsonb,
  after_summary jsonb,
  request_id text,
  occurred_at timestamptz not null default now()
);
create index on public.audit_events (tenant_id, occurred_at desc);

-- Transactional outbox. dedupe_key prevents duplicate sends.
create table public.outbox (
  tenant_id uuid references public.tenants (id),
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  entity_id uuid,
  recipient_id uuid,
  dedupe_key text not null unique,
  payload jsonb not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'skipped', 'failed')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_until timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.outbox (status, next_attempt_at);

create table public.notifications (
  tenant_id uuid not null references public.tenants (id),
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null,
  entity_type text not null default '',
  entity_id uuid,
  title text not null,
  link text not null default '',
  dedupe_key text unique,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.notifications (recipient_id, created_at desc);

-- Mail sink for development / tests (MAIL_PROVIDER=sink). Never used in LIVE.
create table public.mail_sink (
  id uuid primary key default gen_random_uuid(),
  to_address text not null,
  subject text not null,
  body text not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function app.request_id() returns text
language sql stable set search_path = '' as $$
  select coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-request-id', '')
$$;

create or replace function app.session_valid() returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.app_sessions s
    where s.session_id = nullif(auth.jwt() ->> 'session_id', '')::uuid
      and s.user_id = auth.uid()
      and s.revoked_at is null
      and s.absolute_expires_at > now()
  )
$$;

create or replace function app.uid() returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.session_valid() then
    perform app.fail('UNAUTHENTICATED', 'ログインが必要です');
  end if;
  return auth.uid();
end $$;

create or replace function app.mfa_aal2() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
$$;

create or replace function app.mfa_recent(p_seconds integer default 300) returns boolean
language sql stable set search_path = '' as $$
  select app.mfa_aal2() and exists (
    select 1 from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) e
    where e ->> 'method' = 'totp'
      and (e ->> 'timestamp')::bigint >= extract(epoch from now())::bigint - p_seconds
  )
$$;

create or replace function app.office_roles(p_tenant uuid) returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(m.role order by m.role), '{}')
  from public.memberships m
  where m.tenant_id = p_tenant and m.user_id = auth.uid() and m.status = 'active'
$$;

create or replace function app.is_office(p_tenant uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.session_valid() and exists (
    select 1 from public.memberships m
    where m.tenant_id = p_tenant and m.user_id = auth.uid() and m.status = 'active'
  )
$$;

create or replace function app.has_office_role(p_tenant uuid, p_roles text[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.session_valid() and exists (
    select 1 from public.memberships m
    where m.tenant_id = p_tenant and m.user_id = auth.uid() and m.status = 'active' and m.role = any (p_roles)
  )
$$;

create or replace function app.is_shop_member(p_shop uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.session_valid() and exists (
    select 1 from public.shop_memberships sm
    where sm.shop_id = p_shop and sm.user_id = auth.uid() and sm.status = 'active'
  )
$$;

create or replace function app.is_shop_owner(p_shop uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.session_valid() and exists (
    select 1 from public.shop_memberships sm
    where sm.shop_id = p_shop and sm.user_id = auth.uid() and sm.status = 'active' and sm.role = 'shop_owner'
  )
$$;

create or replace function app.can_read_shop(p_tenant uuid, p_shop uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_shop_member(p_shop) or app.is_office(p_tenant)
$$;

create or replace function app.is_tenant_visible(p_tenant uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_office(p_tenant) or (app.session_valid() and exists (
    select 1 from public.shop_memberships sm
    where sm.tenant_id = p_tenant and sm.user_id = auth.uid() and sm.status = 'active'))
$$;

-- Require an office role. Users without any membership in the tenant get
-- NOT_FOUND (do not reveal existence). Office work always needs aal2 and a
-- session started within 8h.
create or replace function app.require_office(p_tenant uuid, p_roles text[], p_recent_mfa boolean default false)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := app.uid();
  v_status text;
begin
  if not exists (select 1 from public.memberships m where m.tenant_id = p_tenant and m.user_id = v_uid and m.status = 'active') then
    perform app.fail('NOT_FOUND');
  end if;
  if not exists (select 1 from public.memberships m where m.tenant_id = p_tenant and m.user_id = v_uid and m.status = 'active' and m.role = any (p_roles)) then
    perform app.fail('FORBIDDEN', 'この操作の権限がありません');
  end if;
  if not exists (select 1 from public.app_sessions s where s.session_id = (auth.jwt() ->> 'session_id')::uuid and s.started_at > now() - interval '8 hours') then
    perform app.fail('UNAUTHENTICATED', '事務局の操作は8時間ごとに再ログインが必要です');
  end if;
  if not app.mfa_aal2() then
    perform app.fail('MFA_REQUIRED', '二段階認証が必要です', '{"recent":false}');
  end if;
  if p_recent_mfa and not app.mfa_recent() then
    perform app.fail('MFA_REQUIRED', '確認のため認証コードを入力してください', '{"recent":true}');
  end if;
  select status into v_status from public.tenants where id = p_tenant;
  if v_status <> 'active' and not ('tenant_admin' = any (p_roles) and array_length(p_roles, 1) = 1) then
    perform app.fail('FORBIDDEN', '組織の利用が停止されています');
  end if;
  return v_uid;
end $$;

-- Require a shop membership. Returns the tenant id of the shop.
create or replace function app.require_shop(p_shop uuid, p_roles text[] default array['shop_staff', 'shop_owner'])
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := app.uid();
  v_tenant uuid;
  v_shop_status text;
  v_tenant_status text;
begin
  select s.tenant_id, s.status, t.status into v_tenant, v_shop_status, v_tenant_status
  from public.shops s join public.tenants t on t.id = s.tenant_id
  where s.id = p_shop;
  if v_tenant is null or not exists (
    select 1 from public.shop_memberships sm where sm.shop_id = p_shop and sm.user_id = v_uid and sm.status = 'active'
  ) then
    perform app.fail('NOT_FOUND');
  end if;
  if not exists (
    select 1 from public.shop_memberships sm where sm.shop_id = p_shop and sm.user_id = v_uid and sm.status = 'active' and sm.role = any (p_roles)
  ) then
    perform app.fail('FORBIDDEN', 'この操作は店主のみ行えます');
  end if;
  if v_tenant_status <> 'active' then
    perform app.fail('FORBIDDEN', '商店街の利用が停止されています。事務局へお問い合わせください');
  end if;
  if v_shop_status <> 'active' then
    perform app.fail('FORBIDDEN', 'この店舗は現在利用できません');
  end if;
  return v_tenant;
end $$;

create or replace function app.audit(
  p_tenant uuid, p_action text, p_entity text, p_entity_id uuid,
  p_before jsonb default null, p_after jsonb default null, p_shop uuid default null
) returns void language sql security definer set search_path = '' as $$
  insert into public.audit_events (tenant_id, actor_id, acting_for_shop_id, action, entity, entity_id, before_summary, after_summary, request_id)
  values (p_tenant, auth.uid(), p_shop, p_action, p_entity, p_entity_id, p_before, p_after, app.request_id());
$$;

create or replace function app.next_number(p_tenant uuid, p_kind text) returns bigint
language sql security definer set search_path = '' as $$
  insert into public.counters as c (tenant_id, kind, value) values (p_tenant, p_kind, 1)
  on conflict (tenant_id, kind) do update set value = c.value + 1
  returning value
$$;

create or replace function app.enqueue(
  p_tenant uuid, p_kind text, p_entity uuid, p_recipient uuid, p_dedupe text, p_payload jsonb default '{}'
) returns void language sql security definer set search_path = '' as $$
  insert into public.outbox (tenant_id, kind, entity_id, recipient_id, dedupe_key, payload)
  values (p_tenant, p_kind, p_entity, p_recipient, p_dedupe, p_payload)
  on conflict (dedupe_key) do nothing;
$$;

-- Notify every active member of a shop (in-app; email decided by job runner).
create or replace function app.notify_shop(p_tenant uuid, p_shop uuid, p_title text, p_link text, p_entity_type text, p_entity uuid, p_dedupe text)
returns void language sql security definer set search_path = '' as $$
  insert into public.outbox (tenant_id, kind, entity_id, recipient_id, dedupe_key, payload)
  select distinct p_tenant, 'notification', p_entity, sm.user_id, p_dedupe || ':' || sm.user_id,
         jsonb_build_object('title', p_title, 'link', p_link, 'entityType', p_entity_type)
  from public.shop_memberships sm
  where sm.shop_id = p_shop and sm.status = 'active'
  on conflict (dedupe_key) do nothing;
$$;

create or replace function app.notify_office(p_tenant uuid, p_roles text[], p_title text, p_link text, p_entity_type text, p_entity uuid, p_dedupe text)
returns void language sql security definer set search_path = '' as $$
  insert into public.outbox (tenant_id, kind, entity_id, recipient_id, dedupe_key, payload)
  select distinct p_tenant, 'notification', p_entity, m.user_id, p_dedupe || ':' || m.user_id,
         jsonb_build_object('title', p_title, 'link', p_link, 'entityType', p_entity_type)
  from public.memberships m
  where m.tenant_id = p_tenant and m.status = 'active' and m.role = any (p_roles)
  on conflict (dedupe_key) do nothing;
$$;

-- Idempotency: returns the stored result for (actor,key) or null; raises
-- CONFLICT when the same key is reused with a different payload.
create or replace function app.idem_lookup(p_actor uuid, p_key uuid, p_kind text, p_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if p_key is null then
    perform app.fail('VALIDATION', 'Idempotency-Key が必要です');
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor::text || ':' || p_key::text, 0));
  select * into r from public.idempotency_keys where actor_id = p_actor and idem_key = p_key;
  if not found then
    return null;
  end if;
  if r.kind <> p_kind or r.request_hash <> p_hash then
    perform app.fail('CONFLICT', '同じ受付キーで異なる内容が送信されました', '{"reason":"IDEMPOTENCY_MISMATCH"}');
  end if;
  return r.result;
end $$;

create or replace function app.idem_store(p_actor uuid, p_key uuid, p_tenant uuid, p_kind text, p_hash text, p_result jsonb)
returns jsonb language sql security definer set search_path = '' as $$
  insert into public.idempotency_keys (actor_id, idem_key, tenant_id, kind, request_hash, result)
  values (p_actor, p_key, p_tenant, p_kind, p_hash, p_result);
  select p_result;
$$;

create or replace function app.hash_json(p jsonb) returns text
language sql immutable set search_path = '' as $$
  select encode(extensions.digest(convert_to(p::text, 'UTF8'), 'sha256'), 'hex')
$$;

create or replace function app.jst_date(p timestamptz) returns date
language sql immutable set search_path = '' as $$
  select (p at time zone 'Asia/Tokyo')::date
$$;

create or replace function app.touch() returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Session / identity API
-- ---------------------------------------------------------------------------
create or replace function public.api_session_start(p_user_agent text default '') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_sid uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  v_office boolean;
  v_row public.app_sessions;
begin
  if v_uid is null or v_sid is null then
    perform app.fail('UNAUTHENTICATED');
  end if;
  v_office := exists (select 1 from public.memberships m where m.user_id = v_uid and m.status = 'active');
  insert into public.app_sessions (session_id, user_id, kind, absolute_expires_at, user_agent)
  values (v_sid, v_uid, case when v_office then 'office' else 'merchant' end,
          now() + case when v_office then interval '8 hours' else interval '7 days' end,
          left(coalesce(p_user_agent, ''), 300))
  on conflict (session_id) do nothing;
  select * into v_row from public.app_sessions where session_id = v_sid;
  if v_row.user_id <> v_uid then
    perform app.fail('UNAUTHENTICATED');
  end if;
  insert into public.profiles (user_id) values (v_uid) on conflict do nothing;
  return jsonb_build_object('kind', v_row.kind, 'absoluteExpiresAt', v_row.absolute_expires_at,
                            'revoked', v_row.revoked_at is not null);
end $$;

-- Revoke every session of the caller (lost device / full logout).
create or replace function public.api_session_revoke_all() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_n integer;
begin
  if v_uid is null then perform app.fail('UNAUTHENTICATED'); end if;
  update public.app_sessions set revoked_at = now() where user_id = v_uid and revoked_at is null;
  get diagnostics v_n = row_count;
  insert into public.audit_events (tenant_id, actor_id, action, entity, entity_id, after_summary, request_id)
  values (null, v_uid, 'session.revoke_all', 'user', v_uid, jsonb_build_object('sessions', v_n), app.request_id());
  return jsonb_build_object('revoked', v_n);
end $$;

create or replace function public.api_me() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := app.uid();
begin
  return jsonb_build_object(
    'userId', v_uid,
    'environment', app.environment(),
    'aal', auth.jwt() ->> 'aal',
    'profile', (select jsonb_build_object('displayName', p.display_name, 'termsAcceptedAt', p.terms_accepted_at)
                from public.profiles p where p.user_id = v_uid),
    'session', (select jsonb_build_object('kind', s.kind, 'absoluteExpiresAt', s.absolute_expires_at)
                from public.app_sessions s where s.session_id = (auth.jwt() ->> 'session_id')::uuid),
    'offices', coalesce((
      select jsonb_agg(jsonb_build_object('tenantId', t.id, 'tenantName', t.name, 'tenantStatus', t.status, 'roles', x.roles) order by t.name)
      from (select m.tenant_id, array_agg(m.role order by m.role) roles from public.memberships m
            where m.user_id = v_uid and m.status = 'active' group by m.tenant_id) x
      join public.tenants t on t.id = x.tenant_id), '[]'),
    'shops', coalesce((
      select jsonb_agg(jsonb_build_object('shopId', s.id, 'shopName', s.display_name, 'shopStatus', s.status,
                                          'tenantId', t.id, 'tenantName', t.name, 'tenantStatus', t.status,
                                          'tenantContact', t.contact, 'roles', x.roles) order by t.name, s.display_name)
      from (select sm.shop_id, array_agg(sm.role order by sm.role) roles from public.shop_memberships sm
            where sm.user_id = v_uid and sm.status = 'active' group by sm.shop_id) x
      join public.shops s on s.id = x.shop_id join public.tenants t on t.id = s.tenant_id), '[]')
  );
end $$;

create or replace function public.api_profile_update(p_display_name text, p_accept_terms_version text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := app.uid();
begin
  if p_display_name is null or char_length(btrim(p_display_name)) not between 1 and 60 then
    perform app.fail('VALIDATION', '表示名は1〜60文字で入力してください', '{"fieldErrors":{"displayName":"1〜60文字"}}');
  end if;
  insert into public.profiles (user_id, display_name) values (v_uid, btrim(p_display_name))
  on conflict (user_id) do update set display_name = excluded.display_name, updated_at = now(), version = public.profiles.version + 1;
  if p_accept_terms_version is not null then
    update public.profiles set terms_accepted_at = now(), terms_version = p_accept_terms_version where user_id = v_uid;
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.api_notifications_list(p_limit integer default 30) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'title', n.title, 'link', n.link, 'readAt', n.read_at,
                                               'createdAt', n.created_at) order by n.created_at desc), '[]')
  from (select * from public.notifications where recipient_id = app.uid() order by created_at desc limit least(greatest(p_limit, 1), 100)) n
$$;

create or replace function public.api_notification_read(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  update public.notifications set read_at = coalesce(read_at, now()) where id = p_id and recipient_id = app.uid();
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- Server-only: rate limit, environment
-- ---------------------------------------------------------------------------
create or replace function public.svc_rate_limit_hit(p_bucket text, p_limit integer, p_window_seconds integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_start timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits integer;
begin
  insert into public.rate_limits as r (bucket, window_start, hits) values (p_bucket, v_start, 1)
  on conflict (bucket, window_start) do update set hits = r.hits + 1
  returning hits into v_hits;
  if random() < 0.01 then
    delete from public.rate_limits where window_start < now() - interval '1 day';
  end if;
  return jsonb_build_object('allowed', v_hits <= p_limit, 'hits', v_hits,
                            'retryAfter', ceil(extract(epoch from (v_start + make_interval(secs => p_window_seconds) - now()))));
end $$;

create or replace function public.svc_environment() returns text
language sql stable security definer set search_path = '' as $$ select app.environment() $$;

-- Lock down function privileges. Re-run at the end of every migration.
create or replace function app.lock_down_functions() returns void language plpgsql set search_path = '' as $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig, n.nspname, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'app') and p.prokind = 'f'
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    if r.nspname = 'app' then
      execute format('grant execute on function %s to authenticated, service_role', r.sig);
    elsif r.proname like 'api\_%' then
      execute format('grant execute on function %s to authenticated, service_role', r.sig);
    elsif r.proname like 'svc\_%' then
      execute format('revoke all on function %s from authenticated', r.sig);
      execute format('grant execute on function %s to service_role', r.sig);
    else
      execute format('revoke all on function %s from authenticated', r.sig);
    end if;
  end loop;
end $$;

select app.lock_down_functions();
