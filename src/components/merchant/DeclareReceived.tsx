'use client';

import { useRouter } from 'next/navigation';
import { useAction } from '@/components/forms/useAction';
import { ui } from '@/components/ui';
import { api } from '@/lib/api-client';

/** Shop's own "入金を確認した" note. Never upgrades the bank-confirmed state. */
export function DeclareReceived({ lineId }: { lineId: string }) {
  const router = useRouter();
  const { busy, run } = useAction();
  return (
    <button
      type="button"
      className={ui.linkBtn}
      disabled={busy}
      onClick={async () => {
        const r = await run(() => api(`/settlement-lines/${lineId}/declare`, { body: {} }));
        if (r) router.refresh();
      }}
    >
      口座に入金があったことを事務局に知らせる
    </button>
  );
}
