import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { MfaSetup } from '@/components/auth/MfaSetup';
import { userDb } from '@/server/db/supabase';

export const metadata: Metadata = { title: '二段階認証' };

export default async function MfaPage() {
  const db = await userDb();
  const { data } = await db.auth.getClaims();
  if (!data?.claims) redirect('/login');
  return <MfaSetup />;
}
