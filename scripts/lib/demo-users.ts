/** Fixed fictional DEMO identities (must match supabase/seed.sql). */
export const TENANT_A = '00000000-0000-4000-a000-000000000001';
export const TENANT_B = '00000000-0000-4000-a000-000000000002';
export const SHOP_A1 = '00000000-0000-4000-b000-000000000001'; // 山田商店
export const SHOP_A2 = '00000000-0000-4000-b000-000000000002'; // さくら食堂
export const SHOP_B1 = '00000000-0000-4000-b000-000000000003'; // 青葉青果

export const DEMO_PASSWORD = 'yorikado-demo-2026';
export const DEMO_TOTP_SECRET = 'YORIKADODEMOTOTPSECRETAA';

export const USERS = {
  staff: { id: '00000000-0000-4000-c000-000000000001', email: 'a.staff@example.com' },
  owner: { id: '00000000-0000-4000-c000-000000000002', email: 'a.owner@example.com' },
  operator: { id: '00000000-0000-4000-c000-000000000003', email: 'a.operator@example.com' },
  approver: { id: '00000000-0000-4000-c000-000000000004', email: 'a.approver@example.com' },
  admin: { id: '00000000-0000-4000-c000-000000000005', email: 'a.admin@example.com' },
  bstaff: { id: '00000000-0000-4000-c000-000000000006', email: 'b.staff@example.com' },
  auditor: { id: '00000000-0000-4000-c000-000000000007', email: 'a.auditor@example.com' },
  boperator: { id: '00000000-0000-4000-c000-000000000008', email: 'b.operator@example.com' },
  bapprover: { id: '00000000-0000-4000-c000-000000000009', email: 'b.approver@example.com' },
} as const;
export type UserKey = keyof typeof USERS;
