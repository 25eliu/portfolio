import type { Bar } from "../market/types.ts";
import { Technicals, emptyTechnicals, type Technicals as TechnicalsT } from "../domain/technicals.ts";

const round = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;

export function sma(values: number[], n: number): number | null {
  if (values.length < n) return null;
  const slice = values.slice(-n);
  return round(slice.reduce((a, b) => a + b, 0) / n);
}

export function ema(values: number[], n: number): number | null {
  if (values.length < n) return null;
  const k = 2 / (n + 1);
  let e = values.slice(0, n).reduce((a, b) => a + b, 0) / n; // seed with SMA
  for (let i = n; i < values.length; i++) e = values[i]! * k + e * (1 - k);
  return round(e);
}

export function rsi(values: number[], n = 14): number | null {
  if (values.length < n + 1) return null;
  let gainSum = 0, lossSum = 0;
  for (let i = 1; i <= n; i++) {
    const d = values[i]! - values[i - 1]!;
    if (d >= 0) gainSum += d; else lossSum -= d;
  }
  let avgGain = gainSum / n, avgLoss = lossSum / n;
  for (let i = n + 1; i < values.length; i++) {
    const d = values[i]! - values[i - 1]!;
    avgGain = (avgGain * (n - 1) + (d > 0 ? d : 0)) / n;
    avgLoss = (avgLoss * (n - 1) + (d < 0 ? -d : 0)) / n;
  }
  if (avgGain + avgLoss === 0) return 50;
  if (avgLoss === 0) return 100;
  return round(100 - 100 / (1 + avgGain / avgLoss), 2);
}

function macd(values: number[]): { macd: number | null; signal: number | null; hist: number | null } {
  const fast = ema(values, 12);
  const slow = ema(values, 26);
  if (fast == null || slow == null) return { macd: null, signal: null, hist: null };
  const line: number[] = [];
  for (let i = 26; i <= values.length; i++) {
    const f = ema(values.slice(0, i), 12);
    const s = ema(values.slice(0, i), 26);
    if (f != null && s != null) line.push(f - s);
  }
  const m = round(fast - slow);
  const signal = ema(line, 9);
  return { macd: m, signal, hist: signal == null ? null : round(m - signal) };
}

function atr(bars: Bar[], n = 14): number | null {
  if (bars.length < n + 1) return null;
  const tr: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const h = bars[i]!.high, l = bars[i]!.low, pc = bars[i - 1]!.close;
    tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  let a = tr.slice(0, n).reduce((x, y) => x + y, 0) / n;
  for (let i = n; i < tr.length; i++) a = (a * (n - 1) + tr[i]!) / n;
  return round(a);
}

function stdev(values: number[]): number {
  const m = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, b) => a + (b - m) ** 2, 0) / values.length);
}

function stochastic(bars: Bar[], n = 14, d = 3): { k: number | null; dval: number | null } {
  if (bars.length < n) return { k: null, dval: null };
  const kSeries: number[] = [];
  for (let end = n; end <= bars.length; end++) {
    const window = bars.slice(end - n, end);
    const high = Math.max(...window.map((b) => b.high));
    const low = Math.min(...window.map((b) => b.low));
    const close = window[window.length - 1]!.close;
    kSeries.push(high === low ? 50 : ((close - low) / (high - low)) * 100);
  }
  const k = kSeries.at(-1)!;
  const dval = kSeries.length >= d ? kSeries.slice(-d).reduce((a, b) => a + b, 0) / d : null;
  return { k: round(k, 2), dval: dval == null ? null : round(dval, 2) };
}

export function computeTechnicals(bars: Bar[], beta: number | null): TechnicalsT {
  if (bars.length === 0) return emptyTechnicals();
  const closes = bars.map((b) => b.close);
  const vols = bars.map((b) => b.volume);
  const price = closes.at(-1)!;
  const sma50v = sma(closes, 50);
  const sma200v = sma(closes, 200);
  const m = macd(closes);
  const stoch = stochastic(bars);
  const recent = bars.slice(-20);
  const window52 = bars.slice(-252);
  const high52 = round(Math.max(...window52.map((b) => b.high)));
  const low52 = round(Math.min(...window52.map((b) => b.low)));

  let bbUpper: number | null = null, bbLower: number | null = null, bbPercentB: number | null = null;
  if (closes.length >= 20) {
    const window = closes.slice(-20);
    const mid = window.reduce((a, b) => a + b, 0) / 20;
    const sd = stdev(window);
    bbUpper = round(mid + 2 * sd);
    bbLower = round(mid - 2 * sd);
    bbPercentB = sd === 0 ? null : round((price - bbLower) / (bbUpper - bbLower), 4);
  }

  let obv = 0;
  for (let i = 1; i < bars.length; i++) {
    obv += bars[i]!.close > bars[i - 1]!.close ? bars[i]!.volume
      : bars[i]!.close < bars[i - 1]!.close ? -bars[i]!.volume : 0;
  }

  const pv = recent.reduce((a, b) => a + ((b.high + b.low + b.close) / 3) * b.volume, 0);
  const vv = recent.reduce((a, b) => a + b.volume, 0);
  const avgVol20 = sma(vols, 20);

  return Technicals.parse({
    price,
    sma20: sma(closes, 20), sma50: sma50v, sma200: sma200v,
    ema20: ema(closes, 20), ema50: ema(closes, 50), ema200: ema(closes, 200),
    priceVsSma200Pct: sma200v != null ? round(((price - sma200v) / sma200v) * 100, 2) : null,
    goldenCross: sma50v != null && sma200v != null ? sma50v > sma200v : null,
    rsi14: rsi(closes, 14),
    macd: m.macd, macdSignal: m.signal, macdHist: m.hist,
    stochK: stoch.k, stochD: stoch.dval,
    atr14: atr(bars, 14),
    bbUpper, bbLower, bbPercentB,
    high52w: high52, low52w: low52,
    pctFrom52wHigh: round(((price - high52) / high52) * 100, 2),
    pctFrom52wLow: round(((price - low52) / low52) * 100, 2),
    avgVolume20: avgVol20,
    relativeVolume: avgVol20 ? round(vols.at(-1)! / avgVol20, 2) : null,
    obv,
    vwap: vv ? round(pv / vv) : null,
    beta,
    support: round(Math.min(...recent.map((b) => b.low))),
    resistance: round(Math.max(...recent.map((b) => b.high))),
  });
}
