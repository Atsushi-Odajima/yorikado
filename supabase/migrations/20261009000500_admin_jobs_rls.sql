-- Shops/invitations/memberships admin, office queue, merchant home & history,
-- audit, tenant export, job runner functions, RLS policies, grants, storage.

create table public.tenant_exports (
  tenant_id uuid not null references public.tenants (id),
  id uuid primary key default gen_random_uuid(),
  requested_by uuid not null,
  masked boolean not null default true,
  status text not null default 'queued' check (status in ('queued', 'ready', 'failed', 'expired')),
  object_path text,
  sha256 text,
  expires_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

-- ---------------------------------------------------------------------------
-- Shops
-- ---------------------------------------------------------------------------
create or replace function app.shop_json(s public.shops) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', s.id, 'tenantId', s.tenant_id, 'displayName', s.display_name, 'legalName', s.legal_name,
    'address', s.address, 'contactPhone', s.contact_phone, 'status', s.status, 'externalCode', s.external_code, 'version', s.version)
$$;

create or replace function public.api_shop_create(
  p_tenant uuid, p_display_name text, p_legal_name text, p_address text, p_contact_phone text, p_external_code text, p_idem uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_office(p_tenant, array['office_operator', 'tenant_admin']); v_prev jsonb; v_s public.shops;
  v_hash text := app.hash_json(jsonb_build_object('n', p_display_name, 'l', p_legal_name, 'a', p_address, 'p', p_contact_phone, 'c', p_external_code));
begin
  v_prev := app.idem_lookup(v_uid, p_idem, 'shop.create', v_hash);
  if v_prev is not null then return v_prev; end if;
  if coalesce(btrim(p_display_name), '') = '' then perform app.fail('VALIDATION', '店名を入力してください', '{"fieldErrors":{"displayName":"必須"}}'); end if;
  if p_external_code is not null and p_external_code <> '' and exists (select 1 from public.shops where tenant_id = p_tenant and external_code = p_external_code) then
    perform app.fail('CONFLICT', 'この店舗コードは使われています', '{"fieldErrors":{"externalCode":"重複"}}');
  end if;
  insert into public.shops (tenant_id, display_name, legal_name, address, contact_phone, external_code, search_name, actor_id)
  values (p_tenant, btrim(p_display_name), coalesce(p_legal_name, ''), coalesce(p_address, ''), coalesce(p_contact_phone, ''),
          nullif(btrim(coalesce(p_external_code, '')), ''), lower(normalize(regexp_replace(p_display_name, '\s+', '', 'g'), NFKC)), v_uid)
  returning * into v_s;
  perform app.audit(p_tenant, 'shop.create', 'shop', v_s.id, null, app.shop_json(v_s));
  return app.idem_store(v_uid, p_idem, p_tenant, 'shop.create', v_hash, app.shop_json(v_s));
end $$;

create or replace function public.api_shop_update(
  p_shop uuid, p_expected_version integer, p_display_name text, p_legal_name text, p_address text, p_contact_phone text,
  p_external_code text, p_status text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_s public.shops; v_uid uuid; v_before jsonb;
begin
  select * into v_s from public.shops where id = p_shop for update;
  if not found then perform app.fail('NOT_FOUND'); end if;
  v_uid := app.require_office(v_s.tenant_id, array['office_operator', 'tenant_admin']);
  if v_s.version <> p_expected_version then perform app.fail('CONFLICT', '他の担当者が更新しました。再読み込みしてください'); end if;
  if p_status not in ('active', 'suspended', 'closed') then perform app.fail('VALIDATION', '状態が不正です'); end if;
  v_before := app.shop_json(v_s);
  update public.shops set display_name = btrim(p_display_name), legal_name = coalesce(p_legal_name, ''), address = coalesce(p_address, ''),
    contact_phone = coalesce(p_contact_phone, ''), external_code = nullif(btrim(coalesce(p_external_code, '')), ''), status = p_status,
    search_name = lower(normalize(regexp_replace(p_display_name, '\s+', '', 'g'), NFKC)),
    version = version + 1, updated_at = now(), actor_id = v_uid
  where id = p_shop returning * into v_s;
  perform app.audit(v_s.tenant_id, 'shop.update', 'shop', v_s.id, v_before, app.shop_json(v_s));
  return app.shop_json(v_s);
end $$;

create or replace function public.api_shop_get(p_shop uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_s public.shops;
begin
  select * into v_s from public.shops where id = p_shop;
  if not found or not app.is_office(v_s.tenant_id) then perform app.fail('NOT_FOUND'); end if;
  return app.shop_json(v_s) || jsonb_build_object(
    'members', coalesce((select jsonb_agg(jsonb_build_object('userId', sm.user_id, 'role', sm.role, 'status', sm.status,
        'displayName', p.display_name, 'email', u.email) order by sm.role, p.display_name)
      from public.shop_memberships sm left join public.profiles p on p.user_id = sm.user_id left join auth.users u on u.id = sm.user_id
      where sm.shop_id = p_shop), '[]'),
    'invitations', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'email', i.email, 'role', i.role, 'status', i.status,
        'expiresAt', i.expires_at, 'createdAt', i.created_at) order by i.created_at desc)
      from public.invitations i where i.shop_id = p_shop), '[]'),
    'bankAccounts', public.api_bank_accounts_for_shop(p_shop));
end $$;

