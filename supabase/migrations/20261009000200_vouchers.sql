-- Vouchers: campaigns, owned QR issuance, atomic redemption, reversals,
-- paper reports, external CSV records. Amounts are JPY integers (bigint).

create table public.campaigns (
  tenant_id uuid not null references public.tenants (id),
  id uuid not null default gen_random_uuid() unique,
  name text not null check (char_length(name) between 1 and 100),
  mode text not null check (mode in ('owned_qr', 'paper_count', 'external_csv')),
  environment text not null check (environment in ('DEMO', 'LIVE')),
  status text not null default 'draft' check (status in ('draft', 'active', 'suspended', 'closed')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  denominations integer[] not null default '{}',
  rules_text text not null default '',
  rules_version integer not null default 1,
  issuer text not null default '',
  external_service_url text not null default '',
  settlement_cycle text not null default 'monthly' check (settlement_cycle in ('monthly', 'explicit')),
  permission_evidence_id uuid,
  submitted_by uuid,
  submitted_at timestamptz,
  approved_by uuid,
  approved_at timestamptz,
  live_approved_by uuid,
  live_approved_at timestamptz,
  suspended_reason text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  actor_id uuid,
  primary key (tenant_id, id),
  check (ends_at > starts_at),
  check (coalesce(array_length(denominations, 1), 0) <= 3),
  check (mode = 'external_csv' or coalesce(array_length(denominations, 1), 0) >= 1),
  check (1 <= all (denominations) and 100000 >= all (denominations))
);

create table public.campaign_shops (
  tenant_id uuid not null,
  campaign_id uuid not null,
  shop_id uuid not null,
  eligible_from timestamptz,
  eligible_until timestamptz,
  status text not null default 'active' check (status in ('active', 'removed')),
  created_at timestamptz not null default now(),
  primary key (tenant_id, campaign_id, shop_id),
  foreign key (tenant_id, campaign_id) references public.campaigns (tenant_id, id),
  foreign key (tenant_id, shop_id) references public.shops (tenant_id, id)
);
create index on public.campaign_shops (shop_id);

create table public.live_readiness (
  tenant_id uuid not null,
  campaign_id uuid not null,
  issuer_authority boolean not null default false,
  rules_approved boolean not null default false,
  security_reviewed boolean not null default false,
  pilot_completed boolean not null default false,
  legal_review_ref text not null default '',
  two_person_approval boolean not null default false,
  evidence_ids uuid[] not null default '{}',
  updated_by uuid,
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  primary key (tenant_id, campaign_id),
  foreign key (tenant_id, campaign_id) references public.campaigns (tenant_id, id)
);

create table public.issuance_batches (
  tenant_id uuid not null,
  campaign_id uuid not null,
  id uuid not null default gen_random_uuid() unique,
  batch_number bigint not null,
  denomination integer not null check (denomination between 1 and 100000),
  count integer not null check (count between 1 and 200),
  valid_from timestamptz not null,
  valid_until timestamptz not null,
  status text not null default 'draft' check (status in ('draft', 'generated', 'activated', 'void')),
  key_version integer not null,
  created_by uuid not null,
  encrypted_object_path text,
  download_expires_at timestamptz,
  first_downloaded_at timestamptz,
  download_count integer not null default 0,
  object_purged_at timestamptz,
  receipt_confirmed_by uuid,
  receipt_confirmed_at timestamptz,
  approved_by uuid,
  activated_at timestamptz,
  voided_by uuid,
  voided_at timestamptz,
  void_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  primary key (tenant_id, id),
  unique (tenant_id, batch_number),
  check (valid_until > valid_from),
  foreign key (tenant_id, campaign_id) references public.campaigns (tenant_id, id)
);

create table public.coupons (
  tenant_id uuid not null,
  campaign_id uuid not null,
  batch_id uuid not null,
  id uuid not null default gen_random_uuid() unique,
  token_digest text not null unique check (token_digest ~ '^[0-9a-f]{64}$'),
  key_version integer not null,
  display_number text not null,
  face_value integer not null check (face_value between 1 and 100000),
  status text not null default 'inactive' check (status in ('inactive', 'active', 'redeemed', 'void', 'retired')),
  valid_from timestamptz not null,
  valid_until timestamptz not null,
  redeemed_operation_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, display_number),
  foreign key (tenant_id, campaign_id) references public.campaigns (tenant_id, id),
  foreign key (tenant_id, batch_id) references public.issuance_batches (tenant_id, id)
);
create index on public.coupons (batch_id);

create table public.receipt_drafts (
  tenant_id uuid not null,
  id uuid not null default gen_random_uuid() unique,
  shop_id uuid not null,
  actor_id uuid not null,
  campaign_id uuid not null,
  coupon_ids uuid[] not null,
  quote_amount bigint not null check (quote_amount between 1 and 1000000),
  rules_version integer not null,
  expires_at timestamptz not null,
  status text not null default 'quoted' check (status in ('quoted', 'consumed', 'expired')),
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, shop_id) references public.shops (tenant_id, id),
  foreign key (tenant_id, campaign_id) references public.campaigns (tenant_id, id)
);

create table public.operations (
  tenant_id uuid not null,
  id uuid not null default gen_random_uuid() unique,
  shop_id uuid not null,
  actor_id uuid not null,
  kind text not null check (kind in ('redemption')),
  idempotency_key uuid not null,
  request_hash text not null,
  draft_id uuid,
  status text not null check (status in ('pending', 'confirmed', 'failed')),
  result_ref uuid,
  error_code text,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, actor_id, idempotency_key),
  unique (draft_id),
  foreign key (tenant_id, shop_id) references public.shops (tenant_id, id)
);

create table public.redemptions (
  tenant_id uuid not null,
  id uuid not null default gen_random_uuid() unique,
  operation_id uuid not null,
  campaign_id uuid not null,
  shop_id uuid not null,
  actor_id uuid not null,
  amount bigint not null check (amount between 1 and 1000000),
  occurred_at timestamptz not null default now(),
  rules_version integer not null,
  status text not null default 'confirmed' check (status in ('confirmed', 'reversed')),
  receipt_number text not null,
  primary key (tenant_id, id),
  unique (tenant_id, operation_id),
  unique (tenant_id, receipt_number),
  foreign key (tenant_id, operation_id) references public.operations (tenant_id, id),
  foreign key (tenant_id, campaign_id) references public.campaigns (tenant_id, id),
  foreign key (tenant_id, shop_id) references public.shops (tenant_id, id)
);
create index on public.redemptions (shop_id, occurred_at desc);
create index on public.redemptions (campaign_id, occurred_at);

create table public.redemption_items (
  tenant_id uuid not null,
  redemption_id uuid not null,
  coupon_id uuid not null unique,  -- a coupon can be redeemed once in its lifetime
  face_value integer not null,
  primary key (tenant_id, redemption_id, coupon_id),
  foreign key (tenant_id, redemption_id) references public.redemptions (tenant_id, id),
  foreign key (tenant_id, coupon_id) references public.coupons (tenant_id, id)
);

create table public.reversals (
  tenant_id uuid not null,
  id uuid not null default gen_random_uuid() unique,
  redemption_id uuid not null unique,  -- full reversal only, once
  reason text not null check (char_length(reason) between 1 and 500),
  amount bigint not null,
  status text not null default 'requested' check (status in ('requested', 'approved', 'rejected')),
  requested_by uuid not null,
  approved_by uuid,
  decided_at timestamptz,
  decision_note text,
  settlement_adjustment_id uuid,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, redemption_id) references public.redemptions (tenant_id, id),
  check (approved_by is null or approved_by <> requested_by)
);

create table public.paper_reports (
  tenant_id uuid not null,
  id uuid not null default gen_random_uuid() unique,
  campaign_id uuid not null,
  shop_id uuid not null,
  received_date date not null,
  denomination_counts jsonb not null,
  claimed_amount bigint not null check (claimed_amount between 1 and 1000000),
  photo_ids uuid[] not null default '{}',
  original_bundle_ref text not null default '' check (char_length(original_bundle_ref) <= 60),
  status text not null default 'draft' check (status in ('draft', 'submitted', 'returned', 'verified', 'rejected')),
  verified_amount bigint check (verified_amount between 0 and 1000000),
  difference_reason text,
  return_reason text,
  original_present boolean,
  original_storage text not null default '',
  original_return_status text not null default '',
  submitted_by uuid,
  submitted_at timestamptz,
  verified_by uuid,
  verified_at timestamptz,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  primary key (tenant_id, id),
  foreign key (tenant_id, campaign_id) references public.campaigns (tenant_id, id),
  foreign key (tenant_id, shop_id) references public.shops (tenant_id, id)
);
create unique index paper_bundle_unique on public.paper_reports (tenant_id, campaign_id, original_bundle_ref)
  where status = 'verified';

create table public.external_imports (
  tenant_id uuid not null,
  id uuid not null default gen_random_uuid() unique,
  campaign_id uuid not null,
  source_name text not null check (char_length(source_name) between 1 and 100),
  file_name text not null default '',
  file_hash text not null check (file_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'staged' check (status in ('staged', 'validated', 'committed', 'rejected')),
  mapping_version integer not null default 1,
  actor_id uuid not null,
  committed_by uuid,
  committed_at timestamptz,
  summary jsonb not null default '{}',
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, campaign_id) references public.campaigns (tenant_id, id)
);
create unique index external_import_hash_active on public.external_imports (tenant_id, campaign_id, file_hash)
  where status <> 'rejected';

