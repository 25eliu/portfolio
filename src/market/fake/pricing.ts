/** Deterministic pseudo-prices for the fake adapter — stable per (symbol, date), no randomness. */

/** FNV-1a hash → unsigned 32-bit int. */
function hash(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A stable base price in roughly [20, 420) derived from the symbol alone. */
export function basePrice(symbol: string): number {
  return 20 + (hash(symbol) % 40000) / 100;
}

/**
 * Price for a symbol on a given calendar date. Base price modulated by a small (±6%)
 * deterministic factor keyed on the date, so the equity curve moves across days but is
 * fully reproducible (great for tests + demos).
 */
export function fakePrice(symbol: string, date: string): number {
  const base = basePrice(symbol);
  const factor = ((hash(`${symbol}@${date}`) % 1200) - 600) / 10000; // [-0.06, +0.06)
  return Math.round(base * (1 + factor) * 100) / 100;
}
