-- Bank accounts (encrypted, two-person approval) and settlements:
-- generate -> review -> approve (other person) -> export worklist -> bank results -> confirm (other person).

create table public.bank_accounts (
  tenant_id uuid not null,
  shop_id uuid not null,
  id uuid not null default gen_random_uuid() unique,
  version integer not null,
  encrypted_payload text not null,
  key_version integer not null,
  display_label text not null check (char_length(display_label) <= 120),
  masked_suffix text not null check (masked_suffix ~ '^[0-9]{4}$'),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_by uuid not null,
  approved_by uuid,
  decided_at timestamptz,
  decision_note text,
  approval_evidence_id uuid,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (shop_id, version),
  foreign key (tenant_id, shop_id) references public.shops (tenant_id, id),
  check (approved_by is null or approved_by <> requested_by)
);
create unique index bank_accounts_one_pending on public.bank_accounts (shop_id) where status = 'pending';

create table public.settlement_batches (
  tenant_id uuid not null,
  id uuid not null default gen_random_uuid() unique,
  batch_number bigint not null,
  campaign_id uuid not null,
  period_start timestamptz not null,
  period_end timestamptz not null,
  status text not null default 'draft' check (status in ('draft', 'review', 'approved', 'exported', 'partially_confirmed', 'confirmed', 'exception')),
  total_amount bigint not null default 0,
  prepared_by uuid not null,
  submitted_by uuid,
  submitted_at timestamptz,
  approved_by uuid,
  approved_at timestamptz,
  frozen_at timestamptz,
  hash text,
  scheduled_payment_date date,
  export_count integer not null default 0,
  last_exported_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  primary key (tenant_id, id),
  unique (tenant_id, batch_number),
  check (period_end > period_start),
  check (approved_by is null or approved_by <> prepared_by),
  foreign key (tenant_id, campaign_id) references public.campaigns (tenant_id, id)
);

create table public.settlement_lines (
  tenant_id uuid not null,
  id uuid not null default gen_random_uuid() unique,
  batch_id uuid not null,
  shop_id uuid not null,
  bank_account_id uuid,
  bank_account_version integer,
  gross_amount bigint not null check (gross_amount >= 0),
  reversal_amount bigint not null check (reversal_amount >= 0),
  net_amount bigint not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'exported', 'confirmed', 'failed', 'exception', 'held', 'resolved')),
  exception_reason text,
  expected_date date,
  shop_declared_at timestamptz,
  resolved_by uuid,
  resolved_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (batch_id, shop_id),
  check (net_amount = gross_amount - reversal_amount),
  foreign key (tenant_id, batch_id) references public.settlement_batches (tenant_id, id),
  foreign key (tenant_id, shop_id) references public.shops (tenant_id, id)
);

create table public.settlement_sources (
  tenant_id uuid not null,
  line_id uuid not null,
  source_type text not null check (source_type in ('redemption', 'redemption_reversal', 'paper', 'external')),
  source_id uuid not null,
  signed_amount bigint not null,
  occurred_at timestamptz not null,
  primary key (tenant_id, source_type, source_id),  -- the same record is never settled twice
  foreign key (tenant_id, line_id) references public.settlement_lines (tenant_id, id)
);
create index on public.settlement_sources (line_id);

create table public.bank_result_imports (
  tenant_id uuid not null,
  id uuid not null default gen_random_uuid() unique,
  batch_id uuid not null,
  file_name text not null default '',
  file_hash text not null check (file_hash ~ '^[0-9a-f]{64}$'),
  raw_object_path text,
  status text not null default 'staged' check (status in ('staged', 'confirmed', 'rejected')),
  summary jsonb not null default '{}',
  uploaded_by uuid not null,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, batch_id) references public.settlement_batches (tenant_id, id),
  check (reviewed_by is null or reviewed_by <> uploaded_by)
);
create unique index bank_result_imports_hash on public.bank_result_imports (batch_id, file_hash) where status <> 'rejected';

create table public.bank_result_rows (
  tenant_id uuid not null,
  import_id uuid not null,
  source_row integer not null,
  line_id uuid,
  bank_reference text not null default '',
  amount bigint,
  result text not null default '',
  executed_date date,
  row_status text not null check (row_status in ('ok', 'error')),
  error_code text,
  raw jsonb not null,
  primary key (tenant_id, import_id, source_row),
  foreign key (tenant_id, import_id) references public.bank_result_imports (tenant_id, id)
);

create table public.bank_results (
  tenant_id uuid not null,
  id uuid not null default gen_random_uuid() unique,
  import_id uuid not null,
  settlement_line_id uuid not null,
  bank_reference text not null,
  amount bigint not null,
  result text not null check (result in ('success', 'failed')),
  executed_date date not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, bank_reference),
  foreign key (tenant_id, import_id) references public.bank_result_imports (tenant_id, id),
  foreign key (tenant_id, settlement_line_id) references public.settlement_lines (tenant_id, id)
);

