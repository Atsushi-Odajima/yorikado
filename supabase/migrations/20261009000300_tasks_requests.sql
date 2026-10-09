-- Tasks (回覧・出欠・休業・写真・店情報変更), responses, acknowledgements,
-- private requests (相談) with internal memos, and attachments.

create table public.attachments (
  tenant_id uuid not null references public.tenants (id),
  id uuid not null default gen_random_uuid() unique,
  shop_id uuid,
  parent_type text check (parent_type in ('request_message', 'paper_report', 'task_response', 'evidence')),
  parent_id uuid,
  object_path text not null,
  mime text,
  size bigint,
  sha256 text,
  width integer,
  height integer,
  scan_status text not null default 'pending' check (scan_status in ('pending', 'clean', 'rejected')),
  reject_reason text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, shop_id) references public.shops (tenant_id, id)
);

create table public.tasks (
  tenant_id uuid not null references public.tenants (id),
  id uuid not null default gen_random_uuid() unique,
  type text not null check (type in ('notice', 'event', 'closure', 'photo', 'shop_change')),
  title text not null check (char_length(title) between 1 and 120),
  body text not null default '' check (char_length(body) <= 4000),
  schema_version integer not null default 1,
  definition_json jsonb not null default '{"questions":[]}',
  due_at timestamptz,
  status text not null default 'draft' check (status in ('draft', 'published', 'closed')),
  published_at timestamptz,
  supersedes_id uuid,
  superseded_by uuid,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  actor_id uuid,
  primary key (tenant_id, id)
);

create table public.task_draft_targets (
  tenant_id uuid not null,
  task_id uuid not null,
  shop_id uuid not null,
  primary key (tenant_id, task_id, shop_id),
  foreign key (tenant_id, task_id) references public.tasks (tenant_id, id),
  foreign key (tenant_id, shop_id) references public.shops (tenant_id, id)
);

create table public.task_recipients (
  tenant_id uuid not null,
  task_id uuid not null,
  shop_id uuid not null,
  assigned_at timestamptz not null default now(),
  last_reminded_at timestamptz,
  primary key (tenant_id, task_id, shop_id),
  foreign key (tenant_id, task_id) references public.tasks (tenant_id, id),
  foreign key (tenant_id, shop_id) references public.shops (tenant_id, id)
);
create index on public.task_recipients (shop_id);

create table public.responses (
  tenant_id uuid not null,
  task_id uuid not null,
  shop_id uuid not null,
  revision integer not null check (revision >= 1),
  payload_json jsonb not null,
  status text not null check (status in ('submitted', 'returned', 'approved')),
  is_current boolean not null default true,
  submitted_by uuid not null,
  proxy_reason text,
  proxy_channel text check (proxy_channel in ('phone', 'paper', 'in_person', 'other')),
  submitted_at timestamptz not null default now(),
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_note text,
  primary key (tenant_id, task_id, shop_id, revision),
  foreign key (tenant_id, task_id) references public.tasks (tenant_id, id),
  foreign key (tenant_id, shop_id) references public.shops (tenant_id, id),
  check ((proxy_reason is null) = (proxy_channel is null))
);
create unique index responses_one_current on public.responses (task_id, shop_id) where is_current;

create table public.acknowledgements (
  tenant_id uuid not null,
  task_id uuid not null,
  shop_id uuid not null,
  user_id uuid not null,
  confirmed_at timestamptz not null default now(),
  proxy_reason text,
  primary key (tenant_id, task_id, shop_id),
  foreign key (tenant_id, task_id) references public.tasks (tenant_id, id),
  foreign key (tenant_id, shop_id) references public.shops (tenant_id, id)
);

create table public.requests (
  tenant_id uuid not null references public.tenants (id),
  id uuid not null default gen_random_uuid() unique,
  request_number text not null,
  shop_id uuid not null,
  category text not null check (category in ('voucher_payment', 'facility_cleaning', 'other')),
  subject text not null check (char_length(subject) between 1 and 120),
  status text not null default 'received' check (status in ('received', 'in_progress', 'awaiting_shop', 'resolved')),
  assigned_to uuid,
  resolution_note text,
  resolved_at timestamptz,
  related_request_id uuid,
  related_receipt_number text,
  created_by uuid not null,
  last_shop_activity_at timestamptz not null default now(),
  last_office_activity_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  actor_id uuid,
  primary key (tenant_id, id),
  unique (tenant_id, request_number),
  foreign key (tenant_id, shop_id) references public.shops (tenant_id, id)
);
create index on public.requests (shop_id, created_at desc);

create table public.request_messages (
  tenant_id uuid not null,
  request_id uuid not null,
  id uuid not null default gen_random_uuid() unique,
  author_id uuid not null,
  author_side text not null check (author_side in ('shop', 'office')),
  visibility text not null check (visibility in ('shop', 'internal')),
  body text not null check (char_length(body) between 1 and 4000),
  attachment_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, request_id) references public.requests (tenant_id, id),
  check (not (author_side = 'shop' and visibility = 'internal'))
);
create index on public.request_messages (request_id, created_at);

