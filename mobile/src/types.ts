export type TradeDirection = 'LONG' | 'SHORT' | 'NO_TRADE';
export type CorrelationMode = 'STANDALONE_ALPHA' | 'BTC_COUPLED';

export interface CandidateCoin {
  symbol: string;
  price: number;
  priceChange15mPct: number;
  openInterest15mDeltaPct: number;
  squeezeVelocityScore: number;
  regime: string;
  fundingRate: number;
  isTradeableAplus?: boolean;
  confluenceScore?: number;
}

export interface TradePrediction {
  symbol: string;
  timestamp: number;
  direction: TradeDirection;
  regime: string;
  liveMarkPrice: number;
  entryPrice: number;
  stopLoss: number;
  stopDistancePct: number;
  tp1: number;
  tp1DistancePct: number;
  tp2: number;
  tp2DistancePct: number;
  riskRewardRatio: number | string;
  confidenceScore: number;
  winProbabilityPct: number;
  recommendedNotionalUsdt: number;
  recommendedLeverage: number;
  marginRequiredUsdt: number;
  atr14?: number;
  correlationMode: CorrelationMode;
  htfTrend?: 'BULLISH' | 'BEARISH';
  microCvd5m?: number;
  priceCvdDivergence?: string;
  shortLiqPool50x?: number;
  longLiqPool50x?: number;
  wallFrontRunNote?: string;
  predictionSummary?: {
    priceActionForecast?: string;
    keyCatalyst?: string;
    invalidationTrigger?: string;
  };
  rationale?: string;
}

export interface PaperTrade {
  id?: string;
  tradeId?: string;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  currentMarkPrice?: number;
  currentPrice?: number;
  stopLoss: number;
  trailingStopPrice?: number;
  tp1: number;
  tp2: number;
  notionalUsdt?: number;
  currentNotional?: number;
  maxSafeLeverage?: number;
  leverage?: number;
  unrealizedPnlPct?: number;
  unrealizedPnlUsdt?: number;
  unrealizedPnL?: number;
  status: 'ACTIVE' | 'PENDING_FILL' | 'CLOSED_WIN' | 'CLOSED_LOSS' | 'CLOSED_SCRATCH' | 'EXPIRED' | string;
  entryTime?: number;
}

export interface MacroTelemetry {
  btcPrice: number;
  btcChange15mPct: number;
  macroState: string;
  longsBlocked: boolean;
}

export interface PortfolioReport {
  equityUsdt: number;
  availableBalanceUsdt: number;
  unrealizedPnlUsdt?: number;
  totalUnrealizedPnL?: number;
  usedMarginUsdt?: number;
  marginUsagePct?: number;
}

// --- DYNAMIC HIGH-PRECISION CRYPTO PRICE FORMATTERS ---

export function getCryptoPriceDecimals(ref: number | string): number {
  const num = Math.abs(Number(ref));
  if (isNaN(num) || num === 0) return 2;
  if (num >= 1000) return 2;
  if (num >= 100) return 2;
  if (num >= 1) return 4;
  const leadingZeros = Math.floor(-Math.log10(num));
  return Math.max(4, Math.min(8, leadingZeros + 5));
}

export function formatCryptoPrice(val: number | string, refPrice?: number | string): string {
  const num = Number(val);
  if (isNaN(num) || num === 0) return '0.00';
  const ref = refPrice !== undefined ? Number(refPrice) : num;
  const dec = getCryptoPriceDecimals(ref);
  if (num >= 1000) {
    return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  let str = num.toFixed(dec);
  if (dec > 2 && str.includes('.')) {
    str = str.replace(/(\.\d{2,}?)0+$/, '$1');
  }
  return str;
}

