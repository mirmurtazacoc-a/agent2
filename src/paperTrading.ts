import {
  BracketTradeSetup,
  CorrelationMode,
  MarketRegime,
  PaperTradeRecord,
  TradeDirection,
  TradeStatus,
} from './types';
import { marketData } from './marketData';

export interface IPaperTrade {
  tradeId: string;
  symbol: string;
  direction: TradeDirection;
  regime: MarketRegime;
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
  maePct: number;
  maeUsd: number;
  mfePct: number;
  mfeUsd: number;
  realizedPnL: number;
  unrealizedPnL: number;
  feesPaid: number;
  createdAt: Date;
  openedAt?: Date;
  closedAt?: Date;
  lastEvaluatedAt?: Date;
  maxHoldMinutes: number;
  closeReason?: string;
  correlationMode?: CorrelationMode;
  save?: () => Promise<any>;
  toObject?: () => any;
}

// In-Memory Fast Trade Store (Zero external DB dependencies, instant execution)
class InMemoryTradeStore {
  private trades: Map<string, IPaperTrade> = new Map();

  public save(trade: any): IPaperTrade {
    const existing = this.trades.get(trade.tradeId);
    const merged = { ...(existing ? (existing as any).toObject?.() || existing : {}), ...trade };
    merged._id = merged._id || trade.tradeId;
    merged.save = async () => this.save(merged);
    merged.toObject = () => ({ ...merged });
    this.trades.set(trade.tradeId, merged as IPaperTrade);
    return merged as IPaperTrade;
  }

  public find(query?: any): IPaperTrade[] {
    let list = Array.from(this.trades.values());
    if (query?.status) {
      if (typeof query.status === 'object' && query.status.$in) {
        list = list.filter((t) => query.status.$in.includes(t.status));
      } else {
        list = list.filter((t) => t.status === query.status);
      }
    }
    return list;
  }

  public findOne(query: any): IPaperTrade | undefined {
    if (query?.tradeId) return this.trades.get(query.tradeId);
    let list = Array.from(this.trades.values());
    if (query?.symbol) list = list.filter((t) => t.symbol === query.symbol);
    if (query?.status) {
      if (typeof query.status === 'object' && query.status.$in) {
        list = list.filter((t) => query.status.$in.includes(t.status));
      } else {
        list = list.filter((t) => t.status === query.status);
      }
    }
    return list[0];
  }
}

export class PaperTradingEngine {
  private inMemoryStore = new InMemoryTradeStore();
  private evalLoopInterval: NodeJS.Timeout | null = null;
  private isEvaluating = false;

  // Maker & Taker fee rate constants
  private readonly MAKER_FEE_RATE = 0.0002; // 0.02% Post-Only
  private readonly TAKER_FEE_RATE = 0.0005; // 0.05% Market Order

  constructor() {}

  public async initialize(): Promise<void> {
    console.log('[PaperTradingEngine] In-memory fast trade engine initialized. No database overhead.');
  }

  public isDbConnected(): boolean {
    return true;
  }

  // --- 1. CREATE PAPER BRACKET TRADE ---

