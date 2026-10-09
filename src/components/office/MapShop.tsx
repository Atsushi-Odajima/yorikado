'use client';

import { useState } from 'react';
import { ui } from '@/components/ui';
import { ActionButton } from './Actions';

export function MapShop({ importId, code, shops }: { importId: string; code: string; shops: { id: string; name: string }[] }) {
  const [shopId, setShopId] = useState('');
  return (
    <div className={ui.row} style={{ marginBottom: 12 }}>
      <span>コード <strong>{code}</strong> →</span>
      <label className="sr-only" htmlFor={`m-${code}`}>対応する店舗</label>
      <select id={`m-${code}`} className={ui.select} style={{ width: 'auto' }} value={shopId} onChange={(e) => setShopId(e.target.value)}>
        <option value="">店舗を選ぶ</option>
        {shops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      {shopId && <ActionButton path={`/imports/${importId}/map-shop`} body={{ code, shopId }} label="対応付ける" variant="secondary" />}
    </div>
  );
}
