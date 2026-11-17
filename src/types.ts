export type MarketRegime =
  | 'PRIME_SHORT_SQUEEZE'
  | 'SHORT_COVERING_EXHAUSTION'
  | 'PRIME_LONG_SQUEEZE'
  | 'SPOT_LED_MARKUP'
  | 'NEUTRAL';

export type MacroState =
  | 'MACRO_STABLE'
  | 'MACRO_DUMP_WARNING'
  | 'MACRO_SQUEEZE_TAILWIND';

export type CorrelationMode = 'STANDALONE_ALPHA' | 'BTC_COUPLED';

export type TradeDirection = 'LONG' | 'SHORT' | 'NO_TRADE';

export type TradeStatus =
  | 'PENDING_FILL'
  | 'ACTIVE'
  | 'CLOSED_WIN'
  | 'CLOSED_LOSS'
  | 'CLOSED_SCRATCH'
  | 'EXPIRED';

export interface LiquidationEvent {
  symbol: string;
  side: 'BUY' | 'SELL'; // BUY = forced buy to cover (short liquidated), SELL = forced sell (long liquidated)
  price: number;
  origQty: number;
  notionalUsd: number;
  timestamp: number;
}

export interface SymbolLiquidationWindow {
  symbol: string;
  shortLiqUsd15m: number; // Forced buy-to-cover notional (shorts rekt)
  longLiqUsd15m: number;  // Forced sell-to-close notional (longs rekt)
  lastUpdated: number;
}

export interface MarkPriceData {
  symbol: string;
  markPrice: number;
  indexPrice: number;
  estimatedSettlePrice: number;
  lastFundingRate: number;
  nextFundingTime: number; // Timestamp T
  timestamp: number;
}

export interface KlineCandle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
  quoteVolume: number;
  trades: number;
}

export interface LiquidityWall {
  price: number;
  quantity: number;
  notional: number;
  distancePct: number;
}

export interface OrderBookTelemetry {
  symbol: string;
  midPrice: number;
  bestBid: number;
  bestAsk: number;
  bidNotional2Pct: number;
  askNotional2Pct: number;
  obi: number; // Order Book Imbalance (-1.0 to +1.0)
  topBidWall: LiquidityWall;
  topAskWall: LiquidityWall;
  timestamp: number;
}

export interface CoinMicrostructure {
  symbol: string;
  price: number;
  priceChange15mPct: number;
  priceChange24hPct: number;
  volume15m: number;
  volume24hUsd: number;
  atr14: number;
  sessionVwap: number;
  openInterest: number;
  openInterest15mDeltaPct: number;
  markPrice: number;
  indexPrice: number;
  spotPerpBasisPct: number;
  fundingRate: number;
  nextFundingTime: number; // T
  takerBuySellRatio15m: number;
  topTraderLongShortRatio: number;
  globalRetailLongShortRatio: number;
  shortLiqUsd15m: number;
  longLiqUsd15m: number;
  orderBook: OrderBookTelemetry;
  adlRiskLevel: number; // 1 to 5
  squeezeVelocityScore: number; // 0 to 100
  regime: MarketRegime;
  timestamp: number;
  // Multi-Timeframe (MTF) & Micro-CVD Confluence Telemetry
  ema9_1m?: number;
  rsi14_1m?: number;
  microCvd5m: number; // Net taker buy quote volume over 5m
  priceCvdDivergence: 'BULLISH_ABSORPTION' | 'BEARISH_ABSORPTION' | 'NONE';
  ema20_1h?: number;
  htfTrend: 'BULLISH' | 'BEARISH';
  swingHigh1h: number;
  swingLow1h: number;
  shortLiqPool50x: number; // Estimated 50x short liquidation magnet pool (swingHigh * 1.018)
  longLiqPool50x: number;  // Estimated 50x long liquidation magnet pool (swingLow * 0.982)
  atr14_1h?: number;       // 1-Hour Wilder ATR14 for structural swing stops
  ema50_1h?: number;       // 1-Hour 50-EMA for HTF trend bias
  confluenceScore?: number;// Signed institutional confluence matrix (-100 to +100)
}

export interface CandidateScanResult {
  symbol: string;
  price: number;
  squeezeVelocityScore: number;
  regime: MarketRegime;
  openInterest15mDeltaPct: number;
  fundingRate: number;
  priceChange15mPct: number;
  volume15mUsd: number;
  shortLiqUsd15m: number;
  longLiqUsd15m: number;
  obi: number;
  topBidWallPrice: number;
  topAskWallPrice: number;
  confluenceScore?: number;
  isTradeableAplus?: boolean;
}

