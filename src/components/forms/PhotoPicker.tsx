'use client';

/* eslint-disable @next/next/no-img-element */
import { useState } from 'react';
import { Notice, ui } from '@/components/ui';
import { api, ApiError } from '@/lib/api-client';

const ACCEPT = 'image/jpeg,image/png,image/webp';

/**
 * Upload flow: intent -> PUT to a quarantine signed URL -> server decodes,
 * re-encodes (EXIF/GPS removed) and only then the photo becomes visible.
 */
export function PhotoPicker({
  shopId,
  tenantId,
  purpose,
  value,
  onChange,
  max = 3,
  label = '写真（3枚まで・任意）',
}: {
  shopId: string | null;
  tenantId?: string | null;
  purpose: 'request_message' | 'paper_report' | 'task_response' | 'evidence';
  value: string[];
  onChange: (ids: string[]) => void;
  max?: number;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function add(files: FileList) {
    setMsg(null);
    const list = Array.from(files).slice(0, Math.max(0, max - value.length));
    if (files.length > list.length) setMsg(`写真は${max}枚までです`);
    setBusy(true);
    const ids = [...value];
    for (const f of list) {
      if (/heic|heif/i.test(f.type) || /\.hei[cf]$/i.test(f.name)) {
        setMsg('HEIC形式は受け付けていません。iPhoneの「設定 → カメラ → フォーマット → 互換性優先」にするか、JPEGで保存した写真を選んでください');
        continue;
      }
      try {
        const intent = await api<{ id: string; uploadUrl: string }>('/attachments/upload-intent', { body: { shopId, tenantId: tenantId ?? null, purpose, contentType: f.type || 'application/octet-stream', size: f.size } });
        const put = await fetch(intent.uploadUrl, { method: 'PUT', body: f, headers: { 'content-type': f.type, 'x-upsert': 'false' } });
        if (!put.ok) throw new ApiError('SERVICE_UNAVAILABLE', '写真を送信できませんでした', put.status);
        const fin = await api<{ id: string; status: string; duplicateOf?: string[] | null }>(`/attachments/${intent.id}/finalize`, { body: {} });
        if (fin.status !== 'clean') throw new ApiError('UNSUPPORTED', '画像として読み取れませんでした', 422);
        if (fin.duplicateOf?.length) setMsg('同じ写真が以前にも送られています（そのまま送信できます）');
        ids.push(intent.id);
      } catch (e) {
        setMsg(e instanceof ApiError ? e.message : '写真を送信できませんでした。もう一度お試しください');
      }
    }
    onChange(ids);
    setBusy(false);
  }

  return (
    <div className={ui.field}>
      <span className={ui.label}>{label}</span>
      {value.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {value.map((id, i) => (
            <span key={id} style={{ display: 'grid', gap: 4 }}>
              <img src={`/api/v1/attachments/${id}/download`} alt={`写真${i + 1}`} width={88} height={88} style={{ objectFit: 'cover', border: '1px solid var(--line)' }} />
              <button type="button" className={ui.linkBtn} onClick={() => onChange(value.filter((x) => x !== id))}>
                外す
              </button>
            </span>
          ))}
        </div>
      )}
      {value.length < max && (
        <label className={ui.secondary} aria-busy={busy || undefined}>
          {busy ? '写真を送信しています' : '写真を選ぶ・撮る'}
          <input type="file" accept={ACCEPT} multiple className="sr-only" disabled={busy} onChange={(e) => e.target.files && void add(e.target.files).then(() => (e.target.value = ''))} />
        </label>
      )}
      <p className={ui.help}>JPEG・PNG・WebP、1枚10MBまで。撮影場所などの情報は取り除いて保存します。</p>
      {msg && <Notice tone="warning">{msg}</Notice>}
    </div>
  );
}
