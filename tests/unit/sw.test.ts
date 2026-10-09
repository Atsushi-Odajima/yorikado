import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

/** Executes public/sw.js with fake browser globals to check its fetch decisions. */
function loadSw(fetchImpl: (r: unknown) => Promise<unknown>) {
  const listeners: Record<string, (e: unknown) => void> = {};
  const cached = new Map<string, string>([['/offline.html', 'OFFLINE']]);
  const ctx = {
    self: { addEventListener: (t: string, f: (e: unknown) => void) => (listeners[t] = f), location: { origin: 'https://app.example' }, skipWaiting: () => undefined, clients: { claim: () => undefined } },
    caches: { match: async (r: string | { url: string }) => cached.get(typeof r === 'string' ? r : new URL(r.url).pathname) ?? undefined, open: async () => ({ addAll: async () => undefined }), keys: async () => [] },
    fetch: fetchImpl,
    URL,
    Promise,
  };
  runInNewContext(readFileSync('public/sw.js', 'utf8'), ctx);
  return (req: { method: string; url: string; mode?: string }) => {
    let responded: Promise<unknown> | undefined;
    listeners.fetch!({ request: req, respondWith: (p: Promise<unknown>) => (responded = p) });
    return responded;
  };
}

describe('service worker', () => {
  it('serves the offline notice when a navigation fails, never a cached business page', async () => {
    const fire = loadSw(() => Promise.reject(new Error('offline')));
    await expect(fire({ method: 'GET', url: 'https://app.example/m/tasks', mode: 'navigate' })).resolves.toBe('OFFLINE');
  });
  it('does not intercept API, POST, or cross-origin requests', () => {
    const fire = loadSw(() => Promise.resolve('NET'));
    expect(fire({ method: 'GET', url: 'https://app.example/api/v1/me' })).toBeUndefined();
    expect(fire({ method: 'POST', url: 'https://app.example/api/v1/redemptions' })).toBeUndefined();
    expect(fire({ method: 'POST', url: 'https://app.example/m', mode: 'navigate' })).toBeUndefined();
    expect(fire({ method: 'GET', url: 'https://other.example/x' })).toBeUndefined();
  });
  it('online navigations go to the network', async () => {
    const fire = loadSw(() => Promise.resolve('NET'));
    await expect(fire({ method: 'GET', url: 'https://app.example/m', mode: 'navigate' })).resolves.toBe('NET');
  });
});