create table public.external_import_rows (
  tenant_id uuid not null,
  import_id uuid not null,
  source_row integer not null,
  provider text not null default '',
  provider_transaction_id text not null default '',
  shop_external_code text not null default '',
  shop_id uuid,
  amount bigint,
  occurred_at timestamptz,
  tx_status text not null default '',
  original_transaction_id text not null default '',
  row_status text not null check (row_status in ('ok', 'duplicate', 'conflict', 'error', 'unknown_shop', 'unsupported')),
  error_code text,
  raw jsonb not null,
  primary key (tenant_id, import_id, source_row),
  foreign key (tenant_id, import_id) references public.external_imports (tenant_id, id)
);

create table public.external_transactions (
  tenant_id uuid not null,
  id uuid not null default gen_random_uuid() unique,
  campaign_id uuid not null,
  provider text not null,
  provider_transaction_id text not null,
  shop_id uuid not null,
  amount bigint not null check (amount between 1 and 1000000),
  occurred_at timestamptz not null,
  status text not null check (status in ('confirmed', 'reversed')),
  original_transaction_id text,
  import_id uuid not null,
  source_row integer not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, campaign_id, provider, provider_transaction_id),
  foreign key (tenant_id, campaign_id) references public.campaigns (tenant_id, id),
  foreign key (tenant_id, shop_id) references public.shops (tenant_id, id),
  foreign key (tenant_id, import_id) references public.external_imports (tenant_id, id)
);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function app.shop_eligible(p_campaign uuid, p_shop uuid, p_at timestamptz) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.campaign_shops cs
    where cs.campaign_id = p_campaign and cs.shop_id = p_shop and cs.status = 'active'
      and (cs.eligible_from is null or cs.eligible_from <= p_at)
      and (cs.eligible_until is null or cs.eligible_until > p_at)
  )
$$;

create or replace function app.campaign_json(c public.campaigns) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', c.id, 'name', c.name, 'mode', c.mode, 'environment', c.environment, 'status', c.status,
    'startsAt', c.starts_at, 'endsAt', c.ends_at, 'denominations', to_jsonb(c.denominations), 'rulesText', c.rules_text,
    'rulesVersion', c.rules_version, 'issuer', c.issuer, 'externalServiceUrl', c.external_service_url,
    'settlementCycle', c.settlement_cycle, 'submittedBy', c.submitted_by, 'submittedAt', c.submitted_at,
    'approvedBy', c.approved_by, 'approvedAt', c.approved_at, 'liveApprovedAt', c.live_approved_at,
    'suspendedReason', c.suspended_reason, 'createdBy', c.created_by, 'version', c.version)
$$;

-- Problem code for one coupon at a point in time, or null when acceptable.
create or replace function app.coupon_problem(c public.coupons, p_campaign public.campaigns, p_shop uuid, p_at timestamptz)
returns text language sql stable set search_path = '' as $$
  select case
    when c.id is null then 'UNSUPPORTED'
    when c.campaign_id <> p_campaign.id then 'OTHER_CAMPAIGN'
    when c.status in ('redeemed', 'retired') then 'ALREADY_USED'
    when c.status = 'void' then 'VOID'
    when c.status = 'inactive' then 'INACTIVE'
    when p_at >= c.valid_until or p_at >= p_campaign.ends_at then 'EXPIRED'
    when p_at < c.valid_from or p_at < p_campaign.starts_at then 'NOT_YET_VALID'
    when not (c.face_value = any (p_campaign.denominations)) then 'UNSUPPORTED'
    else null
  end
$$;

create or replace function app.campaign_problem(p_campaign public.campaigns, p_shop uuid, p_at timestamptz)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when p_campaign.id is null then 'UNSUPPORTED'
    when p_campaign.mode <> 'owned_qr' then 'UNSUPPORTED'
    when p_campaign.environment is distinct from app.environment() then 'ENVIRONMENT_MISMATCH'
    when p_campaign.environment = 'LIVE' and p_campaign.live_approved_at is null then 'LIVE_NOT_APPROVED'
    when p_campaign.status = 'suspended' then 'CAMPAIGN_SUSPENDED'
    when p_campaign.status <> 'active' then 'CAMPAIGN_INACTIVE'
    when not app.shop_eligible(p_campaign.id, p_shop, p_at) then 'SHOP_NOT_ELIGIBLE'
    else null
  end
$$;

create or replace function app.problem_to_error(p_codes text[]) returns text
language sql immutable set search_path = '' as $$
  select case
    when 'ALREADY_USED' = any (p_codes) then 'ALREADY_USED'
    when 'EXPIRED' = any (p_codes) then 'EXPIRED'
    when 'DUPLICATE_IN_LIST' = any (p_codes) then 'VALIDATION'
    when 'CAMPAIGN_SUSPENDED' = any (p_codes) or 'SHOP_NOT_ELIGIBLE' = any (p_codes)
      or 'CAMPAIGN_INACTIVE' = any (p_codes) or 'INACTIVE' = any (p_codes) or 'NOT_YET_VALID' = any (p_codes)
      or 'VOID' = any (p_codes) then 'CONFLICT'
    else 'UNSUPPORTED'
  end
$$;