  public async createPaperTrade(setup: BracketTradeSetup): Promise<PaperTradeRecord> {
    const tradeId = `paper_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const initialNotional = setup.entryPrice * setup.quantity;

    const markData = marketData.getLatestMarkPrice(setup.symbol);
    const currentMark = markData?.markPrice || setup.entryPrice;

    // Determine fill state: if entry price is within 0.05% of mark price, fill immediately as ACTIVE; otherwise queue as PENDING_FILL
    const isImmediateFill = Math.abs(currentMark - setup.entryPrice) / currentMark <= 0.0005;

    const tradeDoc: any = {
      tradeId,
      symbol: setup.symbol,
      direction: setup.direction,
      regime: setup.regime,
      correlationMode: setup.correlationMode || 'STANDALONE_ALPHA',
      entryPrice: setup.entryPrice,
      targetPrice: setup.entryPrice,
      currentPrice: currentMark,
      stopLoss: setup.stopLoss,
      originalStopLoss: setup.stopLoss,
      tp1: setup.tp1,
      tp2: setup.tp2,
      quantity: setup.quantity,
      initialNotional: Number(initialNotional.toFixed(2)),
      currentNotional: Number(initialNotional.toFixed(2)),
      leverage: setup.maxSafeLeverage,
      status: isImmediateFill ? 'ACTIVE' : 'PENDING_FILL',
      flowHealth: 'STRONG',
      tp1Hit: false,
      tp2Hit: false,
      slHit: false,
      maePct: 0,
      maeUsd: 0,
      mfePct: 0,
      mfeUsd: 0,
      realizedPnL: isImmediateFill ? -Number((initialNotional * this.MAKER_FEE_RATE).toFixed(4)) : 0,
      unrealizedPnL: 0,
      feesPaid: isImmediateFill ? Number((initialNotional * this.MAKER_FEE_RATE).toFixed(4)) : 0,
      createdAt: new Date(),
      openedAt: isImmediateFill ? new Date() : undefined,
      lastEvaluatedAt: isImmediateFill ? new Date() : undefined,
      maxHoldMinutes: 240,
    };

    return this.inMemoryStore.save(tradeDoc) as unknown as PaperTradeRecord;
  }

  // --- 2. TICK-ACCURATE 3-SECOND EVALUATION LOOP ---

  public startEvaluationLoop(): void {
    if (this.evalLoopInterval) return;
    this.evalLoopInterval = setInterval(async () => {
      await this.evaluateActiveTrades();
    }, 3000);
    console.log('[PaperTradingEngine] Paper trading evaluation loop started (3s interval).');
  }

  public stopEvaluationLoop(): void {
    if (this.evalLoopInterval) {
      clearInterval(this.evalLoopInterval);
      this.evalLoopInterval = null;
    }
  }

  public async evaluateActiveTrades(): Promise<void> {
    if (this.isEvaluating) return;
    this.isEvaluating = true;
    try {
      const pendingAndActive = await this.getTradesByStatuses(['PENDING_FILL', 'ACTIVE']);
      for (const trade of pendingAndActive) {
        await this.evaluateSingleTrade(trade);
      }
    } catch (err: any) {
      console.warn('[PaperTradingEngine] Evaluation loop warning:', err.message);
    } finally {
      this.isEvaluating = false;
    }
  }

  private async evaluateSingleTrade(trade: IPaperTrade): Promise<void> {
    const symbol = trade.symbol;
    const markData = marketData.getLatestMarkPrice(symbol);
    const evalSince = trade.lastEvaluatedAt
      ? new Date(trade.lastEvaluatedAt).getTime()
      : (trade.openedAt ? new Date(trade.openedAt).getTime() : new Date(trade.createdAt).getTime());
    const wick = marketData.getWickSince(symbol, evalSince);

    const markPrice = markData?.markPrice || trade.currentPrice;
    const highPrice = wick ? Math.max(wick.high, markPrice) : markPrice;
    const lowPrice = wick ? Math.min(wick.low, markPrice) : markPrice;

    trade.currentPrice = markPrice;
    const now = Date.now();

    // --- A. PENDING_FILL EVALUATION ---
    if (trade.status === 'PENDING_FILL') {
      const pendingDurationMinutes = (now - new Date(trade.createdAt).getTime()) / 60000;

      // 30-Minute Timeout for limit orders
      if (pendingDurationMinutes > 30) {
        trade.status = 'EXPIRED';
        trade.closedAt = new Date();
        trade.lastEvaluatedAt = new Date();
        trade.closeReason = 'Limit Entry Expired (30m unfilled)';
        await this.persistTrade(trade);
        return;
      }

      // Check Limit Fill Condition
      let filled = false;
      if (trade.direction === 'LONG') {
        if (lowPrice <= trade.entryPrice) filled = true;
      } else {
        if (highPrice >= trade.entryPrice) filled = true;
      }

      if (filled) {
        trade.status = 'ACTIVE';
        trade.openedAt = new Date();
        trade.lastEvaluatedAt = new Date();
        const entryFee = trade.initialNotional * this.MAKER_FEE_RATE;
        trade.feesPaid += entryFee;
        trade.realizedPnL -= entryFee;
        console.log(`[PaperTradingEngine] Trade ${trade.tradeId} (${trade.symbol} ${trade.direction}) FILLED at limit ${trade.entryPrice}.`);
        await this.persistTrade(trade);
      }
      return;
    }

    // --- B. ACTIVE TRADE EVALUATION ---
    if (trade.status === 'ACTIVE') {
      const openedAtTs = trade.openedAt ? new Date(trade.openedAt).getTime() : new Date(trade.createdAt).getTime();
      const holdMinutes = (now - openedAtTs) / 60000;

      let priceExcursion = trade.direction === 'LONG' ? markPrice - trade.entryPrice : trade.entryPrice - markPrice;
      let unrealizedPct = (priceExcursion / trade.entryPrice) * 100;
      let currentUnrealizedPnL = (unrealizedPct / 100) * trade.currentNotional;
      trade.unrealizedPnL = Number(currentUnrealizedPnL.toFixed(2));

      let worstExcursion = trade.direction === 'LONG' ? lowPrice - trade.entryPrice : trade.entryPrice - highPrice;
      let worstPct = Math.min(0, (worstExcursion / trade.entryPrice) * 100);
      trade.maePct = Number(Math.min(trade.maePct, worstPct).toFixed(2));
      trade.maeUsd = Number(Math.min(trade.maeUsd, (trade.maePct / 100) * trade.initialNotional).toFixed(2));

      let bestExcursion = trade.direction === 'LONG' ? highPrice - trade.entryPrice : trade.entryPrice - lowPrice;
      let bestPct = Math.max(0, (bestExcursion / trade.entryPrice) * 100);
      trade.mfePct = Number(Math.max(trade.mfePct, bestPct).toFixed(2));
      trade.mfeUsd = Number(Math.max(trade.mfeUsd, (trade.mfePct / 100) * trade.initialNotional).toFixed(2));

      // Check Stop-Loss
      let slTriggered = false;
      if (trade.direction === 'LONG' && lowPrice <= trade.stopLoss) slTriggered = true;
      if (trade.direction === 'SHORT' && highPrice >= trade.stopLoss) slTriggered = true;

      if (slTriggered) {
        trade.slHit = true;
        const lossAmount = ((trade.stopLoss - trade.entryPrice) / trade.entryPrice) * trade.currentNotional * (trade.direction === 'LONG' ? 1 : -1);
        const exitFee = trade.currentNotional * this.TAKER_FEE_RATE;
        trade.realizedPnL += lossAmount - exitFee;
        trade.feesPaid += exitFee;
        trade.currentNotional = 0;
        trade.status = trade.realizedPnL >= 0 ? 'CLOSED_WIN' : 'CLOSED_LOSS';
        trade.closedAt = new Date();
        trade.closeReason = 'Stop-Loss Hit (Taker Market Exit)';
        console.log(`[PaperTradingEngine] Trade ${trade.tradeId} (${trade.symbol}) STOPPED OUT at ${trade.stopLoss}. Realized PnL: ${trade.realizedPnL.toFixed(2)} USDT.`);
        await this.persistTrade(trade);
        return;
      }

      // Check TP1
      if (!trade.tp1Hit) {
        let tp1Triggered = false;
        if (trade.direction === 'LONG' && highPrice >= trade.tp1) tp1Triggered = true;
        if (trade.direction === 'SHORT' && lowPrice <= trade.tp1) tp1Triggered = true;

        if (tp1Triggered) {
          trade.tp1Hit = true;
          const scaleOutNotional = trade.initialNotional * 0.5;
          const gain50Pct = Math.abs(trade.tp1 - trade.entryPrice) / trade.entryPrice;
          const gainUsd = scaleOutNotional * gain50Pct;
          const makerFee = scaleOutNotional * this.MAKER_FEE_RATE;
          trade.realizedPnL += gainUsd - makerFee;
          trade.feesPaid += makerFee;
          trade.currentNotional -= scaleOutNotional;
          trade.stopLoss = trade.entryPrice; // Move to Breakeven
          console.log(`[PaperTradingEngine] Trade ${trade.tradeId} TP1 HIT (+${(gain50Pct * 100).toFixed(2)}%). Stop moved to Breakeven.`);
        }
      }

      // Check TP2
      if (trade.tp1Hit && !trade.tp2Hit) {
        let tp2Triggered = false;
        if (trade.direction === 'LONG' && highPrice >= trade.tp2) tp2Triggered = true;
        if (trade.direction === 'SHORT' && lowPrice <= trade.tp2) tp2Triggered = true;

        if (tp2Triggered) {
          trade.tp2Hit = true;
          const finalGainPct = Math.abs(trade.tp2 - trade.entryPrice) / trade.entryPrice;
          const gainUsd = trade.currentNotional * finalGainPct;
          const makerFee = trade.currentNotional * this.MAKER_FEE_RATE;
          trade.realizedPnL += gainUsd - makerFee;
          trade.feesPaid += makerFee;
          trade.currentNotional = 0;
          trade.status = 'CLOSED_WIN';
          trade.closedAt = new Date();
          trade.closeReason = 'Full TP2 Hit (Runner Scaled)';
          console.log(`[PaperTradingEngine] Trade ${trade.tradeId} FULL TP2 HIT. Final Realized PnL: ${trade.realizedPnL.toFixed(2)} USDT.`);
          await this.persistTrade(trade);
          return;
        }
      }

      // Check Time-Stop
      if (holdMinutes >= (trade.maxHoldMinutes || 240)) {
        trade.status = trade.realizedPnL + trade.unrealizedPnL >= 0 ? 'CLOSED_WIN' : 'CLOSED_SCRATCH';
        trade.closedAt = new Date();
        trade.closeReason = `Time-Stop Expired (${Math.round(holdMinutes)}m held)`;
        trade.realizedPnL += trade.unrealizedPnL;
        trade.currentNotional = 0;
        console.log(`[PaperTradingEngine] Trade ${trade.tradeId} TIME-STOP EXPIRED.`);
        await this.persistTrade(trade);
        return;
      }

      trade.lastEvaluatedAt = new Date();
      await this.persistTrade(trade);
    }
  }

  private async persistTrade(trade: IPaperTrade): Promise<void> {
    this.inMemoryStore.save(trade);
  }

  private async getTradesByStatuses(statuses: TradeStatus[]): Promise<IPaperTrade[]> {
    return this.inMemoryStore.find({ status: { $in: statuses } });
  }

  public async getActiveTrades(): Promise<PaperTradeRecord[]> {
    const trades = await this.getTradesByStatuses(['ACTIVE', 'PENDING_FILL']);
    return trades.map((t) => (typeof (t as any).toObject === 'function' ? (t as any).toObject() : t));
  }

  public async moveStopToBreakeven(identifier: string): Promise<{ success: boolean; message: string; trade?: PaperTradeRecord }> {
    const trade = this.inMemoryStore.findOne({ tradeId: identifier, status: 'ACTIVE' }) ||
                  this.inMemoryStore.findOne({ symbol: identifier, status: 'ACTIVE' });

    if (!trade) {
      return { success: false, message: `No active paper trade found for ${identifier}` };
    }

    trade.stopLoss = trade.entryPrice;
    await this.persistTrade(trade);
    return {
      success: true,
      message: `Stop-loss moved to breakeven (${trade.entryPrice}) for ${trade.symbol}`,
      trade: typeof (trade as any).toObject === 'function' ? (trade as any).toObject() : trade,
    };
  }

  public async panicCloseTrade(identifier: string): Promise<{ success: boolean; message: string; trade?: PaperTradeRecord }> {
    const trade = this.inMemoryStore.findOne({ tradeId: identifier, status: { $in: ['ACTIVE', 'PENDING_FILL'] } }) ||
                  this.inMemoryStore.findOne({ symbol: identifier, status: { $in: ['ACTIVE', 'PENDING_FILL'] } });

    if (!trade) {
      return { success: false, message: `No active or pending paper trade found for ${identifier}` };
    }

    const markData = marketData.getLatestMarkPrice(trade.symbol);
    const markPrice = markData?.markPrice || trade.currentPrice;

    if (trade.status === 'PENDING_FILL') {
      trade.status = 'EXPIRED';
      trade.closedAt = new Date();
      trade.closeReason = 'Manual Panic Cancel';
      await this.persistTrade(trade);
      return {
        success: true,
        message: `Cancelled pending limit order for ${trade.symbol}`,
        trade: typeof (trade as any).toObject === 'function' ? (trade as any).toObject() : trade,
      };
    }

    const exitNotional = trade.currentNotional;
    const priceExcursion = trade.direction === 'LONG' ? markPrice - trade.entryPrice : trade.entryPrice - markPrice;
    const unrealizedPct = (priceExcursion / trade.entryPrice) * 100;
    const finalGrossPnL = (unrealizedPct / 100) * exitNotional;
    const takerFee = exitNotional * this.TAKER_FEE_RATE;

    trade.currentPrice = markPrice;
    trade.realizedPnL += finalGrossPnL - takerFee;
    trade.feesPaid += takerFee;
    trade.currentNotional = 0;
    trade.status = trade.realizedPnL >= 0 ? 'CLOSED_WIN' : 'CLOSED_LOSS';
    trade.closedAt = new Date();
    trade.closeReason = 'Manual Panic Close (Market Taker Exit)';

    await this.persistTrade(trade);
    return {
      success: true,
      message: `Panic closed ${trade.symbol} at ${markPrice}. Realized PnL: ${trade.realizedPnL.toFixed(2)} USDT.`,
      trade: typeof (trade as any).toObject === 'function' ? (trade as any).toObject() : trade,
    };
  }

  public async getAllTrades(): Promise<PaperTradeRecord[]> {
    return this.inMemoryStore.find().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) as unknown as PaperTradeRecord[];
  }

  // --- 3. HISTORICAL PERFORMANCE RAG METRICS FOR GEMINI COPILOT ---

  public async getHistoricalRegimeMetrics(): Promise<Record<string, {
    hasHistory: boolean;
    totalTrades: number;
    winRate: number;
    profitFactor: number;
    avgPnL: number;
  }>> {
    const allTrades = await this.getAllTrades();
    const closedTrades = allTrades.filter((t) => t.status && t.status.startsWith('CLOSED_'));

    const regimeGroups: Record<string, { wins: number; losses: number; grossGains: number; grossLosses: number; totalPnL: number; count: number }> = {};

    for (const t of closedTrades) {
      const reg = t.regime || 'NEUTRAL';
      if (!regimeGroups[reg]) {
        regimeGroups[reg] = { wins: 0, losses: 0, grossGains: 0, grossLosses: 0, totalPnL: 0, count: 0 };
      }
      regimeGroups[reg].count++;
      regimeGroups[reg].totalPnL += t.realizedPnL;

      if (t.realizedPnL > 0) {
        regimeGroups[reg].wins++;
        regimeGroups[reg].grossGains += t.realizedPnL;
      } else if (t.realizedPnL < 0) {
        regimeGroups[reg].losses++;
        regimeGroups[reg].grossLosses += Math.abs(t.realizedPnL);
      }
    }

    const result: Record<string, any> = {};
    for (const [reg, g] of Object.entries(regimeGroups)) {
      if (g.count === 0) {
        result[reg] = { hasHistory: false, totalTrades: 0, winRate: 0, profitFactor: 0, avgPnL: 0 };
        continue;
      }
      const winRate = (g.wins / g.count) * 100;
      const profitFactor = g.grossLosses > 0 ? g.grossGains / g.grossLosses : g.grossGains > 0 ? 99.0 : 1.0;
      const avgPnL = g.totalPnL / g.count;

      result[reg] = {
        hasHistory: true,
        totalTrades: g.count,
        winRate: Number(winRate.toFixed(1)),
        profitFactor: Number(profitFactor.toFixed(2)),
        avgPnL: Number(avgPnL.toFixed(2)),
      };
    }

    return result;
  }
}

// Singleton Export
export const paperTrading = new PaperTradingEngine();
