import { z } from 'zod';

export const RequestCategory = z.enum(['voucher_payment', 'facility_cleaning', 'other']);
export type RequestCategory = z.infer<typeof RequestCategory>;

export const CATEGORY_LABEL: Record<RequestCategory, string> = {
  voucher_payment: '券・入金',
  facility_cleaning: '設備・清掃',
  other: 'その他',
};

export const REQUEST_STATUS_LABEL: Record<string, string> = {
  received: '受付',
  in_progress: '対応中',
  awaiting_shop: '店の返事待ち',
  resolved: '完了',
};