-- ---------------------------------------------------------------------------
-- Campaign management (office)
-- ---------------------------------------------------------------------------
create or replace function public.api_campaign_create(
  p_tenant uuid, p_name text, p_mode text, p_starts_at timestamptz, p_ends_at timestamptz,
  p_denominations integer[], p_rules_text text, p_issuer text, p_shop_ids uuid[],
  p_external_service_url text, p_idem uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_office(p_tenant, array['office_operator', 'tenant_admin']);
  v_hash text := app.hash_json(jsonb_build_object('t', p_tenant, 'n', p_name, 'm', p_mode, 's', p_starts_at, 'e', p_ends_at,
                  'd', p_denominations, 'r', p_rules_text, 'i', p_issuer, 'shops', p_shop_ids, 'u', p_external_service_url));
  v_prev jsonb;
  v_env text := app.environment();
  v_c public.campaigns;
begin
  v_prev := app.idem_lookup(v_uid, p_idem, 'campaign.create', v_hash);
  if v_prev is not null then return v_prev; end if;
  if v_env is null then perform app.fail('SERVICE_UNAVAILABLE', '環境(DEMO/LIVE)が未設定です'); end if;
  if p_mode not in ('owned_qr', 'paper_count', 'external_csv') then perform app.fail('VALIDATION', '券方式が不正です'); end if;
  if p_mode <> 'external_csv' and (coalesce(array_length(p_denominations, 1), 0) not between 1 and 3) then
    perform app.fail('VALIDATION', '額面は1〜3種類で設定してください', '{"fieldErrors":{"denominations":"1〜3種類"}}');
  end if;
  if exists (select 1 from unnest(p_shop_ids) s where not exists (select 1 from public.shops x where x.id = s and x.tenant_id = p_tenant)) then
    perform app.fail('VALIDATION', '対象店舗が不正です');
  end if;
  if p_external_service_url <> '' and p_external_service_url !~ '^https://' then
    perform app.fail('VALIDATION', '公式サービスのURLはhttps://で始めてください');
  end if;
  insert into public.campaigns (tenant_id, name, mode, environment, starts_at, ends_at, denominations, rules_text, issuer,
                                external_service_url, created_by, actor_id)
  values (p_tenant, btrim(p_name), p_mode, v_env, p_starts_at, p_ends_at,
          case when p_mode = 'external_csv' then '{}' else (select array_agg(distinct d order by d) from unnest(p_denominations) d) end,
          coalesce(p_rules_text, ''), coalesce(p_issuer, ''), coalesce(p_external_service_url, ''), v_uid, v_uid)
  returning * into v_c;
  insert into public.campaign_shops (tenant_id, campaign_id, shop_id)
  select p_tenant, v_c.id, s from (select distinct unnest(p_shop_ids) s) x;
  insert into public.live_readiness (tenant_id, campaign_id) values (p_tenant, v_c.id);
  perform app.audit(p_tenant, 'campaign.create', 'campaign', v_c.id, null, app.campaign_json(v_c));
  return app.idem_store(v_uid, p_idem, p_tenant, 'campaign.create', v_hash, app.campaign_json(v_c));
end $$;

create or replace function public.api_campaign_submit(p_campaign uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_c public.campaigns; v_uid uuid;
begin
  select * into v_c from public.campaigns where id = p_campaign for update;
  if not found then perform app.fail('NOT_FOUND'); end if;
  v_uid := app.require_office(v_c.tenant_id, array['office_operator', 'tenant_admin']);
  if v_c.status <> 'draft' then perform app.fail('CONFLICT', '下書きの事業だけ公開申請できます'); end if;
  if not exists (select 1 from public.campaign_shops where campaign_id = p_campaign and status = 'active') then
    perform app.fail('VALIDATION', '対象店舗を1店以上設定してください');
  end if;
  update public.campaigns set submitted_by = v_uid, submitted_at = now(), version = version + 1, updated_at = now()
  where id = p_campaign returning * into v_c;
  perform app.audit(v_c.tenant_id, 'campaign.submit', 'campaign', v_c.id, null, app.campaign_json(v_c));
  perform app.notify_office(v_c.tenant_id, array['office_approver'], '地域券事業の公開申請があります', '/o/campaigns/' || v_c.id, 'campaign', v_c.id, 'campaign.submit:' || v_c.id || ':' || v_c.version);
  return app.campaign_json(v_c);
end $$;

create or replace function public.api_live_readiness_update(
  p_campaign uuid, p_issuer_authority boolean, p_rules_approved boolean, p_security_reviewed boolean,
  p_pilot_completed boolean, p_legal_review_ref text, p_two_person_approval boolean, p_expected_version integer
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_c public.campaigns; v_uid uuid; v_r public.live_readiness;
begin
  select * into v_c from public.campaigns where id = p_campaign;
  if not found then perform app.fail('NOT_FOUND'); end if;
  v_uid := app.require_office(v_c.tenant_id, array['tenant_admin', 'office_approver'], true);
  update public.live_readiness set issuer_authority = p_issuer_authority, rules_approved = p_rules_approved,
    security_reviewed = p_security_reviewed, pilot_completed = p_pilot_completed,
    legal_review_ref = coalesce(p_legal_review_ref, ''), two_person_approval = p_two_person_approval,
    updated_by = v_uid, updated_at = now(), version = version + 1
  where campaign_id = p_campaign and version = p_expected_version returning * into v_r;
  if not found then perform app.fail('CONFLICT', '他の担当者が更新しました。再読み込みしてください'); end if;
  perform app.audit(v_c.tenant_id, 'campaign.live_readiness', 'campaign', v_c.id, null, to_jsonb(v_r));
  return to_jsonb(v_r);
end $$;

-- LIVE approval: only in a LIVE deployment, readiness complete, approver distinct from submitter.
create or replace function public.api_campaign_approve_live(p_campaign uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_c public.campaigns; v_uid uuid; v_r public.live_readiness;
begin
  select * into v_c from public.campaigns where id = p_campaign for update;
  if not found then perform app.fail('NOT_FOUND'); end if;
  v_uid := app.require_office(v_c.tenant_id, array['office_approver'], true);
  if v_c.environment <> 'LIVE' or app.environment() <> 'LIVE' then
    perform app.fail('FORBIDDEN', 'DEMO環境ではLIVE審査を承認できません');
  end if;
  select * into v_r from public.live_readiness where campaign_id = p_campaign;
  if not (v_r.issuer_authority and v_r.rules_approved and v_r.security_reviewed and v_r.pilot_completed
          and v_r.two_person_approval and v_r.legal_review_ref <> '') then
    perform app.fail('CONFLICT', '実券の開始条件が満たされていません');
  end if;
  if v_c.submitted_by is null or v_c.submitted_by = v_uid or v_r.updated_by = v_uid and v_c.submitted_by = v_uid then
    perform app.fail('FORBIDDEN', '申請者とは別の担当者が承認してください');
  end if;
  update public.campaigns set live_approved_by = v_uid, live_approved_at = now(), version = version + 1, updated_at = now()
  where id = p_campaign returning * into v_c;
  perform app.audit(v_c.tenant_id, 'campaign.approve_live', 'campaign', v_c.id, null, app.campaign_json(v_c));
  return app.campaign_json(v_c);
end $$;

create or replace function public.api_campaign_approve(p_campaign uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_c public.campaigns; v_uid uuid;
begin
  select * into v_c from public.campaigns where id = p_campaign for update;
  if not found then perform app.fail('NOT_FOUND'); end if;
  v_uid := app.require_office(v_c.tenant_id, array['office_approver'], true);
  if v_c.status <> 'draft' or v_c.submitted_at is null then perform app.fail('CONFLICT', '公開申請済みの下書きだけ承認できます'); end if;
  if v_c.submitted_by = v_uid or v_c.created_by = v_uid then perform app.fail('FORBIDDEN', '作成者・申請者とは別の担当者が承認してください'); end if;
  if v_c.environment is distinct from app.environment() then perform app.fail('CONFLICT', '環境が一致しません'); end if;
  if v_c.environment = 'LIVE' and v_c.live_approved_at is null then perform app.fail('CONFLICT', 'LIVE審査が完了していません'); end if;
  update public.campaigns set status = 'active', approved_by = v_uid, approved_at = now(), version = version + 1, updated_at = now()
  where id = p_campaign returning * into v_c;
  perform app.audit(v_c.tenant_id, 'campaign.approve', 'campaign', v_c.id, null, app.campaign_json(v_c));
  return app.campaign_json(v_c);
end $$;

create or replace function public.api_campaign_suspend(p_campaign uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_c public.campaigns; v_uid uuid;
begin
  select * into v_c from public.campaigns where id = p_campaign for update;
  if not found then perform app.fail('NOT_FOUND'); end if;
  v_uid := app.require_office(v_c.tenant_id, array['office_operator', 'office_approver', 'tenant_admin']);
  if v_c.status <> 'active' then perform app.fail('CONFLICT', '受付中の事業だけ停止できます'); end if;
  if coalesce(btrim(p_reason), '') = '' then perform app.fail('VALIDATION', '停止理由を入力してください'); end if;
  update public.campaigns set status = 'suspended', suspended_reason = p_reason, version = version + 1, updated_at = now()
  where id = p_campaign returning * into v_c;
  perform app.audit(v_c.tenant_id, 'campaign.suspend', 'campaign', v_c.id, null, jsonb_build_object('reason', p_reason));
  return app.campaign_json(v_c);
end $$;

create or replace function public.api_campaign_resume(p_campaign uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_c public.campaigns; v_uid uuid;
begin
  select * into v_c from public.campaigns where id = p_campaign for update;
  if not found then perform app.fail('NOT_FOUND'); end if;
  v_uid := app.require_office(v_c.tenant_id, array['office_approver'], true);
  if v_c.status <> 'suspended' then perform app.fail('CONFLICT', '停止中の事業だけ再開できます'); end if;
  update public.campaigns set status = 'active', suspended_reason = null, version = version + 1, updated_at = now()
  where id = p_campaign returning * into v_c;
  perform app.audit(v_c.tenant_id, 'campaign.resume', 'campaign', v_c.id, null, null);
  return app.campaign_json(v_c);
end $$;

create or replace function public.api_campaign_close(p_campaign uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_c public.campaigns; v_uid uuid;
begin
  select * into v_c from public.campaigns where id = p_campaign for update;
  if not found then perform app.fail('NOT_FOUND'); end if;
  v_uid := app.require_office(v_c.tenant_id, array['office_approver'], true);
  if v_c.status = 'closed' then perform app.fail('CONFLICT', '既に終了しています'); end if;
  update public.campaigns set status = 'closed', version = version + 1, updated_at = now() where id = p_campaign returning * into v_c;
  perform app.audit(v_c.tenant_id, 'campaign.close', 'campaign', v_c.id, null, null);
  return app.campaign_json(v_c);
end $$;

-- ---------------------------------------------------------------------------
-- Issuance (two-stage: generate inactive -> receipt check -> activate by another person)
-- ---------------------------------------------------------------------------
create or replace function public.api_issuance_create(
  p_campaign uuid, p_denomination integer, p_valid_from timestamptz, p_valid_until timestamptz,
  p_digests text[], p_key_version integer, p_idem uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_c public.campaigns;
  v_uid uuid;
  v_hash text := app.hash_json(jsonb_build_object('c', p_campaign, 'd', p_denomination, 'f', p_valid_from, 'u', p_valid_until,
                                                  'n', coalesce(array_length(p_digests, 1), 0)));
  v_prev jsonb;
  v_no bigint;
  v_batch uuid;
  v_n integer := coalesce(array_length(p_digests, 1), 0);
  v_result jsonb;
begin
  select * into v_c from public.campaigns where id = p_campaign;
  if not found then perform app.fail('NOT_FOUND'); end if;
  v_uid := app.require_office(v_c.tenant_id, array['office_operator'], true);
  v_prev := app.idem_lookup(v_uid, p_idem, 'issuance.create', v_hash);
  if v_prev is not null then return v_prev || '{"replayed":true}'; end if;
  if v_c.mode <> 'owned_qr' then perform app.fail('UNSUPPORTED', 'この事業はQR券を発行しません'); end if;
  if v_c.status not in ('draft', 'active') then perform app.fail('CONFLICT', '停止・終了した事業では発行できません'); end if;
  if v_c.environment is distinct from app.environment() then perform app.fail('CONFLICT', '環境が一致しません'); end if;
  if v_n not between 1 and 200 then perform app.fail('VALIDATION', '1回の発行は1〜200枚です', '{"fieldErrors":{"count":"1〜200"}}'); end if;
  if not (p_denomination = any (v_c.denominations)) then perform app.fail('VALIDATION', '事業に設定された額面を選んでください'); end if;
  if p_valid_from < v_c.starts_at or p_valid_until > v_c.ends_at or p_valid_until <= p_valid_from then
    perform app.fail('VALIDATION', '有効期間は事業期間内で設定してください');
  end if;
  if (select count(distinct d) from unnest(p_digests) d where d ~ '^[0-9a-f]{64}$') <> v_n then
    perform app.fail('VALIDATION', '券データが不正です');
  end if;
  v_no := app.next_number(v_c.tenant_id, 'issuance_batch');
  insert into public.issuance_batches (tenant_id, campaign_id, batch_number, denomination, count, valid_from, valid_until, key_version, created_by)
  values (v_c.tenant_id, p_campaign, v_no, p_denomination, v_n, p_valid_from, p_valid_until, p_key_version, v_uid)
  returning id into v_batch;
  insert into public.coupons (tenant_id, campaign_id, batch_id, token_digest, key_version, display_number, face_value, valid_from, valid_until)
  select v_c.tenant_id, p_campaign, v_batch, d, p_key_version,
         'B' || lpad(v_no::text, 4, '0') || '-' || lpad(o::text, 3, '0'), p_denomination, p_valid_from, p_valid_until
  from unnest(p_digests) with ordinality as x(d, o);
  v_result := jsonb_build_object('batchId', v_batch, 'batchNumber', v_no, 'count', v_n,
    'displayNumbers', (select jsonb_agg('B' || lpad(v_no::text, 4, '0') || '-' || lpad(o::text, 3, '0') order by o)
                       from generate_series(1, v_n) o));
  perform app.audit(v_c.tenant_id, 'issuance.create', 'issuance_batch', v_batch, null,
                    jsonb_build_object('count', v_n, 'denomination', p_denomination, 'batchNumber', v_no));
  return app.idem_store(v_uid, p_idem, v_c.tenant_id, 'issuance.create', v_hash, v_result);
end $$;

create or replace function public.api_issuance_mark_generated(p_batch uuid, p_object_path text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_b public.issuance_batches; v_uid uuid;
begin
  select * into v_b from public.issuance_batches where id = p_batch for update;
  if not found then perform app.fail('NOT_FOUND'); end if;
  v_uid := app.require_office(v_b.tenant_id, array['office_operator']);
  if v_b.created_by <> v_uid then perform app.fail('FORBIDDEN'); end if;
  if v_b.status <> 'draft' then perform app.fail('CONFLICT', '発行データは既に作成されています'); end if;
  update public.issuance_batches set status = 'generated', encrypted_object_path = p_object_path,
    download_expires_at = now() + interval '24 hours', updated_at = now(), version = version + 1
  where id = p_batch returning * into v_b;
  perform app.audit(v_b.tenant_id, 'issuance.generated', 'issuance_batch', v_b.id, null, jsonb_build_object('expiresAt', v_b.download_expires_at));
  return jsonb_build_object('batchId', v_b.id, 'status', v_b.status, 'downloadExpiresAt', v_b.download_expires_at);
end $$;

create or replace function public.api_issuance_void(p_batch uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_b public.issuance_batches; v_uid uuid; v_n integer;
begin
  select * into v_b from public.issuance_batches where id = p_batch for update;
  if not found then perform app.fail('NOT_FOUND'); end if;
  v_uid := app.require_office(v_b.tenant_id, array['office_operator', 'office_approver']);
  if v_b.status = 'void' then perform app.fail('CONFLICT', '既に破棄されています'); end if;
  if coalesce(btrim(p_reason), '') = '' then perform app.fail('VALIDATION', '破棄理由を入力してください'); end if;
  perform 1 from public.coupons where batch_id = p_batch order by id for update;
  update public.coupons set status = 'void', updated_at = now() where batch_id = p_batch and status in ('inactive', 'active');
  get diagnostics v_n = row_count;
  update public.issuance_batches set status = 'void', voided_by = v_uid, voided_at = now(), void_reason = p_reason,
    updated_at = now(), version = version + 1 where id = p_batch returning * into v_b;
  perform app.audit(v_b.tenant_id, 'issuance.void', 'issuance_batch', v_b.id, null, jsonb_build_object('reason', p_reason, 'voidedCoupons', v_n));
  return jsonb_build_object('batchId', v_b.id, 'status', v_b.status, 'voidedCoupons', v_n);
end $$;

create or replace function public.api_issuance_download_authorize(p_batch uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_b public.issuance_batches; v_uid uuid; v_c public.campaigns;
begin
  select * into v_b from public.issuance_batches where id = p_batch for update;
  if not found then perform app.fail('NOT_FOUND'); end if;
  v_uid := app.require_office(v_b.tenant_id, array['office_operator', 'office_approver'], true);
  if v_b.status <> 'generated' or v_b.encrypted_object_path is null then
    perform app.fail('CONFLICT', '取得できる状態ではありません');
  end if;
  if v_b.download_expires_at <= now() or v_b.object_purged_at is not null then
    perform app.fail('EXPIRED', '取得期限を過ぎました。このバッチを破棄して再発行してください');
  end if;
  update public.issuance_batches set first_downloaded_at = coalesce(first_downloaded_at, now()),
    download_count = download_count + 1, updated_at = now() where id = p_batch returning * into v_b;
  select * into v_c from public.campaigns where id = v_b.campaign_id;
  perform app.audit(v_b.tenant_id, 'issuance.download', 'issuance_batch', v_b.id, null, jsonb_build_object('downloadCount', v_b.download_count));
  return jsonb_build_object('objectPath', v_b.encrypted_object_path, 'batchNumber', v_b.batch_number, 'denomination', v_b.denomination,
    'count', v_b.count, 'validFrom', v_b.valid_from, 'validUntil', v_b.valid_until, 'campaignName', v_c.name,
    'issuer', v_c.issuer, 'environment', v_c.environment, 'tenantId', v_b.tenant_id);
end $$;

create or replace function public.api_issuance_confirm_receipt(p_batch uuid, p_counted integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_b public.issuance_batches; v_uid uuid;
begin
  select * into v_b from public.issuance_batches where id = p_batch for update;
  if not found then perform app.fail('NOT_FOUND'); end if;
  v_uid := app.require_office(v_b.tenant_id, array['office_operator', 'office_approver']);
  if v_b.status <> 'generated' then perform app.fail('CONFLICT', '印刷データ作成済みのバッチだけ確認できます'); end if;
  if v_b.first_downloaded_at is null then perform app.fail('CONFLICT', '印刷データをまだ取得していません'); end if;
  if p_counted is distinct from v_b.count then
    perform app.fail('VALIDATION', '枚数が一致しません。印刷物を数え直すか、バッチを破棄してください',
                     jsonb_build_object('fieldErrors', jsonb_build_object('counted', '発行枚数 ' || v_b.count || ' 枚と一致しません')));
  end if;
  update public.issuance_batches set receipt_confirmed_by = v_uid, receipt_confirmed_at = now(), updated_at = now(), version = version + 1
  where id = p_batch returning * into v_b;
  perform app.audit(v_b.tenant_id, 'issuance.receipt_confirmed', 'issuance_batch', v_b.id, null, jsonb_build_object('counted', p_counted));
  return jsonb_build_object('batchId', v_b.id, 'receiptConfirmedAt', v_b.receipt_confirmed_at);
end $$;

create or replace function public.api_issuance_activate(p_batch uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_b public.issuance_batches; v_uid uuid; v_n integer; v_c public.campaigns;
begin
  select * into v_b from public.issuance_batches where id = p_batch for update;
  if not found then perform app.fail('NOT_FOUND'); end if;
  v_uid := app.require_office(v_b.tenant_id, array['office_approver'], true);
  if v_b.status <> 'generated' then perform app.fail('CONFLICT', '有効化できる状態ではありません'); end if;
  if v_b.receipt_confirmed_at is null then perform app.fail('CONFLICT', '印刷物の受領・枚数確認が済んでいません'); end if;
  if v_b.created_by = v_uid then perform app.fail('FORBIDDEN', '発行した担当者とは別の担当者が有効化してください'); end if;
  select * into v_c from public.campaigns where id = v_b.campaign_id;
  if v_c.status not in ('draft', 'active') then perform app.fail('CONFLICT', '停止・終了した事業の券は有効化できません'); end if;
  perform 1 from public.coupons where batch_id = p_batch order by id for update;
  update public.coupons set status = 'active', updated_at = now() where batch_id = p_batch and status = 'inactive';
  get diagnostics v_n = row_count;
  update public.issuance_batches set status = 'activated', approved_by = v_uid, activated_at = now(), updated_at = now(), version = version + 1
  where id = p_batch returning * into v_b;
  perform app.audit(v_b.tenant_id, 'issuance.activate', 'issuance_batch', v_b.id, null, jsonb_build_object('activated', v_n));
  return jsonb_build_object('batchId', v_b.id, 'status', v_b.status, 'activated', v_n);
end $$;

-- ---------------------------------------------------------------------------
-- Redemption
-- ---------------------------------------------------------------------------
-- p_items: [{ "index": 0, "digests": ["<hex>", ...] }] -- one entry per scanned token; digests
-- are HMACs under every active key version (computed by the server; raw tokens never reach the DB).
create or replace function public.api_receipt_draft_create(p_shop uuid, p_campaign uuid, p_items jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := app.require_shop(p_shop);
  v_uid uuid := auth.uid();
  v_c public.campaigns;
  v_now timestamptz := now();
  v_problem text;
  v_items jsonb := '[]';
  v_problems jsonb := '[]';
  v_codes text[] := '{}';
  v_ids uuid[] := '{}';
  v_amount bigint := 0;
  v_item jsonb;
  v_coupon public.coupons;
  v_draft public.receipt_drafts;
  v_shop_name text;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 10 then
    perform app.fail('VALIDATION', '1回に受け付けられるのは1〜10枚です');
  end if;
  select * into v_c from public.campaigns where id = p_campaign and tenant_id = v_tenant;
  v_problem := app.campaign_problem(v_c, p_shop, v_now);
  if v_problem is not null then
    perform app.fail(case when v_problem in ('UNSUPPORTED', 'ENVIRONMENT_MISMATCH', 'LIVE_NOT_APPROVED') then 'UNSUPPORTED' else 'CONFLICT' end,
                     case v_problem when 'CAMPAIGN_SUSPENDED' then 'この地域券事業は現在受付を停止しています'
                                    when 'SHOP_NOT_ELIGIBLE' then 'この店舗はこの地域券の対象外です'
                                    when 'CAMPAIGN_INACTIVE' then 'この地域券事業は受付期間外です'
                                    else 'この地域券には対応していません' end,
                     jsonb_build_object('reason', v_problem));
  end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_coupon := null;
    select c.* into v_coupon from public.coupons c
    where c.tenant_id = v_tenant
      and c.token_digest in (select jsonb_array_elements_text(v_item -> 'digests'));
    v_problem := app.coupon_problem(v_coupon, v_c, p_shop, v_now);
    if v_problem is null and v_coupon.id = any (v_ids) then
      v_problem := 'DUPLICATE_IN_LIST';
    end if;
    if v_problem is not null then
      v_codes := v_codes || v_problem;
      v_problems := v_problems || jsonb_build_object('index', (v_item ->> 'index')::integer, 'code', v_problem,
        'displayNumber', case when v_problem in ('UNSUPPORTED', 'OTHER_CAMPAIGN') then null else v_coupon.display_number end);
    else
      v_ids := v_ids || v_coupon.id;
      v_amount := v_amount + v_coupon.face_value;
      v_items := v_items || jsonb_build_object('index', (v_item ->> 'index')::integer, 'displayNumber', v_coupon.display_number,
                                               'faceValue', v_coupon.face_value);
    end if;
  end loop;
  if jsonb_array_length(v_problems) > 0 then
    perform app.fail(app.problem_to_error(v_codes), '受け付けられない券があります', jsonb_build_object('items', v_problems));
  end if;
  if v_amount > 1000000 then perform app.fail('VALIDATION', '1回の受付は1,000,000円までです'); end if;
  insert into public.receipt_drafts (tenant_id, shop_id, actor_id, campaign_id, coupon_ids, quote_amount, rules_version, expires_at)
  values (v_tenant, p_shop, v_uid, p_campaign, v_ids, v_amount, v_c.rules_version, v_now + interval '120 seconds')
  returning * into v_draft;
  select display_name into v_shop_name from public.shops where id = p_shop;
  return jsonb_build_object('id', v_draft.id, 'expiresAt', v_draft.expires_at, 'shopId', p_shop, 'shopName', v_shop_name,
    'campaignId', v_c.id, 'campaignName', v_c.name, 'items', v_items, 'amount', v_amount, 'rulesVersion', v_c.rules_version,
    'rulesText', v_c.rules_text, 'environment', v_c.environment);
end $$;

create or replace function app.operation_json(p_op uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('operationId', o.id, 'status', o.status, 'idempotencyKey', o.idempotency_key,
    'receipt', case when r.id is null then null else jsonb_build_object(
      'redemptionId', r.id, 'receiptNumber', r.receipt_number, 'amount', r.amount, 'occurredAt', r.occurred_at,
      'shopId', r.shop_id, 'shopName', s.display_name, 'campaignId', r.campaign_id, 'campaignName', c.name,
      'rulesVersion', r.rules_version, 'status', r.status, 'environment', c.environment,
      'count', (select count(*) from public.redemption_items i where i.redemption_id = r.id),
      'items', (select jsonb_agg(jsonb_build_object('displayNumber', cp.display_number, 'faceValue', i.face_value) order by cp.display_number)
                from public.redemption_items i join public.coupons cp on cp.id = i.coupon_id where i.redemption_id = r.id),
      'reversal', (select jsonb_build_object('id', v.id, 'status', v.status, 'reason', v.reason, 'createdAt', v.created_at)
                   from public.reversals v where v.redemption_id = r.id)) end)
  from public.operations o
  left join public.redemptions r on r.operation_id = o.id
  left join public.shops s on s.id = r.shop_id
  left join public.campaigns c on c.id = r.campaign_id
  where o.id = p_op
$$;

create or replace function public.api_redemption_confirm(p_draft uuid, p_expected_amount bigint, p_idem uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.uid();
  v_hash text := app.hash_json(jsonb_build_object('draft', p_draft, 'amount', p_expected_amount));
  v_op public.operations;
  v_d public.receipt_drafts;
  v_c public.campaigns;
  v_coupon public.coupons;
  v_problem text;
  v_problems jsonb := '[]';
  v_codes text[] := '{}';
  v_sum bigint := 0;
  v_n integer := 0;
  v_now timestamptz := now();
  v_red uuid;
  v_receipt text;
begin
  if p_idem is null then perform app.fail('VALIDATION', 'Idempotency-Key が必要です'); end if;
  -- (a) idempotency: serialize per actor+key, replay stored result
  perform pg_advisory_xact_lock(hashtextextended('redeem:' || v_uid::text || ':' || p_idem::text, 0));
  select * into v_op from public.operations where actor_id = v_uid and idempotency_key = p_idem;
  if found then
    if v_op.request_hash <> v_hash then
      perform app.fail('CONFLICT', '同じ受付キーで異なる内容が送信されました', '{"reason":"IDEMPOTENCY_MISMATCH"}');
    end if;
    return app.operation_json(v_op.id) || '{"replayed":true}';
  end if;
  -- (b) lock the draft and validate ownership / state / expiry
  select * into v_d from public.receipt_drafts where id = p_draft for update;
  if not found or v_d.actor_id <> v_uid then perform app.fail('NOT_FOUND'); end if;
  perform app.require_shop(v_d.shop_id);
  if v_d.status = 'consumed' then
    perform app.fail('CONFLICT', 'この確認画面の受付は既に確定しています。履歴を確認してください',
                     jsonb_build_object('reason', 'DRAFT_CONSUMED',
                                        'operationId', (select id from public.operations where draft_id = p_draft)));
  end if;
  if v_d.expires_at <= v_now then
    perform app.fail('EXPIRED', '確認画面の有効時間(2分)を過ぎました。もう一度読み取ってください', '{"reason":"DRAFT_EXPIRED"}');
  end if;
  if p_expected_amount is distinct from v_d.quote_amount then
    perform app.fail('CONFLICT', '金額が一致しません。もう一度確認してください', '{"reason":"AMOUNT_MISMATCH"}');
  end if;
  -- (c) lock campaign and coupons in a fixed order; re-check every rule on server time
  select * into v_c from public.campaigns where id = v_d.campaign_id for share;
  v_problem := app.campaign_problem(v_c, v_d.shop_id, v_now);
  if v_problem is not null then
    perform app.fail('CONFLICT', '地域券事業の状態が変わったため受け付けできません', jsonb_build_object('reason', v_problem));
  end if;
  if v_c.rules_version <> v_d.rules_version then
    perform app.fail('CONFLICT', '券の規則が更新されました。もう一度読み取ってください', '{"reason":"RULES_CHANGED"}');
  end if;
  for v_coupon in select * from public.coupons where id = any (v_d.coupon_ids) order by id for update loop
    v_n := v_n + 1;
    v_problem := app.coupon_problem(v_coupon, v_c, v_d.shop_id, v_now);
    if v_problem is not null then
      v_codes := v_codes || v_problem;
      v_problems := v_problems || jsonb_build_object('displayNumber', v_coupon.display_number, 'code', v_problem);
    else
      v_sum := v_sum + v_coupon.face_value;
    end if;
  end loop;
  -- (d) all or nothing
  if v_n <> coalesce(array_length(v_d.coupon_ids, 1), 0) then
    perform app.fail('CONFLICT', '券の情報を確認できませんでした', '{"reason":"COUPON_MISSING"}');
  end if;
  if jsonb_array_length(v_problems) > 0 then
    perform app.fail(app.problem_to_error(v_codes), '受け付けられない券があります。全体を取り消しました', jsonb_build_object('items', v_problems));
  end if;
  if v_sum <> v_d.quote_amount then
    perform app.fail('CONFLICT', '金額が一致しません', '{"reason":"AMOUNT_MISMATCH"}');
  end if;
  -- (e) write everything in this transaction
  insert into public.operations (tenant_id, shop_id, actor_id, kind, idempotency_key, request_hash, draft_id, status)
  values (v_d.tenant_id, v_d.shop_id, v_uid, 'redemption', p_idem, v_hash, p_draft, 'confirmed')
  returning * into v_op;
  v_receipt := 'R' || lpad(app.next_number(v_d.tenant_id, 'receipt')::text, 6, '0');
  insert into public.redemptions (tenant_id, operation_id, campaign_id, shop_id, actor_id, amount, occurred_at, rules_version, receipt_number)
  values (v_d.tenant_id, v_op.id, v_d.campaign_id, v_d.shop_id, v_uid, v_sum, v_now, v_d.rules_version, v_receipt)
  returning id into v_red;
  insert into public.redemption_items (tenant_id, redemption_id, coupon_id, face_value)
  select v_d.tenant_id, v_red, c.id, c.face_value from public.coupons c where c.id = any (v_d.coupon_ids);
  update public.coupons set status = 'redeemed', redeemed_operation_id = v_op.id, updated_at = now()
  where id = any (v_d.coupon_ids) and status = 'active';
  update public.receipt_drafts set status = 'consumed' where id = p_draft;
  update public.operations set result_ref = v_red where id = v_op.id;
  perform app.audit(v_d.tenant_id, 'redemption.confirm', 'redemption', v_red, null,
                    jsonb_build_object('amount', v_sum, 'count', v_n, 'receiptNumber', v_receipt), v_d.shop_id);
  -- (f) outbox in the same transaction
  perform app.enqueue(v_d.tenant_id, 'redemption_recorded', v_red, null, 'redemption:' || v_red, jsonb_build_object('amount', v_sum));
  return app.operation_json(v_op.id);
end $$;

-- Operation status for the actor. An unknown id is reported as "pending":
-- nothing has been committed for that key, so retrying with the same key is safe.
create or replace function public.api_operation_get(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := app.uid(); v_op public.operations;
begin
  select * into v_op from public.operations where actor_id = v_uid and (id = p_id or idempotency_key = p_id);
  if not found then
    return jsonb_build_object('operationId', null, 'status', 'pending', 'receipt', null);
  end if;
  return app.operation_json(v_op.id);
end $$;

create or replace function public.api_redemption_get(p_redemption uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_r public.redemptions;
begin
  select * into v_r from public.redemptions where id = p_redemption;
  if not found or not app.can_read_shop(v_r.tenant_id, v_r.shop_id) then perform app.fail('NOT_FOUND'); end if;
  return app.operation_json(v_r.operation_id);
end $$;

-- ---------------------------------------------------------------------------
-- Reversal (full only): request -> approve by a different person (MFA)
-- ---------------------------------------------------------------------------
create or replace function public.api_reversal_request(p_redemption uuid, p_reason text, p_idem uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_r public.redemptions; v_uid uuid := app.uid(); v_prev jsonb; v_id uuid;
  v_hash text := app.hash_json(jsonb_build_object('r', p_redemption, 'reason', p_reason));
begin
  select * into v_r from public.redemptions where id = p_redemption for update;
  if not found or not app.can_read_shop(v_r.tenant_id, v_r.shop_id) then perform app.fail('NOT_FOUND'); end if;
  if not (app.is_shop_owner(v_r.shop_id) or app.has_office_role(v_r.tenant_id, array['office_operator'])) then
    perform app.fail('FORBIDDEN', '取消の申請は店主または事務局が行えます');
  end if;
  if app.has_office_role(v_r.tenant_id, array['office_operator']) and not app.is_shop_owner(v_r.shop_id) then
    perform app.require_office(v_r.tenant_id, array['office_operator']);
  else
    perform app.require_shop(v_r.shop_id, array['shop_owner']);
  end if;
  v_prev := app.idem_lookup(v_uid, p_idem, 'reversal.request', v_hash);
  if v_prev is not null then return v_prev; end if;
  if coalesce(btrim(p_reason), '') = '' then perform app.fail('VALIDATION', '取消の理由を入力してください'); end if;
  if v_r.status <> 'confirmed' then perform app.fail('CONFLICT', '既に取り消されています'); end if;
  if exists (select 1 from public.reversals where redemption_id = p_redemption and status in ('requested', 'approved')) then
    perform app.fail('CONFLICT', '取消の申請は既に受け付けています');
  end if;
  if exists (select 1 from public.reversals where redemption_id = p_redemption and status = 'rejected') then
    perform app.fail('CONFLICT', 'この受付の取消申請は承認されませんでした。事務局へご相談ください');
  end if;
  insert into public.reversals (tenant_id, redemption_id, reason, amount, requested_by)
  values (v_r.tenant_id, p_redemption, btrim(p_reason), v_r.amount, v_uid) returning id into v_id;
  perform app.audit(v_r.tenant_id, 'reversal.request', 'reversal', v_id, null,
                    jsonb_build_object('redemptionId', p_redemption, 'amount', v_r.amount, 'reason', p_reason), v_r.shop_id);
  perform app.notify_office(v_r.tenant_id, array['office_approver'], '地域券受付の取消申請があります', '/o', 'reversal', v_id, 'reversal.request:' || v_id);
  return app.idem_store(v_uid, p_idem, v_r.tenant_id, 'reversal.request', v_hash,
                        jsonb_build_object('reversalId', v_id, 'status', 'requested', 'amount', v_r.amount));
end $$;

create or replace function public.api_reversal_decide(p_reversal uuid, p_approve boolean, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_v public.reversals; v_r public.redemptions; v_uid uuid; v_settled boolean;
begin
  select * into v_v from public.reversals where id = p_reversal for update;
  if not found then perform app.fail('NOT_FOUND'); end if;
  v_uid := app.require_office(v_v.tenant_id, array['office_approver'], true);
  if v_v.status <> 'requested' then perform app.fail('CONFLICT', '既に判断済みです'); end if;
  if v_v.requested_by = v_uid then perform app.fail('FORBIDDEN', '申請者本人は承認できません'); end if;
  select * into v_r from public.redemptions where id = v_v.redemption_id for update;
  if not p_approve then
    update public.reversals set status = 'rejected', approved_by = null, decided_at = now(), decision_note = p_note where id = p_reversal;
    perform app.audit(v_v.tenant_id, 'reversal.reject', 'reversal', v_v.id, null, jsonb_build_object('note', p_note), v_r.shop_id);
    return jsonb_build_object('reversalId', v_v.id, 'status', 'rejected');
  end if;
  update public.reversals set status = 'approved', approved_by = v_uid, decided_at = now(), decision_note = p_note where id = p_reversal;
  update public.redemptions set status = 'reversed' where id = v_r.id;
  -- coupons stay unusable forever: retired, never reactivated
  update public.coupons set status = 'retired', updated_at = now()
  where id in (select coupon_id from public.redemption_items where redemption_id = v_r.id);
  v_settled := exists (select 1 from public.settlement_sources ss join public.settlement_lines l on l.id = ss.line_id
                       join public.settlement_batches b on b.id = l.batch_id
                       where ss.source_type = 'redemption' and ss.source_id = v_r.id and b.status not in ('draft', 'review'));
  perform app.audit(v_v.tenant_id, 'reversal.approve', 'reversal', v_v.id, null,
                    jsonb_build_object('redemptionId', v_r.id, 'amount', v_r.amount, 'afterSettlementApproval', v_settled), v_r.shop_id);
  perform app.notify_shop(v_v.tenant_id, v_r.shop_id, '地域券受付の取消が承認されました（' || v_r.receipt_number || '）',
                          '/m/receipts/' || v_r.operation_id, 'reversal', v_v.id, 'reversal.approve:' || v_v.id);
  return jsonb_build_object('reversalId', v_v.id, 'status', 'approved', 'requiresAdjustment', v_settled);
end $$;

-- ---------------------------------------------------------------------------
-- Paper reports
-- ---------------------------------------------------------------------------
create or replace function app.paper_json(p public.paper_reports) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', p.id, 'campaignId', p.campaign_id, 'shopId', p.shop_id, 'receivedDate', p.received_date,
    'denominationCounts', p.denomination_counts, 'claimedAmount', p.claimed_amount, 'photoIds', to_jsonb(p.photo_ids),
    'originalBundleRef', p.original_bundle_ref, 'status', p.status, 'verifiedAmount', p.verified_amount,
    'differenceReason', p.difference_reason, 'returnReason', p.return_reason, 'originalPresent', p.original_present,
    'originalStorage', p.original_storage, 'originalReturnStatus', p.original_return_status,
    'submittedAt', p.submitted_at, 'verifiedAt', p.verified_at, 'version', p.version)
$$;

create or replace function app.paper_amount(p_campaign public.campaigns, p_counts jsonb) returns bigint
language plpgsql immutable set search_path = '' as $$
declare v_total bigint := 0; k text; v jsonb; n bigint;
begin
  if jsonb_typeof(p_counts) <> 'object' then perform app.fail('VALIDATION', '枚数が不正です'); end if;
  for k, v in select * from jsonb_each(p_counts) loop
    if k !~ '^[0-9]{1,6}$' or not (k::integer = any (p_campaign.denominations)) then
      perform app.fail('VALIDATION', '事業にない額面です');
    end if;
    if jsonb_typeof(v) <> 'number' or (v::text) !~ '^[0-9]{1,5}$' then perform app.fail('VALIDATION', '枚数は0以上の整数で入力してください'); end if;
    n := (v::text)::bigint;
    v_total := v_total + n * k::bigint;
  end loop;
  if v_total < 1 or v_total > 1000000 then perform app.fail('VALIDATION', '合計は1〜1,000,000円で入力してください'); end if;
  return v_total;
end $$;

create or replace function public.api_paper_report_save(
  p_id uuid, p_shop uuid, p_campaign uuid, p_received_date date, p_counts jsonb, p_photo_ids uuid[],
  p_bundle_ref text, p_expected_version integer, p_idem uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := app.require_shop(p_shop);
  v_uid uuid := auth.uid();
  v_c public.campaigns;
  v_p public.paper_reports;
  v_amount bigint;
  v_prev jsonb;
  v_hash text := app.hash_json(jsonb_build_object('id', p_id, 's', p_shop, 'c', p_campaign, 'd', p_received_date, 'n', p_counts,
                                                  'p', p_photo_ids, 'b', p_bundle_ref, 'v', p_expected_version));
begin
  select * into v_c from public.campaigns where id = p_campaign and tenant_id = v_tenant;
  if not found or v_c.mode <> 'paper_count' then perform app.fail('NOT_FOUND'); end if;
  if v_c.status <> 'active' or not app.shop_eligible(p_campaign, p_shop, now()) then
    perform app.fail('CONFLICT', 'この紙券事業は現在申告できません');
  end if;
  if p_received_date is null or p_received_date > app.jst_date(now()) or p_received_date < app.jst_date(v_c.starts_at) then
    perform app.fail('VALIDATION', '受取日が事業期間外です', '{"fieldErrors":{"receivedDate":"事業期間内の日付"}}');
  end if;
  if coalesce(array_length(p_photo_ids, 1), 0) > 3 then perform app.fail('VALIDATION', '写真は3枚までです'); end if;
  if exists (select 1 from unnest(p_photo_ids) x where not exists (
      select 1 from public.attachments a where a.id = x and a.tenant_id = v_tenant and a.shop_id = p_shop and a.scan_status = 'clean')) then
    perform app.fail('VALIDATION', '写真を確認できません');
  end if;
  v_amount := app.paper_amount(v_c, p_counts);
  if p_id is null then
    v_prev := app.idem_lookup(v_uid, p_idem, 'paper.create', v_hash);
    if v_prev is not null then return v_prev; end if;
    insert into public.paper_reports (tenant_id, campaign_id, shop_id, received_date, denomination_counts, claimed_amount, photo_ids,
                                      original_bundle_ref, created_by)
    values (v_tenant, p_campaign, p_shop, p_received_date, p_counts, v_amount, coalesce(p_photo_ids, '{}'), coalesce(btrim(p_bundle_ref), ''), v_uid)
    returning * into v_p;
    update public.attachments set parent_type = 'paper_report', parent_id = v_p.id where id = any (p_photo_ids);
    perform app.audit(v_tenant, 'paper.create', 'paper_report', v_p.id, null, app.paper_json(v_p), p_shop);
    return app.idem_store(v_uid, p_idem, v_tenant, 'paper.create', v_hash, app.paper_json(v_p));
  end if;
  update public.paper_reports set received_date = p_received_date, denomination_counts = p_counts, claimed_amount = v_amount,
    photo_ids = coalesce(p_photo_ids, '{}'), original_bundle_ref = coalesce(btrim(p_bundle_ref), ''),
    version = version + 1, updated_at = now()
  where id = p_id and shop_id = p_shop and status in ('draft', 'returned') and version = p_expected_version
  returning * into v_p;
  if not found then perform app.fail('CONFLICT', '他の操作で更新されたか、編集できない状態です'); end if;
  update public.attachments set parent_type = 'paper_report', parent_id = v_p.id where id = any (p_photo_ids);
  perform app.audit(v_tenant, 'paper.update', 'paper_report', v_p.id, null, app.paper_json(v_p), p_shop);
  return app.paper_json(v_p);
end $$;

create or replace function public.api_paper_report_submit(p_id uuid, p_expected_version integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_p public.paper_reports; v_tenant uuid;
begin
  select * into v_p from public.paper_reports where id = p_id;
  if not found then perform app.fail('NOT_FOUND'); end if;
  v_tenant := app.require_shop(v_p.shop_id);
  update public.paper_reports set status = 'submitted', submitted_by = auth.uid(), submitted_at = now(),
    version = version + 1, updated_at = now()
  where id = p_id and status in ('draft', 'returned') and version = p_expected_version returning * into v_p;
  if not found then perform app.fail('CONFLICT', '提出できない状態です。再読み込みしてください'); end if;
  perform app.audit(v_tenant, 'paper.submit', 'paper_report', v_p.id, null, jsonb_build_object('claimedAmount', v_p.claimed_amount), v_p.shop_id);
  perform app.notify_office(v_tenant, array['office_operator'], '紙券の申告が届きました', '/o/campaigns/' || v_p.campaign_id, 'paper_report', v_p.id, 'paper.submit:' || v_p.id || ':' || v_p.version);
  return app.paper_json(v_p);
end $$;

-- Office: verify the originals (sets verified_amount), return to shop, or reject.
create or replace function public.api_paper_report_review(
  p_id uuid, p_action text, p_verified_amount bigint, p_reason text, p_original_present boolean,
  p_original_storage text, p_original_return_status text, p_expected_version integer
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_p public.paper_reports; v_uid uuid;
begin
  select * into v_p from public.paper_reports where id = p_id for update;
  if not found then perform app.fail('NOT_FOUND'); end if;
  v_uid := app.require_office(v_p.tenant_id, array['office_operator']);
  if v_p.status <> 'submitted' or v_p.version <> p_expected_version then
    perform app.fail('CONFLICT', '確認できない状態です。再読み込みしてください');
  end if;
  if p_action = 'verify' then
    if p_verified_amount is null or p_verified_amount < 0 or p_verified_amount > 1000000 then
      perform app.fail('VALIDATION', '確認額を入力してください');
    end if;
    if p_verified_amount <> v_p.claimed_amount and coalesce(btrim(p_reason), '') = '' then
      perform app.fail('VALIDATION', '申告額と確認額が異なる場合は理由が必要です', '{"fieldErrors":{"reason":"差異の理由"}}');
    end if;
    if p_original_present is null then perform app.fail('VALIDATION', '原本の有無を記録してください'); end if;
    if v_p.original_bundle_ref = '' then perform app.fail('VALIDATION', '原本束番号がない申告は確認済みにできません'); end if;
    if exists (select 1 from public.paper_reports x where x.campaign_id = v_p.campaign_id and x.original_bundle_ref = v_p.original_bundle_ref
               and x.status = 'verified' and x.id <> v_p.id) then
      perform app.fail('CONFLICT', 'この原本束番号は同じ事業で確認済みです');
    end if;
    update public.paper_reports set status = 'verified', verified_amount = p_verified_amount,
      difference_reason = nullif(btrim(coalesce(p_reason, '')), ''), original_present = p_original_present,
      original_storage = coalesce(p_original_storage, ''), original_return_status = coalesce(p_original_return_status, ''),
      verified_by = v_uid, verified_at = now(), version = version + 1, updated_at = now()
    where id = p_id returning * into v_p;
  elsif p_action = 'return' then
    if coalesce(btrim(p_reason), '') = '' then perform app.fail('VALIDATION', '差戻しの理由を入力してください'); end if;
    update public.paper_reports set status = 'returned', return_reason = p_reason, version = version + 1, updated_at = now()
    where id = p_id returning * into v_p;
    perform app.notify_shop(v_p.tenant_id, v_p.shop_id, '紙券の申告が差し戻されました', '/m/paper/' || v_p.id, 'paper_report', v_p.id, 'paper.return:' || v_p.id || ':' || v_p.version);
  elsif p_action = 'reject' then
    if coalesce(btrim(p_reason), '') = '' then perform app.fail('VALIDATION', '理由を入力してください'); end if;
    update public.paper_reports set status = 'rejected', return_reason = p_reason, verified_by = v_uid, verified_at = now(),
      version = version + 1, updated_at = now() where id = p_id returning * into v_p;
  else
    perform app.fail('VALIDATION', '操作が不正です');
  end if;
  perform app.audit(v_p.tenant_id, 'paper.' || p_action, 'paper_report', v_p.id, null, app.paper_json(v_p), v_p.shop_id);
  return app.paper_json(v_p);
end $$;

-- ---------------------------------------------------------------------------
-- External CSV records (not a payment API). Server parses and validates the
-- file format; the DB re-validates business rules and stages rows.
-- p_rows: [{row, provider, provider_transaction_id, shop_external_code, amount_jpy, occurred_at, status,
--           original_transaction_id, error?}]
-- ---------------------------------------------------------------------------
create or replace function app.import_restage(p_import uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_i public.external_imports; r record; v_status text; v_err text; v_existing public.external_transactions;
  v_orig_amount bigint; v_summary jsonb;
begin
  select * into v_i from public.external_imports where id = p_import;
  for r in select * from public.external_import_rows where import_id = p_import and (row_status <> 'error' or error_code in ('UNKNOWN_SHOP'))
           order by source_row loop
    v_status := 'ok'; v_err := null;
    if r.shop_id is null then
      v_status := 'unknown_shop'; v_err := 'UNKNOWN_SHOP';
    else
      select * into v_existing from public.external_transactions t
      where t.campaign_id = v_i.campaign_id and t.provider = r.provider and t.provider_transaction_id = r.provider_transaction_id;
      if found then
        if v_existing.shop_id = r.shop_id and v_existing.amount = r.amount and v_existing.occurred_at = r.occurred_at
           and v_existing.status = r.tx_status and coalesce(v_existing.original_transaction_id, '') = r.original_transaction_id then
          v_status := 'duplicate';
        else
          v_status := 'conflict'; v_err := 'CONFLICT_EXISTING';
        end if;
      elsif exists (select 1 from public.external_import_rows x where x.import_id = p_import and x.provider = r.provider
                    and x.provider_transaction_id = r.provider_transaction_id and x.source_row < r.source_row) then
        v_status := 'conflict'; v_err := 'DUPLICATE_IN_FILE';
      elsif r.tx_status = 'reversed' then
        select amount into v_orig_amount from (
          select t.amount from public.external_transactions t
          where t.campaign_id = v_i.campaign_id and t.provider = r.provider and t.provider_transaction_id = r.original_transaction_id
            and t.status = 'confirmed' and t.shop_id = r.shop_id
          union all
          select x.amount from public.external_import_rows x
          where x.import_id = p_import and x.provider = r.provider and x.provider_transaction_id = r.original_transaction_id
            and x.tx_status = 'confirmed' and x.shop_id = r.shop_id and x.source_row < r.source_row) o limit 1;
        if v_orig_amount is null then
          v_status := 'error'; v_err := 'ORIGINAL_NOT_FOUND';
        elsif v_orig_amount <> r.amount then
          v_status := 'unsupported'; v_err := 'PARTIAL_REVERSAL_UNSUPPORTED';
        elsif exists (select 1 from public.external_transactions t where t.campaign_id = v_i.campaign_id and t.provider = r.provider
                      and t.original_transaction_id = r.original_transaction_id and t.status = 'reversed')
           or exists (select 1 from public.external_import_rows x where x.import_id = p_import and x.provider = r.provider
                      and x.original_transaction_id = r.original_transaction_id and x.tx_status = 'reversed' and x.source_row < r.source_row) then
          v_status := 'conflict'; v_err := 'ALREADY_REVERSED';
        end if;
        v_orig_amount := null;
      end if;
    end if;
    update public.external_import_rows set row_status = v_status, error_code = v_err
    where import_id = p_import and source_row = r.source_row;
  end loop;
  select jsonb_build_object(
    'rows', count(*),
    'ok', count(*) filter (where row_status = 'ok'),
    'duplicate', count(*) filter (where row_status = 'duplicate'),
    'conflict', count(*) filter (where row_status = 'conflict'),
    'error', count(*) filter (where row_status = 'error'),
    'unknownShop', count(*) filter (where row_status = 'unknown_shop'),
    'unsupported', count(*) filter (where row_status = 'unsupported'),
    'confirmedAmount', coalesce(sum(amount) filter (where row_status = 'ok' and tx_status = 'confirmed'), 0),
    'reversedAmount', coalesce(sum(amount) filter (where row_status = 'ok' and tx_status = 'reversed'), 0))
  into v_summary from public.external_import_rows where import_id = p_import;
  update public.external_imports set summary = v_summary,
    status = case when (v_summary ->> 'conflict')::int + (v_summary ->> 'error')::int + (v_summary ->> 'unknownShop')::int
                       + (v_summary ->> 'unsupported')::int = 0 then 'validated' else 'staged' end
  where id = p_import;
  return v_summary;
end $$;

create or replace function app.import_json(p_import uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', i.id, 'campaignId', i.campaign_id, 'sourceName', i.source_name, 'fileName', i.file_name,
    'fileHash', i.file_hash, 'status', i.status, 'summary', i.summary, 'createdAt', i.created_at, 'committedAt', i.committed_at,
    'rows', coalesce((select jsonb_agg(jsonb_build_object('row', r.source_row, 'provider', r.provider,
        'providerTransactionId', r.provider_transaction_id, 'shopExternalCode', r.shop_external_code, 'shopId', r.shop_id,
        'shopName', s.display_name, 'amount', r.amount, 'occurredAt', r.occurred_at, 'status', r.tx_status,
        'originalTransactionId', r.original_transaction_id, 'rowStatus', r.row_status, 'errorCode', r.error_code) order by r.source_row)
      from public.external_import_rows r left join public.shops s on s.id = r.shop_id where r.import_id = i.id), '[]'))
  from public.external_imports i where i.id = p_import
$$;

create or replace function public.api_external_import_stage(
  p_campaign uuid, p_source_name text, p_file_name text, p_file_hash text, p_rows jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_c public.campaigns; v_uid uuid; v_id uuid; v_existing uuid; r jsonb; v_shop uuid; v_err text;
begin
  select * into v_c from public.campaigns where id = p_campaign;
  if not found then perform app.fail('NOT_FOUND'); end if;
  v_uid := app.require_office(v_c.tenant_id, array['office_operator']);
  if v_c.mode <> 'external_csv' then perform app.fail('UNSUPPORTED', 'この事業は外部実績CSVの対象ではありません'); end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) not between 1 and 10000 then
    perform app.fail('VALIDATION', '1ファイル1〜10,000行です');
  end if;
  select id into v_existing from public.external_imports where campaign_id = p_campaign and file_hash = p_file_hash and status <> 'rejected';
  if v_existing is not null then
    return app.import_json(v_existing) || '{"existing":true}';
  end if;
  insert into public.external_imports (tenant_id, campaign_id, source_name, file_name, file_hash, actor_id)
  values (v_c.tenant_id, p_campaign, btrim(p_source_name), left(coalesce(p_file_name, ''), 200), p_file_hash, v_uid) returning id into v_id;
  for r in select * from jsonb_array_elements(p_rows) loop
    v_err := nullif(r ->> 'error', '');
    v_shop := null;
    if v_err is null then
      select id into v_shop from public.shops where tenant_id = v_c.tenant_id and external_code = r ->> 'shop_external_code';
      if v_shop is not null and not app.shop_eligible(p_campaign, v_shop, (r ->> 'occurred_at')::timestamptz) then
        v_err := 'SHOP_NOT_ELIGIBLE';
      elsif (r ->> 'occurred_at')::timestamptz < v_c.starts_at or (r ->> 'occurred_at')::timestamptz >= v_c.ends_at then
        v_err := 'OUT_OF_PERIOD';
      end if;
    end if;
    insert into public.external_import_rows (tenant_id, import_id, source_row, provider, provider_transaction_id, shop_external_code,
      shop_id, amount, occurred_at, tx_status, original_transaction_id, row_status, error_code, raw)
    values (v_c.tenant_id, v_id, (r ->> 'row')::integer, coalesce(r ->> 'provider', ''), coalesce(r ->> 'provider_transaction_id', ''),
      coalesce(r ->> 'shop_external_code', ''), v_shop,
      case when v_err is null then (r ->> 'amount_jpy')::bigint end,
      case when v_err is null then (r ->> 'occurred_at')::timestamptz end,
      coalesce(r ->> 'status', ''), coalesce(r ->> 'original_transaction_id', ''),
      case when v_err is not null then 'error' when v_shop is null then 'unknown_shop' else 'ok' end,
      coalesce(v_err, case when v_shop is null then 'UNKNOWN_SHOP' end), r);
  end loop;
  perform app.import_restage(v_id);
  perform app.audit(v_c.tenant_id, 'external_import.stage', 'external_import', v_id, null,
                    (select summary from public.external_imports where id = v_id));
  return app.import_json(v_id);
end $$;

create or replace function public.api_external_import_get(p_import uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_t uuid;
begin
  select tenant_id into v_t from public.external_imports where id = p_import;
  if v_t is null or not app.is_office(v_t) then perform app.fail('NOT_FOUND'); end if;
  return app.import_json(p_import);
end $$;

-- Assign an unknown shop code to a shop of the same tenant (manual mapping).
create or replace function public.api_external_import_map_shop(p_import uuid, p_code text, p_shop uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_i public.external_imports; v_uid uuid;
begin
  select * into v_i from public.external_imports where id = p_import for update;
  if not found then perform app.fail('NOT_FOUND'); end if;
  v_uid := app.require_office(v_i.tenant_id, array['office_operator']);
  if v_i.status not in ('staged', 'validated') then perform app.fail('CONFLICT', '確定済みの取込は変更できません'); end if;
  if not exists (select 1 from public.shops where id = p_shop and tenant_id = v_i.tenant_id) then
    perform app.fail('VALIDATION', '同じ組織の店舗を選んでください');
  end if;
  update public.external_import_rows set shop_id = p_shop, row_status = 'ok', error_code = null
  where import_id = p_import and shop_external_code = p_code and row_status = 'unknown_shop';
  perform app.import_restage(p_import);
  perform app.audit(v_i.tenant_id, 'external_import.map_shop', 'external_import', p_import, null, jsonb_build_object('code', p_code, 'shopId', p_shop));
  return app.import_json(p_import);
end $$;

create or replace function public.api_external_import_commit(p_import uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_i public.external_imports; v_uid uuid; v_summary jsonb; v_n integer;
begin
  select * into v_i from public.external_imports where id = p_import for update;
  if not found then perform app.fail('NOT_FOUND'); end if;
  v_uid := app.require_office(v_i.tenant_id, array['office_operator']);
  if v_i.status = 'committed' then return app.import_json(p_import) || '{"replayed":true}'; end if;
  v_summary := app.import_restage(p_import);
  if (v_summary ->> 'conflict')::int + (v_summary ->> 'error')::int + (v_summary ->> 'unknownShop')::int + (v_summary ->> 'unsupported')::int > 0 then
    perform app.fail('CONFLICT', 'エラー・差分・不明店の行があるため確定できません', jsonb_build_object('summary', v_summary));
  end if;
  insert into public.external_transactions (tenant_id, campaign_id, provider, provider_transaction_id, shop_id, amount, occurred_at,
                                            status, original_transaction_id, import_id, source_row)
  select v_i.tenant_id, v_i.campaign_id, r.provider, r.provider_transaction_id, r.shop_id, r.amount, r.occurred_at, r.tx_status,
         nullif(r.original_transaction_id, ''), p_import, r.source_row
  from public.external_import_rows r where r.import_id = p_import and r.row_status = 'ok' order by r.source_row;
  get diagnostics v_n = row_count;
  update public.external_imports set status = 'committed', committed_by = v_uid, committed_at = now() where id = p_import;
  perform app.audit(v_i.tenant_id, 'external_import.commit', 'external_import', p_import, null, v_summary || jsonb_build_object('inserted', v_n));
  return app.import_json(p_import);
end $$;

create or replace function public.api_external_import_reject(p_import uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_i public.external_imports; v_uid uuid;
begin
  select * into v_i from public.external_imports where id = p_import for update;
  if not found then perform app.fail('NOT_FOUND'); end if;
  v_uid := app.require_office(v_i.tenant_id, array['office_operator']);
  if v_i.status = 'committed' then perform app.fail('CONFLICT', '確定済みの取込は取り消せません'); end if;
  update public.external_imports set status = 'rejected' where id = p_import;
  perform app.audit(v_i.tenant_id, 'external_import.reject', 'external_import', p_import, null, null);
  return app.import_json(p_import);
end $$;

select app.lock_down_functions();
