'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ErrorNotice } from '@/components/forms/ErrorNotice';
import { useAction } from '@/components/forms/useAction';
import { Button, ui } from '@/components/ui';
import { api } from '@/lib/api-client';

export function ImportUpload({ campaignId }: { campaignId: string }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState('');
  const [mapping, setMapping] = useState('');
  const { busy, error, run } = useAction();
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!file) return;
        const form = new FormData();
        form.set('campaignId', campaignId);
        form.set('sourceName', source);
        form.set('file', file);
        if (mapping.trim()) form.set('mapping', mapping.trim());
        const r = await run(() => api<{ id: string }>('/imports/external', { form }));
        if (r) router.push(`/o/imports/${r.id}`);
      }}
    >
      <ErrorNotice error={error} />
      <div className={ui.row} style={{ alignItems: 'flex-end' }}>
        <div className={ui.field} style={{ margin: 0, flex: 1, minWidth: 200 }}>
          <label className={ui.label} htmlFor="src">提供元（記録責任者）</label>
          <input id="src" className={ui.input} value={source} onChange={(e) => setSource(e.target.value)} maxLength={100} />
        </div>
        <div className={ui.field} style={{ margin: 0 }}>
          <label className={ui.label} htmlFor="file">CSVファイル</label>
          <input id="file" type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </div>
        <Button type="submit" inline busy={busy} busyLabel="検査しています" disabled={!file || !source.trim()}>
          検査してプレビュー
        </Button>
      </div>
      <details style={{ marginTop: 8 }}>
        <summary>列名が標準と違う場合（マッピング）</summary>
        <label className={ui.label} htmlFor="map">標準列→ファイルの列名（JSON）</label>
        <textarea id="map" className={ui.textarea} style={{ minHeight: 80 }} placeholder='{"provider_transaction_id":"取引ID","amount_jpy":"金額"}' value={mapping} onChange={(e) => setMapping(e.target.value)} />
      </details>
    </form>
  );
}
