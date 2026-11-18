import { GoogleGenerativeAI } from '@google/generative-ai';
import { CONFIG } from './config';
import { CoinIndicatorPayload } from './indicators';

export type HorizonOrderType = 'STOP_MARKET' | 'LIMIT';
export type HorizonDirection = 'LONG' | 'SHORT';

export interface ScalpTradeSetup {
  direction: HorizonDirection;
  orderType: HorizonOrderType;
  triggerPrice: number;
  stopLoss: number;
  takeProfit: number;
  maxLeverage: number;
  timeStopMinutes: number;
  targetMagnet: string;
  rationale: string;
}

export interface SwingTradeSetup {
  direction: HorizonDirection;
  orderType: HorizonOrderType;
  triggerPrice: number;
  stopLoss: number;
  takeProfit: number;
  maxLeverage: number;
  riskRewardRatio: number;
  macroTarget: string;
  rationale: string;
}

export interface DualHorizonAnalysis {
  symbol: string;
  price: number;
  fundingRate: number;
  priceChange24hPct: number;
  preFilterReasons: string[];
  scalpSetup: ScalpTradeSetup;
  swingSetup: SwingTradeSetup;
  source: 'GEMINI_AI' | 'DETERMINISTIC_FALLBACK';
  analyzedAt: number;
}

const DUAL_HORIZON_SYSTEM_PROMPT = `You are an Institutional Quantitative Crypto Futures Analyst managing an $80 USD Binance Futures account.
STRICT RISK RULES:
1. NO MARKET ORDERS ALLOWED. Every setup MUST use either "STOP_MARKET" (breakout/breakdown trap) or "LIMIT" (structural pullback trap).
2. Leverage is strictly capped between 2x and 5x based on volatility.
3. Return ONLY valid JSON matching the exact schema below.

OUTPUT JSON SCHEMA:
{
  "scalpSetup": {
    "direction": "LONG" | "SHORT",
    "orderType": "STOP_MARKET" | "LIMIT",
    "triggerPrice": number,
    "stopLoss": number,
    "takeProfit": number,
    "maxLeverage": number (integer 2..5),
    "timeStopMinutes": number (integer 5..10),
    "targetMagnet": string (e.g. "15m MA7", "15m MA25", "15m localCeiling"),
    "rationale": string
  },
  "swingSetup": {
    "direction": "LONG" | "SHORT",
    "orderType": "STOP_MARKET" | "LIMIT",
    "triggerPrice": number,
    "stopLoss": number,
    "takeProfit": number,
    "maxLeverage": number (integer 2..3),
    "riskRewardRatio": number (>= 2.5),
    "macroTarget": string (e.g. "15m MA99", "4h MA25", "Short Squeeze Continuation"),
    "rationale": string
  }
}

GUIDELINES:
- scalpSetup: 5-10 minute rapid scalp targeting immediate micro-magnets (15m MA7, 15m MA25, or local wick) with a 1.5%-4% target, tight stop-loss (1.5%-3%), and hard timeStopMinutes (5-10 mins).
- swingSetup: Multi-hour swing targeting macro voids (15m MA99, 1h/4h MA25, or short-squeeze continuation) with minimum 1:2.5 Risk/Reward ratio and 2x-3x leverage.`;

const DEFAULT_GEMINI_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-1.5-flash',
  'gemini-2.5-pro',
];

export class DualHorizonAIAnalyst {
  private genAI: GoogleGenerativeAI | null = null;
  private candidateModels: string[];
  private unavailableModels: Set<string> = new Set();
  private preferredModel: string | null = null;
  private analysisCache: Map<string, { result: DualHorizonAnalysis; timestamp: number }> = new Map();
  private readonly CACHE_TTL_MS = 15_000;