-- ---------------------------------------------------------------------------
-- Attachments: server creates an intent, uploads to quarantine with a signed
-- URL, then finalizes after decoding/re-encoding (svc_attachment_finalize).
-- ---------------------------------------------------------------------------
create or replace function public.api_attachment_intent(p_tenant uuid, p_shop uuid, p_purpose text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := app.uid(); v_id uuid := gen_random_uuid(); v_tenant uuid := p_tenant;
begin
  if p_shop is not null then
    if app.is_shop_member(p_shop) then
      v_tenant := app.require_shop(p_shop);
    else
      select tenant_id into v_tenant from public.shops where id = p_shop;
      if v_tenant is null then perform app.fail('NOT_FOUND'); end if;
      perform app.require_office(v_tenant, array['office_operator', 'office_approver', 'tenant_admin']);
    end if;
  else
    perform app.require_office(v_tenant, array['office_operator', 'office_approver', 'tenant_admin']);
  end if;
  if p_purpose not in ('request_message', 'paper_report', 'task_response', 'evidence') then
    perform app.fail('VALIDATION', '用途が不正です');
  end if;
  if (select count(*) from public.attachments where created_by = v_uid and created_at > now() - interval '1 hour') >= 60 then
    perform app.fail('RATE_LIMITED', '写真の送信回数が多すぎます。しばらくしてからお試しください');
  end if;
  insert into public.attachments (tenant_id, id, shop_id, parent_type, object_path, created_by)
  values (v_tenant, v_id, p_shop, p_purpose, 'quarantine/' || v_tenant || '/' || v_id, v_uid);
  return jsonb_build_object('id', v_id, 'tenantId', v_tenant, 'quarantinePath', 'quarantine/' || v_tenant || '/' || v_id);
end $$;

-- Called by the server (service role) after decode/re-encode succeeded or failed.
create or replace function public.svc_attachment_finalize(
  p_id uuid, p_actor uuid, p_ok boolean, p_object_path text, p_mime text, p_size bigint, p_sha256 text,
  p_width integer, p_height integer, p_reason text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_a public.attachments;
begin
  select * into v_a from public.attachments where id = p_id for update;
  if not found or v_a.created_by <> p_actor then perform app.fail('NOT_FOUND'); end if;
  if v_a.scan_status <> 'pending' then
    return jsonb_build_object('id', v_a.id, 'status', v_a.scan_status, 'sha256', v_a.sha256);
  end if;
  if p_ok then
    update public.attachments set scan_status = 'clean', object_path = p_object_path, mime = p_mime, size = p_size, sha256 = p_sha256,
      width = p_width, height = p_height where id = p_id returning * into v_a;
  else
    update public.attachments set scan_status = 'rejected', reject_reason = left(p_reason, 200) where id = p_id returning * into v_a;
  end if;
  return jsonb_build_object('id', v_a.id, 'status', v_a.scan_status, 'sha256', v_a.sha256,
    'duplicateOf', (select jsonb_agg(x.id) from public.attachments x where x.tenant_id = v_a.tenant_id and x.sha256 = v_a.sha256
                    and x.id <> v_a.id and x.scan_status = 'clean'));
end $$;

create or replace function app.attachment_readable(a public.attachments) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_msg public.request_messages;
begin
  if a.scan_status <> 'clean' then return false; end if;
  if app.is_office(a.tenant_id) then return true; end if;
  if a.created_by = auth.uid() and app.session_valid() then return true; end if;
  if a.shop_id is null or not app.is_shop_member(a.shop_id) then return false; end if;
  -- shop members never see attachments of internal memos
  if a.parent_type = 'request_message' and a.parent_id is not null then
    select * into v_msg from public.request_messages where id = a.parent_id;
    if found and v_msg.visibility = 'internal' then return false; end if;
  end if;
  return true;
end $$;

-- Returns the object path when the caller may download. Server signs a 60s URL.
create or replace function public.api_attachment_authorize_download(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_a public.attachments;
begin
  perform app.uid();
  select * into v_a from public.attachments where id = p_id;
  if not found or not app.attachment_readable(v_a) then perform app.fail('NOT_FOUND'); end if;
  return jsonb_build_object('objectPath', v_a.object_path, 'mime', v_a.mime);
end $$;

create or replace function app.check_attachments(p_ids uuid[], p_tenant uuid, p_shop uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce(array_length(p_ids, 1), 0) > 3 then perform app.fail('VALIDATION', '写真は3枚までです'); end if;
  if exists (select 1 from unnest(p_ids) x where not exists (
      select 1 from public.attachments a where a.id = x and a.tenant_id = p_tenant and a.created_by = auth.uid()
        and a.scan_status = 'clean' and (p_shop is null or a.shop_id = p_shop))) then
    perform app.fail('VALIDATION', '写真を確認できません。もう一度選んでください');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Tasks (office)
-- ---------------------------------------------------------------------------
create or replace function app.task_json(t public.tasks) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', t.id, 'tenantId', t.tenant_id, 'type', t.type, 'title', t.title, 'body', t.body,
    'schemaVersion', t.schema_version, 'definition', t.definition_json, 'dueAt', t.due_at, 'status', t.status,
    'publishedAt', t.published_at, 'supersedesId', t.supersedes_id, 'supersededBy', t.superseded_by, 'version', t.version)
$$;

create or replace function app.validate_definition(p_type text, p_def jsonb) returns void
language plpgsql immutable set search_path = '' as $$
declare q jsonb; v_ids text[] := '{}';
begin
  if jsonb_typeof(p_def) <> 'object' or jsonb_typeof(p_def -> 'questions') <> 'array' then
    perform app.fail('VALIDATION', '質問の定義が不正です');
  end if;
  if jsonb_array_length(p_def -> 'questions') > 5 then perform app.fail('VALIDATION', '質問は5項目までです'); end if;
  if p_type <> 'notice' and jsonb_array_length(p_def -> 'questions') = 0 then
    perform app.fail('VALIDATION', '質問を1項目以上設定してください');
  end if;
  for q in select * from jsonb_array_elements(p_def -> 'questions') loop
    if coalesce(q ->> 'id', '') !~ '^[a-z][a-z0-9_]{0,30}$' or coalesce(btrim(q ->> 'label'), '') = ''
       or coalesce(q ->> 'kind', '') not in ('choice', 'text', 'dates', 'photos', 'number') then
      perform app.fail('VALIDATION', '質問の項目名・種類を確認してください');
    end if;
    if (q ->> 'id') = any (v_ids) then perform app.fail('VALIDATION', '質問IDが重複しています'); end if;
    v_ids := v_ids || (q ->> 'id');
    if q ->> 'kind' = 'choice' and (jsonb_typeof(q -> 'options') <> 'array' or jsonb_array_length(q -> 'options') not between 2 and 6) then
      perform app.fail('VALIDATION', '選択肢は2〜6個で設定してください');
    end if;
  end loop;
end $$;

create or replace function public.api_task_save_draft(
  p_tenant uuid, p_id uuid, p_type text, p_title text, p_body text, p_definition jsonb, p_due_at timestamptz,
  p_shop_ids uuid[], p_expected_version integer, p_idem uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_office(p_tenant, array['office_operator']);
  v_t public.tasks; v_prev jsonb;
  v_hash text := app.hash_json(jsonb_build_object('id', p_id, 'ty', p_type, 'ti', p_title, 'b', p_body, 'd', p_definition,
                                                  'due', p_due_at, 's', p_shop_ids, 'v', p_expected_version));
begin
  perform app.validate_definition(p_type, p_definition);
  if exists (select 1 from unnest(p_shop_ids) s where not exists (select 1 from public.shops x where x.id = s and x.tenant_id = p_tenant)) then
    perform app.fail('VALIDATION', '対象店舗が不正です');
  end if;
  if p_id is null then
    v_prev := app.idem_lookup(v_uid, p_idem, 'task.create', v_hash);
    if v_prev is not null then return v_prev; end if;
    insert into public.tasks (tenant_id, type, title, body, definition_json, due_at, created_by, actor_id)
    values (p_tenant, p_type, btrim(p_title), coalesce(p_body, ''), p_definition, p_due_at, v_uid, v_uid) returning * into v_t;
  else
    update public.tasks set type = p_type, title = btrim(p_title), body = coalesce(p_body, ''), definition_json = p_definition,
      due_at = p_due_at, version = version + 1, updated_at = now(), actor_id = v_uid
    where id = p_id and tenant_id = p_tenant and status = 'draft' and version = p_expected_version returning * into v_t;
    if not found then perform app.fail('CONFLICT', '公開済みの依頼は直接変更できません。改版してください'); end if;
    delete from public.task_draft_targets where task_id = v_t.id;
  end if;
  insert into public.task_draft_targets (tenant_id, task_id, shop_id)
  select p_tenant, v_t.id, s from (select distinct unnest(p_shop_ids) s) x;
  perform app.audit(p_tenant, 'task.save_draft', 'task', v_t.id, null, app.task_json(v_t));
  if p_id is null then
    return app.idem_store(v_uid, p_idem, p_tenant, 'task.create', v_hash, app.task_json(v_t));
  end if;
  return app.task_json(v_t);
end $$;

-- Create a new draft revision of a published task (corrections are new versions).
create or replace function public.api_task_revise(p_task uuid, p_idem uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_old public.tasks; v_uid uuid; v_t public.tasks; v_prev jsonb; v_hash text := app.hash_json(jsonb_build_object('t', p_task));
begin
  select * into v_old from public.tasks where id = p_task;
  if not found then perform app.fail('NOT_FOUND'); end if;
  v_uid := app.require_office(v_old.tenant_id, array['office_operator']);
  v_prev := app.idem_lookup(v_uid, p_idem, 'task.revise', v_hash);
  if v_prev is not null then return v_prev; end if;
  if v_old.status <> 'published' or v_old.superseded_by is not null then perform app.fail('CONFLICT', '公開中の最新版だけ改版できます'); end if;
  insert into public.tasks (tenant_id, type, title, body, definition_json, due_at, supersedes_id, created_by, actor_id)
  values (v_old.tenant_id, v_old.type, v_old.title, v_old.body, v_old.definition_json, v_old.due_at, v_old.id, v_uid, v_uid)
  returning * into v_t;
  insert into public.task_draft_targets (tenant_id, task_id, shop_id)
  select v_old.tenant_id, v_t.id, shop_id from public.task_recipients where task_id = v_old.id;
  return app.idem_store(v_uid, p_idem, v_old.tenant_id, 'task.revise', v_hash, app.task_json(v_t));
end $$;

create or replace function public.api_task_publish(p_task uuid, p_expected_version integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_t public.tasks; v_uid uuid; v_n integer; r record;
begin
  select * into v_t from public.tasks where id = p_task for update;
  if not found then perform app.fail('NOT_FOUND'); end if;
  v_uid := app.require_office(v_t.tenant_id, array['office_operator']);
  if v_t.status <> 'draft' or v_t.version <> p_expected_version then perform app.fail('CONFLICT', '下書きの最新版だけ公開できます'); end if;
  perform app.validate_definition(v_t.type, v_t.definition_json);
  if v_t.due_at is not null and v_t.due_at <= now() then perform app.fail('VALIDATION', '期限が過去になっています'); end if;
  insert into public.task_recipients (tenant_id, task_id, shop_id)
  select d.tenant_id, d.task_id, d.shop_id from public.task_draft_targets d join public.shops s on s.id = d.shop_id
  where d.task_id = p_task and s.status = 'active';
  get diagnostics v_n = row_count;
  if v_n = 0 then perform app.fail('VALIDATION', '対象店舗を1店以上選んでください'); end if;
  update public.tasks set status = 'published', published_at = now(), version = version + 1, updated_at = now()
  where id = p_task returning * into v_t;
  if v_t.supersedes_id is not null then
    update public.tasks set superseded_by = v_t.id, updated_at = now() where id = v_t.supersedes_id;
  end if;
  for r in select shop_id from public.task_recipients where task_id = p_task loop
    perform app.notify_shop(v_t.tenant_id, r.shop_id, '事務局から新しい依頼: ' || v_t.title, '/m/tasks/' || v_t.id, 'task', v_t.id, 'task.publish:' || v_t.id || ':' || r.shop_id);
  end loop;
  perform app.audit(v_t.tenant_id, 'task.publish', 'task', v_t.id, null, jsonb_build_object('recipients', v_n));
  return app.task_json(v_t);
end $$;

create or replace function public.api_task_close(p_task uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_t public.tasks; v_uid uuid;
begin
  select * into v_t from public.tasks where id = p_task for update;
  if not found then perform app.fail('NOT_FOUND'); end if;
  v_uid := app.require_office(v_t.tenant_id, array['office_operator']);
  if v_t.status <> 'published' then perform app.fail('CONFLICT', '公開中の依頼だけ締め切れます'); end if;
  update public.tasks set status = 'closed', version = version + 1, updated_at = now() where id = p_task returning * into v_t;
  perform app.audit(v_t.tenant_id, 'task.close', 'task', v_t.id, null, null);
  return app.task_json(v_t);
end $$;

create or replace function public.api_task_extend(p_task uuid, p_due_at timestamptz) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_t public.tasks; v_uid uuid; v_old timestamptz;
begin
  select * into v_t from public.tasks where id = p_task for update;
  if not found then perform app.fail('NOT_FOUND'); end if;
  v_uid := app.require_office(v_t.tenant_id, array['office_operator']);
  if v_t.status = 'draft' then perform app.fail('CONFLICT', '下書きは編集画面で期限を変更してください'); end if;
  if p_due_at is null or p_due_at <= now() then perform app.fail('VALIDATION', '新しい期限は未来の日時にしてください'); end if;
  v_old := v_t.due_at;
  update public.tasks set due_at = p_due_at, status = 'published', updated_at = now() where id = p_task returning * into v_t;
  perform app.audit(v_t.tenant_id, 'task.extend', 'task', v_t.id, jsonb_build_object('dueAt', v_old), jsonb_build_object('dueAt', p_due_at));
  return app.task_json(v_t);
end $$;

-- Validate a response payload against the published definition.
create or replace function app.validate_payload(p_def jsonb, p_payload jsonb, p_tenant uuid, p_shop uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
declare q jsonb; v jsonb; v_key text;
begin
  if jsonb_typeof(p_payload) <> 'object' then perform app.fail('VALIDATION', '回答が不正です'); end if;
  for v_key in select jsonb_object_keys(p_payload) loop
    if not exists (select 1 from jsonb_array_elements(p_def -> 'questions') x where x ->> 'id' = v_key) then
      perform app.fail('VALIDATION', '不明な回答項目があります');
    end if;
  end loop;
  for q in select * from jsonb_array_elements(p_def -> 'questions') loop
    v := p_payload -> (q ->> 'id');
    if v is null or v = 'null'::jsonb or v = '""'::jsonb or v = '[]'::jsonb then
      if coalesce((q ->> 'required')::boolean, false) then
        perform app.fail('VALIDATION', '必須項目が未入力です', jsonb_build_object('fieldErrors', jsonb_build_object(q ->> 'id', '必須です')));
      end if;
      continue;
    end if;
    case q ->> 'kind'
      when 'choice' then
        if jsonb_typeof(v) <> 'string' or not exists (select 1 from jsonb_array_elements_text(q -> 'options') o where o = v #>> '{}') then
          perform app.fail('VALIDATION', '選択肢から選んでください', jsonb_build_object('fieldErrors', jsonb_build_object(q ->> 'id', '選択肢から選ぶ')));
        end if;
      when 'text' then
        if jsonb_typeof(v) <> 'string' or char_length(v #>> '{}') > 1000 then
          perform app.fail('VALIDATION', '文章は1000文字までです', jsonb_build_object('fieldErrors', jsonb_build_object(q ->> 'id', '1000文字まで')));
        end if;
      when 'number' then
        if jsonb_typeof(v) <> 'number' or (v #>> '{}') !~ '^[0-9]{1,6}$' then
          perform app.fail('VALIDATION', '数は0以上の整数です', jsonb_build_object('fieldErrors', jsonb_build_object(q ->> 'id', '整数')));
        end if;
      when 'dates' then
        if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > 31
           or exists (select 1 from jsonb_array_elements_text(v) d where d !~ '^\d{4}-\d{2}-\d{2}$') then
          perform app.fail('VALIDATION', '日付の形式が不正です', jsonb_build_object('fieldErrors', jsonb_build_object(q ->> 'id', '日付')));
        end if;
        perform (select array_agg(d::date) from jsonb_array_elements_text(v) d);
      when 'photos' then
        if jsonb_typeof(v) <> 'array' then perform app.fail('VALIDATION', '写真が不正です'); end if;
        perform app.check_attachments((select array_agg(x::uuid) from jsonb_array_elements_text(v) x), p_tenant, null);
        if exists (select 1 from jsonb_array_elements_text(v) x join public.attachments a on a.id = x::uuid
                   where a.shop_id is distinct from p_shop) then
          perform app.fail('VALIDATION', '写真を確認できません');
        end if;
      else
        perform app.fail('VALIDATION', '回答が不正です');
    end case;
  end loop;
end $$;

create or replace function app.response_core(
  p_task uuid, p_shop uuid, p_expected_revision integer, p_payload jsonb, p_proxy_reason text, p_proxy_channel text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_t public.tasks; v_cur public.responses; v_rev integer; v_status text; v_new public.responses;
begin
  select * into v_t from public.tasks where id = p_task;
  if v_t.type = 'notice' then perform app.fail('UNSUPPORTED', '回覧は「確認しました」で記録します'); end if;
  if v_t.status <> 'published' then perform app.fail('CONFLICT', 'この依頼は締め切られています。事務局へご相談ください'); end if;
  if v_t.due_at is not null and v_t.due_at <= now() then
    perform app.fail('EXPIRED', '期限を過ぎています。事務局に延長を依頼してください');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('response:' || p_task || ':' || p_shop, 0));
  select * into v_cur from public.responses where task_id = p_task and shop_id = p_shop and is_current;
  v_rev := coalesce(v_cur.revision, 0);
  if p_expected_revision is distinct from v_rev then
    perform app.fail('CONFLICT', '他の方が先に回答しました。最新の回答を確認してください',
      jsonb_build_object('reason', 'REVISION_CONFLICT', 'current', jsonb_build_object('revision', v_cur.revision,
        'payload', v_cur.payload_json, 'status', v_cur.status, 'submittedAt', v_cur.submitted_at)));
  end if;
  perform app.validate_payload(v_t.definition_json, p_payload, v_t.tenant_id, p_shop);
  v_status := case when v_t.type in ('photo', 'shop_change') then 'submitted' else 'approved' end;
  update public.responses set is_current = false where task_id = p_task and shop_id = p_shop and is_current;
  insert into public.responses (tenant_id, task_id, shop_id, revision, payload_json, status, submitted_by, proxy_reason, proxy_channel)
  values (v_t.tenant_id, p_task, p_shop, v_rev + 1, p_payload, v_status, auth.uid(), p_proxy_reason, p_proxy_channel)
  returning * into v_new;
  if v_t.type = 'photo' then
    update public.attachments set parent_type = 'task_response', parent_id = p_task
    where id in (select x::uuid from jsonb_each(p_payload) e, jsonb_array_elements_text(case when jsonb_typeof(e.value) = 'array' then e.value else '[]' end) x
                 where x ~ '^[0-9a-f-]{36}$');
  end if;
  perform app.audit(v_t.tenant_id, case when p_proxy_reason is null then 'task.respond' else 'task.proxy_respond' end, 'task', p_task,
                    case when v_cur.revision is null then null else jsonb_build_object('revision', v_cur.revision) end,
                    jsonb_build_object('revision', v_new.revision, 'status', v_status, 'proxyChannel', p_proxy_channel), p_shop);
  if v_status = 'submitted' then
    perform app.notify_office(v_t.tenant_id, array['office_operator'], '確認が必要な回答: ' || v_t.title, '/o/tasks/' || v_t.id, 'task', v_t.id,
                              'task.submitted:' || v_t.id || ':' || p_shop || ':' || v_new.revision);
  end if;
  return jsonb_build_object('taskId', p_task, 'shopId', p_shop, 'revision', v_new.revision, 'status', v_new.status,
                            'submittedAt', v_new.submitted_at, 'proxy', p_proxy_reason is not null);
end $$;

create or replace function public.api_task_respond(p_task uuid, p_shop uuid, p_expected_revision integer, p_payload jsonb, p_idem uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := app.require_shop(p_shop); v_uid uuid := auth.uid(); v_prev jsonb;
  v_hash text := app.hash_json(jsonb_build_object('t', p_task, 's', p_shop, 'r', p_expected_revision, 'p', p_payload));
begin
  if not exists (select 1 from public.task_recipients where task_id = p_task and shop_id = p_shop) then perform app.fail('NOT_FOUND'); end if;
  v_prev := app.idem_lookup(v_uid, p_idem, 'task.respond', v_hash);
  if v_prev is not null then return v_prev; end if;
  return app.idem_store(v_uid, p_idem, v_tenant, 'task.respond', v_hash,
                        app.response_core(p_task, p_shop, p_expected_revision, p_payload, null, null));
end $$;

create or replace function public.api_task_proxy_respond(
  p_task uuid, p_shop uuid, p_expected_revision integer, p_payload jsonb, p_proxy_reason text, p_proxy_channel text, p_idem uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_t public.tasks; v_uid uuid; v_prev jsonb;
  v_hash text := app.hash_json(jsonb_build_object('t', p_task, 's', p_shop, 'r', p_expected_revision, 'p', p_payload,
                                                  'reason', p_proxy_reason, 'ch', p_proxy_channel));
begin
  select * into v_t from public.tasks where id = p_task;
  if not found then perform app.fail('NOT_FOUND'); end if;
  v_uid := app.require_office(v_t.tenant_id, array['office_operator']);
  if not exists (select 1 from public.task_recipients where task_id = p_task and shop_id = p_shop) then perform app.fail('NOT_FOUND'); end if;
  if coalesce(btrim(p_proxy_reason), '') = '' or p_proxy_channel not in ('phone', 'paper', 'in_person', 'other') then
    perform app.fail('VALIDATION', '代理入力の理由と受付方法を入力してください');
  end if;
  v_prev := app.idem_lookup(v_uid, p_idem, 'task.proxy', v_hash);
  if v_prev is not null then return v_prev; end if;
  if v_t.type = 'notice' then
    perform pg_advisory_xact_lock(hashtextextended('ack:' || p_task || ':' || p_shop, 0));
    insert into public.acknowledgements (tenant_id, task_id, shop_id, user_id, proxy_reason)
    values (v_t.tenant_id, p_task, p_shop, v_uid, p_proxy_channel || ': ' || p_proxy_reason) on conflict do nothing;
    perform app.audit(v_t.tenant_id, 'task.proxy_acknowledge', 'task', p_task, null, jsonb_build_object('channel', p_proxy_channel), p_shop);
    return app.idem_store(v_uid, p_idem, v_t.tenant_id, 'task.proxy', v_hash, jsonb_build_object('taskId', p_task, 'acknowledged', true));
  end if;
  return app.idem_store(v_uid, p_idem, v_t.tenant_id, 'task.proxy', v_hash,
                        app.response_core(p_task, p_shop, p_expected_revision, p_payload, btrim(p_proxy_reason), p_proxy_channel));
end $$;

-- Explicit acknowledgement only (opening a notice never acknowledges it).
create or replace function public.api_task_acknowledge(p_task uuid, p_shop uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_tenant uuid := app.require_shop(p_shop); v_t public.tasks; v_ack public.acknowledgements;
begin
  select * into v_t from public.tasks where id = p_task and tenant_id = v_tenant;
  if not found or not exists (select 1 from public.task_recipients where task_id = p_task and shop_id = p_shop) then
    perform app.fail('NOT_FOUND');
  end if;
  if v_t.type <> 'notice' then perform app.fail('UNSUPPORTED', 'この依頼は回答が必要です'); end if;
  if v_t.status = 'draft' then perform app.fail('NOT_FOUND'); end if;
  insert into public.acknowledgements (tenant_id, task_id, shop_id, user_id) values (v_tenant, p_task, p_shop, auth.uid())
  on conflict (tenant_id, task_id, shop_id) do nothing;
  select * into v_ack from public.acknowledgements where task_id = p_task and shop_id = p_shop;
  perform app.audit(v_tenant, 'task.acknowledge', 'task', p_task, null, null, p_shop);
  return jsonb_build_object('taskId', p_task, 'confirmedAt', v_ack.confirmed_at);
end $$;

create or replace function public.api_task_review(p_task uuid, p_shop uuid, p_revision integer, p_approve boolean, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_t public.tasks; v_uid uuid; v_r public.responses; v_change jsonb;
begin
  select * into v_t from public.tasks where id = p_task;
  if not found then perform app.fail('NOT_FOUND'); end if;
  v_uid := app.require_office(v_t.tenant_id, array['office_operator', 'office_approver']);
  select * into v_r from public.responses where task_id = p_task and shop_id = p_shop and is_current for update;
  if not found or v_r.revision <> p_revision then perform app.fail('CONFLICT', '最新の回答を確認してください'); end if;
  if v_r.status <> 'submitted' then perform app.fail('CONFLICT', '確認待ちの回答ではありません'); end if;
  if v_r.submitted_by = v_uid then perform app.fail('FORBIDDEN', '代理入力した本人以外が確認してください'); end if;
  if not p_approve and coalesce(btrim(p_note), '') = '' then perform app.fail('VALIDATION', '差戻しの理由を入力してください'); end if;
  update public.responses set status = case when p_approve then 'approved' else 'returned' end, reviewed_by = v_uid,
    reviewed_at = now(), review_note = p_note
  where task_id = p_task and shop_id = p_shop and revision = p_revision returning * into v_r;
  if p_approve and v_t.type = 'shop_change' then
    v_change := v_r.payload_json;
    update public.shops set
      display_name = coalesce(nullif(btrim(v_change ->> 'display_name'), ''), display_name),
      address = coalesce(nullif(btrim(v_change ->> 'address'), ''), address),
      contact_phone = coalesce(nullif(btrim(v_change ->> 'contact_phone'), ''), contact_phone),
      version = version + 1, updated_at = now(), actor_id = v_uid
    where id = p_shop;
  end if;
  perform app.audit(v_t.tenant_id, case when p_approve then 'task.approve' else 'task.return' end, 'task', p_task, null,
                    jsonb_build_object('revision', p_revision, 'note', p_note), p_shop);
  perform app.notify_shop(v_t.tenant_id, p_shop, case when p_approve then '回答が確認されました: ' else '回答が差し戻されました: ' end || v_t.title,
                          '/m/tasks/' || p_task, 'task', p_task, 'task.review:' || p_task || ':' || p_shop || ':' || p_revision);
  return jsonb_build_object('taskId', p_task, 'shopId', p_shop, 'revision', p_revision, 'status', v_r.status);
end $$;

create or replace function app.task_shop_state(p_task public.tasks, p_shop uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when p_task.type = 'notice' then
      case when exists (select 1 from public.acknowledgements a where a.task_id = p_task.id and a.shop_id = p_shop) then 'done' else 'unanswered' end
    else coalesce((select case r.status when 'approved' then 'done' when 'returned' then 'returned' else 'pending_review' end
                   from public.responses r where r.task_id = p_task.id and r.shop_id = p_shop and r.is_current), 'unanswered')
  end
$$;

-- Merchant task list ordered: returned -> overdue -> nearest due -> newest.
create or replace function public.api_tasks_for_shop(p_shop uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_tenant uuid := app.require_shop(p_shop);
begin
  return coalesce((
    select jsonb_agg(x.j order by x.rank, x.due nulls last, x.pub desc)
    from (
      select jsonb_build_object('id', t.id, 'type', t.type, 'title', t.title, 'dueAt', t.due_at, 'status', t.status,
               'state', app.task_shop_state(t, p_shop), 'publishedAt', t.published_at, 'officeName', tn.name,
               'supersededBy', t.superseded_by) j,
             case app.task_shop_state(t, p_shop)
               when 'returned' then 0
               when 'unanswered' then case when t.due_at is not null and t.due_at < now() then 1 else 2 end
               when 'pending_review' then 3 else 4 end rank,
             t.due_at due, t.published_at pub
      from public.task_recipients tr join public.tasks t on t.id = tr.task_id join public.tenants tn on tn.id = t.tenant_id
      where tr.shop_id = p_shop and t.status in ('published', 'closed')
        and (t.superseded_by is null or app.task_shop_state(t, p_shop) <> 'unanswered')
    ) x), '[]');
end $$;

create or replace function public.api_task_for_shop(p_task uuid, p_shop uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_tenant uuid := app.require_shop(p_shop); v_t public.tasks;
begin
  select t.* into v_t from public.tasks t join public.task_recipients tr on tr.task_id = t.id and tr.shop_id = p_shop
  where t.id = p_task and t.status <> 'draft';
  if not found then perform app.fail('NOT_FOUND'); end if;
  return app.task_json(v_t) || jsonb_build_object(
    'state', app.task_shop_state(v_t, p_shop),
    'acknowledgedAt', (select confirmed_at from public.acknowledgements where task_id = p_task and shop_id = p_shop),
    'current', (select jsonb_build_object('revision', r.revision, 'payload', r.payload_json, 'status', r.status,
                  'submittedAt', r.submitted_at, 'reviewNote', r.review_note, 'proxy', r.proxy_reason is not null)
                from public.responses r where r.task_id = p_task and r.shop_id = p_shop and r.is_current),
    'history', (select coalesce(jsonb_agg(jsonb_build_object('revision', r.revision, 'status', r.status, 'submittedAt', r.submitted_at,
                  'proxy', r.proxy_reason is not null) order by r.revision desc), '[]')
                from public.responses r where r.task_id = p_task and r.shop_id = p_shop));
end $$;

-- Manual reminder: unanswered recipients only, max 1 per shop per JST day.
create or replace function public.api_task_remind(p_task uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_t public.tasks; v_uid uuid; v_n integer := 0; r record; v_day text := app.jst_date(now())::text;
begin
  select * into v_t from public.tasks where id = p_task;
  if not found then perform app.fail('NOT_FOUND'); end if;
  v_uid := app.require_office(v_t.tenant_id, array['office_operator']);
  if v_t.status <> 'published' then perform app.fail('CONFLICT', '公開中の依頼だけ催促できます'); end if;
  for r in select tr.shop_id from public.task_recipients tr where tr.task_id = p_task
             and app.task_shop_state(v_t, tr.shop_id) in ('unanswered', 'returned')
             and (tr.last_reminded_at is null or tr.last_reminded_at < now() - interval '24 hours') loop
    insert into public.outbox (tenant_id, kind, entity_id, recipient_id, dedupe_key, payload)
    values (v_t.tenant_id, 'reminder_digest', r.shop_id, null, 'reminder:' || r.shop_id || ':' || v_day,
            jsonb_build_object('shopId', r.shop_id, 'day', v_day))
    on conflict (dedupe_key) do nothing;
    update public.task_recipients set last_reminded_at = now() where task_id = p_task and shop_id = r.shop_id;
    v_n := v_n + 1;
  end loop;
  perform app.audit(v_t.tenant_id, 'task.remind', 'task', p_task, null, jsonb_build_object('shops', v_n));
  return jsonb_build_object('queued', v_n);
end $$;

-- ---------------------------------------------------------------------------
-- Requests (相談)
-- ---------------------------------------------------------------------------
create or replace function app.request_json(p_req uuid, p_office boolean) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', r.id, 'requestNumber', r.request_number, 'shopId', r.shop_id, 'shopName', s.display_name,
    'category', r.category, 'subject', r.subject, 'status', r.status, 'assignedTo', r.assigned_to,
    'assignedName', (select p.display_name from public.profiles p where p.user_id = r.assigned_to),
    'resolutionNote', r.resolution_note, 'resolvedAt', r.resolved_at, 'relatedRequestId', r.related_request_id,
    'relatedReceiptNumber', r.related_receipt_number, 'createdAt', r.created_at, 'updatedAt', r.updated_at, 'version', r.version,
    'reopenableUntil', case when r.resolved_at is null then null else r.resolved_at + interval '30 days' end,
    'officeHours', t.office_hours, 'replyGuidance', t.reply_guidance,
    'messages', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'authorSide', m.author_side, 'visibility', m.visibility,
        'authorName', (select p.display_name from public.profiles p where p.user_id = m.author_id),
        'body', m.body, 'attachmentIds', to_jsonb(m.attachment_ids), 'createdAt', m.created_at) order by m.created_at)
      from public.request_messages m where m.request_id = r.id and (p_office or m.visibility = 'shop')), '[]'))
  from public.requests r join public.shops s on s.id = r.shop_id join public.tenants t on t.id = r.tenant_id
  where r.id = p_req
$$;

create or replace function public.api_request_create(
  p_shop uuid, p_category text, p_subject text, p_body text, p_attachment_ids uuid[], p_related_receipt text,
  p_related_request uuid, p_idem uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := app.require_shop(p_shop); v_uid uuid := auth.uid(); v_prev jsonb; v_id uuid; v_no bigint; v_msg uuid;
  v_hash text := app.hash_json(jsonb_build_object('s', p_shop, 'c', p_category, 'su', p_subject, 'b', p_body, 'a', p_attachment_ids,
                                                  'rr', p_related_receipt, 'rq', p_related_request));
begin
  v_prev := app.idem_lookup(v_uid, p_idem, 'request.create', v_hash);
  if v_prev is not null then return v_prev; end if;
  if p_category not in ('voucher_payment', 'facility_cleaning', 'other') then perform app.fail('VALIDATION', '種類を選んでください'); end if;
  if coalesce(btrim(p_body), '') = '' or char_length(p_body) > 4000 then
    perform app.fail('VALIDATION', '内容を入力してください', '{"fieldErrors":{"body":"1〜4000文字"}}');
  end if;
  perform app.check_attachments(coalesce(p_attachment_ids, '{}'), v_tenant, p_shop);
  if p_related_request is not null and not exists (select 1 from public.requests where id = p_related_request and shop_id = p_shop) then
    perform app.fail('VALIDATION', '関連する相談が見つかりません');
  end if;
  v_no := app.next_number(v_tenant, 'request');
  insert into public.requests (tenant_id, request_number, shop_id, category, subject, created_by, related_request_id, related_receipt_number, actor_id)
  values (v_tenant, 'Q' || lpad(v_no::text, 5, '0'), p_shop, p_category,
          coalesce(nullif(btrim(p_subject), ''), left(btrim(p_body), 40)), v_uid, p_related_request, nullif(btrim(coalesce(p_related_receipt, '')), ''), v_uid)
  returning id into v_id;
  insert into public.request_messages (tenant_id, request_id, author_id, author_side, visibility, body, attachment_ids)
  values (v_tenant, v_id, v_uid, 'shop', 'shop', btrim(p_body), coalesce(p_attachment_ids, '{}')) returning id into v_msg;
  update public.attachments set parent_type = 'request_message', parent_id = v_msg where id = any (p_attachment_ids);
  perform app.audit(v_tenant, 'request.create', 'request', v_id, null, jsonb_build_object('category', p_category), p_shop);
  perform app.notify_office(v_tenant, array['office_operator'], '新しい相談が届きました', '/o/requests/' || v_id, 'request', v_id, 'request.create:' || v_id);
  return app.idem_store(v_uid, p_idem, v_tenant, 'request.create', v_hash, app.request_json(v_id, false));
end $$;

create or replace function public.api_request_get(p_req uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_r public.requests;
begin
  select * into v_r from public.requests where id = p_req;
  if not found then perform app.fail('NOT_FOUND'); end if;
  if app.is_office(v_r.tenant_id) then return app.request_json(p_req, true); end if;
  if app.is_shop_member(v_r.shop_id) then return app.request_json(p_req, false); end if;
  perform app.fail('NOT_FOUND');
end $$;

-- p_internal=true is office-only (internal memo); shop replies reopen awaiting threads.
create or replace function public.api_request_message(p_req uuid, p_body text, p_attachment_ids uuid[], p_internal boolean, p_idem uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_r public.requests; v_uid uuid := app.uid(); v_office boolean; v_prev jsonb; v_msg uuid;
  v_hash text := app.hash_json(jsonb_build_object('r', p_req, 'b', p_body, 'a', p_attachment_ids, 'i', p_internal));
begin
  select * into v_r from public.requests where id = p_req for update;
  if not found then perform app.fail('NOT_FOUND'); end if;
  v_office := app.is_office(v_r.tenant_id);
  if v_office then
    perform app.require_office(v_r.tenant_id, array['office_operator', 'office_approver', 'tenant_admin']);
  elsif app.is_shop_member(v_r.shop_id) then
    perform app.require_shop(v_r.shop_id);
    if p_internal then perform app.fail('NOT_FOUND'); end if;
  else
    perform app.fail('NOT_FOUND');
  end if;
  v_prev := app.idem_lookup(v_uid, p_idem, 'request.message', v_hash);
  if v_prev is not null then return v_prev; end if;
  if coalesce(btrim(p_body), '') = '' or char_length(p_body) > 4000 then perform app.fail('VALIDATION', '内容を入力してください'); end if;
  perform app.check_attachments(coalesce(p_attachment_ids, '{}'), v_r.tenant_id, case when v_office then null else v_r.shop_id end);
  if v_r.status = 'resolved' then
    if v_office or v_r.resolved_at < now() - interval '30 days' then
      perform app.fail('CONFLICT', '完了した相談です。新しい相談として送ってください', '{"reason":"RESOLVED"}');
    end if;
  end if;
  insert into public.request_messages (tenant_id, request_id, author_id, author_side, visibility, body, attachment_ids)
  values (v_r.tenant_id, p_req, v_uid, case when v_office then 'office' else 'shop' end,
          case when v_office and p_internal then 'internal' else 'shop' end, btrim(p_body), coalesce(p_attachment_ids, '{}'))
  returning id into v_msg;
  update public.attachments set parent_type = 'request_message', parent_id = v_msg where id = any (p_attachment_ids);
  if v_office then
    if not p_internal then
      update public.requests set last_office_activity_at = now(), updated_at = now(), version = version + 1,
        status = case when status = 'received' then 'in_progress' else status end where id = p_req;
      perform app.notify_shop(v_r.tenant_id, v_r.shop_id, '事務局から相談の返事があります（' || v_r.request_number || '）',
                              '/m/requests/' || p_req, 'request', p_req, 'request.reply:' || v_msg);
    end if;
  else
    update public.requests set last_shop_activity_at = now(), updated_at = now(), version = version + 1,
      status = case when status in ('awaiting_shop', 'resolved') then 'in_progress' else status end,
      resolved_at = case when status = 'resolved' then null else resolved_at end
    where id = p_req;
    perform app.notify_office(v_r.tenant_id, array['office_operator'], '相談に店舗から返事があります（' || v_r.request_number || '）',
                              '/o/requests/' || p_req, 'request', p_req, 'request.shop_msg:' || v_msg);
  end if;
  perform app.audit(v_r.tenant_id, case when p_internal then 'request.internal_memo' else 'request.message' end, 'request', p_req, null, null, v_r.shop_id);
  return app.idem_store(v_uid, p_idem, v_r.tenant_id, 'request.message', v_hash,
                        jsonb_build_object('messageId', v_msg, 'requestId', p_req));
end $$;

-- Office state change / assignment with optimistic version. Resolve needs a reason.
create or replace function public.api_request_update(
  p_req uuid, p_expected_version integer, p_status text, p_assigned_to uuid, p_resolution_note text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_r public.requests; v_uid uuid; v_before jsonb;
begin
  select * into v_r from public.requests where id = p_req for update;
  if not found then perform app.fail('NOT_FOUND'); end if;
  v_uid := app.require_office(v_r.tenant_id, array['office_operator', 'office_approver', 'tenant_admin']);
  if v_r.version <> p_expected_version then
    perform app.fail('CONFLICT', '他の担当者が更新しました。最新の内容を確認してください', jsonb_build_object('current', app.request_json(p_req, true)));
  end if;
  if p_status not in ('received', 'in_progress', 'awaiting_shop', 'resolved') then perform app.fail('VALIDATION', '状態が不正です'); end if;
  if p_status = 'resolved' and coalesce(btrim(p_resolution_note), '') = '' then
    perform app.fail('VALIDATION', '完了にする理由を入力してください', '{"fieldErrors":{"resolutionNote":"必須"}}');
  end if;
  if p_assigned_to is not null and not exists (select 1 from public.memberships where tenant_id = v_r.tenant_id and user_id = p_assigned_to and status = 'active') then
    perform app.fail('VALIDATION', '担当者は事務局のメンバーから選んでください');
  end if;
  v_before := jsonb_build_object('status', v_r.status, 'assignedTo', v_r.assigned_to);
  update public.requests set status = p_status, assigned_to = p_assigned_to,
    resolution_note = case when p_status = 'resolved' then btrim(p_resolution_note) else resolution_note end,
    resolved_at = case when p_status = 'resolved' then now() else null end,
    version = version + 1, updated_at = now(), actor_id = v_uid
  where id = p_req returning * into v_r;
  perform app.audit(v_r.tenant_id, 'request.update', 'request', p_req, v_before,
                    jsonb_build_object('status', v_r.status, 'assignedTo', v_r.assigned_to), v_r.shop_id);
  if v_before ->> 'status' <> p_status then
    perform app.notify_shop(v_r.tenant_id, v_r.shop_id, '相談の状態が変わりました（' || v_r.request_number || '）', '/m/requests/' || p_req,
                            'request', p_req, 'request.status:' || p_req || ':' || v_r.version);
  end if;
  return app.request_json(p_req, true);
end $$;

select app.lock_down_functions();

create or replace function public.api_tasks_office_list(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_office(p_tenant, array['office_operator', 'office_approver', 'tenant_admin', 'auditor']);
  return coalesce((select jsonb_agg(app.task_json(t) || jsonb_build_object(
      'recipients', (select count(*) from public.task_recipients tr where tr.task_id = t.id),
      'targets', (select count(*) from public.task_draft_targets d where d.task_id = t.id),
      'unanswered', (select count(*) from public.task_recipients tr where tr.task_id = t.id and app.task_shop_state(t, tr.shop_id) in ('unanswered', 'returned')),
      'pendingReview', (select count(*) from public.task_recipients tr where tr.task_id = t.id and app.task_shop_state(t, tr.shop_id) = 'pending_review'))
    order by case t.status when 'draft' then 0 when 'published' then 1 else 2 end, t.due_at nulls last, t.created_at desc)
    from public.tasks t where t.tenant_id = p_tenant), '[]');
end $$;

create or replace function public.api_task_office_get(p_task uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_t public.tasks;
begin
  select * into v_t from public.tasks where id = p_task;
  if not found then perform app.fail('NOT_FOUND'); end if;
  perform app.require_office(v_t.tenant_id, array['office_operator', 'office_approver', 'tenant_admin', 'auditor']);
  return app.task_json(v_t) || jsonb_build_object(
    'targets', coalesce((select jsonb_agg(d.shop_id) from public.task_draft_targets d where d.task_id = p_task), '[]'),
    'recipients', coalesce((select jsonb_agg(jsonb_build_object('shopId', tr.shop_id, 'shopName', s.display_name,
        'state', app.task_shop_state(v_t, tr.shop_id), 'lastRemindedAt', tr.last_reminded_at,
        'acknowledgedAt', (select a.confirmed_at from public.acknowledgements a where a.task_id = p_task and a.shop_id = tr.shop_id),
        'current', (select jsonb_build_object('revision', r.revision, 'payload', r.payload_json, 'status', r.status, 'submittedAt', r.submitted_at,
                      'submittedBy', (select display_name from public.profiles where user_id = r.submitted_by),
                      'proxyReason', r.proxy_reason, 'proxyChannel', r.proxy_channel, 'reviewNote', r.review_note)
                    from public.responses r where r.task_id = p_task and r.shop_id = tr.shop_id and r.is_current),
        'revisions', (select count(*) from public.responses r where r.task_id = p_task and r.shop_id = tr.shop_id))
      order by s.display_name)
      from public.task_recipients tr join public.shops s on s.id = tr.shop_id where tr.task_id = p_task), '[]'));
end $$;

select app.lock_down_functions();