-- ---------------------------------------------------------------------------
-- Invitations (72h, single use). Token digest computed by the server.
-- Shop owners may *request* staff invitations; office issues them.
-- ---------------------------------------------------------------------------
create or replace function public.api_invitation_create(
  p_tenant uuid, p_email text, p_role text, p_shop uuid, p_token_digest text, p_token_enc text, p_idem uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid; v_prev jsonb; v_id uuid;
  v_hash text := app.hash_json(jsonb_build_object('t', p_tenant, 'e', lower(p_email), 'r', p_role, 's', p_shop));
begin
  if p_role in ('shop_staff', 'shop_owner') then
    v_uid := app.require_office(p_tenant, array['office_operator', 'tenant_admin']);
    if p_shop is null or not exists (select 1 from public.shops where id = p_shop and tenant_id = p_tenant) then
      perform app.fail('VALIDATION', '店舗を選んでください');
    end if;
  else
    v_uid := app.require_office(p_tenant, array['tenant_admin'], true);
    if p_shop is not null then perform app.fail('VALIDATION', '事務局の招待に店舗は指定しません'); end if;
  end if;
  v_prev := app.idem_lookup(v_uid, p_idem, 'invitation.create', v_hash);
  if v_prev is not null then return v_prev; end if;
  if lower(p_email) = (select lower(email) from auth.users where id = v_uid) and p_role not in ('shop_staff', 'shop_owner') then
    perform app.fail('FORBIDDEN', '自分自身に事務局の権限を付与することはできません');
  end if;
  update public.invitations set status = 'revoked' where tenant_id = p_tenant and lower(email) = lower(p_email) and role = p_role
    and shop_id is not distinct from p_shop and status = 'pending';
  insert into public.invitations (tenant_id, email, role, shop_id, token_digest, expires_at, created_by)
  values (p_tenant, lower(btrim(p_email)), p_role, p_shop, p_token_digest, now() + interval '72 hours', v_uid) returning id into v_id;
  perform app.enqueue(p_tenant, 'invite_email', v_id, null, 'invite:' || v_id, jsonb_build_object('tokenEnc', p_token_enc, 'email', lower(btrim(p_email))));
  perform app.audit(p_tenant, 'invitation.create', 'invitation', v_id, null, jsonb_build_object('role', p_role, 'shopId', p_shop), p_shop);
  return app.idem_store(v_uid, p_idem, p_tenant, 'invitation.create', v_hash,
                        jsonb_build_object('id', v_id, 'status', 'pending', 'expiresAt', now() + interval '72 hours'));
end $$;

create or replace function public.api_invitation_revoke(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_i public.invitations; v_uid uuid;
begin
  select * into v_i from public.invitations where id = p_id for update;
  if not found then perform app.fail('NOT_FOUND'); end if;
  v_uid := app.require_office(v_i.tenant_id, array['office_operator', 'tenant_admin']);
  if v_i.status <> 'pending' then perform app.fail('CONFLICT', '使用済みまたは取消済みです'); end if;
  update public.invitations set status = 'revoked' where id = p_id;
  perform app.audit(v_i.tenant_id, 'invitation.revoke', 'invitation', p_id, null, null, v_i.shop_id);
  return jsonb_build_object('id', p_id, 'status', 'revoked');
end $$;

create or replace function public.svc_invitation_lookup(p_token_digest text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', i.id, 'email', i.email, 'role', i.role, 'tenantName', t.name, 'shopName', s.display_name,
    'state', case when i.status <> 'pending' then i.status when i.expires_at <= now() then 'expired' else 'pending' end,
    'userExists', exists (select 1 from auth.users u where lower(u.email) = i.email))
  from public.invitations i join public.tenants t on t.id = i.tenant_id left join public.shops s on s.id = i.shop_id
  where i.token_digest = p_token_digest
$$;

-- Accept: single use. Grants the role atomically. The server verifies that the
-- authenticated user's email equals the invited email before calling.
create or replace function public.svc_invitation_accept(p_token_digest text, p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_i public.invitations; v_email text;
begin
  select * into v_i from public.invitations where token_digest = p_token_digest for update;
  if not found then perform app.fail('NOT_FOUND', '招待が見つかりません'); end if;
  if v_i.status <> 'pending' then perform app.fail('CONFLICT', 'この招待は使用済みか取り消されています。事務局へ再発行を依頼してください'); end if;
  if v_i.expires_at <= now() then perform app.fail('EXPIRED', '招待の有効期限(72時間)が切れています。事務局へ再発行を依頼してください'); end if;
  select lower(email) into v_email from auth.users where id = p_user;
  if v_email is distinct from v_i.email then perform app.fail('FORBIDDEN', '招待されたメールアドレスでログインしてください'); end if;
  if v_i.role in ('shop_staff', 'shop_owner') then
    insert into public.shop_memberships (tenant_id, shop_id, user_id, role, actor_id) values (v_i.tenant_id, v_i.shop_id, p_user, v_i.role, v_i.created_by)
    on conflict (tenant_id, shop_id, user_id, role) do update set status = 'active', updated_at = now(), version = public.shop_memberships.version + 1;
  else
    insert into public.memberships (tenant_id, user_id, role, actor_id) values (v_i.tenant_id, p_user, v_i.role, v_i.created_by)
    on conflict (tenant_id, user_id, role) do update set status = 'active', updated_at = now(), version = public.memberships.version + 1;
  end if;
  insert into public.profiles (user_id) values (p_user) on conflict do nothing;
  update public.invitations set status = 'used', used_at = now(), used_by = p_user where id = v_i.id;
  insert into public.audit_events (tenant_id, actor_id, acting_for_shop_id, action, entity, entity_id, after_summary)
  values (v_i.tenant_id, p_user, v_i.shop_id, 'invitation.accept', 'invitation', v_i.id, jsonb_build_object('role', v_i.role));
  return jsonb_build_object('tenantId', v_i.tenant_id, 'shopId', v_i.shop_id, 'role', v_i.role);
end $$;

-- ---------------------------------------------------------------------------
-- Memberships (tenant_admin, recent MFA). No self-grant; keep >= 1 admin.
-- ---------------------------------------------------------------------------
create or replace function public.api_membership_set(p_tenant uuid, p_user uuid, p_role text, p_status text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := app.require_office(p_tenant, array['tenant_admin'], true);
begin
  if p_role not in ('office_operator', 'office_approver', 'tenant_admin', 'auditor') or p_status not in ('active', 'revoked') then
    perform app.fail('VALIDATION', '役割または状態が不正です');
  end if;
  if p_user = v_uid and p_status = 'active' then perform app.fail('FORBIDDEN', '自分自身に権限を付与することはできません'); end if;
  if p_status = 'active' and not exists (select 1 from public.memberships where tenant_id = p_tenant and user_id = p_user) then
    perform app.fail('VALIDATION', '新しい事務局メンバーは招待から追加してください');
  end if;
  if p_role = 'tenant_admin' and p_status = 'revoked' and (
      select count(*) from public.memberships where tenant_id = p_tenant and role = 'tenant_admin' and status = 'active' and user_id <> p_user) = 0 then
    perform app.fail('CONFLICT', '最後の管理者は削除できません');
  end if;
  insert into public.memberships (tenant_id, user_id, role, status, actor_id) values (p_tenant, p_user, p_role, p_status, v_uid)
  on conflict (tenant_id, user_id, role) do update set status = excluded.status, updated_at = now(), actor_id = v_uid,
    version = public.memberships.version + 1;
  if p_status = 'revoked' and not exists (select 1 from public.memberships where user_id = p_user and status = 'active') then
    update public.app_sessions set revoked_at = now() where user_id = p_user and kind = 'office' and revoked_at is null;
  end if;
  perform app.audit(p_tenant, 'membership.set', 'user', p_user, null, jsonb_build_object('role', p_role, 'status', p_status));
  return jsonb_build_object('userId', p_user, 'role', p_role, 'status', p_status);
end $$;

create or replace function public.api_shop_membership_set(p_shop uuid, p_user uuid, p_role text, p_status text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_t uuid; v_uid uuid;
begin
  select tenant_id into v_t from public.shops where id = p_shop;
  if v_t is null then perform app.fail('NOT_FOUND'); end if;
  v_uid := app.require_office(v_t, array['office_operator', 'tenant_admin']);
  if p_status <> 'revoked' then perform app.fail('VALIDATION', '店舗メンバーの追加は招待から行ってください'); end if;
  update public.shop_memberships set status = 'revoked', updated_at = now(), actor_id = v_uid, version = version + 1
  where shop_id = p_shop and user_id = p_user and role = p_role;
  if not found then perform app.fail('NOT_FOUND'); end if;
  perform app.audit(v_t, 'shop_membership.revoke', 'user', p_user, null, jsonb_build_object('role', p_role), p_shop);
  return jsonb_build_object('userId', p_user, 'status', 'revoked');
end $$;

create or replace function public.api_office_members(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_office(p_tenant, array['office_operator', 'office_approver', 'tenant_admin', 'auditor']);
  return coalesce((select jsonb_agg(jsonb_build_object('userId', x.user_id, 'displayName', p.display_name, 'email', u.email,
      'roles', x.roles, 'revokedRoles', x.revoked) order by p.display_name)
    from (select user_id, array_agg(role order by role) filter (where status = 'active') roles,
                 array_agg(role order by role) filter (where status = 'revoked') revoked
          from public.memberships where tenant_id = p_tenant group by user_id) x
    left join public.profiles p on p.user_id = x.user_id left join auth.users u on u.id = x.user_id), '[]');
end $$;

create or replace function public.api_tenant_settings_update(
  p_tenant uuid, p_expected_version integer, p_contact text, p_office_hours text, p_reply_guidance text, p_email_notifications boolean
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := app.require_office(p_tenant, array['tenant_admin']); v_t public.tenants;
begin
  update public.tenants set contact = coalesce(p_contact, ''), office_hours = coalesce(p_office_hours, ''),
    reply_guidance = coalesce(p_reply_guidance, ''), email_notifications = coalesce(p_email_notifications, false),
    version = version + 1, updated_at = now(), actor_id = v_uid
  where id = p_tenant and version = p_expected_version returning * into v_t;
  if not found then perform app.fail('CONFLICT', '他の担当者が更新しました。再読み込みしてください'); end if;
  perform app.audit(p_tenant, 'tenant.settings', 'tenant', p_tenant, null,
                    jsonb_build_object('emailNotifications', v_t.email_notifications));
  return jsonb_build_object('id', v_t.id, 'version', v_t.version);
end $$;

-- ---------------------------------------------------------------------------
-- Office queue (O1): exceptions first, then returns/awaiting, requests, tasks.
-- ---------------------------------------------------------------------------
create or replace function public.api_office_queue(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_office(p_tenant, array['office_operator', 'office_approver', 'tenant_admin', 'auditor']);
  return coalesce((select jsonb_agg(q order by (q ->> 'priority')::int, q ->> 'at') from (
    select jsonb_build_object('priority', 1, 'kind', 'reversal', 'id', v.id, 'shopName', s.display_name, 'title', '取消申請 ' || r.receipt_number,
      'amount', v.amount, 'reason', v.reason, 'at', v.created_at, 'link', '/o/reversals/' || v.id) q
    from public.reversals v join public.redemptions r on r.id = v.redemption_id join public.shops s on s.id = r.shop_id
    where v.tenant_id = p_tenant and v.status = 'requested'
    union all
    select jsonb_build_object('priority', 1, 'kind', 'settlement', 'id', b.id, 'shopName', '', 'title', '精算 #' || b.batch_number || ' ' ||
      case b.status when 'review' then '承認待ち' else '要確認の行があります' end, 'amount', b.total_amount, 'at', b.updated_at, 'link', '/o/settlements/' || b.id)
    from public.settlement_batches b where b.tenant_id = p_tenant and b.status in ('review', 'exception')
    union all
    select jsonb_build_object('priority', 1, 'kind', 'bank_change', 'id', ba.id, 'shopName', s.display_name, 'title', '口座変更の承認', 'at', ba.created_at,
      'link', '/o/shops/' || ba.shop_id)
    from public.bank_accounts ba join public.shops s on s.id = ba.shop_id where ba.tenant_id = p_tenant and ba.status = 'pending'
    union all
    select jsonb_build_object('priority', 1, 'kind', 'issuance', 'id', ib.id, 'shopName', '', 'title', '発行バッチ B' || lpad(ib.batch_number::text, 4, '0') ||
      case when ib.receipt_confirmed_at is null then ' 印刷・枚数確認待ち' else ' 有効化待ち' end, 'at', ib.created_at, 'link', '/o/campaigns/' || ib.campaign_id)
    from public.issuance_batches ib where ib.tenant_id = p_tenant and ib.status = 'generated'
    union all
    select jsonb_build_object('priority', 2, 'kind', 'paper', 'id', p.id, 'shopName', s.display_name, 'title', '紙券の原本確認', 'amount', p.claimed_amount,
      'at', p.submitted_at, 'link', '/o/paper/' || p.id)
    from public.paper_reports p join public.shops s on s.id = p.shop_id where p.tenant_id = p_tenant and p.status = 'submitted'
    union all
    select jsonb_build_object('priority', 2, 'kind', 'task_review', 'id', t.id, 'shopName', s.display_name, 'title', '回答の確認: ' || t.title,
      'at', r.submitted_at, 'link', '/o/tasks/' || t.id)
    from public.responses r join public.tasks t on t.id = r.task_id join public.shops s on s.id = r.shop_id
    where r.tenant_id = p_tenant and r.is_current and r.status = 'submitted'
    union all
    select jsonb_build_object('priority', 3, 'kind', 'request', 'id', q.id, 'shopName', s.display_name,
      'title', '相談 ' || q.request_number || ' ' || q.subject, 'status', q.status, 'assignedTo', q.assigned_to,
      'assignedName', (select display_name from public.profiles where user_id = q.assigned_to), 'at', q.last_shop_activity_at,
      'link', '/o/requests/' || q.id)
    from public.requests q join public.shops s on s.id = q.shop_id where q.tenant_id = p_tenant and q.status in ('received', 'in_progress')
    union all
    select jsonb_build_object('priority', 4, 'kind', 'task', 'id', t.id, 'shopName', '', 'title', '未回答あり: ' || t.title,
      'count', (select count(*) from public.task_recipients tr where tr.task_id = t.id and app.task_shop_state(t, tr.shop_id) in ('unanswered', 'returned')),
      'at', t.due_at, 'link', '/o/tasks/' || t.id)
    from public.tasks t where t.tenant_id = p_tenant and t.status = 'published' and exists (
      select 1 from public.task_recipients tr where tr.task_id = t.id and app.task_shop_state(t, tr.shop_id) in ('unanswered', 'returned'))
  ) z(q)), '[]');
end $$;

-- ---------------------------------------------------------------------------
-- Merchant home & history
-- ---------------------------------------------------------------------------
create or replace function public.api_merchant_home(p_shop uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_tenant uuid := app.require_shop(p_shop); v_s public.shops; v_t public.tenants;
begin
  select * into v_s from public.shops where id = p_shop;
  select * into v_t from public.tenants where id = v_tenant;
  return jsonb_build_object(
    'shop', jsonb_build_object('id', v_s.id, 'name', v_s.display_name),
    'tenant', jsonb_build_object('id', v_t.id, 'name', v_t.name, 'contact', v_t.contact, 'officeHours', v_t.office_hours),
    'environment', app.environment(),
    'roles', (select jsonb_agg(role) from public.shop_memberships where shop_id = p_shop and user_id = auth.uid() and status = 'active'),
    'campaigns', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'mode', c.mode, 'status', c.status,
        'environment', c.environment, 'endsAt', c.ends_at, 'externalServiceUrl', c.external_service_url,
        'usable', app.campaign_problem(c, p_shop, now()) is null or (c.mode <> 'owned_qr' and c.status = 'active' and now() < c.ends_at),
        'reason', case when c.status = 'suspended' then coalesce(c.suspended_reason, '受付停止中')
                       when now() >= c.ends_at then '受付期間が終了しました'
                       when now() < c.starts_at then '受付開始前です' end) order by c.ends_at)
      from public.campaigns c join public.campaign_shops cs on cs.campaign_id = c.id and cs.shop_id = p_shop and cs.status = 'active'
      where c.status in ('active', 'suspended') and c.environment = app.environment() and now() < c.ends_at + interval '7 days'), '[]'),
    'unansweredCount', (select count(*) from public.task_recipients tr join public.tasks t on t.id = tr.task_id
                        where tr.shop_id = p_shop and t.status = 'published' and t.superseded_by is null
                          and app.task_shop_state(t, p_shop) in ('unanswered', 'returned')),
    'unreadNotifications', (select count(*) from public.notifications where recipient_id = auth.uid() and read_at is null),
    'openRequests', (select count(*) from public.requests where shop_id = p_shop and status <> 'resolved'));
end $$;

-- Cursor-paginated history (50 per page). p_kind: all|voucher|task|request
create or replace function public.api_history_for_shop(p_shop uuid, p_kind text, p_before timestamptz, p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_tenant uuid := app.require_shop(p_shop); v_items jsonb; v_lim integer := least(greatest(coalesce(p_limit, 50), 1), 50);
begin
  select coalesce(jsonb_agg(x.j order by x.at desc), '[]') into v_items from (
    select * from (
      select jsonb_build_object('kind', 'voucher', 'id', r.id, 'operationId', r.operation_id, 'at', r.occurred_at,
               'title', '地域券の受付 ' || r.receipt_number, 'amount', r.amount, 'status', r.status,
               'actorName', (select display_name from public.profiles where user_id = r.actor_id),
               'reversal', (select v.status from public.reversals v where v.redemption_id = r.id)) j, r.occurred_at at
      from public.redemptions r where r.shop_id = p_shop and coalesce(p_kind, 'all') in ('all', 'voucher')
      union all
      select jsonb_build_object('kind', 'paper', 'id', p.id, 'at', coalesce(p.submitted_at, p.created_at), 'title', '紙券の申告',
               'amount', p.claimed_amount, 'status', p.status), coalesce(p.submitted_at, p.created_at)
      from public.paper_reports p where p.shop_id = p_shop and coalesce(p_kind, 'all') in ('all', 'voucher')
      union all
      select jsonb_build_object('kind', 'task', 'id', r.task_id, 'at', r.submitted_at, 'title', '返事: ' || t.title, 'status', r.status,
               'proxy', r.proxy_reason is not null, 'actorName', (select display_name from public.profiles where user_id = r.submitted_by)), r.submitted_at
      from public.responses r join public.tasks t on t.id = r.task_id where r.shop_id = p_shop and coalesce(p_kind, 'all') in ('all', 'task')
      union all
      select jsonb_build_object('kind', 'task', 'id', a.task_id, 'at', a.confirmed_at, 'title', '回覧の確認: ' || t.title, 'status', 'confirmed',
               'proxy', a.proxy_reason is not null), a.confirmed_at
      from public.acknowledgements a join public.tasks t on t.id = a.task_id where a.shop_id = p_shop and coalesce(p_kind, 'all') in ('all', 'task')
      union all
      select jsonb_build_object('kind', 'request', 'id', q.id, 'at', q.created_at, 'title', '相談 ' || q.request_number || ' ' || q.subject,
               'status', q.status), q.created_at
      from public.requests q where q.shop_id = p_shop and coalesce(p_kind, 'all') in ('all', 'request')
    ) u where p_before is null or u.at < p_before
    order by u.at desc limit v_lim
  ) x;
  return jsonb_build_object('items', v_items,
    'nextBefore', case when jsonb_array_length(v_items) = v_lim then v_items -> (v_lim - 1) ->> 'at' end);
end $$;

-- ---------------------------------------------------------------------------
-- Audit & export
-- ---------------------------------------------------------------------------
create or replace function public.api_audit_list(p_tenant uuid, p_before timestamptz, p_limit integer default 100) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_office(p_tenant, array['tenant_admin', 'auditor', 'office_approver']);
  return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'action', a.action, 'entity', a.entity, 'entityId', a.entity_id,
      'actorName', (select display_name from public.profiles where user_id = a.actor_id), 'actorId', a.actor_id,
      'shopName', (select display_name from public.shops where id = a.acting_for_shop_id), 'after', a.after_summary,
      'before', a.before_summary, 'requestId', a.request_id, 'occurredAt', a.occurred_at) order by a.occurred_at desc)
    from (select * from public.audit_events where tenant_id = p_tenant and (p_before is null or occurred_at < p_before)
          order by occurred_at desc limit least(greatest(coalesce(p_limit, 100), 1), 200)) a), '[]');
end $$;

create or replace function public.api_export_request(p_tenant uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := app.require_office(p_tenant, array['tenant_admin', 'auditor'], true); v_id uuid; v_masked boolean;
begin
  if exists (select 1 from public.tenant_exports where tenant_id = p_tenant and status = 'queued') then
    perform app.fail('CONFLICT', '作成中のエクスポートがあります');
  end if;
  v_masked := not ('tenant_admin' = any (app.office_roles(p_tenant)));
  insert into public.tenant_exports (tenant_id, requested_by, masked) values (p_tenant, v_uid, v_masked) returning id into v_id;
  perform app.enqueue(p_tenant, 'tenant_export', v_id, v_uid, 'export:' || v_id, jsonb_build_object('masked', v_masked));
  perform app.audit(p_tenant, 'export.request', 'tenant_export', v_id, null, jsonb_build_object('masked', v_masked));
  return jsonb_build_object('id', v_id, 'status', 'queued', 'masked', v_masked);
end $$;

create or replace function public.api_export_get(p_id uuid, p_for_download boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_e public.tenant_exports;
begin
  select * into v_e from public.tenant_exports where id = p_id;
  if not found then perform app.fail('NOT_FOUND'); end if;
  perform app.require_office(v_e.tenant_id, array['tenant_admin', 'auditor'], p_for_download);
  if p_for_download then
    if v_e.status <> 'ready' or v_e.expires_at <= now() then perform app.fail('EXPIRED', 'エクスポートの取得期限が切れているか、未作成です'); end if;
    perform app.audit(v_e.tenant_id, 'export.download', 'tenant_export', v_e.id, null, null);
  end if;
  return jsonb_build_object('id', v_e.id, 'status', v_e.status, 'masked', v_e.masked, 'createdAt', v_e.created_at,
    'expiresAt', v_e.expires_at, 'sha256', v_e.sha256, 'objectPath', case when p_for_download then v_e.object_path end);
end $$;

create or replace function public.api_exports_list(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_office(p_tenant, array['tenant_admin', 'auditor']);
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'status', status, 'masked', masked, 'createdAt', created_at,
    'expiresAt', expires_at) order by created_at desc) from public.tenant_exports where tenant_id = p_tenant), '[]');
end $$;

-- ---------------------------------------------------------------------------
-- Job runner (service role only)
-- ---------------------------------------------------------------------------
create or replace function public.svc_jobs_claim(p_limit integer) returns setof public.outbox
language sql security definer set search_path = '' as $$
  update public.outbox o set status = 'processing', attempts = o.attempts + 1, locked_until = now() + interval '5 minutes', updated_at = now()
  where o.id in (
    select id from public.outbox
    where (status = 'pending' and next_attempt_at <= now()) or (status = 'processing' and locked_until < now())
    order by next_attempt_at limit greatest(1, least(p_limit, 100))
    for update skip locked)
  returning o.*
$$;

create or replace function public.svc_job_complete(p_id uuid, p_status text, p_scrub_keys text[] default '{}') returns void
language sql security definer set search_path = '' as $$
  update public.outbox set status = p_status, locked_until = null, updated_at = now(), last_error = null,
    payload = payload - p_scrub_keys
  where id = p_id and status = 'processing';
$$;

-- Exponential backoff 1,2,4,8 min; after 5 attempts the job moves to the failed queue.
create or replace function public.svc_job_fail(p_id uuid, p_error text) returns text
language plpgsql security definer set search_path = '' as $$
declare v_o public.outbox;
begin
  select * into v_o from public.outbox where id = p_id for update;
  if v_o.attempts >= 5 then
    update public.outbox set status = 'failed', last_error = left(p_error, 500), locked_until = null, updated_at = now() where id = p_id;
    return 'failed';
  end if;
  update public.outbox set status = 'pending', last_error = left(p_error, 500), locked_until = null,
    next_attempt_at = now() + make_interval(mins => power(2, greatest(v_o.attempts - 1, 0))::int), updated_at = now() where id = p_id;
  return 'pending';
end $$;

create or replace function public.svc_job_defer(p_id uuid, p_until timestamptz) returns void
language sql security definer set search_path = '' as $$
  update public.outbox set status = 'pending', next_attempt_at = p_until, attempts = greatest(attempts - 1, 0), locked_until = null, updated_at = now()
  where id = p_id;
$$;

-- In-app notification (idempotent by dedupe key) + email decision data.
create or replace function public.svc_notification_deliver(p_outbox uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_o public.outbox; v_t public.tenants; v_email text;
begin
  select * into v_o from public.outbox where id = p_outbox;
  select * into v_t from public.tenants where id = v_o.tenant_id;
  insert into public.notifications (tenant_id, recipient_id, entity_type, entity_id, title, link, dedupe_key)
  values (v_o.tenant_id, v_o.recipient_id, coalesce(v_o.payload ->> 'entityType', ''), v_o.entity_id, v_o.payload ->> 'title',
          coalesce(v_o.payload ->> 'link', ''), v_o.dedupe_key)
  on conflict (dedupe_key) do nothing;
  select email into v_email from auth.users where id = v_o.recipient_id;
  return jsonb_build_object('email', case when v_t.email_notifications then v_email end, 'title', v_o.payload ->> 'title',
                            'link', v_o.payload ->> 'link', 'tenantName', v_t.name);
end $$;

-- Reminder digest: recheck unanswered right before sending.
create or replace function public.svc_reminder_digest(p_shop uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'tasks', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'dueAt', t.due_at))
      from public.task_recipients tr join public.tasks t on t.id = tr.task_id
      where tr.shop_id = p_shop and t.status = 'published' and t.superseded_by is null
        and app.task_shop_state(t, p_shop) in ('unanswered', 'returned')), '[]'),
    'recipients', coalesce((select jsonb_agg(sm.user_id) from public.shop_memberships sm where sm.shop_id = p_shop and sm.status = 'active'), '[]'),
    'tenantId', (select tenant_id from public.shops where id = p_shop))
