-- ============================================================================
-- Yorikado DEMO seed (DEMO専用). All organisations, shops, people and vouchers
-- are fictional. Never run against LIVE: scripts/db-reset-demo.mjs refuses
-- non-local targets, and verify-env fails in LIVE if these users exist.
-- Dynamic fixtures (coupons, redemptions, settlements, tasks, requests) are
-- created by scripts/seed-demo.ts through the real DB functions.
-- ============================================================================

do $$
begin
  if exists (select 1 from public.deployment_environment where environment = 'LIVE') then
    raise exception 'This database is marked LIVE. Refusing to load DEMO seed.';
  end if;
end $$;

insert into public.deployment_environment (id, environment) values (true, 'DEMO')
on conflict (id) do update set environment = 'DEMO', updated_at = now();

-- Organisations
insert into public.tenants (id, name, slug, contact, office_hours, reply_guidance, email_notifications) values
  ('00000000-0000-4000-a000-000000000001', 'ひなた商店街', 'hinata-demo', '事務局 03-0000-0000（練習用）', '平日 10:00〜17:00', '通常2営業日以内にお返事します', true),
  ('00000000-0000-4000-a000-000000000002', 'あおば通り会', 'aoba-demo', '事務局 03-0000-0001（練習用）', '平日 10:00〜16:00', '通常3営業日以内にお返事します', false);

-- Shops
insert into public.shops (tenant_id, id, display_name, legal_name, address, contact_phone, external_code, search_name) values
  ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-b000-000000000001', '山田商店', '山田商店（練習用）', 'ひなた町1-1（架空）', '000-0000-0001', 'SHOP-DEMO-01', '山田商店'),
  ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-b000-000000000002', 'さくら食堂', 'さくら食堂（練習用）', 'ひなた町1-2（架空）', '000-0000-0002', 'SHOP-DEMO-02', 'さくら食堂'),
  ('00000000-0000-4000-a000-000000000002', '00000000-0000-4000-b000-000000000003', '青葉青果', '青葉青果（練習用）', 'あおば町2-1（架空）', '000-0000-0003', 'SHOP-AOBA-01', '青葉青果');

-- Users (fixed fictional test IDs). DEMO password: see docs/SETUP_WINDOWS.txt.
do $$
declare
  r record;
  v_pw text := extensions.crypt('yorikado-demo-2026', extensions.gen_salt('bf'));
begin
  for r in select * from (values
    ('00000000-0000-4000-c000-000000000001'::uuid, 'a.staff@example.com', '山田（店員）'),
    ('00000000-0000-4000-c000-000000000002'::uuid, 'a.owner@example.com', '山田（店主）'),
    ('00000000-0000-4000-c000-000000000003'::uuid, 'a.operator@example.com', '佐藤（事務局）'),
    ('00000000-0000-4000-c000-000000000004'::uuid, 'a.approver@example.com', '鈴木（承認）'),
    ('00000000-0000-4000-c000-000000000005'::uuid, 'a.admin@example.com', '高橋（管理者）'),
    ('00000000-0000-4000-c000-000000000006'::uuid, 'b.staff@example.com', '青葉（店員）'),
    ('00000000-0000-4000-c000-000000000007'::uuid, 'a.auditor@example.com', '田中（監査）'),
    ('00000000-0000-4000-c000-000000000008'::uuid, 'b.operator@example.com', '青木（あおば事務局）'),
    ('00000000-0000-4000-c000-000000000009'::uuid, 'b.approver@example.com', '青山（あおば承認）')
  ) as t(id, email, name) loop
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                            created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
    values ('00000000-0000-0000-0000-000000000000', r.id, 'authenticated', 'authenticated', r.email, v_pw, now(),
            '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    insert into auth.identities (user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (r.id, r.id::text, jsonb_build_object('sub', r.id::text, 'email', r.email, 'email_verified', true), 'email', now(), now(), now());
    insert into public.profiles (user_id, display_name, terms_accepted_at, terms_version) values (r.id, r.name, now(), 'v1-draft-2026-10');
  end loop;
end $$;

-- Office users have a pre-registered TOTP factor with a DEMO-only secret
-- (YORIKADODEMOTOTPSECRETAA). LIVE users always enrol their own factor.
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
select gen_random_uuid(), u, 'DEMO認証アプリ', 'totp', 'verified', now(), now(), 'YORIKADODEMOTOTPSECRETAA'
from unnest(array[
  '00000000-0000-4000-c000-000000000002',  -- owner (needs MFA for bank changes)
  '00000000-0000-4000-c000-000000000003',
  '00000000-0000-4000-c000-000000000004',
  '00000000-0000-4000-c000-000000000005',
  '00000000-0000-4000-c000-000000000007',
  '00000000-0000-4000-c000-000000000008',
  '00000000-0000-4000-c000-000000000009'
]::uuid[]) u;

insert into public.memberships (tenant_id, user_id, role) values
  ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-c000-000000000003', 'office_operator'),
  ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-c000-000000000004', 'office_approver'),
  ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-c000-000000000005', 'tenant_admin'),
  ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-c000-000000000007', 'auditor'),
  ('00000000-0000-4000-a000-000000000002', '00000000-0000-4000-c000-000000000008', 'office_operator'),
  ('00000000-0000-4000-a000-000000000002', '00000000-0000-4000-c000-000000000009', 'office_approver');

insert into public.shop_memberships (tenant_id, shop_id, user_id, role) values
  ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-b000-000000000001', '00000000-0000-4000-c000-000000000001', 'shop_staff'),
  ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-b000-000000000001', '00000000-0000-4000-c000-000000000002', 'shop_owner'),
  ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-b000-000000000002', '00000000-0000-4000-c000-000000000002', 'shop_owner'),
  ('00000000-0000-4000-a000-000000000002', '00000000-0000-4000-b000-000000000003', '00000000-0000-4000-c000-000000000006', 'shop_staff');
