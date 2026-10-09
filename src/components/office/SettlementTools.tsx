'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ErrorNotice } from '@/components/forms/ErrorNotice';
import { useAction } from '@/components/forms/useAction';
import { Button, Notice, ui } from '@/components/ui';
import { api, downloadBlob } from '@/lib/api-client';

export function ExportWorklist({ batchId, batchNumber, exportCount }: { batchId: string; batchNumber: number; exportCount: number }) {
  const router = useRouter();
  const { busy, error, run } = useAction();
  return (
    <div className={ui.stack8}>
      {exportCount > 0 && <Notice tone="warning" title="再出力になります">同じ内容の支払作業票です。銀行で重ねて振込を実行しないでください。振込結果確認済みの行は含まれません。</Notice>}
      <Button
        variant={exportCount > 0 ? 'secondary' : 'primary'}
        busy={busy}
        busyLabel="出力しています"
        onClick={async () => {
          const blob = await run(() => api<Blob>(`/settlements/${batchId}/export-worklist`, { body: {} }));
          if (blob) {
            downloadBlob(blob, `worklist_${batchNumber}_${exportCount > 0 ? 'reexport' + (exportCount + 1) : 'first'}.csv`);
            router.refresh();
          }
        }}
      >
        {exportCount > 0 ? '支払作業票を再出力する' : '支払作業票を出力する'}
      </Button>
      <ErrorNotice error={error} />
    </div>
  );
}

export function BankResultsImport({ batchId }: { batchId: string }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const { busy, error, run } = useAction();
  return (
    <form
      className={ui.stack8}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!file) return;
        const form = new FormData();
        form.set('file', file);
        const r = await run(() => api(`/settlements/${batchId}/import-bank-results`, { form }));
        if (r) {
          setFile(null);
          router.refresh();
        }
      }}
    >
      <label className={ui.label} htmlFor="bank">銀行の振込結果（CSV: line_id, bank_reference, amount_jpy, result, executed_date）</label>
      <input id="bank" type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      <ErrorNotice error={error} />
      <Button type="submit" variant="secondary" busy={busy} busyLabel="照合しています" disabled={!file}>
        結果を取り込んで照合する
      </Button>
    </form>
  );
}