$$;

-- Automatic reminders for tasks due within 48h (1 per shop per JST day).
create or replace function public.svc_schedule_auto_reminders() returns integer
language plpgsql security definer set search_path = '' as $$
declare v_n integer := 0; r record; v_day text := app.jst_date(now())::text;
begin
  for r in select distinct tr.tenant_id, tr.shop_id, tr.task_id from public.task_recipients tr join public.tasks t on t.id = tr.task_id
           where t.status = 'published' and t.superseded_by is null and t.due_at between now() and now() + interval '48 hours'
             and (tr.last_reminded_at is null or tr.last_reminded_at < now() - interval '24 hours')
             and app.task_shop_state(t, tr.shop_id) in ('unanswered', 'returned') loop
    insert into public.outbox (tenant_id, kind, entity_id, dedupe_key, payload)
    values (r.tenant_id, 'reminder_digest', r.shop_id, 'reminder:' || r.shop_id || ':' || v_day, jsonb_build_object('shopId', r.shop_id, 'day', v_day))
    on conflict (dedupe_key) do nothing;
    update public.task_recipients set last_reminded_at = now() where task_id = r.task_id and shop_id = r.shop_id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

create or replace function public.svc_issuance_objects_to_purge() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'path', encrypted_object_path)), '[]') from public.issuance_batches
  where encrypted_object_path is not null and object_purged_at is null and (download_expires_at < now() or status in ('void', 'activated'))
