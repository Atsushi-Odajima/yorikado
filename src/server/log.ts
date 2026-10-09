/**
 * Minimal structured logger. Never pass tokens, passwords, bank numbers or
 * request bodies. Keys that look secret are redacted defensively.
 */
const SECRET_KEY = /token|password|secret|key|authorization|cookie|account_number|accountNumber/i;

function scrub(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) out[k] = SECRET_KEY.test(k) ? '[redacted]' : v;
  return out;
}

function write(level: 'info' | 'warn' | 'error', event: string, meta: Record<string, unknown> = {}) {
  const line = JSON.stringify({ level, event, at: new Date().toISOString(), ...scrub(meta) });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const log = {
  info: (event: string, meta?: Record<string, unknown>) => write('info', event, meta),
  warn: (event: string, meta?: Record<string, unknown>) => write('warn', event, meta),
  error: (event: string, meta?: Record<string, unknown>) => write('error', event, meta),
};