-- ---------------------------------------------------------------------------
-- Bank account change (shop owner with recent MFA -> approver, other person, MFA)
-- ---------------------------------------------------------------------------
create or replace function public.api_bank_change_request(
  p_shop uuid, p_encrypted_payload text, p_key_version integer, p_display_label text, p_masked_suffix text, p_idem uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := app.require_shop(p_shop, array['shop_owner']); v_uid uuid := auth.uid(); v_prev jsonb; v_id uuid; v_ver integer;
  v_hash text := app.hash_json(jsonb_build_object('s', p_shop, 'l', p_display_label, 'm', p_masked_suffix, 'k', p_key_version));
begin
  if not app.mfa_recent() then
    perform app.fail('MFA_REQUIRED', '口座変更の前に二段階認証で本人確認をしてください', '{"recent":true}');
  end if;
  v_prev := app.idem_lookup(v_uid, p_idem, 'bank.request', v_hash);
  if v_prev is not null then return v_prev; end if;
  if exists (select 1 from public.bank_accounts where shop_id = p_shop and status = 'pending') then
    perform app.fail('CONFLICT', '確認待ちの口座変更があります');
  end if;
  select coalesce(max(version), 0) + 1 into v_ver from public.bank_accounts where shop_id = p_shop;
  insert into public.bank_accounts (tenant_id, shop_id, version, encrypted_payload, key_version, display_label, masked_suffix, requested_by)
  values (v_tenant, p_shop, v_ver, p_encrypted_payload, p_key_version, p_display_label, p_masked_suffix, v_uid) returning id into v_id;
  perform app.audit(v_tenant, 'bank.change_request', 'bank_account', v_id, null,
                    jsonb_build_object('version', v_ver, 'label', p_display_label), p_shop);
  perform app.notify_office(v_tenant, array['office_approver'], '口座変更の申請があります', '/o/shops/' || p_shop, 'bank_account', v_id, 'bank.request:' || v_id);
  return app.idem_store(v_uid, p_idem, v_tenant, 'bank.request', v_hash, jsonb_build_object('id', v_id, 'version', v_ver, 'status', 'pending'));
end $$;

create or replace function public.api_bank_change_decide(p_id uuid, p_approve boolean, p_note text, p_evidence uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_b public.bank_accounts; v_uid uuid;
begin
  select * into v_b from public.bank_accounts where id = p_id for update;
  if not found then perform app.fail('NOT_FOUND'); end if;
  v_uid := app.require_office(v_b.tenant_id, array['office_approver'], true);
  if v_b.status <> 'pending' then perform app.fail('CONFLICT', '既に判断済みです'); end if;
  if v_b.requested_by = v_uid then perform app.fail('FORBIDDEN', '申請者本人は承認できません'); end if;
  if p_approve and coalesce(btrim(p_note), '') = '' then perform app.fail('VALIDATION', '本人確認の方法を記録してください'); end if;
  update public.bank_accounts set status = case when p_approve then 'approved' else 'rejected' end, approved_by = case when p_approve then v_uid end,
    decided_at = now(), decision_note = p_note, approval_evidence_id = p_evidence where id = p_id returning * into v_b;
  perform app.audit(v_b.tenant_id, case when p_approve then 'bank.change_approve' else 'bank.change_reject' end, 'bank_account', v_b.id, null,
                    jsonb_build_object('version', v_b.version, 'label', v_b.display_label), v_b.shop_id);
  perform app.notify_shop(v_b.tenant_id, v_b.shop_id, case when p_approve then '口座変更が承認されました' else '口座変更が承認されませんでした' end,
                          '/m/settings', 'bank_account', v_b.id, 'bank.decide:' || v_b.id);
  return jsonb_build_object('id', v_b.id, 'status', v_b.status, 'version', v_b.version);
end $$;

create or replace function app.current_bank(p_shop uuid) returns public.bank_accounts
language sql stable security definer set search_path = '' as $$
  select * from public.bank_accounts where shop_id = p_shop and status = 'approved' order by version desc limit 1
$$;

create or replace function public.api_bank_accounts_for_shop(p_shop uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_tenant uuid;
begin
  select tenant_id into v_tenant from public.shops where id = p_shop;
  if v_tenant is null or not (app.is_shop_owner(p_shop) or app.has_office_role(v_tenant, array['office_operator', 'office_approver', 'tenant_admin', 'auditor'])) then
    perform app.fail('NOT_FOUND');
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'version', b.version, 'label', b.display_label,
      'maskedSuffix', b.masked_suffix, 'status', b.status, 'requestedBy', b.requested_by, 'approvedBy', b.approved_by,
      'decidedAt', b.decided_at, 'createdAt', b.created_at) order by b.version desc)
    from public.bank_accounts b where b.shop_id = p_shop), '[]');
end $$;

-- ---------------------------------------------------------------------------
-- Settlements
-- ---------------------------------------------------------------------------
create or replace function app.settlement_json(p_batch uuid, p_include_sources boolean default false) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', b.id, 'batchNumber', b.batch_number, 'campaignId', b.campaign_id, 'campaignName', c.name,
    'campaignMode', c.mode, 'periodStart', b.period_start, 'periodEnd', b.period_end, 'status', b.status, 'totalAmount', b.total_amount,
    'preparedBy', b.prepared_by, 'preparedName', (select display_name from public.profiles where user_id = b.prepared_by),
    'approvedBy', b.approved_by, 'approvedName', (select display_name from public.profiles where user_id = b.approved_by),
    'approvedAt', b.approved_at, 'hash', b.hash, 'scheduledPaymentDate', b.scheduled_payment_date, 'exportCount', b.export_count,
    'lastExportedAt', b.last_exported_at, 'version', b.version, 'createdAt', b.created_at,
    'lines', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'shopId', l.shop_id, 'shopName', s.display_name,
        'grossAmount', l.gross_amount, 'reversalAmount', l.reversal_amount, 'netAmount', l.net_amount, 'status', l.status,
        'exceptionReason', l.exception_reason, 'bankAccountVersion', l.bank_account_version,
        'bankLabel', (select ba.display_label from public.bank_accounts ba where ba.id = l.bank_account_id),
        'shopDeclaredAt', l.shop_declared_at, 'sourceCount', (select count(*) from public.settlement_sources ss where ss.line_id = l.id),
        'sourceSum', (select coalesce(sum(ss.signed_amount), 0) from public.settlement_sources ss where ss.line_id = l.id),
        'sources', case when p_include_sources then (select coalesce(jsonb_agg(jsonb_build_object('type', ss.source_type, 'id', ss.source_id,
            'amount', ss.signed_amount, 'occurredAt', ss.occurred_at) order by ss.occurred_at), '[]')
            from public.settlement_sources ss where ss.line_id = l.id) end) order by s.display_name)
      from public.settlement_lines l join public.shops s on s.id = l.shop_id where l.batch_id = b.id), '[]'),
    'bankImports', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'fileName', i.file_name, 'status', i.status, 'summary', i.summary,
        'uploadedBy', i.uploaded_by, 'reviewedBy', i.reviewed_by, 'createdAt', i.created_at) order by i.created_at)
      from public.bank_result_imports i where i.batch_id = b.id), '[]'))
  from public.settlement_batches b join public.campaigns c on c.id = b.campaign_id where b.id = p_batch