$$;

create or replace function public.svc_issuance_mark_purged(p_id uuid) returns void
language sql security definer set search_path = '' as $$
  update public.issuance_batches set object_purged_at = now() where id = p_id;
$$;

create or replace function public.svc_housekeeping() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_drafts integer; v_exports integer;
begin
  update public.receipt_drafts set status = 'expired' where status = 'quoted' and expires_at < now() - interval '1 minute';
  get diagnostics v_drafts = row_count;
  update public.tenant_exports set status = 'expired' where status = 'ready' and expires_at < now();
  get diagnostics v_exports = row_count;
  delete from public.outbox where status in ('sent', 'skipped') and updated_at < now() - interval '30 days';
  delete from public.outbox where status = 'failed' and updated_at < now() - interval '90 days';
  return jsonb_build_object('expiredDrafts', v_drafts, 'expiredExports', v_exports);
end $$;

create or replace function public.svc_export_complete(p_id uuid, p_ok boolean, p_path text, p_sha256 text, p_error text) returns void
language sql security definer set search_path = '' as $$
  update public.tenant_exports set status = case when p_ok then 'ready' else 'failed' end, object_path = p_path, sha256 = p_sha256,
    error = left(p_error, 300), completed_at = now(), expires_at = case when p_ok then now() + interval '24 hours' end
  where id = p_id;
