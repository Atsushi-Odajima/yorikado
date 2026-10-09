/** Current time in ms. Server components render per request, so reading the clock is intended. */
export function nowMs(): number {
  return Date.now();
}
