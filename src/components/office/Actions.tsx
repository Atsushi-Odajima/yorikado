'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, type ReactNode } from 'react';
import { ErrorNotice } from '@/components/forms/ErrorNotice';
import { useAction } from '@/components/forms/useAction';
import { Button, ui } from '@/components/ui';
import { api, newKey } from '@/lib/api-client';

/** One POST/PUT/PATCH with busy state, MFA retry, error display and refresh. */
export function ActionButton({
  path,
  body = {},
  method = 'POST',
  label,
  variant = 'primary',
  idempotent = false,
  confirmText,
  then = 'refresh',
  thenIdPrefix,
  inline = true,
}: {
  path: string;
  body?: unknown;
  method?: 'POST' | 'PUT' | 'PATCH';
  label: ReactNode;
  variant?: 'primary' | 'secondary' | 'danger';
  idempotent?: boolean;
  confirmText?: string;
  then?: 'refresh' | string;
  /** Navigate to `${thenIdPrefix}${data.id}` after success (functions cannot cross the server/client boundary). */
  thenIdPrefix?: string;
  inline?: boolean;
}) {
  const router = useRouter();
  const key = useRef(newKey());
  const { busy, error, run } = useAction();
  return (
    <span style={{ display: inline ? 'inline-grid' : 'grid', gap: 8 }}>
      <Button
        variant={variant}
        inline={inline}
        busy={busy}
        busyLabel="処理しています"
        onClick={async () => {
          if (confirmText && !window.confirm(confirmText)) return;
          const r = await run(() => api(path, { method, body, idempotencyKey: idempotent ? key.current : undefined }));
          if (r !== undefined) {
            key.current = newKey();
            if (thenIdPrefix) router.push(thenIdPrefix + String((r as { id?: string })?.id ?? ''));
            else if (then === 'refresh') router.refresh();
            else router.push(then);
          }
        }}
      >
        {label}
      </Button>
      <ErrorNotice error={error} />
    </span>
  );
}

/** Button that opens a required note/reason field before posting. */
export function NoteAction({
  path,
  field = 'reason',
  extra = {},
  label,
  noteLabel = '理由',
  variant = 'secondary',
  required = true,
}: {
  path: string;
  field?: string;
  extra?: Record<string, unknown>;
  label: string;
  noteLabel?: string;
  variant?: 'primary' | 'secondary' | 'danger';
  required?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const { busy, error, run } = useAction();
  if (!open) {
    return (
      <Button variant={variant} inline onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  }
  return (
    <form
      className={ui.stack8}
      style={{ width: '100%' }}
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await run(() => api(path, { body: { ...extra, [field]: note } }));
        if (r !== undefined) {
          setOpen(false);
          setNote('');
          router.refresh();
        }
      }}
    >
      <ErrorNotice error={error} />
      <label className={ui.label} htmlFor={`n-${path}`}>{noteLabel}{required && <span className={ui.required}>必須</span>}</label>
      <textarea id={`n-${path}`} className={ui.textarea} style={{ minHeight: 96 }} value={note} onChange={(e) => setNote(e.target.value)} />
      <div className={ui.row}>
        <Button type="submit" variant={variant === 'secondary' ? 'primary' : variant} inline busy={busy} disabled={required && !note.trim()}>
          {label}
        </Button>
        <Button type="button" variant="secondary" inline onClick={() => setOpen(false)}>
          やめる
        </Button>
      </div>
    </form>
  );
}