export interface CachedCoinData {
  symbol: string;
  microstructure: CoinMicrostructure;
  candles: KlineCandle[];
  timestamp: number;
}

export interface MacroTelemetry {
  btcPrice: number;
  btcChange15mPct: number;
  btcShortLiq15mUsd: number;
  btcLongLiq15mUsd: number;
  macroState: MacroState;
  longsBlocked: boolean;
  timestamp: number;
  btc1hTrend: 'BULLISH' | 'BEARISH';
  below1hEma20: boolean;
  above1hEma20: boolean;
  btcEma20_1h?: number;
}

export interface BracketTradeSetup {
  symbol: string;
  direction: TradeDirection;
  regime: MarketRegime;
  entryPrice: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  riskRewardRatio: number;
  stopDistancePct: number;
  notionalUsdt: number;
  quantity: number;
  maxSafeLeverage: number;
  marginRequiredUsdt?: number;
  atr14: number;
  atr14_1h?: number;
  wallFrontRunNote?: string;
  sanitizerNotes: string[];
  rationale: string;
  correlationMode?: CorrelationMode;
}

export interface TradePredictionSummary {
  priceActionForecast: string;
  keyCatalyst: string;
  invalidationTrigger: string;
}

export interface TradePrediction {
  symbol: string;
  timestamp: number;
  direction: TradeDirection;
  regime: MarketRegime;
  correlationMode?: CorrelationMode;
  liveMarkPrice: number;
  entryPrice: number;
  stopLoss: number;
  stopDistancePct: number;
  tp1: number;
  tp1DistancePct: number;
  tp2: number;
  tp2DistancePct: number;
  riskRewardRatio: number;
  confidenceScore: number;
  winProbabilityPct: number;
  recommendedNotionalUsdt: number;
  recommendedLeverage: number;
  marginRequiredUsdt: number;
  atr14: number;
  predictionSummary: TradePredictionSummary;
  rationale: string;
  sanitizerNotes?: string[];
  // MTF & Order Flow Confluence
  microCvd5m?: number;
  priceCvdDivergence?: 'BULLISH_ABSORPTION' | 'BEARISH_ABSORPTION' | 'NONE';
  htfTrend?: 'BULLISH' | 'BEARISH';
  shortLiqPool50x?: number;
  longLiqPool50x?: number;
  wallFrontRunNote?: string;
  // Phase 4 Gatekeeper & Structural Swing Fields
  gatekeeperStatus?: 'ACTIVE_SWING_SETUP' | 'WAIT_FOR_CONFLUENCE' | 'FORCED_SIMULATION';
  gatekeeperReason?: string;
  confluenceScore?: number;
  watchLongBelow?: number;
  watchShortAbove?: number;
  requiredOiTrigger?: string;
  isAplusSetup?: boolean;
}

export interface PaperTradeRecord {
  tradeId: string;
  symbol: string;
  direction: TradeDirection;
  regime: MarketRegime;
  correlationMode?: CorrelationMode;
  entryPrice: number;
  targetPrice: number;
  currentPrice: number;
  stopLoss: number;
  originalStopLoss: number;
  tp1: number;
  tp2: number;
  quantity: number;
  initialNotional: number;
  currentNotional: number;
  leverage: number;
  status: TradeStatus;
  flowHealth?: 'STRONG' | 'STALLING' | 'REVERSAL_WARNING';
  tp1Hit: boolean;
  tp2Hit: boolean;
  slHit: boolean;
  maePct: number; // Max Adverse Excursion %
  maeUsd: number;
  mfePct: number; // Max Favorable Excursion %
  mfeUsd: number;
  realizedPnL: number;
  unrealizedPnL: number;
  feesPaid: number;
  createdAt: Date;
  openedAt?: Date;
  closedAt?: Date;
  maxHoldMinutes: number;
  closeReason?: string;
}

export interface PortfolioPosition {
  symbol: string;
  direction: TradeDirection;
  notionalUsd: number;
  entryPrice: number;
  markPrice: number;
  leverage: number;
  unrealizedPnL: number;
  liquidationPrice: number;
  distanceToLiqPct: number;
  fundingRate: number;
  estimatedFundingBleed8h: number;
  betaToBtc: number;
}

