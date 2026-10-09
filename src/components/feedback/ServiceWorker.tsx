'use client';

import { useEffect } from 'react';

/** Registers the public-shell-only service worker (see public/sw.js). */
export function ServiceWorker() {
  useEffect(() => {
    if ('serviceWorker' in navigator && window.isSecureContext) {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined);
    }
  }, []);
  return null;
}
