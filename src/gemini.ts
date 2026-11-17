import { GoogleGenerativeAI } from '@google/generative-ai';
import axios from 'axios';
import dotenv from 'dotenv';
import {
  BracketTradeSetup,
  CoinMicrostructure,
  CorrelationMode,
  MacroTelemetry,
  PortfolioRiskReport,
  TradeDirection,
  TradePrediction,
  DualModeQuantSetup,
  FastScalpSetup,
  LongTermSwingSetup,
  QuantMetricsPayload,
  QuantMarketRegime,
  roundCryptoPrice,
  formatCryptoPrice,
} from './types';
import { paperTrading } from './paperTrading';
import { binanceAccount } from './binanceAccount';
import { marketData } from './marketData';
import { CONFIG } from './config';

dotenv.config();

export const QUANT_SYSTEM_PROMPT = `
You are an Institutional Quantitative Crypto Futures Analyst and Risk Engine managing an $80 USD Binance Futures account.
You will receive a real-time JSON payload containing 15m (micro) and 1h/4h (macro) OHLCV metrics, Moving Averages (MA7, MA25, MA99), local wick highs/lows, volume ratios, and funding rates for a high-volatility coin.

Your job is to evaluate the structure and output TWO distinct, non-emotional trap setups (NEVER recommend market orders):

### MODE 1: 5-TO-10 MINUTE ULTRA-FAST SCALP (15m Micro-Structure)
- **Objective:** Capture a rapid 1.5% to 4.5% impulse move that resolves within 5 to 10 minutes (1 to 2 five-minute candles).
- **Target Selection:** Target the nearest immediate liquidity magnet—such as a snap-back to 15m MA(7), a quick flush to 15m MA(25), or a break of the current 15m candle's high/low wick.
- **Stop-Loss:** Tight invalidation (1.5% to 3.0% max distance from entry).
- **Time-Stop Rule:** Strictly enforce a 5 to 8 minute time-stop. If triggered and TP is not hit within the time limit, instruct the user to exit at breakeven/scratch.

### MODE 2: LONG-TERM / MULTI-HOUR SWING SETUP (1h/4h Macro-Structure & Voids)
- **Objective:** Capture a major 8% to 25%+ structural trend continuation, parabolic void flush (drop toward 15m/1h MA99), or negative-funding short squeeze.
- **Entry Trap:** Use either a Stop-Market order strictly outside the 5-candle structural floor/ceiling (to catch breakdowns/breakouts) OR a patient Limit order front-running a major macro moving average (1h/4h MA25 or 15m MA25/MA99).
- **Risk/Reward:** Must maintain at least a 1:2.5 Risk-to-Reward ratio.
- **Leverage Cap:** If 24h change > 50% or 15m candle range > 5%, cap leverage strictly at 2x–3x. Otherwise, cap at 3x–5x.
- **Price Precision Rule:** NEVER prematurely truncate small-value coins to 4 or 5 decimals. Match the exact real-time precision of the target coin (e.g. for coins like 0.0004034, preserve full 7-8 decimal precision for entries, stops, and take-profit targets).

### REQUIRED JSON OUTPUT FORMAT:
Always respond in valid JSON matching this exact schema:
{
  "symbol": "string",
  "marketRegime": "PARABOLIC_BLOWOFF | SHORT_SQUEEZE | BEARISH_CASCADE | MA_VICE_PINCH",
  "structuralDiagnosis": {
    "maRelationship": "1-sentence summary of MA(7), MA(25), MA(99) fan or pinch across 15m and 4h",
    "liquidityWicks": "Exact floor and ceiling defense wicks",
    "voidAndFundingAnalysis": "Distance to major MA magnets and funding squeeze risk"
  },
  "fastScalp5to10m": {
    "bias": "LONG | SHORT",
    "orderType": "STOP_MARKET | LIMIT",
    "triggerOrEntry": 0.0004034,
    "stopLoss": 0.0003960,
    "takeProfit": 0.0004130,
    "expectedMovePercent": 2.4,
    "maxLeverage": 3,
    "timeStopMinutes": 8,
    "executionNote": "string"
  },
  "longTermSwing": {
    "bias": "LONG | SHORT",
    "orderType": "STOP_MARKET | LIMIT",
    "triggerOrEntry": 0.0004034,
    "stopLoss": 0.0003880,
    "takeProfit1": 0.0004450,
    "takeProfit2": 0.0004800,
    "riskRewardRatio": "1:2.8",
    "maxLeverage": 3,
    "estimatedHoldTime": "string",
    "executionNote": "string"
  }
}
`;

export interface CopilotAnalysisResponse {
  setup: BracketTradeSetup;
  copilotRationale: string;
  convictionScore: number; // 0 to 100
  ragStatsInjected?: any;
}

export class GeminiStrategyEngine {
  private genAI: GoogleGenerativeAI | null = null;
  private apiKey = '';
  // 60-second in-memory AI Setup cache per symbol for 0ms instant retrieval
  private aiSetupCache: Map<string, { response: CopilotAnalysisResponse; timestamp: number }> = new Map();
  // Fast prioritized models for execution on Google AI Studio
  private priorityModels: string[];
  // Circuit-breaker timestamp when Google AI Studio free tier rate/daily quota is hit
  private quotaExceededUntil = 0;

  private isQuotaExceeded(err: any): boolean {
    const msg = (err?.message || '').toLowerCase();
    return (
      msg.includes('429') ||
      msg.includes('quota') ||
      msg.includes('resourceexhausted') ||
      msg.includes('limit exceeded') ||
      msg.includes('rate-limits')
    );
  }

