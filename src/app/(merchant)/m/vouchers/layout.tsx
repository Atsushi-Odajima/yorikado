import type { ReactNode } from 'react';
import { BasketProvider } from '@/components/merchant/Basket';

export default function VouchersLayout({ children }: { children: ReactNode }) {
  return <BasketProvider>{children}</BasketProvider>;
}