  constructor() {
    const apiKey = (process.env.GEMINI_API_KEY || '').replace(/^["']|["']$/g, '').trim();
    const envModel = (process.env.GEMINI_MODEL || '').replace(/^["']|["']$/g, '').trim();
    this.candidateModels = envModel
      ? [envModel, ...DEFAULT_GEMINI_MODELS.filter((m) => m !== envModel)]
      : [...DEFAULT_GEMINI_MODELS];
    if (apiKey) {
      this.genAI = new GoogleGenerativeAI(apiKey);
    }
  }

  private roundPrice(p: number): number {
    if (!Number.isFinite(p) || p <= 0) return 0;
    if (p >= 1000) return Number(p.toFixed(2));
    if (p >= 10) return Number(p.toFixed(3));
    if (p >= 1) return Number(p.toFixed(4));
    if (p >= 0.01) return Number(p.toFixed(5));
    return Number(p.toFixed(7));
  }

  private sanitizeAnalysis(
    payload: CoinIndicatorPayload,
    raw: any,
    source: 'GEMINI_AI' | 'DETERMINISTIC_FALLBACK'
  ): DualHorizonAnalysis {
    const fallback = this.buildDeterministicFallback(payload);

    const sanitizeScalp = (s: any): ScalpTradeSetup => {
      if (!s || typeof s !== 'object') return fallback.scalpSetup;
      const direction: HorizonDirection = s.direction === 'SHORT' ? 'SHORT' : 'LONG';
      const orderType: HorizonOrderType = s.orderType === 'LIMIT' ? 'LIMIT' : 'STOP_MARKET';
      const trigger = Number(s.triggerPrice) > 0 ? Number(s.triggerPrice) : fallback.scalpSetup.triggerPrice;
      const sl = Number(s.stopLoss) > 0 ? Number(s.stopLoss) : fallback.scalpSetup.stopLoss;
      const tp = Number(s.takeProfit) > 0 ? Number(s.takeProfit) : fallback.scalpSetup.takeProfit;
      const maxLev = Math.min(CONFIG.MAX_LEVERAGE, Math.max(CONFIG.MIN_LEVERAGE, Math.round(Number(s.maxLeverage) || 3)));
      const timeStop = Math.min(
        CONFIG.SCALP_TIME_STOP_MAX,
        Math.max(CONFIG.SCALP_TIME_STOP_MIN, Math.round(Number(s.timeStopMinutes) || 8))
      );

      // Ensure directional geometry is valid
      const validGeometry =
        direction === 'LONG' ? tp > trigger && sl < trigger : tp < trigger && sl > trigger;
      if (!validGeometry) return fallback.scalpSetup;

      return {
        direction,
        orderType,
        triggerPrice: this.roundPrice(trigger),
        stopLoss: this.roundPrice(sl),
        takeProfit: this.roundPrice(tp),
        maxLeverage: maxLev,
        timeStopMinutes: timeStop,
        targetMagnet: String(s.targetMagnet || fallback.scalpSetup.targetMagnet),
        rationale: String(s.rationale || fallback.scalpSetup.rationale),
      };
    };

    const sanitizeSwing = (s: any): SwingTradeSetup => {
      if (!s || typeof s !== 'object') return fallback.swingSetup;
      const direction: HorizonDirection = s.direction === 'SHORT' ? 'SHORT' : 'LONG';
      const orderType: HorizonOrderType = s.orderType === 'LIMIT' ? 'LIMIT' : 'STOP_MARKET';
      const trigger = Number(s.triggerPrice) > 0 ? Number(s.triggerPrice) : fallback.swingSetup.triggerPrice;
      const sl = Number(s.stopLoss) > 0 ? Number(s.stopLoss) : fallback.swingSetup.stopLoss;
      const maxLev = Math.min(CONFIG.SWING_LEVERAGE_MAX, Math.max(CONFIG.SWING_LEVERAGE_MIN, Math.round(Number(s.maxLeverage) || 2)));

      const risk = Math.abs(trigger - sl);
      let tp = Number(s.takeProfit) > 0 ? Number(s.takeProfit) : fallback.swingSetup.takeProfit;
      const reward = Math.abs(tp - trigger);
      const validGeometry =
        direction === 'LONG' ? tp > trigger && sl < trigger : tp < trigger && sl > trigger;

      if (!validGeometry || risk <= 0) return fallback.swingSetup;

      let rr = reward / risk;
      if (rr < CONFIG.SWING_MIN_RR) {
        tp = direction === 'LONG' ? trigger + risk * CONFIG.SWING_MIN_RR : trigger - risk * CONFIG.SWING_MIN_RR;
        rr = CONFIG.SWING_MIN_RR;
      }

      return {
        direction,
        orderType,
        triggerPrice: this.roundPrice(trigger),
        stopLoss: this.roundPrice(sl),
        takeProfit: this.roundPrice(tp),
        maxLeverage: maxLev,
        riskRewardRatio: Number(rr.toFixed(2)),
        macroTarget: String(s.macroTarget || fallback.swingSetup.macroTarget),
        rationale: String(s.rationale || fallback.swingSetup.rationale),
      };
    };

    return {
      symbol: payload.symbol,
      price: payload.price,
      fundingRate: payload.fundingRate,
      priceChange24hPct: payload.priceChange24hPct,
      preFilterReasons: payload.preFilter.reasons,
      scalpSetup: sanitizeScalp(raw?.scalpSetup),
      swingSetup: sanitizeSwing(raw?.swingSetup),
      source,
      analyzedAt: Date.now(),
    };
  }

  private buildDeterministicFallback(payload: CoinIndicatorPayload): DualHorizonAnalysis {
    const p = payload.price;
    const tf15 = payload.tf15m;
    const tf4h = payload.tf4h;
    const isBullishBias = p >= tf15.ma25 || payload.fundingRate < -0.0003;
    const scalpDir: HorizonDirection = isBullishBias ? 'LONG' : 'SHORT';

    const scalpTrigger =
      scalpDir === 'LONG'
        ? this.roundPrice(Math.max(p * 1.0015, tf15.localCeiling * 0.999))
        : this.roundPrice(Math.min(p * 0.9985, tf15.localFloor * 1.001));
    const scalpSl = this.roundPrice(scalpDir === 'LONG' ? scalpTrigger * 0.982 : scalpTrigger * 1.018);
    const scalpTp = this.roundPrice(scalpDir === 'LONG' ? scalpTrigger * 1.028 : scalpTrigger * 0.972);
    const scalpLev = tf15.currentCandleRangePct > 3.5 ? 2 : tf15.currentCandleRangePct > 2.0 ? 3 : 4;

    const swingDir: HorizonDirection = p >= tf4h.ma25 || payload.fundingRate < -0.0004 ? 'LONG' : 'SHORT';
    const swingTrigger =
      swingDir === 'LONG'
        ? this.roundPrice(tf15.ma25 > 0 && tf15.ma25 < p ? tf15.ma25 * 1.002 : p * 0.994)
        : this.roundPrice(tf15.ma25 > 0 && tf15.ma25 > p ? tf15.ma25 * 0.998 : p * 1.006);
    const swingSl = this.roundPrice(swingDir === 'LONG' ? swingTrigger * 0.968 : swingTrigger * 1.032);
    const swingRisk = Math.abs(swingTrigger - swingSl);
    const swingTp = this.roundPrice(
      swingDir === 'LONG' ? swingTrigger + swingRisk * 2.8 : swingTrigger - swingRisk * 2.8
    );

    return {
      symbol: payload.symbol,
      price: p,
      fundingRate: payload.fundingRate,
      priceChange24hPct: payload.priceChange24hPct,
      preFilterReasons: payload.preFilter.reasons,
      scalpSetup: {
        direction: scalpDir,
        orderType: 'STOP_MARKET',
        triggerPrice: scalpTrigger,
        stopLoss: scalpSl,
        takeProfit: scalpTp,
        maxLeverage: scalpLev,
        timeStopMinutes: 8,
        targetMagnet: scalpDir === 'LONG' ? '15m localCeiling Breakout' : '15m localFloor Breakdown',
        rationale: `Quantitative bracket trap around 15m structure (Vol ${tf15.volumeSpikeRatio}x, Range ${tf15.currentCandleRangePct}%).`,
      },
      swingSetup: {
        direction: swingDir,
        orderType: 'LIMIT',
        triggerPrice: swingTrigger,
        stopLoss: swingSl,
        takeProfit: swingTp,
        maxLeverage: 2,
        riskRewardRatio: 2.8,
        macroTarget: tf4h.ma25 > 0 ? '4h MA25 / 15m MA99 Macro Void' : 'Multi-Hour Trend Continuation',
        rationale: `1:2.8 R:R structural pullback trap targeting macro void (4h MA25: ${this.roundPrice(tf4h.ma25)}).`,
      },
      source: 'DETERMINISTIC_FALLBACK',
      analyzedAt: Date.now(),
    };
  }

  public async analyzeDualHorizon(payload: CoinIndicatorPayload, forceRefresh = false): Promise<DualHorizonAnalysis> {
    const cached = this.analysisCache.get(payload.symbol);
    if (!forceRefresh && cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
      return cached.result;
    }

    if (!this.genAI) {
      return this.buildDeterministicFallback(payload);
    }

    // Build ordered list: preferred working model first, skipping any 404/unavailable models
    const orderedModels = [
      ...(this.preferredModel && !this.unavailableModels.has(this.preferredModel) ? [this.preferredModel] : []),
      ...this.candidateModels.filter((m) => m !== this.preferredModel && !this.unavailableModels.has(m)),
    ];

    // If all models were marked unavailable earlier, reset and retry all
    const modelsToTry = orderedModels.length > 0 ? orderedModels : [...this.candidateModels];
    if (orderedModels.length === 0) {
      this.unavailableModels.clear();
    }

    // Compact JSON saves tokens & latency across thousands of analyses
    const prompt = `Analyze this real-time Binance Futures payload and return Dual-Horizon bracketed JSON setups:${JSON.stringify(payload)}`;

    for (const modelName of modelsToTry) {
      try {
        const model = this.genAI.getGenerativeModel({
          model: modelName,
          systemInstruction: DUAL_HORIZON_SYSTEM_PROMPT,
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.2,
          },
        });

        const result = await Promise.race([
          model.generateContent(prompt),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`Gemini timeout (${modelName})`)), 7000)),
        ]);

        const text = result.response.text();
        const parsed = JSON.parse(text);
        this.preferredModel = modelName;
        const sanitized = this.sanitizeAnalysis(payload, parsed, 'GEMINI_AI');
        this.analysisCache.set(payload.symbol, { result: sanitized, timestamp: Date.now() });
        return sanitized;
      } catch (err: any) {
        const msg = String(err?.message || err || '');
        if (msg.includes('404') || msg.toLowerCase().includes('not found')) {
          this.unavailableModels.add(modelName);
        }
        console.warn(`[AIAnalyst] Model '${modelName}' failed for ${payload.symbol}: ${msg}. Trying next...`);
      }
    }

    return this.buildDeterministicFallback(payload);
  }
}

export const dualHorizonAnalyst = new DualHorizonAIAnalyst();