$$;

create or replace function public.svc_alert_rate_limit(p_tenant uuid, p_bucket text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.notify_office(p_tenant, array['tenant_admin', 'office_approver'], '照会・ログインの失敗が多く発生しています', '/o/audit', 'security', null,
                            'ratelimit:' || p_bucket || ':' || to_char(now(), 'YYYYMMDDHH24'));
  insert into public.audit_events (tenant_id, action, entity, after_summary) values (p_tenant, 'security.rate_limited', 'rate_limit', jsonb_build_object('bucket', p_bucket));
end $$;

create or replace function app.attachment_readable_by_id(p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select app.attachment_readable(a) from public.attachments a where a.id = p_id), false)
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security. Every table has RLS; writes happen only through functions.
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', r.tablename);
    execute format('revoke all on public.%I from anon, authenticated', r.tablename);
  end loop;
end $$;

-- service_role is the server/job runner; it bypasses RLS by design (BYPASSRLS).
grant all on all tables in schema public to service_role;

create policy tenants_read on public.tenants for select to authenticated using (app.is_tenant_visible(id));
create policy profiles_read on public.profiles for select to authenticated using (user_id = auth.uid() and app.session_valid());
create policy memberships_read on public.memberships for select to authenticated
  using ((user_id = auth.uid() and app.session_valid()) or app.has_office_role(tenant_id, array['tenant_admin', 'auditor']));
