'use client';

import { useRouter } from 'next/navigation';
import { dt, StateBadge, ui } from '@/components/ui';
import { api } from '@/lib/api-client';

export function NotificationList({ items }: { items: { id: string; title: string; link: string; readAt: string | null; createdAt: string }[] }) {
  const router = useRouter();
  if (!items.length) return <p>新しいお知らせはありません</p>;
  return (
    <ul className={ui.list}>
      {items.map((n) => (
        <li key={n.id} className={ui.listItem}>
          <button
            type="button"
            className={ui.rowLink}
            style={{ width: '100%', background: 'none', border: 0, textAlign: 'left', cursor: 'pointer' }}
            onClick={async () => {
              await api(`/notifications/${n.id}/read`, { body: {} }).catch(() => undefined);
              router.push(n.link || '/');
            }}
          >
            <span className={ui.rowMain}>
              <span className={ui.rowTitle}>{n.title}</span>
              <span className={ui.meta}>{dt(n.createdAt)}</span>
            </span>
            {!n.readAt && <StateBadge tone="todo">未読</StateBadge>}
          </button>
        </li>
      ))}
    </ul>
  );
}