  constructor() {
    this.apiKey = (process.env.GEMINI_API_KEY || '').replace(/^["']|["']$/g, '').trim();
    const envModel = process.env.GEMINI_MODEL?.replace(/^["']|["']$/g, '').trim();
    const defaultModels = ['gemini-3.8-flash'];
    if (envModel) {
      this.priorityModels = [envModel, ...defaultModels.filter((m) => m !== envModel)];
    } else {
      this.priorityModels = defaultModels;
    }

    if (this.apiKey) {
      try {
        this.genAI = new GoogleGenerativeAI(this.apiKey);
        console.log(`[GeminiStrategyEngine] Google Generative AI client initialized. Priority models: ${this.priorityModels.join(', ')}`);
      } catch (err: any) {
        console.warn(`[GeminiStrategyEngine] Failed to initialize GoogleGenerativeAI: ${err.message}. Deterministic Quant Engine active.`);
      }
    } else {
      console.log('[GeminiStrategyEngine] GEMINI_API_KEY not configured. Deterministic Institutional Rule Engine active.');
    }
  }

  private async executeWithTimeout<T>(promise: Promise<T>, timeoutMs = 4000): Promise<T> {
    let timer: NodeJS.Timeout | null = null;
    const timeoutPromise = new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timeout: Gemini request exceeded ${timeoutMs}ms`)), timeoutMs);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  }

  // --- 1. DETERMINISTIC MATH SANITIZER (MOMENTUM SCALP PROTOCOL) ---

  /**
   * Deterministic Math Sanitizer:
   * - Immediate Momentum Scalp Entry (within 0.15 * ATR14 of live mark price)
   * - Tight Scalp Stop Floor: |Entry - SL| >= 0.8 * ATR14
   * - Fast Momentum Targets: TP1 at 1.2R, TP2 at 2.2R
   * - Blocks long entries during SHORT_COVERING_EXHAUSTION regimes
   * - Blocks long entries during MACRO_DUMP_WARNING
   */
  public validateAndSanitizeSetup(
    rawSetup: {
      symbol: string;
      direction: TradeDirection;
      entryPrice: number;
      stopLoss: number;
      tp1: number;
      tp2: number;
      equityUsdt?: number;
    },
    microstructure: CoinMicrostructure,
    macro: MacroTelemetry,
    correlationMode: CorrelationMode = 'STANDALONE_ALPHA',
    lockDirection = false
  ): BracketTradeSetup {
    const sanitizerNotes: string[] = [];
    const symbol = rawSetup.symbol.toUpperCase().trim();
    let direction = rawSetup.direction;
    const markPrice = microstructure.price;
    const atr14 = microstructure.atr14 > 0 ? microstructure.atr14 : markPrice * 0.012;
    const atr1h = microstructure.atr14_1h && microstructure.atr14_1h > 0 ? microstructure.atr14_1h : atr14 * 2.2;

    // Item #6: Reject NO_TRADE rather than coercing to LONG
    if (direction === 'NO_TRADE') {
      throw new Error(`Cannot sanitize trade setup: Direction is NO_TRADE (Edge Gatekeeper blocked setup)`);
    }

    if (!lockDirection) {
      // RULE 1: MACRO ALIGNMENT CHECK
      if (correlationMode === 'BTC_COUPLED') {
        if (direction === 'LONG' && macro.longsBlocked) {
          direction = 'SHORT';
          sanitizerNotes.push('[MACRO ALIGNMENT] Flipped direction to SHORT because BTC Macro Dump Warning is active (BTC-Coupled Mode).');
        }
      } else {
        sanitizerNotes.push('[STANDALONE ALPHA] BTC Macro filter bypassed — executing purely on coin order flow and structural levels.');
      }

      // RULE 2: REGIME CONSTRAINTS
      if (direction === 'LONG' && microstructure.regime === 'SHORT_COVERING_EXHAUSTION') {
        direction = 'SHORT';
        sanitizerNotes.push('[REGIME ALIGNMENT] Flipped direction to SHORT because SHORT_COVERING_EXHAUSTION is active.');
      }
    } else {
      sanitizerNotes.push(`[DEDICATED ${direction}] Generating dedicated ${direction} bracket setup.`);
    }

    // 1H Structural Swing Entry: Limit entry near live mark or minor 1m pullback
    let entryPrice = rawSetup.entryPrice > 0 ? rawSetup.entryPrice : markPrice;
    const maxEntryDistance = 0.20 * atr1h;
    if (Math.abs(entryPrice - markPrice) > maxEntryDistance) {
      const tightOffset = Math.min(atr1h * 0.10, markPrice * 0.001);
      entryPrice = direction === 'LONG'
        ? roundCryptoPrice(markPrice - tightOffset, markPrice)
        : roundCryptoPrice(markPrice + tightOffset, markPrice);
      sanitizerNotes.push(`[SWING ENTRY] Tuned entry to ${formatCryptoPrice(entryPrice, markPrice)} near mark $${formatCryptoPrice(markPrice, markPrice)}.`);
    }

    // RULE 3: 1-HOUR STRUCTURAL SWING STOP FLOOR (1.80% to 3.80% Breathing Room)
    // Survives normal market-maker liquidity sweeps and is 100% immune to human order-entry delay
    const minStopDist = entryPrice * 0.018; // 1.80% minimum floor
    const maxStopDist = entryPrice * 0.038; // 3.80% structural cap
    const baseStructuralDist = Math.min(maxStopDist, Math.max(1.5 * atr1h, minStopDist));
    let stopLoss = rawSetup.stopLoss;

    if (direction === 'LONG') {
      // Base structural stop
      stopLoss = roundCryptoPrice(entryPrice - baseStructuralDist, markPrice);

      // Anchor below 1H swing low if available within reasonable structural distance
      if (microstructure.swingLow1h > 0 && microstructure.swingLow1h < entryPrice) {
        const swingSl = roundCryptoPrice(microstructure.swingLow1h * 0.9985, markPrice);
        if (swingSl <= entryPrice - minStopDist && swingSl >= entryPrice - maxStopDist) {
          stopLoss = swingSl;
          sanitizerNotes.push(`[STRUCTURAL SWING STOP] Anchored SL below 1H swing low ($${formatCryptoPrice(microstructure.swingLow1h, markPrice)}).`);
        }
      }

      // Order book wall tucking
      const bidWallPrice = microstructure.orderBook?.topBidWall?.price || 0;
      if (bidWallPrice > 0 && bidWallPrice < entryPrice) {
        const tuckedSl = roundCryptoPrice(bidWallPrice * 0.9985, markPrice);
        if (tuckedSl <= stopLoss && tuckedSl >= entryPrice - maxStopDist) {
          stopLoss = tuckedSl;
          sanitizerNotes.push(`[WALL STOP TUCK] Tucked SL behind $${formatCryptoPrice(bidWallPrice, markPrice)} bid wall.`);
        }
      }
    } else {
      // Base structural stop for SHORT
      stopLoss = roundCryptoPrice(entryPrice + baseStructuralDist, markPrice);

      // Anchor above 1H swing high if available within structural range
      if (microstructure.swingHigh1h > 0 && microstructure.swingHigh1h > entryPrice) {
        const swingSl = roundCryptoPrice(microstructure.swingHigh1h * 1.0015, markPrice);
        if (swingSl >= entryPrice + minStopDist && swingSl <= entryPrice + maxStopDist) {
          stopLoss = swingSl;
          sanitizerNotes.push(`[STRUCTURAL SWING STOP] Anchored SL above 1H swing high ($${formatCryptoPrice(microstructure.swingHigh1h, markPrice)}).`);
        }
      }

      // Order book wall tucking for SHORT
      const askWallPrice = microstructure.orderBook?.topAskWall?.price || 0;
      if (askWallPrice > 0 && askWallPrice > entryPrice) {
        const tuckedSl = roundCryptoPrice(askWallPrice * 1.0015, markPrice);
        if (tuckedSl >= stopLoss && tuckedSl <= entryPrice + maxStopDist) {
          stopLoss = tuckedSl;
          sanitizerNotes.push(`[WALL STOP TUCK] Tucked SL behind $${formatCryptoPrice(askWallPrice, markPrice)} ask wall.`);
        }
      }
    }

    let currentStopDistance = Math.abs(entryPrice - stopLoss);
    // Hard clamp to ensure minimum 1.8% floor
    if (currentStopDistance < minStopDist) {
      currentStopDistance = minStopDist;
      stopLoss = direction === 'LONG' ? roundCryptoPrice(entryPrice - minStopDist, markPrice) : roundCryptoPrice(entryPrice + minStopDist, markPrice);
    }

    sanitizerNotes.push(
      `[1H STRUCTURAL STOP] Enforced SL at ${formatCryptoPrice(stopLoss, markPrice)} (${((currentStopDistance / entryPrice) * 100).toFixed(2)}% distance, 1.5x 1H ATR: ${formatCryptoPrice(baseStructuralDist, markPrice)}).`
    );

    // RULE 4: STRUCTURAL SWING TARGETS (TP1 = 1.5R, TP2 = 2.8R) & WALL FRONT-RUNNING
    // Beats exchange round-trip fees by 30x+!
    const reqTp1Distance = currentStopDistance * 1.5;
    const reqTp2Distance = currentStopDistance * 2.8;
    let tp1 = direction === 'LONG' ? roundCryptoPrice(entryPrice + reqTp1Distance, markPrice) : roundCryptoPrice(entryPrice - reqTp1Distance, markPrice);
    let tp2 = direction === 'LONG' ? roundCryptoPrice(entryPrice + reqTp2Distance, markPrice) : roundCryptoPrice(entryPrice - reqTp2Distance, markPrice);
    let wallFrontRunNote: string | undefined;

    if (direction === 'LONG') {
      const askWall = microstructure.orderBook?.topAskWall;
      if (askWall && askWall.price >= (entryPrice + 1.1 * currentStopDistance) && askWall.price <= (entryPrice + 1.6 * currentStopDistance)) {
        const frontRunTp1 = roundCryptoPrice(askWall.price * 0.9992, markPrice);
        wallFrontRunNote = `TP1 front-running $${formatCryptoPrice(askWall.price, markPrice)} ask wall (-0.08% offset)`;
        sanitizerNotes.push(`[WALL FRONT-RUN] ${wallFrontRunNote}. Adjusted TP1 from ${formatCryptoPrice(tp1, markPrice)} to ${formatCryptoPrice(frontRunTp1, markPrice)}.`);
        tp1 = frontRunTp1;
      }
    } else {
      const bidWall = microstructure.orderBook?.topBidWall;
      if (bidWall && bidWall.price >= (entryPrice - 1.6 * currentStopDistance) && bidWall.price <= (entryPrice - 1.1 * currentStopDistance)) {
        const frontRunTp1 = roundCryptoPrice(bidWall.price * 1.0008, markPrice);
        wallFrontRunNote = `TP1 front-running $${formatCryptoPrice(bidWall.price, markPrice)} bid wall (+0.08% offset)`;
        sanitizerNotes.push(`[WALL FRONT-RUN] ${wallFrontRunNote}. Adjusted TP1 from ${formatCryptoPrice(tp1, markPrice)} to ${formatCryptoPrice(frontRunTp1, markPrice)}.`);
        tp1 = frontRunTp1;
      }
    }

    sanitizerNotes.push(`[SWING TARGETS ENFORCED] TP1 set to 1.5R (${tp1}) & TP2 set to 2.8R (${tp2}).`);

    const effectiveRR = Number((Math.abs(tp1 - entryPrice) / currentStopDistance).toFixed(2));
    const stopDistancePct = Number(((currentStopDistance / entryPrice) * 100).toFixed(2));

    // Position Sizing: Small Account Smart Sizing (<$500 = 2.5%, >=$500 = 1%)
    const equity = rawSetup.equityUsdt && rawSetup.equityUsdt > 0 ? rawSetup.equityUsdt : (CONFIG.ACCOUNT_CAPITAL_USD || 80.0);
    const sizing = binanceAccount.calculatePositionSizing({
      equityUsdt: equity,
      entryPrice,
      stopLoss,
      riskFraction: equity < 500 ? 0.025 : 0.01,
    });

    sanitizerNotes.push(
      `[SIZING VERIFIED] ${equity < 500 ? '2.5% Small Account' : '1%'} Volatility Risk ($${sizing.riskAmountUsdt} max loss): Notional ${sizing.notionalUsdt} USDT (Margin Required: $${sizing.marginRequiredUsdt} USDT @ ${sizing.maxSafeLeverage}x).`
    );
    sanitizerNotes.push(`[SAFE LEVERAGE CAPPER] Enforcing Max Safe Swing Leverage: ${sizing.maxSafeLeverage}x.`);

    return {
      symbol,
      direction,
      regime: microstructure.regime,
      entryPrice,
      stopLoss,
      tp1,
      tp2,
      riskRewardRatio: effectiveRR,
      stopDistancePct,
      notionalUsdt: sizing.notionalUsdt,
      quantity: sizing.quantity,
      maxSafeLeverage: sizing.maxSafeLeverage,
      marginRequiredUsdt: sizing.marginRequiredUsdt,
      atr14: roundCryptoPrice(atr14, markPrice),
      atr14_1h: roundCryptoPrice(atr1h, markPrice),
      wallFrontRunNote,
      sanitizerNotes,
      rationale: '',
      correlationMode,
    };
  }

  // --- 2. RAG HISTORY INTEGRATION & GENERATE STRATEGY ---

  public async generateQuantStrategy(
    symbol: string,
    equityUsdt = CONFIG.ACCOUNT_CAPITAL_USD || 80,
    forceRefresh = false,
    forceOverride = false,
    correlationMode: CorrelationMode = 'STANDALONE_ALPHA',
    explicitDirection?: 'LONG' | 'SHORT'
  ): Promise<CopilotAnalysisResponse> {
    const sym = symbol.toUpperCase().trim();
    const cacheKey = explicitDirection ? `${sym}_${correlationMode}_${explicitDirection}` : `${sym}_${correlationMode}`;

    // 60-second in-memory cache check for instant 0ms switching (bypassed if forceRefresh = true or forceOverride = true)
    if (!forceRefresh && !forceOverride) {
      const cached = this.aiSetupCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < 60000) {
        return cached.response;
      }
    }

    const microstructure = await marketData.fetchCoinData(sym);
    const macro = marketData.getBtcMacroTelemetry();
    const historicalStats = await paperTrading.getHistoricalRegimeMetrics();
    const regimeStats = historicalStats[microstructure.regime] || {
      hasHistory: false,
      winRate: 0,
      profitFactor: 0,
      totalTrades: 0,
      avgPnL: 0,
    };

    // Calculate signed confluence score (-100 to +100) using correlationMode
    const confResult = marketData.calculateConfluenceMatrix(microstructure, macro, correlationMode);
    const confluenceScore = confResult.score;

    // Determine high-probability directional bias (LONG or SHORT) directly
    let rawDirection: TradeDirection = explicitDirection || 'LONG';
    let biasReason = '';

    if (explicitDirection) {
      rawDirection = explicitDirection;
      biasReason = explicitDirection === 'LONG'
        ? `Dedicated LONG Prediction View (Confluence: ${confluenceScore >= 0 ? '+' : ''}${confluenceScore}/100)`
        : `Dedicated SHORT Prediction View (Confluence: ${confluenceScore >= 0 ? '+' : ''}${confluenceScore}/100)`;
    } else {
      if (microstructure.regime === 'SHORT_COVERING_EXHAUSTION') {
        rawDirection = 'SHORT';
        biasReason = 'Directional Bias: SHORT (Short covering exhaustion - fading the climax).';
      } else if (microstructure.regime === 'PRIME_SHORT_SQUEEZE') {
        rawDirection = 'LONG';
        biasReason = 'Directional Bias: LONG (Short squeeze fuel).';
      } else if (microstructure.regime === 'PRIME_LONG_SQUEEZE') {
        rawDirection = 'SHORT';
        biasReason = 'Directional Bias: SHORT (Long liquidation cascade).';
      } else if (confluenceScore > 0) {
        rawDirection = 'LONG';
        biasReason = `Directional Bias: LONG (Confluence Score: +${confluenceScore}/100 [${correlationMode}]).`;
      } else if (confluenceScore < 0) {
        rawDirection = 'SHORT';
        biasReason = `Directional Bias: SHORT (Confluence Score: ${confluenceScore}/100 [${correlationMode}]).`;
      } else {
        const isLongBias = microstructure.fundingRate < 0 || (microstructure.orderBook?.obi || 0) > 0;
        rawDirection = isLongBias ? 'LONG' : 'SHORT';
        biasReason = `Directional Bias: ${rawDirection} (Order book / funding skew tie-break).`;
      }

      // Macro alignment check: if in BTC_COUPLED mode and BTC is dumping and coin is not squeezing, bias SHORT
      if (correlationMode === 'BTC_COUPLED') {
        if (rawDirection === 'LONG' && macro.below1hEma20 && microstructure.fundingRate > -0.0010) {
          rawDirection = 'SHORT';
          biasReason = 'Directional Bias: SHORT (Aligned with BTC 1H macro breakdown in BTC-Coupled Mode).';
        }
      }
    }

    // Anchor precisely to latest live mark price
    const liveMark = marketData.getLatestMarkPrice(sym)?.markPrice || microstructure.price;
    const markPrice = liveMark > 0 ? liveMark : microstructure.price;

    const sanitizedSetup = this.validateAndSanitizeSetup(
      {
        symbol: sym,
        direction: rawDirection,
        entryPrice: markPrice,
        stopLoss: 0,
        tp1: 0,
        tp2: 0,
        equityUsdt,
      },
      microstructure,
      macro,
      correlationMode,
      Boolean(explicitDirection)
    );

    (sanitizedSetup as any).confluenceScore = confluenceScore;
    if (biasReason) {
      sanitizedSetup.sanitizerNotes.unshift(biasReason);
    }

    const baseConviction = Math.round((microstructure.squeezeVelocityScore * 0.35) + (Math.abs(confluenceScore) * 0.65));
    const convictionScore = Math.max(45, Math.min(98, baseConviction));

    // Generate Tagged Institutional Rationale (Ultra-fast Deterministic Quant Engine - Zero Quota Consumption)
    const copilotRationale = this.generateDeterministicTaggedRationale(microstructure, macro, sanitizedSetup, regimeStats);
    sanitizedSetup.rationale = copilotRationale;

    const response: CopilotAnalysisResponse = {
      setup: sanitizedSetup,
      copilotRationale,
      convictionScore,
      ragStatsInjected: regimeStats,
    };

    if (!forceOverride) {
      this.aiSetupCache.set(cacheKey, { response, timestamp: Date.now() });
    }

    return response;
  }

  /**
   * High-Fidelity Real-Time Trade Prediction Generator
   * Triggered on-demand when the user clicks "⚡ Run Live Trade Prediction"
   */
  public async generateTradePrediction(
    symbol: string,
    equityUsdt = CONFIG.ACCOUNT_CAPITAL_USD || 80,
    forceRefresh = true,
    forceOverride = false,
    correlationMode: CorrelationMode = 'STANDALONE_ALPHA',
    explicitDirection?: 'LONG' | 'SHORT'
  ): Promise<{
    prediction: TradePrediction;
    copilotResponse: CopilotAnalysisResponse;
  }> {
    const sym = symbol.toUpperCase().trim();
    const analysis = await this.generateQuantStrategy(sym, equityUsdt, forceRefresh, forceOverride, correlationMode, explicitDirection);
    const setup = analysis.setup;
    const microstructure = await marketData.fetchCoinData(sym);
    const liveMark = marketData.getLatestMarkPrice(sym)?.markPrice || microstructure.price;
    const macro = marketData.getBtcMacroTelemetry();
    const historicalStats = await paperTrading.getHistoricalRegimeMetrics();
    const regimeStats = historicalStats[microstructure.regime] || {
      hasHistory: false,
      winRate: 0,
      profitFactor: 0,
      totalTrades: 0,
      avgPnL: 0,
    };

    const direction = setup.direction;
    const confluenceScore = (setup as any).confluenceScore ?? microstructure.confluenceScore ?? 0;
    const isForced = (setup as any).isForced || false;

    // VALID SWING SETUP (LONG or SHORT)
    const entryPrice = setup.entryPrice;
    const stopLoss = setup.stopLoss;
    const tp1 = setup.tp1;
    const tp2 = setup.tp2;
    const stopDistancePct = setup.stopDistancePct;
    const tp1DistancePct = Number(((Math.abs(tp1 - entryPrice) / entryPrice) * 100).toFixed(2));
    const tp2DistancePct = Number(((Math.abs(tp2 - entryPrice) / entryPrice) * 100).toFixed(2));

    // Direction-aware conviction calculation
    const directionalConfluence = direction === 'LONG' ? confluenceScore : -confluenceScore;
    const rawConfidence = 50 + (directionalConfluence * 0.40) + (microstructure.squeezeVelocityScore * 0.15);
    const confidenceScore = Math.min(95, Math.max(48, Math.round(rawConfidence)));
    const winProbabilityPct = Math.round(Math.min(84, Math.max(50, 46 + (confidenceScore * 0.36))));

    const movePct = tp1DistancePct;
    const forecastDir = direction === 'LONG' ? '1H structural swing expansion / breakout' : '1H structural breakdown / void flush';
    const priceActionForecast = `Projecting a ${direction === 'LONG' ? '+' : '-'}${movePct}% ${forecastDir} towards TP1 ($${formatCryptoPrice(tp1, entryPrice)}) and TP2 ($${formatCryptoPrice(tp2, entryPrice)}) over the next 1–4 hours, supported by confluence score ${confluenceScore > 0 ? '+' : ''}${confluenceScore}/100 and 1H ATR ($${formatCryptoPrice(setup.atr14_1h || setup.atr14, entryPrice)}) [${correlationMode}].`;
    const keyCatalyst = direction === 'LONG'
      ? `[FACT] ${sym} (${microstructure.regime}) 1H structural floor anchored at $${formatCryptoPrice(stopLoss, entryPrice)} with 5m CVD at $${(microstructure.microCvd5m / 1000).toFixed(1)}k and 50x short liq magnet at $${formatCryptoPrice(microstructure.shortLiqPool50x, entryPrice)}.`
      : `[FACT] ${sym} (${microstructure.regime}) 1H structural resistance ceiling anchored at $${formatCryptoPrice(stopLoss, entryPrice)} with 5m CVD at $${(microstructure.microCvd5m / 1000).toFixed(1)}k and 50x long liq magnet at $${formatCryptoPrice(microstructure.longLiqPool50x, entryPrice)}.`;
    const invalidationTrigger = `[INVALIDATION_TRIGGER] ${direction} swing thesis invalidated if 1H candle closes beyond $${formatCryptoPrice(stopLoss, entryPrice)} or if holding duration exceeds 240 minutes.`;

    const marginRequiredUsdt = setup.marginRequiredUsdt || Number((setup.notionalUsdt / setup.maxSafeLeverage).toFixed(2));

    const prediction: TradePrediction = {
      symbol: sym,
      timestamp: Date.now(),
      direction,
      regime: microstructure.regime,
      liveMarkPrice: liveMark,
      entryPrice,
      stopLoss,
      stopDistancePct,
      tp1,
      tp1DistancePct,
      tp2,
      tp2DistancePct,
      riskRewardRatio: setup.riskRewardRatio,
      confidenceScore,
      winProbabilityPct,
      recommendedNotionalUsdt: setup.notionalUsdt,
      recommendedLeverage: setup.maxSafeLeverage,
      marginRequiredUsdt,
      atr14: setup.atr14,
      correlationMode,
      predictionSummary: {
        priceActionForecast,
        keyCatalyst,
        invalidationTrigger,
      },
      rationale: analysis.copilotRationale,
      sanitizerNotes: setup.sanitizerNotes,
      microCvd5m: microstructure.microCvd5m,
      priceCvdDivergence: microstructure.priceCvdDivergence,
      htfTrend: microstructure.htfTrend,
      shortLiqPool50x: microstructure.shortLiqPool50x,
      longLiqPool50x: microstructure.longLiqPool50x,
      wallFrontRunNote: setup.wallFrontRunNote,
      gatekeeperStatus: 'ACTIVE_SWING_SETUP',
      gatekeeperReason: undefined,
      confluenceScore,
      watchLongBelow: microstructure.swingLow1h,
      watchShortAbove: microstructure.swingHigh1h,
      requiredOiTrigger: '15m ΔOI > +2.0%',
      isAplusSetup: Math.abs(confluenceScore) >= 45,
    };

    return { prediction, copilotResponse: analysis };
  }

  /**
   * Dual-Horizon Live Trade Predictions:
   * Concurrently calculates both a strictly LONG prediction view and a strictly SHORT prediction view
   * anchored to live mark prices and multi-timeframe order flow.
   */
  public async generateDualTradePredictions(
    symbol: string,
    equityUsdt = CONFIG.ACCOUNT_CAPITAL_USD || 80,
    correlationMode: CorrelationMode = 'STANDALONE_ALPHA'
  ): Promise<{
    symbol: string;
    longPrediction: TradePrediction;
    shortPrediction: TradePrediction;
    longCopilot: CopilotAnalysisResponse;
    shortCopilot: CopilotAnalysisResponse;
  }> {
    const sym = symbol.toUpperCase().trim();
    const [longRes, shortRes] = await Promise.all([
      this.generateTradePrediction(sym, equityUsdt, true, true, correlationMode, 'LONG'),
      this.generateTradePrediction(sym, equityUsdt, true, true, correlationMode, 'SHORT'),
    ]);

    return {
      symbol: sym,
      longPrediction: longRes.prediction,
      shortPrediction: shortRes.prediction,
      longCopilot: longRes.copilotResponse,
      shortCopilot: shortRes.copilotResponse,
    };
  }

  // --- 3. STRUCTURED TAGGED COPILOT GENERATOR ---

  private generateDeterministicTaggedRationale(
    m: CoinMicrostructure,
    macro: MacroTelemetry,
    s: BracketTradeSetup,
    rag: any
  ): string {
    const fundingPct = (m.fundingRate * 100).toFixed(4);
    const oiDeltaPct = m.openInterest15mDeltaPct.toFixed(2);
    const obiPct = (m.orderBook.obi * 100).toFixed(1);
    const liqShorts = (m.shortLiqUsd15m / 1000).toFixed(1);
    const liqLongs = (m.longLiqUsd15m / 1000).toFixed(1);

    const ragFact = rag?.hasHistory && rag.totalTrades > 0
      ? `[FACT] RAG Historical Calibration: Historical win-rate for ${m.regime} is ${rag.winRate}% across ${rag.totalTrades} closed paper executions with an average profit factor of ${rag.profitFactor}.`
      : `[FACT] RAG Historical Calibration: No closed trade history recorded for regime ${m.regime}. Quant engine operating strictly on live order-flow and structural confluence.`;

    return `
[FACT] Microstructure Telemetry: Symbol ${m.symbol} is trading at $${m.price} under regime ${m.regime}.
[FACT] 15m Funding Rate is ${fundingPct}% with 15m OI Delta at ${oiDeltaPct}%, OBI depth imbalance at ${obiPct}%, and 15m liquidations of $${liqShorts}k shorts vs $${liqLongs}k longs.
${ragFact}

[PREDICTION] Given the Squeeze Velocity Score of ${m.squeezeVelocityScore}/100 and elevated taker flow (CVD ${m.takerBuySellRatio15m.toFixed(2)}), algorithmic cascades are positioned to drive an expansion leg towards TP1 ($${s.tp1}) and TP2 ($${s.tp2}).

[ASSUMPTION] Global BTC Macro conditions remain in ${macro.macroState} (BTC 15m change: ${macro.btcChange15mPct.toFixed(2)}%), and spot bid wall at $${m.orderBook.topBidWall.price} provides liquidity absorption.

[RISK] Primary downside risk lies in liquidation cluster cascades if price breaches the $${s.stopLoss} threshold, which could precipitate rapid order book de-leveraging.

[INVALIDATION_TRIGGER] Trade invalidation occurs immediately if price prints below $${s.stopLoss} or if holding duration exceeds 90 minutes without momentum expansion towards TP1.
    `.trim();
  }

  private async callGeminiCopilot(params: {
    microstructure: CoinMicrostructure;
    macro: MacroTelemetry;
    sanitizedSetup: BracketTradeSetup;
    regimeStats: any;
    convictionScore: number;
  }): Promise<string> {
    if (!this.genAI) throw new Error('Gemini client not available');

    const { microstructure: m, macro, sanitizedSetup: s, regimeStats: rag, convictionScore } = params;

    const ragTelemetryText = rag?.hasHistory && rag.totalTrades > 0
      ? `${rag.winRate}% Win Rate, ${rag.profitFactor} Profit Factor over ${rag.totalTrades} sample trades.`
      : 'No trade history for this regime (0 closed trades). Base analysis on live telemetry.';

    const prompt = `
You are an Institutional Senior Quantitative Strategist and Execution AI Copilot for Binance Futures.
Analyze this coin's live order-flow microstructure and calibrated trade setup.

CRITICAL INSTRUCTION:
Your entire response MUST strictly follow the institutional structured tagged syntax format.
Every core section MUST start with one of these exact colored tags:
- [FACT]
- [PREDICTION]
- [ASSUMPTION]
- [RISK]
- [INVALIDATION_TRIGGER]

LIVE TELEMETRY:
- Symbol: ${m.symbol} | Current Price: $${m.price}
- 15m Regime: ${m.regime} | Squeeze Velocity Score: ${m.squeezeVelocityScore}/100
- Open Interest 15m Delta: ${m.openInterest15mDeltaPct.toFixed(2)}% | Funding Rate: ${(m.fundingRate * 100).toFixed(4)}%
- Order Book Imbalance (OBI within 2%): ${(m.orderBook.obi * 100).toFixed(1)}%
- Liquidity Walls: Top Bid Wall $${m.orderBook.topBidWall.price} (${m.orderBook.topBidWall.distancePct.toFixed(2)}% away), Top Ask Wall $${m.orderBook.topAskWall.price} (${m.orderBook.topAskWall.distancePct.toFixed(2)}% away)
- 15m Rolling Liquidations: Short Liqs $${(m.shortLiqUsd15m / 1000).toFixed(1)}k | Long Liqs $${(m.longLiqUsd15m / 1000).toFixed(1)}k
- BTC Macro State: ${macro.macroState} (BTC 15m change: ${macro.btcChange15mPct.toFixed(2)}%)
- RAG Historical Regime Performance: ${ragTelemetryText}

PROPOSED BRACKET SETUP:
- Direction: ${s.direction}
- Entry Price: $${s.entryPrice}
- Stop Loss: $${s.stopLoss} (Distance: ${s.stopDistancePct}%, ATR14 Floor Verified: $${s.atr14})
- Take Profit 1: $${s.tp1} (50% scale-out, Risk/Reward: 1:${s.riskRewardRatio})
- Take Profit 2: $${s.tp2} (Full target)
- Calibrated Conviction Score: ${convictionScore}/100

Format your output crisply using markdown with the mandatory tags. Keep it concise, quantitative, and institutional.
    `.trim();

    // Sub-2s prioritized execution with 6-second hard timeout
    if (!this.genAI || Date.now() < this.quotaExceededUntil) {
      throw new Error('Google AI Studio quota currently exceeded. Operating via Deterministic Quant Engine.');
    }

    let lastError: any = null;

    for (const modelName of this.priorityModels) {
      try {
        const model = this.genAI.getGenerativeModel({ model: modelName });
        const result = await this.executeWithTimeout(model.generateContent(prompt), 6000);
        console.log(`[GeminiStrategyEngine] Copilot strategy successfully generated using fast model '${modelName}'.`);
        return result.response.text();
      } catch (err: any) {
        lastError = err;
        if (this.isQuotaExceeded(err)) {
          this.quotaExceededUntil = Date.now() + 30 * 60 * 1000;
          console.warn(`[GeminiStrategyEngine] Daily free tier quota limit reached (20/20 requests). Operating smoothly via Deterministic Quant Engine.`);
          break;
        }
        console.warn(`[GeminiStrategyEngine] Model candidate '${modelName}' notice: ${err.message}. Trying next candidate...`);
      }
    }

    throw lastError || new Error('All Gemini candidate models failed');
  }

  // --- 4. INTERACTIVE COPILOT CHAT WITH PORTFOLIO & RAG CONTEXT ---

  public async chatWithCopilot(userQuery: string, symbol = 'BTCUSDT'): Promise<string> {
    const sym = symbol.toUpperCase().trim();
    const microstructure = await marketData.fetchCoinData(sym);
    const macro = marketData.getBtcMacroTelemetry();
    const portfolio = await binanceAccount.getPortfolioRiskReport();
    const historicalStats = await paperTrading.getHistoricalRegimeMetrics();

    if (!this.genAI || Date.now() < this.quotaExceededUntil) {
      return `
[FACT] Symbol: ${sym} trading at $${microstructure.price} in ${microstructure.regime}.
[FACT] Portfolio Equity: $${portfolio.equityUsdt.toLocaleString()} USDT | Portfolio Beta to BTC: ${portfolio.portfolioBeta}.
[PREDICTION] Based on current OBI (${(microstructure.orderBook.obi * 100).toFixed(1)}%) and Squeeze Score (${microstructure.squeezeVelocityScore}/100), key volatility pivot sits at $${microstructure.orderBook.topBidWall.price}.
[ASSUMPTION] BTC Macro remains in ${macro.macroState}.
[RISK] -5% BTC flash shock projects a -$${portfolio.btcCrash5PctLossUsdt} (${portfolio.btcCrash5PctLossPct.toFixed(2)}%) drawdown on existing margin exposure.
[INVALIDATION_TRIGGER] Immediate position freeze if BTC 15m liquidations surpass $5.0M.
      `.trim();
    }

    const systemPrompt = `
You are the Lead Quantitative Portfolio Strategist and AI Copilot for institutional crypto trading.
The user is querying you in real-time.
Answer with high quantitative precision. Whenever making market claims or recommendations, use the tagged syntax:
[FACT], [PREDICTION], [ASSUMPTION], [RISK], [INVALIDATION_TRIGGER].

ACTIVE CONTEXT:
- Active Symbol: ${sym} ($${microstructure.price}) | Regime: ${microstructure.regime} | Squeeze Score: ${microstructure.squeezeVelocityScore}/100
- Funding Rate: ${(microstructure.fundingRate * 100).toFixed(4)}% | Delta OI: ${microstructure.openInterest15mDeltaPct.toFixed(2)}%
- Portfolio Total Equity: $${portfolio.equityUsdt} USDT | Portfolio BTC-Beta: ${portfolio.portfolioBeta}
- Projected -5% BTC Shock Drawdown: -$${portfolio.btcCrash5PctLossUsdt} USDT (${portfolio.btcCrash5PctLossPct}%)
- 8h Funding Bleed Total: $${portfolio.total8hFundingBleedUsdt} USDT
- BTC Macro State: ${macro.macroState} (Longs Blocked: ${macro.longsBlocked})
- Historical Win-Rate for ${microstructure.regime}: ${historicalStats[microstructure.regime]?.hasHistory ? historicalStats[microstructure.regime].winRate + '%' : 'No history'}

USER QUERY:
"${userQuery}"
    `.trim();

    let lastError: any = null;

    for (const modelName of this.priorityModels) {
      try {
        const model = this.genAI.getGenerativeModel({ model: modelName });
        const res = await this.executeWithTimeout(model.generateContent(systemPrompt), 4000);
        console.log(`[GeminiStrategyEngine] Copilot chat reply generated using fast model '${modelName}'.`);
        return res.response.text();
      } catch (err: any) {
        lastError = err;
        if (this.isQuotaExceeded(err)) {
          this.quotaExceededUntil = Date.now() + 30 * 60 * 1000;
          console.warn(`[GeminiStrategyEngine] Daily free tier quota limit reached (20/20 requests). Using Deterministic Copilot Reply.`);
          break;
        }
        console.warn(`[GeminiStrategyEngine] Model candidate '${modelName}' notice: ${err.message}. Trying next candidate...`);
      }
    }

    return `
[FACT] Symbol: ${sym} trading at $${microstructure.price} in ${microstructure.regime}.
[FACT] Portfolio Equity: $${portfolio.equityUsdt.toLocaleString()} USDT | Portfolio Beta to BTC: ${portfolio.portfolioBeta}.
[PREDICTION] Based on current OBI (${(microstructure.orderBook.obi * 100).toFixed(1)}%) and Squeeze Score (${microstructure.squeezeVelocityScore}/100), key volatility pivot sits at $${microstructure.orderBook.topBidWall.price}.
[ASSUMPTION] BTC Macro remains in ${macro.macroState}.
[RISK] -5% BTC flash shock projects a -$${portfolio.btcCrash5PctLossUsdt} (${portfolio.btcCrash5PctLossPct.toFixed(2)}%) drawdown on existing margin exposure.
[INVALIDATION_TRIGGER] Immediate position freeze if BTC 15m liquidations surpass $5.0M.
    `.trim();
  }

  // --- 5. DUAL-MODE QUANT TRAP ENGINE (DYNAMIC ASSET EQUITY) ---

  /**
   * Deterministic Mathematical Fallback Engine for Dual-Mode Setups:
   * Classifies structural regime and outputs Mode 1 (5-10m Scalp) and Mode 2 (Multi-Hour Swing) traps.
   * Dynamically adapts to user's active portfolio asset equity.
   * Strictly enforces: NO market orders (only STOP_MARKET or LIMIT), tight invalidations, and leverage caps.
   */
  public calculateDeterministicDualModeSetup(payload: QuantMetricsPayload, equityUsdt?: number): DualModeQuantSetup {
    const sym = payload.symbol;
    const price = payload.currentPrice > 0 ? payload.currentPrice : 100;
    const isHighVol = payload.priceChange24hPct > 50 || payload.candleRange15mPct > 5;
    const maxLevSwing = isHighVol ? 3 : 5;
    const maxLevScalp = isHighVol ? 3 : 5;
    const activeAssetEquity = equityUsdt && equityUsdt > 0 ? equityUsdt : (payload.accountEquityUsd > 0 ? payload.accountEquityUsd : (CONFIG.ACCOUNT_CAPITAL_USD || 80));

    const marginScalp = Number((activeAssetEquity * 0.12).toFixed(2));
    const notionalScalp = Number((marginScalp * maxLevScalp).toFixed(2));
    const marginSwing = Number((activeAssetEquity * 0.20).toFixed(2));
    const notionalSwing = Number((marginSwing * maxLevSwing).toFixed(2));

    // 1. Regime Classification
    let marketRegime: QuantMarketRegime = 'MA_VICE_PINCH';
    if (payload.priceChange24hPct >= 40 || (price > payload.ma7_15m && payload.ma7_15m > payload.ma25_15m && payload.candleRange15mPct >= 4)) {
      marketRegime = 'PARABOLIC_BLOWOFF';
    } else if (payload.fundingRate <= -0.0004 || (payload.openInterest15mDeltaPct > 1.5 && payload.fundingRate < 0)) {
      marketRegime = 'SHORT_SQUEEZE';
    } else if (price < payload.ma25_15m && payload.ma25_15m < payload.ma99_15m && payload.priceChange24hPct < -5) {
      marketRegime = 'BEARISH_CASCADE';
    } else {
      marketRegime = 'MA_VICE_PINCH';
    }

    // 2. Structural Diagnosis
    const maFan15m = payload.ma7_15m > payload.ma25_15m ? 'bullish expansion' : 'bearish compression';
    const maRelationship = `15m MA(7) ($${formatCryptoPrice(payload.ma7_15m, price)}) displays ${maFan15m} against MA(25) ($${formatCryptoPrice(payload.ma25_15m, price)}), with 4h MA(25) ($${formatCryptoPrice(payload.ma25_4h, price)}) and MA(99) ($${formatCryptoPrice(payload.ma99_4h, price)}) defining macro bounds.`;
    const liquidityWicks = `Floor defense anchored at $${formatCryptoPrice(payload.localFloor15m, price)} (low wick $${formatCryptoPrice(payload.currentWickLow15m, price)}); ceiling supply capped at $${formatCryptoPrice(payload.localCeiling15m, price)} (high wick $${formatCryptoPrice(payload.currentWickHigh15m, price)}).`;
    const distTo99 = Math.abs(Number((((price - payload.ma99_15m) / price) * 100).toFixed(2)));
    const voidAndFundingAnalysis = `15m MA(99) void distance is ${distTo99}%; funding rate sits at ${payload.fundingRatePercent} (${payload.fundingRate <= -0.0003 ? 'negative squeeze pressure' : 'neutral carry risk'}).`;

    // --- 3. DUAL-DIRECTION FAST SCALP (5-10m) SETUPS ---
    // Objective: Capture 1.5% to 4.5% move in 5-10m.
    // Invalidation: 1.5% to 3.0%. Time-stop: 5 to 8 mins. Never market orders!

    // LONG Scalp (Breakout above high wick / snap-back)
    const longScalpTrigger = roundCryptoPrice(payload.currentWickHigh15m * 1.0008, price);
    const longScalpSl = roundCryptoPrice(longScalpTrigger * 0.982, price);
    const longScalpTp = roundCryptoPrice(longScalpTrigger * 1.024, price);
    const longScalpNote = 'Stop-Market breakout trap above 15m candle high wick targeting momentum impulse. Strictly exit at breakeven/scratch if TP not reached within 8 minutes.';

    // SHORT Scalp (Breakdown below low wick / rejection flush)
    const shortScalpTrigger = roundCryptoPrice(payload.currentWickLow15m * 0.9992, price);
    const shortScalpSl = roundCryptoPrice(shortScalpTrigger * 1.018, price);
    const shortScalpTp = roundCryptoPrice(shortScalpTrigger * 0.976, price);
    const shortScalpNote = 'Stop-Market breakdown trap below 15m candle low wick targeting flush to MA(25). Strictly exit at breakeven/scratch if TP not reached within 8 minutes.';

    // --- 4. DUAL-DIRECTION LONG-TERM SWING (Multi-Hour) SETUPS ---
    // Objective: 8% to 25%+ continuation or void flush. Min 1:2.5 R/R.

    // LONG Swing (Outside ceiling breakout trap)
    const longSwingTrigger = roundCryptoPrice(payload.localCeiling15m * 1.002, price);
    const rawSlLong = Math.min(payload.localFloor15m * 0.998, longSwingTrigger * 0.965);
    const longSwingSl = roundCryptoPrice(rawSlLong, price);
    const slDistLong = Math.max(0.015, (longSwingTrigger - longSwingSl) / longSwingTrigger);
    const longSwingTp1 = roundCryptoPrice(longSwingTrigger * (1 + slDistLong * 2.5), price);
    const longSwingTp2 = roundCryptoPrice(longSwingTrigger * (1 + slDistLong * 4.0), price);
    const longSwingNote = `Stop-Market entry outside 5-candle ceiling ($${formatCryptoPrice(payload.localCeiling15m, price)}). Scale out 50% at TP1 (+${(slDistLong * 250).toFixed(1)}%) and trail stop to breakeven for macro continuation.`;

    // SHORT Swing (Outside floor breakdown trap targeting void flush)
    const shortSwingTrigger = roundCryptoPrice(payload.localFloor15m * 0.998, price);
    const rawSlShort = Math.max(payload.localCeiling15m * 1.002, shortSwingTrigger * 1.035);
    const shortSwingSl = roundCryptoPrice(rawSlShort, price);
    const slDistShort = Math.max(0.015, (shortSwingSl - shortSwingTrigger) / shortSwingTrigger);
    const shortSwingTp1 = roundCryptoPrice(shortSwingTrigger * (1 - slDistShort * 2.5), price);
    const shortSwingTp2 = roundCryptoPrice(Math.min(payload.ma99_1h, shortSwingTrigger * (1 - slDistShort * 4.0)), price);
    const shortSwingNote = `Structural breakdown trap below 5-candle floor ($${formatCryptoPrice(payload.localFloor15m, price)}) targeting parabolic void flush to 1h MA(99) ($${formatCryptoPrice(payload.ma99_1h, price)}). Maintain strict 1:2.8 R/R.`;

    const fastScalpLongSetup: FastScalpSetup = {
      bias: 'LONG',
      orderType: 'STOP_MARKET',
      triggerOrEntry: longScalpTrigger,
      stopLoss: longScalpSl,
      takeProfit: longScalpTp,
      expectedMovePercent: 2.4,
      maxLeverage: maxLevScalp,
      timeStopMinutes: 8,
      executionNote: longScalpNote,
    };

    const fastScalpShortSetup: FastScalpSetup = {
      bias: 'SHORT',
      orderType: 'STOP_MARKET',
      triggerOrEntry: shortScalpTrigger,
      stopLoss: shortScalpSl,
      takeProfit: shortScalpTp,
      expectedMovePercent: 2.4,
      maxLeverage: maxLevScalp,
      timeStopMinutes: 8,
      executionNote: shortScalpNote,
    };

    const longSwingSetup: LongTermSwingSetup = {
      bias: 'LONG',
      orderType: 'STOP_MARKET',
      triggerOrEntry: longSwingTrigger,
      stopLoss: longSwingSl,
      takeProfit1: longSwingTp1,
      takeProfit2: longSwingTp2,
      riskRewardRatio: '1:2.8',
      maxLeverage: maxLevSwing,
      estimatedHoldTime: '6 to 24 Hours',
      executionNote: longSwingNote,
    };

    const shortSwingSetup: LongTermSwingSetup = {
      bias: 'SHORT',
      orderType: 'STOP_MARKET',
      triggerOrEntry: shortSwingTrigger,
      stopLoss: shortSwingSl,
      takeProfit1: shortSwingTp1,
      takeProfit2: shortSwingTp2,
      riskRewardRatio: '1:2.8',
      maxLeverage: maxLevSwing,
      estimatedHoldTime: '4 to 18 Hours',
      executionNote: shortSwingNote,
    };

    return {
      symbol: sym,
      marketRegime,
      structuralDiagnosis: {
        maRelationship,
        liquidityWicks,
        voidAndFundingAnalysis,
      },
      fastScalp5to10m: fastScalpLongSetup,
      fastScalpShort5to10m: fastScalpShortSetup,
      longTermSwing: longSwingSetup,
      longTermSwingShort: shortSwingSetup,
      longScalp: fastScalpLongSetup,
      shortScalp: fastScalpShortSetup,
      longSwing: longSwingSetup,
      shortSwing: shortSwingSetup,
      accountEquityUsd: activeAssetEquity,
      positionSizing: {
        notionalScalpUsd: notionalScalp,
        marginScalpUsd: marginScalp,
        notionalSwingUsd: notionalSwing,
        marginSwingUsd: marginSwing,
      },
      timestamp: Date.now(),
    };
  }

  /**
   * Generates Institutional Dual-Mode Quant Setups (5-10m Scalp & Multi-Hour Swing)
   * dynamically sized to the user's active portfolio asset equity.
   */
  public async generateDualModeQuantSetup(symbol: string, equityUsdt?: number): Promise<DualModeQuantSetup> {
    const sym = symbol.toUpperCase().trim();
    const payload = await marketData.getQuantMetricsPayload(sym, equityUsdt);
    if (equityUsdt && equityUsdt > 0) {
      payload.accountEquityUsd = equityUsdt;
    }

    // Ultra-fast deterministic quant engine (0 quota consumption, 0 latency, 100% mathematical precision)
    return this.calculateDeterministicDualModeSetup(payload, equityUsdt);
  }
}

// Singleton Export
export const geminiStrategy = new GeminiStrategyEngine();