create policy shops_read on public.shops for select to authenticated using (app.can_read_shop(tenant_id, id));
create policy shop_memberships_read on public.shop_memberships for select to authenticated
  using ((user_id = auth.uid() and app.session_valid()) or app.is_office(tenant_id));
create policy campaigns_read on public.campaigns for select to authenticated using (
  app.is_office(tenant_id) or exists (select 1 from public.campaign_shops cs where cs.campaign_id = id and app.is_shop_member(cs.shop_id)));
create policy campaign_shops_read on public.campaign_shops for select to authenticated using (app.can_read_shop(tenant_id, shop_id));
create policy live_readiness_read on public.live_readiness for select to authenticated using (app.is_office(tenant_id));
create policy issuance_read on public.issuance_batches for select to authenticated using (app.is_office(tenant_id));
create policy coupons_read on public.coupons for select to authenticated using (app.is_office(tenant_id));
create policy drafts_read on public.receipt_drafts for select to authenticated using (actor_id = auth.uid() and app.session_valid());
create policy operations_read on public.operations for select to authenticated using ((actor_id = auth.uid() and app.session_valid()) or app.is_office(tenant_id));
create policy redemptions_read on public.redemptions for select to authenticated using (app.can_read_shop(tenant_id, shop_id));
create policy redemption_items_read on public.redemption_items for select to authenticated using (
  exists (select 1 from public.redemptions r where r.id = redemption_id and app.can_read_shop(r.tenant_id, r.shop_id)));
