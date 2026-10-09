import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { MfaProvider } from '@/components/feedback/MfaProvider';
import { ServiceWorker } from '@/components/feedback/ServiceWorker';
import '@/styles/global.css';

// Every page is rendered per request so the CSP nonce from proxy.ts is applied to Next's scripts.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: { default: 'Yorikado 商店街の窓口', template: '%s | Yorikado' },
  applicationName: 'Yorikado',
  description: '商店街の加盟店と事務局のための窓口アプリ',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/brand/favicon_32.png', apple: '/brand/apple_touch_icon_180.png' },
  appleWebApp: { capable: true, title: 'ヨリカド', statusBarStyle: 'default' },
  formatDetection: { telephone: false },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: '#F7F4EB',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  colorScheme: 'light',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <MfaProvider>{children}</MfaProvider>
        <ServiceWorker />
      </body>
    </html>
  );
}
