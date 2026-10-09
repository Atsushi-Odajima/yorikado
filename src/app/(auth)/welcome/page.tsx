import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { WelcomeForm } from '@/components/auth/WelcomeForm';
import { rpc, userDb } from '@/server/db/supabase';

export const metadata: Metadata = { title: 'はじめに' };

export default async function WelcomePage() {
  const db = await userDb();
  const { data } = await db.auth.getClaims();
  if (!data?.claims) redirect('/login');
  const me = await rpc<{ profile: { displayName: string } | null }>(db, 'api_me').catch(() => null);
  if (!me) redirect('/login?expired=1');
  return <WelcomeForm initialName={me.profile?.displayName ?? ''} />;
}