export interface PortfolioRiskReport {
  equityUsdt: number;
  availableBalanceUsdt: number;
  usedMarginUsdt: number;
  totalUnrealizedPnL: number;
  portfolioBeta: number;
  btcCrash5PctLossUsdt: number;
  btcCrash5PctLossPct: number;
  total8hFundingBleedUsdt: number;
  positions: PortfolioPosition[];
}

export interface CopilotMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  parsedBadges?: {
    tag: string;
    text: string;
  }[];
}

// =========================================================================
// QUANT DUAL-MODE SETUP SCHEMAS ($80 ACCOUNT ENGINE)
// =========================================================================

export type QuantMarketRegime =
  | 'PARABOLIC_BLOWOFF'
  | 'SHORT_SQUEEZE'
  | 'BEARISH_CASCADE'
  | 'MA_VICE_PINCH';

export interface StructuralDiagnosis {
  maRelationship: string;
  liquidityWicks: string;
  voidAndFundingAnalysis: string;
}

export interface FastScalpSetup {
  bias: 'LONG' | 'SHORT';
  orderType: 'STOP_MARKET' | 'LIMIT';
  triggerOrEntry: number;
  stopLoss: number;
  takeProfit: number;
  expectedMovePercent: number;
  maxLeverage: number;
  timeStopMinutes: number;
  executionNote: string;
}

export interface LongTermSwingSetup {
  bias: 'LONG' | 'SHORT';
  orderType: 'STOP_MARKET' | 'LIMIT';
  triggerOrEntry: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  riskRewardRatio: string;
  maxLeverage: number;
  estimatedHoldTime: string;
  executionNote: string;
}

export interface DualModeQuantSetup {
  symbol: string;
  marketRegime: QuantMarketRegime;
  structuralDiagnosis: StructuralDiagnosis;
  // Primary & Long Traps
  fastScalp5to10m: FastScalpSetup;
  longTermSwing: LongTermSwingSetup;
  // Explicit Short Traps
  fastScalpShort5to10m?: FastScalpSetup;
  longTermSwingShort?: LongTermSwingSetup;
  // Explicit Aliases
  longScalp?: FastScalpSetup;
  shortScalp?: FastScalpSetup;
  longSwing?: LongTermSwingSetup;
  shortSwing?: LongTermSwingSetup;
  accountEquityUsd?: number;
  positionSizing?: {
    notionalScalpUsd: number;
    marginScalpUsd: number;
    notionalSwingUsd: number;
    marginSwingUsd: number;
  };
  timestamp?: number;
}

export interface QuantMetricsPayload {
  symbol: string;
  currentPrice: number;
  priceChange24hPct: number;
  candleRange15mPct: number;
  fundingRate: number;
  fundingRatePercent: string;
  openInterest15mDeltaPct: number;
  volumeRatio15m: number;
  // 15m Micro Moving Averages & Wicks
  ma7_15m: number;
  ma25_15m: number;
  ma99_15m: number;
  localFloor15m: number;
  localCeiling15m: number;
  currentWickHigh15m: number;
  currentWickLow15m: number;
  // 1h / 4h Macro Moving Averages
  ma7_1h: number;
  ma25_1h: number;
  ma99_1h: number;
  ma7_4h: number;
  ma25_4h: number;
  ma99_4h: number;
  // Account Context
  accountEquityUsd: number;
}

/**
 * Dynamic Crypto Price Decimal Precision
 * Determines the required decimal places based on price magnitude to guarantee
 * that low-price and micro-cap coins (e.g. $0.0004034, $0.01382, $0.00001234)
 * preserve their full significant digits and are never prematurely rounded off.
 */
export function getCryptoPriceDecimals(price: number): number {
  const num = Math.abs(Number(price) || 0);
  if (num === 0) return 2;
  if (num >= 1000) return 2;
  if (num >= 100) return 2;
  if (num >= 1) return 4;
  const leadingZeros = Math.floor(-Math.log10(num));
  return Math.max(4, Math.min(8, leadingZeros + 5));
}

export function roundCryptoPrice(val: number, refPrice?: number): number {
  const dec = getCryptoPriceDecimals(refPrice ?? val);
  return Number(Number(val).toFixed(dec));
}

export function formatCryptoPrice(val: number | string, refPrice?: number): string {
  const num = Number(val);
  if (isNaN(num) || num === 0) return '0.00';
  const dec = getCryptoPriceDecimals(refPrice ?? num);
  if (num >= 1000) {
    return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  let str = num.toFixed(dec);
  if (dec > 2 && str.includes('.')) {
    str = str.replace(/(\.\d{2,}?)0+$/, '$1');
  }
  return str;
}

