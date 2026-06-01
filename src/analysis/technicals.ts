import type { Bar } from "../market/types.ts";
import { type Technicals, emptyTechnicals } from "../domain/technicals.ts";

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
  let gain = 0, loss = 0;
  for (let i = values.length - n; i < values.length; i++) {
    const diff = values[i]! - values[i - 1]!;
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  if (gain + loss === 0) return 50;
  if (loss === 0) return 100;
  const rs = gain / loss;
  return round(100 - 100 / (1 + rs), 2);
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
  return sma(tr, n);
}

function stdev(values: number[]): number {
  const m = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, b) => a + (b - m) ** 2, 0) / values.length);
}

export function computeTechnicals(bars: Bar[], beta: number | null): Technicals {
  const t = emptyTechnicals();
  if (bars.length === 0) return t;
  const closes = bars.map((b) => b.close);
  const vols = bars.map((b) => b.volume);
  const price = closes.at(-1)!;
  t.price = price;
  t.beta = beta;
  t.sma20 = sma(closes, 20); t.sma50 = sma(closes, 50); t.sma200 = sma(closes, 200);
  t.ema20 = ema(closes, 20); t.ema50 = ema(closes, 50); t.ema200 = ema(closes, 200);
  if (t.sma200 != null) t.priceVsSma200Pct = round(((price - t.sma200) / t.sma200) * 100, 2);
  if (t.sma50 != null && t.sma200 != null) t.goldenCross = t.sma50 > t.sma200;
  t.rsi14 = rsi(closes, 14);
  const m = macd(closes);
  t.macd = m.macd; t.macdSignal = m.signal; t.macdHist = m.hist;
  t.atr14 = atr(bars, 14);
  if (closes.length >= 20) {
    const window = closes.slice(-20);
    const mid = window.reduce((a, b) => a + b, 0) / 20;
    const sd = stdev(window);
    t.bbUpper = round(mid + 2 * sd); t.bbLower = round(mid - 2 * sd);
    t.bbPercentB = sd === 0 ? null : round((price - t.bbLower) / (t.bbUpper - t.bbLower), 4);
  }
  const window52 = bars.slice(-252);
  t.high52w = round(Math.max(...window52.map((b) => b.high)));
  t.low52w = round(Math.min(...window52.map((b) => b.low)));
  t.pctFrom52wHigh = round(((price - t.high52w) / t.high52w) * 100, 2);
  t.pctFrom52wLow = round(((price - t.low52w) / t.low52w) * 100, 2);
  t.avgVolume20 = sma(vols, 20);
  t.relativeVolume = t.avgVolume20 ? round(vols.at(-1)! / t.avgVolume20, 2) : null;
  let obv = 0;
  for (let i = 1; i < bars.length; i++) obv += bars[i]!.close > bars[i - 1]!.close ? bars[i]!.volume : bars[i]!.close < bars[i - 1]!.close ? -bars[i]!.volume : 0;
  t.obv = obv;
  const recent = bars.slice(-20);
  const pv = recent.reduce((a, b) => a + ((b.high + b.low + b.close) / 3) * b.volume, 0);
  const vv = recent.reduce((a, b) => a + b.volume, 0);
  t.vwap = vv ? round(pv / vv) : null;
  t.support = round(Math.min(...recent.map((b) => b.low)));
  t.resistance = round(Math.max(...recent.map((b) => b.high)));
  return t;
}
