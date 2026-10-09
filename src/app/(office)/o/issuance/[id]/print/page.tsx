import type { Metadata } from 'next';
import { PrintSheet } from '@/components/office/PrintSheet';
import { requireOffice } from '@/server/auth/page';

export const metadata: Metadata = { title: '券の印刷' };

export default async function PrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireOffice();
  return <PrintSheet batchId={id} />;
}
