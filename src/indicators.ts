import { RawCandle, ScannedCoinData } from './scanner';

export interface TimeframeMetrics {
  timeframe: '15m' | '1h' | '4h';
  price: number;
  ma7: number;
  ma25: number;
  ma99: number;
  currentCandleRangePct: number;
  volumeSpikeRatio: number;
  localCeiling: number;
  localFloor: number;
  voidDistanceMa25Pct: number;
  voidDistanceMa99Pct: number;
}

export interface PreFilterResult {
  passed: boolean;
  conditionA: boolean;
  conditionB: boolean;
  reasons: string[];
}

export interface CoinIndicatorPayload {
  symbol: string;
  price: number;
  priceChange24hPct: number;
  quoteVolume24hUsdt: number;
  fundingRate: number;
  tf15m: TimeframeMetrics;
  tf1h: TimeframeMetrics;
  tf4h: TimeframeMetrics;
  preFilter: PreFilterResult;
  computedAt: number;
}

export function calculateSMA(values: number[], period: number): number {
  if (!values || values.length === 0) return 0;
  const slice = values.slice(-period);
  return slice.reduce((sum, v) => sum + v, 0) / slice.length;
}

export function computeTimeframeMetrics(
  timeframe: '15m' | '1h' | '4h',
  candles: RawCandle[],
  livePrice?: number
): TimeframeMetrics {
  if (!candles || candles.length === 0) {
    return {
      timeframe,
      price: livePrice || 0,
      ma7: 0,
      ma25: 0,
      ma99: 0,
      currentCandleRangePct: 0,
      volumeSpikeRatio: 0,
      localCeiling: 0,
      localFloor: 0,
      voidDistanceMa25Pct: 0,
      voidDistanceMa99Pct: 0,
    };
  }

  const closes = candles.map((c) => c.close);
  const lastCandle = candles[candles.length - 1];
  const price = livePrice && livePrice > 0 ? livePrice : lastCandle.close;

  const ma7 = calculateSMA(closes, 7);
  const ma25 = calculateSMA(closes, 25);
  const ma99 = calculateSMA(closes, 99);

  const currentCandleRangePct =
    lastCandle.low > 0 ? ((lastCandle.high - lastCandle.low) / lastCandle.low) * 100 : 0;

  // Volume Spike Ratio: Current candle volume divided by the 10-candle SMA volume
  const prev10Volumes = candles.slice(-11, -1).map((c) => c.volume);
  const sma10Volume = calculateSMA(prev10Volumes.length > 0 ? prev10Volumes : candles.map((c) => c.volume), 10);
  const volumeSpikeRatio = sma10Volume > 0 ? lastCandle.volume / sma10Volume : 1;

  // Local Structural Wicks: Highest high and lowest low of the last 5 candles
  const last5 = candles.slice(-5);
  const localCeiling = Math.max(...last5.map((c) => c.high));
  const localFloor = Math.min(...last5.map((c) => c.low));

  // Void Distance %: Percentage distance between current price and MA(25) / MA(99)
  const voidDistanceMa25Pct = ma25 > 0 ? ((price - ma25) / ma25) * 100 : 0;
  const voidDistanceMa99Pct = ma99 > 0 ? ((price - ma99) / ma99) * 100 : 0;

  return {
    timeframe,
    price,
    ma7,
    ma25,
    ma99,
    currentCandleRangePct: Number(currentCandleRangePct.toFixed(3)),
    volumeSpikeRatio: Number(volumeSpikeRatio.toFixed(2)),
    localCeiling,
    localFloor,
    voidDistanceMa25Pct: Number(voidDistanceMa25Pct.toFixed(2)),
    voidDistanceMa99Pct: Number(voidDistanceMa99Pct.toFixed(2)),
  };
}

export function evaluatePreFilter(
  price: number,
  priceChange24hPct: number,
  tf15m: TimeframeMetrics
): PreFilterResult {
  const reasons: string[] = [];

  // Condition A (Pinch/Breakout): Price within 1.5% of localFloor or localCeiling with Volume Ratio >= 0.9x
  const distToFloorPct = tf15m.localFloor > 0 ? Math.abs((price - tf15m.localFloor) / tf15m.localFloor) * 100 : 999;
  const distToCeilingPct = tf15m.localCeiling > 0 ? Math.abs((tf15m.localCeiling - price) / tf15m.localCeiling) * 100 : 999;
  const nearLocalStructure = distToFloorPct <= 1.5 || distToCeilingPct <= 1.5;
  const conditionA = nearLocalStructure && tf15m.volumeSpikeRatio >= 0.9;

  if (conditionA) {
    reasons.push(
      `Condition A (Pinch/Breakout): Price within 1.5% of ${distToCeilingPct <= distToFloorPct ? 'localCeiling' : 'localFloor'} with Vol Ratio ${tf15m.volumeSpikeRatio}x`
    );
  }

  // Condition B (Parabolic Extension / Void): |24h change| > 25% and price stretched > 5% away from MA(25)
  const conditionB = Math.abs(priceChange24hPct) > 25 && Math.abs(tf15m.voidDistanceMa25Pct) > 5;
  if (conditionB) {
    reasons.push(
      `Condition B (Parabolic Extension/Void): 24h ${priceChange24hPct.toFixed(2)}% & MA25 Void ${tf15m.voidDistanceMa25Pct}%`
    );
  }

  return {
    passed: conditionA || conditionB,
    conditionA,
    conditionB,
    reasons,
  };
}

export function buildIndicatorPayload(coin: ScannedCoinData): CoinIndicatorPayload {
  const tf15m = computeTimeframeMetrics('15m', coin.candles15m, coin.price);
  const tf1h = computeTimeframeMetrics('1h', coin.candles1h, coin.price);
  const tf4h = computeTimeframeMetrics('4h', coin.candles4h, coin.price);
  const preFilter = evaluatePreFilter(coin.price, coin.priceChange24hPct, tf15m);

  return {
    symbol: coin.symbol,
    price: coin.price,
    priceChange24hPct: Number(coin.priceChange24hPct.toFixed(2)),
    quoteVolume24hUsdt: Math.round(coin.quoteVolume24hUsdt),
    fundingRate: coin.fundingRate,
    tf15m,
    tf1h,
    tf4h,
    preFilter,
    computedAt: Date.now(),
  };
}