$$;

-- Collect unsettled sources into lines. Period is [start, end).
create or replace function app.settlement_fill(p_batch uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_b public.settlement_batches; v_c public.campaigns; r record; v_line uuid;
begin
  select * into v_b from public.settlement_batches where id = p_batch;
  select * into v_c from public.campaigns where id = v_b.campaign_id;
  create temporary table if not exists tmp_sources (shop_id uuid, source_type text, source_id uuid, signed_amount bigint, occurred_at timestamptz) on commit drop;
  truncate tmp_sources;
  if v_c.mode = 'owned_qr' then
    insert into tmp_sources
    select r.shop_id, 'redemption', r.id, r.amount, r.occurred_at from public.redemptions r
    where r.campaign_id = v_c.id and r.occurred_at >= v_b.period_start and r.occurred_at < v_b.period_end
      and not exists (select 1 from public.settlement_sources ss where ss.source_type = 'redemption' and ss.source_id = r.id);
    -- approved full reversals: only once the original is settled (earlier batch) or included in this batch
    insert into tmp_sources
    select r.shop_id, 'redemption_reversal', v.id, -v.amount, v.decided_at from public.reversals v
    join public.redemptions r on r.id = v.redemption_id
    where r.campaign_id = v_c.id and v.status = 'approved' and v.decided_at < v_b.period_end
      and not exists (select 1 from public.settlement_sources ss where ss.source_type = 'redemption_reversal' and ss.source_id = v.id)
      and (exists (select 1 from public.settlement_sources ss where ss.source_type = 'redemption' and ss.source_id = r.id)
           or exists (select 1 from tmp_sources t where t.source_type = 'redemption' and t.source_id = r.id));
  elsif v_c.mode = 'paper_count' then
    insert into tmp_sources
    select p.shop_id, 'paper', p.id, p.verified_amount, (p.received_date::timestamp at time zone 'Asia/Tokyo') from public.paper_reports p
    where p.campaign_id = v_c.id and p.status = 'verified' and p.verified_amount > 0
      and (p.received_date::timestamp at time zone 'Asia/Tokyo') >= v_b.period_start
      and (p.received_date::timestamp at time zone 'Asia/Tokyo') < v_b.period_end
      and not exists (select 1 from public.settlement_sources ss where ss.source_type = 'paper' and ss.source_id = p.id);
  else
    insert into tmp_sources
    select t.shop_id, 'external', t.id, case when t.status = 'confirmed' then t.amount else -t.amount end, t.occurred_at
    from public.external_transactions t
    where t.campaign_id = v_c.id and t.occurred_at >= v_b.period_start and t.occurred_at < v_b.period_end
      and not exists (select 1 from public.settlement_sources ss where ss.source_type = 'external' and ss.source_id = t.id);
  end if;
  for r in select shop_id, coalesce(sum(signed_amount) filter (where signed_amount > 0), 0) gross,
                  coalesce(-sum(signed_amount) filter (where signed_amount < 0), 0) rev
           from tmp_sources group by shop_id loop
    insert into public.settlement_lines (tenant_id, batch_id, shop_id, gross_amount, reversal_amount, net_amount, expected_date,
                                         status, exception_reason)
    values (v_b.tenant_id, p_batch, r.shop_id, r.gross, r.rev, r.gross - r.rev, v_b.scheduled_payment_date,
            case when r.gross - r.rev < 0 then 'exception' else 'pending' end,
            case when r.gross - r.rev < 0 then 'NEGATIVE_ADJUSTMENT' end)
    returning id into v_line;
    insert into public.settlement_sources (tenant_id, line_id, source_type, source_id, signed_amount, occurred_at)
    select v_b.tenant_id, v_line, t.source_type, t.source_id, t.signed_amount, t.occurred_at from tmp_sources t where t.shop_id = r.shop_id;
  end loop;
  update public.settlement_batches set total_amount = coalesce((select sum(net_amount) from public.settlement_lines where batch_id = p_batch and net_amount > 0), 0)
  where id = p_batch;
end $$;

create or replace function app.month_bounds(p_month text, out o_start timestamptz, out o_end timestamptz)
language plpgsql immutable set search_path = '' as $$
begin
  if p_month !~ '^\d{4}-(0[1-9]|1[0-2])$' then perform app.fail('VALIDATION', '対象月の形式が不正です'); end if;
  o_start := ((p_month || '-01')::date)::timestamp at time zone 'Asia/Tokyo';
  o_end := (((p_month || '-01')::date + interval '1 month')::date)::timestamp at time zone 'Asia/Tokyo';
end $$;

create or replace function public.api_settlement_generate(
  p_campaign uuid, p_month text, p_period_start timestamptz, p_period_end timestamptz, p_payment_date date, p_idem uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_c public.campaigns; v_uid uuid; v_prev jsonb; v_start timestamptz; v_end timestamptz; v_id uuid; v_no bigint;
  v_hash text := app.hash_json(jsonb_build_object('c', p_campaign, 'm', p_month, 's', p_period_start, 'e', p_period_end, 'p', p_payment_date));
begin
  select * into v_c from public.campaigns where id = p_campaign;
  if not found then perform app.fail('NOT_FOUND'); end if;
  v_uid := app.require_office(v_c.tenant_id, array['office_operator']);
  v_prev := app.idem_lookup(v_uid, p_idem, 'settlement.generate', v_hash);
  if v_prev is not null then return v_prev; end if;
  if p_month is not null then
    select o_start, o_end into v_start, v_end from app.month_bounds(p_month);
  else
    v_start := p_period_start; v_end := p_period_end;
  end if;
  if v_start is null or v_end is null or v_end <= v_start then perform app.fail('VALIDATION', '期間を確認してください'); end if;
  if v_end > now() then perform app.fail('VALIDATION', '締め日(期間の終了)が来てから集計してください'); end if;
  -- serialize generation per campaign so the same source cannot be picked twice
  perform pg_advisory_xact_lock(hashtextextended('settle:' || p_campaign, 0));
  if exists (select 1 from public.settlement_batches where campaign_id = p_campaign and status in ('draft', 'review')) then
    perform app.fail('CONFLICT', '承認前の精算案があります。先に確認・承認するか破棄してください');
  end if;
  v_no := app.next_number(v_c.tenant_id, 'settlement');
  insert into public.settlement_batches (tenant_id, batch_number, campaign_id, period_start, period_end, prepared_by, scheduled_payment_date)
  values (v_c.tenant_id, v_no, p_campaign, v_start, v_end, v_uid, p_payment_date) returning id into v_id;
  perform app.settlement_fill(v_id);
  perform app.audit(v_c.tenant_id, 'settlement.generate', 'settlement_batch', v_id, null,
                    jsonb_build_object('periodStart', v_start, 'periodEnd', v_end, 'total', (select total_amount from public.settlement_batches where id = v_id)));
  return app.idem_store(v_uid, p_idem, v_c.tenant_id, 'settlement.generate', v_hash, app.settlement_json(v_id));
end $$;

create or replace function public.api_settlement_recalculate(p_batch uuid, p_expected_version integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_b public.settlement_batches; v_uid uuid;
begin
  select * into v_b from public.settlement_batches where id = p_batch for update;
  if not found then perform app.fail('NOT_FOUND'); end if;
  v_uid := app.require_office(v_b.tenant_id, array['office_operator']);
  if v_b.status not in ('draft', 'review') or v_b.version <> p_expected_version then
    perform app.fail('CONFLICT', '承認前の最新版だけ再計算できます');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('settle:' || v_b.campaign_id, 0));
  delete from public.settlement_sources where line_id in (select id from public.settlement_lines where batch_id = p_batch);
  delete from public.settlement_lines where batch_id = p_batch;
  update public.settlement_batches set status = 'draft', prepared_by = v_uid, submitted_by = null, submitted_at = null,
    version = version + 1, updated_at = now() where id = p_batch;
  perform app.settlement_fill(p_batch);
  perform app.audit(v_b.tenant_id, 'settlement.recalculate', 'settlement_batch', p_batch, jsonb_build_object('total', v_b.total_amount),
                    jsonb_build_object('total', (select total_amount from public.settlement_batches where id = p_batch)));
  return app.settlement_json(p_batch);
end $$;

-- Discard an unapproved draft (no money effect yet). Frees its sources.
create or replace function public.api_settlement_discard(p_batch uuid, p_expected_version integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_b public.settlement_batches; v_uid uuid;
begin
  select * into v_b from public.settlement_batches where id = p_batch for update;
  if not found then perform app.fail('NOT_FOUND'); end if;
  v_uid := app.require_office(v_b.tenant_id, array['office_operator']);
  if v_b.status not in ('draft', 'review') or v_b.version <> p_expected_version then perform app.fail('CONFLICT', '承認前の精算案だけ破棄できます'); end if;
  perform app.audit(v_b.tenant_id, 'settlement.discard', 'settlement_batch', p_batch, app.settlement_json(p_batch), null);
  delete from public.settlement_sources where line_id in (select id from public.settlement_lines where batch_id = p_batch);
  delete from public.settlement_lines where batch_id = p_batch;
  delete from public.settlement_batches where id = p_batch;
  return jsonb_build_object('discarded', true);
end $$;

-- Blocking issues before review/approval/export.
create or replace function app.settlement_blockers(p_batch uuid, p_stage text) returns jsonb
language sql stable security definer set search_path = '' as $$
  with b as (select * from public.settlement_batches where id = p_batch),
  c as (select * from public.campaigns where id = (select campaign_id from b)),
  issues as (
    select 'PENDING_REVERSAL' code, s.display_name shop from public.settlement_sources ss
      join public.settlement_lines l on l.id = ss.line_id join public.shops s on s.id = l.shop_id
      join public.reversals v on v.redemption_id = ss.source_id
      where l.batch_id = p_batch and ss.source_type = 'redemption' and v.status = 'requested'
    union all
    select 'RECALC_REQUIRED', s.display_name from public.settlement_sources ss
      join public.settlement_lines l on l.id = ss.line_id join public.shops s on s.id = l.shop_id
      join public.reversals v on v.redemption_id = ss.source_id
      where l.batch_id = p_batch and ss.source_type = 'redemption' and v.status = 'approved' and p_stage <> 'export'
        and not exists (select 1 from public.settlement_sources x where x.source_type = 'redemption_reversal' and x.source_id = v.id)
    union all
    select 'UNVERIFIED_PAPER', s.display_name from public.paper_reports p join public.shops s on s.id = p.shop_id
      where p.campaign_id = (select campaign_id from b) and p.status = 'submitted'
        and (p.received_date::timestamp at time zone 'Asia/Tokyo') < (select period_end from b)
    union all
    select 'UNCOMMITTED_IMPORT', '' from public.external_imports i
      where i.campaign_id = (select campaign_id from b) and i.status in ('staged', 'validated')
    union all
    select 'BANK_CHANGE_PENDING', s.display_name from public.settlement_lines l join public.shops s on s.id = l.shop_id
      where l.batch_id = p_batch and l.net_amount > 0 and exists (select 1 from public.bank_accounts ba where ba.shop_id = l.shop_id and ba.status = 'pending')
    union all
    select 'NO_BANK_ACCOUNT', s.display_name from public.settlement_lines l join public.shops s on s.id = l.shop_id
      where l.batch_id = p_batch and l.net_amount > 0 and (app.current_bank(l.shop_id)).id is null
    union all
    select 'BANK_CHANGED_AFTER_APPROVAL', s.display_name from public.settlement_lines l join public.shops s on s.id = l.shop_id
      where l.batch_id = p_batch and p_stage = 'export' and l.status in ('approved', 'exported', 'failed')
        and l.bank_account_id is distinct from (app.current_bank(l.shop_id)).id
    union all
    select 'TOTAL_MISMATCH', '' where p_stage <> 'review' and (
      exists (select 1 from public.settlement_lines l where l.batch_id = p_batch
              and l.net_amount <> (select coalesce(sum(ss.signed_amount), 0) from public.settlement_sources ss where ss.line_id = l.id))
      or (select total_amount from b) <> (select coalesce(sum(net_amount), 0) from public.settlement_lines where batch_id = p_batch and net_amount > 0))
  )
  select coalesce(jsonb_agg(distinct jsonb_build_object('code', code, 'shop', shop)), '[]') from issues
$$;

create or replace function public.api_settlement_submit_review(p_batch uuid, p_expected_version integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_b public.settlement_batches; v_uid uuid; v_blockers jsonb;
begin
  select * into v_b from public.settlement_batches where id = p_batch for update;
  if not found then perform app.fail('NOT_FOUND'); end if;
  v_uid := app.require_office(v_b.tenant_id, array['office_operator']);
  if v_b.status <> 'draft' or v_b.version <> p_expected_version then perform app.fail('CONFLICT', '下書きの最新版だけ確認に回せます'); end if;
  if not exists (select 1 from public.settlement_lines where batch_id = p_batch) then perform app.fail('VALIDATION', '対象の実績がありません'); end if;
  v_blockers := app.settlement_blockers(p_batch, 'review');
  if jsonb_array_length(v_blockers) > 0 then
    perform app.fail('CONFLICT', '確認が必要な例外があります', jsonb_build_object('blockers', v_blockers));
  end if;
  update public.settlement_batches set status = 'review', submitted_by = v_uid, submitted_at = now(), version = version + 1, updated_at = now()
  where id = p_batch;
  perform app.audit(v_b.tenant_id, 'settlement.submit_review', 'settlement_batch', p_batch, null, null);
  perform app.notify_office(v_b.tenant_id, array['office_approver'], '精算案の承認依頼があります', '/o/settlements/' || p_batch, 'settlement', p_batch, 'settle.review:' || p_batch || ':' || v_b.version);
  return app.settlement_json(p_batch);
end $$;

create or replace function public.api_settlement_approve(p_batch uuid, p_expected_version integer, p_approve boolean, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_b public.settlement_batches; v_uid uuid; v_blockers jsonb; v_hash text; r record; v_bank public.bank_accounts;
begin
  select * into v_b from public.settlement_batches where id = p_batch for update;
  if not found then perform app.fail('NOT_FOUND'); end if;
  v_uid := app.require_office(v_b.tenant_id, array['office_approver'], true);
  if v_b.status <> 'review' or v_b.version <> p_expected_version then perform app.fail('CONFLICT', '確認中の最新版だけ承認できます'); end if;
  if v_b.prepared_by = v_uid or v_b.submitted_by = v_uid then perform app.fail('FORBIDDEN', '作成者とは別の担当者が承認してください'); end if;
  if not p_approve then
    if coalesce(btrim(p_note), '') = '' then perform app.fail('VALIDATION', '差戻しの理由を入力してください'); end if;
    update public.settlement_batches set status = 'draft', version = version + 1, updated_at = now() where id = p_batch;
    perform app.audit(v_b.tenant_id, 'settlement.return', 'settlement_batch', p_batch, null, jsonb_build_object('note', p_note));
    return app.settlement_json(p_batch);
  end if;
  v_blockers := app.settlement_blockers(p_batch, 'approve');
  if jsonb_array_length(v_blockers) > 0 then
    perform app.fail('CONFLICT', '確認が必要な例外があります', jsonb_build_object('blockers', v_blockers));
  end if;
  for r in select * from public.settlement_lines where batch_id = p_batch for update loop
    v_bank := app.current_bank(r.shop_id);
    update public.settlement_lines set bank_account_id = v_bank.id, bank_account_version = v_bank.version,
      status = case when status = 'pending' then case when net_amount = 0 then 'resolved' else 'approved' end else status end,
      updated_at = now()
    where id = r.id;
  end loop;
  select encode(extensions.digest(convert_to(string_agg(l.shop_id || ':' || l.net_amount || ':' || coalesce(l.bank_account_version, 0) || ':' ||
           (select string_agg(ss.source_type || '/' || ss.source_id || '/' || ss.signed_amount, ',' order by ss.source_type, ss.source_id)
            from public.settlement_sources ss where ss.line_id = l.id), ';' order by l.shop_id), 'UTF8'), 'sha256'), 'hex')
  into v_hash from public.settlement_lines l where l.batch_id = p_batch;
  update public.settlement_batches set status = 'approved', approved_by = v_uid, approved_at = now(), frozen_at = now(), hash = v_hash,
    version = version + 1, updated_at = now() where id = p_batch;
  perform app.audit(v_b.tenant_id, 'settlement.approve', 'settlement_batch', p_batch, null, jsonb_build_object('hash', v_hash, 'total', v_b.total_amount));
  return app.settlement_json(p_batch);
end $$;

-- Mark lines for the payment worklist (not a bank file). Returns the lines to
-- include; the server decrypts bank data via svc_settlement_bank_payloads.
create or replace function public.api_settlement_export(p_batch uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_b public.settlement_batches; v_uid uuid; v_blockers jsonb; v_reexport boolean; v_lines jsonb;
begin
  select * into v_b from public.settlement_batches where id = p_batch for update;
  if not found then perform app.fail('NOT_FOUND'); end if;
  v_uid := app.require_office(v_b.tenant_id, array['office_operator', 'office_approver'], true);
  if v_b.status not in ('approved', 'exported', 'partially_confirmed', 'exception') then
    perform app.fail('CONFLICT', '承認済みの精算だけ支払作業票を出力できます');
  end if;
  v_blockers := app.settlement_blockers(p_batch, 'export');
  if jsonb_array_length(v_blockers) > 0 then
    perform app.fail('CONFLICT', '出力できない例外があります', jsonb_build_object('blockers', v_blockers));
  end if;
  -- hold lines whose redemptions were reversed after approval (adjust, do not pay silently)
  update public.settlement_lines l set status = 'held', exception_reason = 'REVERSAL_AFTER_APPROVAL', updated_at = now()
  where l.batch_id = p_batch and l.status in ('approved', 'exported', 'failed') and exists (
    select 1 from public.settlement_sources ss join public.reversals v on v.redemption_id = ss.source_id
    where ss.line_id = l.id and ss.source_type = 'redemption' and v.status in ('requested', 'approved'));
  v_reexport := v_b.export_count > 0;
  update public.settlement_lines set status = 'exported', updated_at = now() where batch_id = p_batch and status in ('approved', 'failed');
  select coalesce(jsonb_agg(jsonb_build_object('lineId', l.id, 'shopId', l.shop_id, 'shopName', s.display_name, 'netAmount', l.net_amount,
           'bankAccountId', l.bank_account_id, 'bankLabel', ba.display_label, 'expectedDate', coalesce(l.expected_date, v_b.scheduled_payment_date))
           order by s.display_name), '[]')
  into v_lines from public.settlement_lines l join public.shops s on s.id = l.shop_id left join public.bank_accounts ba on ba.id = l.bank_account_id
  where l.batch_id = p_batch and l.status = 'exported';
  update public.settlement_batches set status = case when status = 'approved' then 'exported' else status end,
    export_count = export_count + 1, last_exported_at = now(), updated_at = now() where id = p_batch returning * into v_b;
  perform app.audit(v_b.tenant_id, case when v_reexport then 'settlement.reexport' else 'settlement.export' end, 'settlement_batch', p_batch, null,
                    jsonb_build_object('lines', jsonb_array_length(v_lines), 'hash', v_b.hash, 'exportCount', v_b.export_count));
  return jsonb_build_object('batchId', v_b.id, 'batchNumber', v_b.batch_number, 'hash', v_b.hash, 'reexport', v_reexport,
                            'exportCount', v_b.export_count, 'lines', v_lines);
end $$;

create or replace function public.svc_settlement_bank_payloads(p_batch uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('lineId', l.id, 'payload', ba.encrypted_payload, 'keyVersion', ba.key_version)), '[]')
  from public.settlement_lines l join public.bank_accounts ba on ba.id = l.bank_account_id
  where l.batch_id = p_batch and l.status = 'exported'
$$;

-- Stage bank results: rows [{row, line_id, bank_reference, amount_jpy, result, executed_date, error?}]
create or replace function public.api_bank_results_stage(p_batch uuid, p_file_name text, p_file_hash text, p_raw_path text, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_b public.settlement_batches; v_uid uuid; v_id uuid; v_existing uuid; r jsonb; v_err text; v_line public.settlement_lines; v_summary jsonb;
begin
  select * into v_b from public.settlement_batches where id = p_batch for update;
  if not found then perform app.fail('NOT_FOUND'); end if;
  v_uid := app.require_office(v_b.tenant_id, array['office_operator', 'office_approver']);
  if v_b.status not in ('exported', 'partially_confirmed', 'exception') then perform app.fail('CONFLICT', '支払作業票を出力した精算だけ結果を取り込めます'); end if;
  select id into v_existing from public.bank_result_imports where batch_id = p_batch and file_hash = p_file_hash and status <> 'rejected';
  if v_existing is not null then
    return jsonb_build_object('importId', v_existing, 'existing', true, 'summary', (select summary from public.bank_result_imports where id = v_existing));
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) not between 1 and 10000 then perform app.fail('VALIDATION', '行がありません'); end if;
  insert into public.bank_result_imports (tenant_id, batch_id, file_name, file_hash, raw_object_path, uploaded_by)
  values (v_b.tenant_id, p_batch, left(coalesce(p_file_name, ''), 200), p_file_hash, p_raw_path, v_uid) returning id into v_id;
  for r in select * from jsonb_array_elements(p_rows) loop
    v_err := nullif(r ->> 'error', '');
    v_line := null;
    if v_err is null then
      select * into v_line from public.settlement_lines where id = (r ->> 'line_id')::uuid and batch_id = p_batch;
      if v_line.id is null then v_err := 'LINE_NOT_IN_BATCH';
      elsif v_line.status = 'confirmed' then v_err := 'ALREADY_CONFIRMED';
      elsif v_line.status <> 'exported' then v_err := 'LINE_NOT_EXPORTED';
      elsif exists (select 1 from public.bank_results x where x.tenant_id = v_b.tenant_id and x.bank_reference = r ->> 'bank_reference') then
        v_err := 'DUPLICATE_BANK_REFERENCE';
      elsif exists (select 1 from public.bank_result_rows x where x.import_id = v_id and (x.bank_reference = r ->> 'bank_reference' or x.line_id = v_line.id)) then
        v_err := 'DUPLICATE_IN_FILE';
      end if;
    end if;
    insert into public.bank_result_rows (tenant_id, import_id, source_row, line_id, bank_reference, amount, result, executed_date, row_status, error_code, raw)
    values (v_b.tenant_id, v_id, (r ->> 'row')::integer, v_line.id, coalesce(r ->> 'bank_reference', ''),
            case when v_err is null then (r ->> 'amount_jpy')::bigint end, coalesce(r ->> 'result', ''),
            case when v_err is null then (r ->> 'executed_date')::date end,
            case when v_err is null then 'ok' else 'error' end, v_err, r);
  end loop;
  select jsonb_build_object('rows', count(*), 'ok', count(*) filter (where row_status = 'ok'), 'error', count(*) filter (where row_status = 'error'),
    'success', count(*) filter (where row_status = 'ok' and result = 'success'), 'failed', count(*) filter (where row_status = 'ok' and result = 'failed'),
    'amountMismatch', count(*) filter (where row_status = 'ok' and amount <> (select net_amount from public.settlement_lines l where l.id = line_id)),
    'missingLines', (select count(*) from public.settlement_lines l where l.batch_id = p_batch and l.status = 'exported'
                     and not exists (select 1 from public.bank_result_rows x where x.import_id = v_id and x.line_id = l.id and x.row_status = 'ok')))
  into v_summary from public.bank_result_rows where import_id = v_id;
  update public.bank_result_imports set summary = v_summary where id = v_id;
  perform app.audit(v_b.tenant_id, 'bank_results.stage', 'settlement_batch', p_batch, null, v_summary || jsonb_build_object('importId', v_id));
  return jsonb_build_object('importId', v_id, 'existing', false, 'summary', v_summary,
    'rows', (select jsonb_agg(jsonb_build_object('row', source_row, 'lineId', line_id, 'bankReference', bank_reference, 'amount', amount,
               'result', result, 'executedDate', executed_date, 'rowStatus', row_status, 'errorCode', error_code) order by source_row)
             from public.bank_result_rows where import_id = v_id));
end $$;

-- Confirm by a person other than the uploader. Only success + exact amount confirms a line.
create or replace function public.api_bank_results_confirm(p_import uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_i public.bank_result_imports; v_b public.settlement_batches; v_uid uuid; r record; v_total integer; v_conf integer; v_bad integer;
begin
  select * into v_i from public.bank_result_imports where id = p_import for update;
  if not found then perform app.fail('NOT_FOUND'); end if;
  v_uid := app.require_office(v_i.tenant_id, array['office_operator', 'office_approver'], true);
  if v_i.status <> 'staged' then perform app.fail('CONFLICT', 'この取込は確定済みまたは取消済みです'); end if;
  if v_i.uploaded_by = v_uid then perform app.fail('FORBIDDEN', '取り込んだ担当者とは別の担当者が確定してください'); end if;
  select * into v_b from public.settlement_batches where id = v_i.batch_id for update;
  for r in select x.*, l.net_amount, l.status line_status from public.bank_result_rows x join public.settlement_lines l on l.id = x.line_id
           where x.import_id = p_import and x.row_status = 'ok' order by x.source_row loop
    if r.line_status <> 'exported' then continue; end if;
    insert into public.bank_results (tenant_id, import_id, settlement_line_id, bank_reference, amount, result, executed_date)
    values (v_i.tenant_id, p_import, r.line_id, r.bank_reference, r.amount, r.result, r.executed_date);
    update public.settlement_lines set
      status = case when r.result = 'success' and r.amount = r.net_amount then 'confirmed'
                    when r.result = 'failed' then 'failed' else 'exception' end,
      exception_reason = case when r.result = 'success' and r.amount = r.net_amount then null
                              when r.result = 'failed' then 'BANK_FAILED'
                              when r.amount < r.net_amount then 'UNDERPAID' else 'OVERPAID' end,
      updated_at = now()
    where id = r.line_id;
  end loop;
  update public.bank_result_imports set status = 'confirmed', reviewed_by = v_uid, reviewed_at = now() where id = p_import;
  select count(*) filter (where net_amount > 0 or status not in ('resolved')),
         count(*) filter (where status in ('confirmed', 'resolved')),
         count(*) filter (where status in ('failed', 'exception', 'held'))
  into v_total, v_conf, v_bad from public.settlement_lines where batch_id = v_b.id;
  update public.settlement_batches set status = case when v_bad > 0 then 'exception'
                                                     when v_conf = (select count(*) from public.settlement_lines where batch_id = v_b.id) then 'confirmed'
                                                     when v_conf > 0 then 'partially_confirmed' else status end,
    version = version + 1, updated_at = now() where id = v_b.id;
  perform app.audit(v_i.tenant_id, 'bank_results.confirm', 'settlement_batch', v_b.id, null, jsonb_build_object('importId', p_import));
  for r in select l.shop_id, l.id, l.status from public.settlement_lines l
           join public.bank_result_rows x on x.line_id = l.id and x.import_id = p_import where x.row_status = 'ok' loop
    perform app.notify_shop(v_i.tenant_id, r.shop_id,
      case when r.status = 'confirmed' then '地域券の振込結果を確認しました' else '地域券の精算に確認が必要な点があります' end,
      '/m/settlements', 'settlement_line', r.id, 'settle.line:' || r.id || ':' || r.status);
  end loop;
  return app.settlement_json(v_b.id);
end $$;

-- Resolve an exception/held line after a separate operational decision (not automatic offset).
create or replace function public.api_settlement_line_resolve(p_line uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_l public.settlement_lines; v_b public.settlement_batches; v_uid uuid; v_bad integer; v_conf integer; v_all integer;
begin
  select * into v_l from public.settlement_lines where id = p_line for update;
  if not found then perform app.fail('NOT_FOUND'); end if;
  select * into v_b from public.settlement_batches where id = v_l.batch_id for update;
  v_uid := app.require_office(v_l.tenant_id, array['office_approver'], true);
  if v_l.status not in ('exception', 'held', 'failed') then perform app.fail('CONFLICT', '要確認の行だけ解消できます'); end if;
  if v_b.prepared_by = v_uid then perform app.fail('FORBIDDEN', '作成者とは別の担当者が判断してください'); end if;
  if coalesce(btrim(p_note), '') = '' then perform app.fail('VALIDATION', '判断の内容と証跡を記録してください'); end if;
  update public.settlement_lines set status = 'resolved', resolved_by = v_uid, resolved_note = p_note, updated_at = now() where id = p_line;
  select count(*), count(*) filter (where status in ('confirmed', 'resolved')), count(*) filter (where status in ('failed', 'exception', 'held'))
  into v_all, v_conf, v_bad from public.settlement_lines where batch_id = v_b.id;
  if v_b.status not in ('draft', 'review') then
    update public.settlement_batches set status = case when v_bad > 0 then 'exception' when v_conf = v_all then 'confirmed'
                                                       when v_conf > 0 then 'partially_confirmed' else status end,
      updated_at = now(), version = version + 1 where id = v_b.id;
  end if;
  perform app.audit(v_l.tenant_id, 'settlement.line_resolve', 'settlement_line', p_line, jsonb_build_object('status', v_l.status, 'reason', v_l.exception_reason),
                    jsonb_build_object('note', p_note), v_l.shop_id);
  return app.settlement_json(v_b.id);
end $$;

create or replace function public.api_settlement_get(p_batch uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_t uuid;
begin
  select tenant_id into v_t from public.settlement_batches where id = p_batch;
  if v_t is null or not app.is_office(v_t) then perform app.fail('NOT_FOUND'); end if;
  return app.settlement_json(p_batch, true) || jsonb_build_object('blockers', app.settlement_blockers(p_batch, 'approve'));
end $$;

-- Merchant view: own shop lines only, with explicit, separate states.
create or replace function public.api_settlements_for_shop(p_shop uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_tenant uuid := app.require_shop(p_shop);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('lineId', l.id, 'batchNumber', b.batch_number, 'campaignName', c.name,
      'periodStart', b.period_start, 'periodEnd', b.period_end, 'grossAmount', l.gross_amount, 'reversalAmount', l.reversal_amount,
      'netAmount', l.net_amount, 'expectedDate', coalesce(l.expected_date, b.scheduled_payment_date),
      'state', case
        when b.status in ('draft', 'review') then 'aggregating'
        when l.status in ('confirmed') then 'bank_confirmed'
        when l.status in ('exception', 'failed', 'held') then 'needs_check'
        when l.status = 'exported' then 'payment_in_progress'
        when l.status = 'resolved' then 'resolved'
        else 'office_confirmed' end,
      'shopDeclaredAt', l.shop_declared_at,
      'sources', (select jsonb_agg(jsonb_build_object('type', ss.source_type, 'amount', ss.signed_amount, 'occurredAt', ss.occurred_at,
                    'receiptNumber', (select r.receipt_number from public.redemptions r where r.id = ss.source_id
                                      union all select r.receipt_number from public.reversals v join public.redemptions r on r.id = v.redemption_id where v.id = ss.source_id limit 1))
                    order by ss.occurred_at) from public.settlement_sources ss where ss.line_id = l.id))
    order by b.period_start desc, c.name)
    from public.settlement_lines l join public.settlement_batches b on b.id = l.batch_id join public.campaigns c on c.id = b.campaign_id
    where l.shop_id = p_shop), '[]');
end $$;

-- Shop declares receipt in their bank. Never promotes to bank-confirmed.
create or replace function public.api_settlement_line_declare(p_line uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_l public.settlement_lines;
begin
  select * into v_l from public.settlement_lines where id = p_line;
  if not found then perform app.fail('NOT_FOUND'); end if;
  perform app.require_shop(v_l.shop_id, array['shop_owner']);
  update public.settlement_lines set shop_declared_at = coalesce(shop_declared_at, now()) where id = p_line;
  perform app.audit(v_l.tenant_id, 'settlement.shop_declared', 'settlement_line', p_line, null, null, v_l.shop_id);
  return jsonb_build_object('lineId', p_line, 'shopDeclared', true);
end $$;

select app.lock_down_functions();