create policy reversals_read on public.reversals for select to authenticated using (
  exists (select 1 from public.redemptions r where r.id = redemption_id and app.can_read_shop(r.tenant_id, r.shop_id)));
create policy paper_read on public.paper_reports for select to authenticated using (app.can_read_shop(tenant_id, shop_id));
create policy ext_imports_read on public.external_imports for select to authenticated using (app.is_office(tenant_id));
create policy ext_rows_read on public.external_import_rows for select to authenticated using (app.is_office(tenant_id));
create policy ext_tx_read on public.external_transactions for select to authenticated using (app.can_read_shop(tenant_id, shop_id));
create policy attachments_read on public.attachments for select to authenticated using (app.attachment_readable_by_id(id));
create policy tasks_read on public.tasks for select to authenticated using (
  app.is_office(tenant_id) or (status <> 'draft' and exists (select 1 from public.task_recipients tr where tr.task_id = id and app.is_shop_member(tr.shop_id))));
create policy task_targets_read on public.task_draft_targets for select to authenticated using (app.is_office(tenant_id));
create policy task_recipients_read on public.task_recipients for select to authenticated using (app.can_read_shop(tenant_id, shop_id));
create policy responses_read on public.responses for select to authenticated using (app.can_read_shop(tenant_id, shop_id));
create policy acks_read on public.acknowledgements for select to authenticated using (app.can_read_shop(tenant_id, shop_id));
create policy requests_read on public.requests for select to authenticated using (app.can_read_shop(tenant_id, shop_id));
create policy request_messages_read on public.request_messages for select to authenticated using (
  app.is_office(tenant_id) or (visibility = 'shop' and exists (select 1 from public.requests q where q.id = request_id and app.is_shop_member(q.shop_id))));
