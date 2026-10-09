'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ErrorNotice } from '@/components/forms/ErrorNotice';
import { useAction } from '@/components/forms/useAction';
import { Button, ui } from '@/components/ui';
import { api } from '@/lib/api-client';

interface R {
  issuer_authority: boolean;
  rules_approved: boolean;
  security_reviewed: boolean;
  pilot_completed: boolean;
  legal_review_ref: string;
  two_person_approval: boolean;
  version: number;
}

const ITEMS: [keyof R, string][] = [
  ['issuer_authority', '発行者の発行権限・契約を確認した'],
  ['rules_approved', '券の規則（額面・期間・対象店）を発行者が承認した'],
  ['security_reviewed', 'セキュリティ確認を実施した'],
  ['pilot_completed', '現場での実証（試行）を完了した'],
  ['two_person_approval', '精算・取消の二人承認の体制がある'],
];

export function LiveReadinessForm({ campaignId, r, canEdit }: { campaignId: string; r: R; canEdit: boolean }) {
  const router = useRouter();
  const [v, setV] = useState(r);
  const { busy, error, run } = useAction();
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const ok = await run(() => api(`/campaigns/${campaignId}/live-readiness`, {
          method: 'PUT',
          body: { issuerAuthority: v.issuer_authority, rulesApproved: v.rules_approved, securityReviewed: v.security_reviewed, pilotCompleted: v.pilot_completed, legalReviewRef: v.legal_review_ref, twoPersonApproval: v.two_person_approval, expectedVersion: r.version },
        }));
        if (ok) router.refresh();
      }}
    >
      <ErrorNotice error={error} />
      <p className={ui.help}>チェックは証跡に基づいて行ってください。環境変数だけでLIVEへは移行できません。</p>
      {ITEMS.map(([k, label]) => (
        <label key={k} className={ui.choice} aria-checked={Boolean(v[k])} style={{ marginBottom: 8 }}>
          <input type="checkbox" disabled={!canEdit} checked={Boolean(v[k])} onChange={(e) => setV({ ...v, [k]: e.target.checked })} style={{ width: 24, height: 24 }} />
          {label}
        </label>
      ))}
      <div className={ui.field}>
        <label className={ui.label} htmlFor="legal">法務確認の記録番号</label>
        <input id="legal" className={ui.input} disabled={!canEdit} value={v.legal_review_ref} onChange={(e) => setV({ ...v, legal_review_ref: e.target.value })} />
      </div>
      {canEdit && <Button type="submit" inline busy={busy}>開始条件を保存する</Button>}
    </form>
  );
}
