import type { Metadata } from 'next';
import { InviteForm } from '@/components/auth/InviteForm';

export const metadata: Metadata = { title: '招待を受け取る' };

export default function InvitePage() {
  return <InviteForm />;
}