create policy settlement_batches_read on public.settlement_batches for select to authenticated using (app.is_office(tenant_id));
create policy settlement_lines_read on public.settlement_lines for select to authenticated using (app.can_read_shop(tenant_id, shop_id));
create policy settlement_sources_read on public.settlement_sources for select to authenticated using (
  exists (select 1 from public.settlement_lines l where l.id = line_id and app.can_read_shop(l.tenant_id, l.shop_id)));
create policy bank_imports_read on public.bank_result_imports for select to authenticated using (app.is_office(tenant_id));
create policy bank_rows_read on public.bank_result_rows for select to authenticated using (app.is_office(tenant_id));
create policy bank_results_read on public.bank_results for select to authenticated using (app.is_office(tenant_id));
create policy audit_read on public.audit_events for select to authenticated using (app.has_office_role(tenant_id, array['tenant_admin', 'auditor', 'office_approver']));
create policy notifications_read on public.notifications for select to authenticated using (recipient_id = auth.uid() and app.session_valid());
create policy exports_read on public.tenant_exports for select to authenticated using (app.has_office_role(tenant_id, array['tenant_admin', 'auditor']));
-- No policies (deny all for API roles): deployment_environment, invitations, app_sessions, rate_limits, counters,
-- idempotency_keys, outbox, mail_sink, bank_accounts (encrypted; read via masked functions only).

grant select on public.tenants, public.profiles, public.memberships, public.shops, public.shop_memberships, public.campaigns,
  public.campaign_shops, public.live_readiness, public.issuance_batches, public.receipt_drafts, public.operations, public.redemptions,
  public.redemption_items, public.reversals, public.paper_reports, public.external_imports, public.external_import_rows,
  public.external_transactions, public.tasks, public.task_draft_targets, public.task_recipients, public.responses, public.acknowledgements,
  public.requests, public.request_messages, public.settlement_batches, public.settlement_lines, public.settlement_sources,
  public.bank_result_imports, public.bank_result_rows, public.bank_results, public.audit_events, public.notifications, public.tenant_exports
  to authenticated;
-- attachments / coupons: column grants without storage paths or token digests
grant select (tenant_id, id, shop_id, parent_type, parent_id, mime, size, sha256, width, height, scan_status, created_by, created_at)
  on public.attachments to authenticated;
grant select (tenant_id, campaign_id, batch_id, id, display_number, face_value, status, valid_from, valid_until, redeemed_operation_id, created_at)
  on public.coupons to authenticated;

-- Audit is append-only even for the owner role used by migrations at runtime.
create or replace function app.audit_immutable() returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'audit_events is append-only';
end $$;
create trigger audit_no_update before update or delete on public.audit_events for each row execute function app.audit_immutable();

-- Money history is append-only: redemptions/items/bank_results cannot be deleted.
create or replace function app.money_no_delete() returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception '% rows cannot be deleted', tg_table_name;
end $$;
create trigger redemptions_no_delete before delete on public.redemptions for each row execute function app.money_no_delete();
create trigger redemption_items_no_delete before delete on public.redemption_items for each row execute function app.money_no_delete();
create trigger reversals_no_delete before delete on public.reversals for each row execute function app.money_no_delete();
create trigger bank_results_no_delete before delete on public.bank_results for each row execute function app.money_no_delete();
create trigger ext_tx_no_delete before delete on public.external_transactions for each row execute function app.money_no_delete();
create trigger operations_no_delete before delete on public.operations for each row execute function app.money_no_delete();

-- ---------------------------------------------------------------------------
-- Storage: private buckets only; no policies for API roles (server signs URLs).
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('attachments', 'attachments', false, 10485760, array['image/jpeg', 'image/png', 'image/webp']),
  ('issuance', 'issuance', false, 52428800, array['application/octet-stream']),
  ('exports', 'exports', false, 524288000, array['application/zip']),
  ('bank-results', 'bank-results', false, 10485760, array['text/csv', 'application/octet-stream'])
on conflict (id) do update set public = false;

select app.lock_down_functions();
