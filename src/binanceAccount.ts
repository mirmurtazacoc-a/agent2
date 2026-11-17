import dotenv from 'dotenv';
import {
  BracketTradeSetup,
  PortfolioPosition,
  PortfolioRiskReport,
  TradeDirection,
} from './types';
import { marketData } from './marketData';
import { paperTrading } from './paperTrading';
import { CONFIG } from './config';

dotenv.config();

export interface SizingResult {
  notionalUsdt: number;
  quantity: number;
  stopDistancePct: number;
  maxSafeLeverage: number;
  riskAmountUsdt: number;
  marginRequiredUsdt: number;
}

export class BinanceAccountEngine {
  // In-memory starting base equity matching real configured capital ($80 default)
  private simulatedEquity = CONFIG.ACCOUNT_CAPITAL_USD || 80.0;

  constructor() {
    console.log(`[BinanceAccountEngine] Pure Standalone Quant Mode Active. Configured Capital: \$${this.simulatedEquity.toFixed(2)} USDT (No private API keys required).`);
  }

  // --- 1. 1% VOLATILITY-ADJUSTED POSITION SIZING ---

  /**
   * Volatility-Adjusted Position Sizing with Small Account Smart Sizing:
   * - Small Account (< $500): 2.5% risk fraction so notional comfortably clears Binance $5 MIN_NOTIONAL
   * - Standard Account (>= $500): 1.0% institutional risk fraction
   * - Strict Cap: Max 2.5x total equity, min $10 notional
   */
  public calculatePositionSizing(params: {
    equityUsdt: number;
    entryPrice: number;
    stopLoss: number;
    riskFraction?: number;
  }): SizingResult {
    const { equityUsdt, entryPrice, stopLoss } = params;

    if (entryPrice <= 0 || stopLoss <= 0 || entryPrice === stopLoss) {
      throw new Error('Invalid entry price or stop-loss for position sizing calculation.');
    }

    const stopDistancePct = Math.abs(entryPrice - stopLoss) / entryPrice;

    // Small account smart sizing: if equity < 500, use 2.5% risk so altcoins clear $5 MIN_NOTIONAL
    const effectiveRiskFraction =
      params.riskFraction !== undefined
        ? params.riskFraction
        : (equityUsdt < 500 ? 0.025 : 0.01);

    const riskAmountUsdt = equityUsdt * effectiveRiskFraction;

    // Raw volatility-adjusted notional: Notional * stopDistancePct = riskAmountUsdt
    const rawNotional = riskAmountUsdt / stopDistancePct;

    // Enforce strict cap: Max 2.0x account equity for structural swings, safe floor without breaking small accounts
    const maxAccountNotionalCap = equityUsdt * 2.0;
    let recommendedNotionalUsdt = Math.min(rawNotional, maxAccountNotionalCap);

    // Clamp small accounts safely to available margin budget
    if (recommendedNotionalUsdt < 12) {
      if (maxAccountNotionalCap >= 12) {
        recommendedNotionalUsdt = 12;
      } else {
        recommendedNotionalUsdt = Math.max(5, Number((equityUsdt * 0.95).toFixed(2)));
      }
    }
    const quantity = recommendedNotionalUsdt / entryPrice;

    // Safe leverage capper: recommend 3x to 5x max for swing stops (liquidation > 20% away)
    const rawSafeLev = this.calculateSafeLeverageCapper(stopDistancePct);
    const effectiveLeverage = Math.min(Math.max(2, rawSafeLev), 5);

    const marginRequiredUsdt = Number((recommendedNotionalUsdt / effectiveLeverage).toFixed(2));

    return {
      notionalUsdt: Number(recommendedNotionalUsdt.toFixed(2)),
      quantity: Number(quantity.toFixed(4)),
      stopDistancePct: Number((stopDistancePct * 100).toFixed(2)),
      maxSafeLeverage: effectiveLeverage,
      riskAmountUsdt: Number(riskAmountUsdt.toFixed(2)),
      marginRequiredUsdt,
    };
  }

  // --- 2. SAFE LEVERAGE CAPPER ---

  /**
   * Safe Leverage Capper for 1H Structural Swings:
   * Enforces that estimated liquidation distance is at least 2.0x farther than the Stop-Loss distance.
   * Clamped between 2x and 5x max.
   */
  public calculateSafeLeverageCapper(stopDistanceDecimal: number): number {
    if (stopDistanceDecimal <= 0) return 3;

    const maintenanceMarginRate = 0.005;
    const safetyMultiplier = 2.0;

    // L <= (1 - MMR) / (safetyMultiplier * stopDistance)
    const rawSafeLeverage = (1 - maintenanceMarginRate) / (safetyMultiplier * stopDistanceDecimal);

    // Floor to integer and clamp between 2x and 5x max
    const safeLeverage = Math.floor(rawSafeLeverage);
    return Math.max(2, Math.min(5, safeLeverage));
  }

  // --- 3. PORTFOLIO BTC-BETA STRESS TEST & FUNDING BLEED ---

  /**
   * Asset Beta to BTC estimation table
   */
  public getAssetBetaToBtc(symbol: string): number {
    const sym = symbol.toUpperCase().replace('/', '');
    if (sym === 'BTCUSDT') return 1.0;
    if (sym === 'ETHUSDT') return 1.2;
    if (sym === 'SOLUSDT') return 1.55;
    if (sym === 'BNBUSDT') return 0.9;
    if (sym === 'XRPUSDT') return 1.35;
    if (sym === 'DOGEUSDT' || sym === 'PEPEUSDT' || sym === 'WIFUSDT') return 1.95;
    if (sym === 'SUIUSDT' || sym === 'APTUSDT' || sym === 'SEIUSDT') return 1.65;
    if (sym === 'AVAXUSDT' || sym === 'NEARUSDT' || sym === 'LINKUSDT') return 1.4;
    return 1.45; // Default altcoin beta
  }

  public async getPortfolioRiskReport(): Promise<PortfolioRiskReport> {
    return await this.calculateSimulatedPortfolioReport();
  }

  private async calculateSimulatedPortfolioReport(): Promise<PortfolioRiskReport> {
    const activeTrades = await paperTrading.getActiveTrades();
    const allTrades = await paperTrading.getAllTrades();
    const realizedPnLSum = allTrades
      .filter((t) => t.status && t.status.startsWith('CLOSED_'))
      .reduce((sum, t) => sum + (t.realizedPnL || 0), 0);

    let totalUnrealizedPnL = 0;
    let usedMarginUsdt = 0;
    let totalNotional = 0;
    let weightedBetaSum = 0;
    let total8hFundingBleedUsdt = 0;
    const positions: PortfolioPosition[] = [];

    for (const trade of activeTrades) {
      if (trade.status !== 'ACTIVE') continue; // only filled active trades
      const sym = trade.symbol;
      const mark = marketData.getLatestMarkPrice(sym)?.markPrice || trade.currentPrice;
      const fundingRate = marketData.getLatestMarkPrice(sym)?.lastFundingRate ?? 0.0001;

      const priceDiff = trade.direction === 'LONG' ? mark - trade.entryPrice : trade.entryPrice - mark;
      const unrealizedPnL = (priceDiff / trade.entryPrice) * trade.currentNotional;
      const currentNotional = (mark / trade.entryPrice) * trade.currentNotional;
      const leverage = trade.leverage || 3;
      const bleed8h = currentNotional * fundingRate;
      const beta = this.getAssetBetaToBtc(sym);

      const liqPrice = trade.direction === 'LONG'
        ? trade.entryPrice * (1 - 0.9 / leverage)
        : trade.entryPrice * (1 + 0.9 / leverage);
      const distanceToLiqPct = mark > 0 ? Math.abs((mark - liqPrice) / mark) * 100 : 0;

      positions.push({
        symbol: sym,
        direction: trade.direction,
        entryPrice: trade.entryPrice,
        markPrice: mark,
        notionalUsd: Number(currentNotional.toFixed(2)),
        unrealizedPnL: Number(unrealizedPnL.toFixed(2)),
        liquidationPrice: Number(liqPrice.toFixed(4)),
        distanceToLiqPct: Number(distanceToLiqPct.toFixed(2)),
        leverage,
        fundingRate,
        estimatedFundingBleed8h: Number(bleed8h.toFixed(2)),
        betaToBtc: beta,
      });

      totalUnrealizedPnL += unrealizedPnL;
      usedMarginUsdt += currentNotional / leverage;
      total8hFundingBleedUsdt += bleed8h;
      totalNotional += currentNotional;

      const directionalBeta = trade.direction === 'LONG' ? beta : -beta;
      weightedBetaSum += currentNotional * directionalBeta;
    }

    const portfolioBeta = totalNotional > 0 ? Number((weightedBetaSum / totalNotional).toFixed(2)) : 0;
    const equityUsdt = this.simulatedEquity + realizedPnLSum + totalUnrealizedPnL;
    const availableBalanceUsdt = Math.max(0, equityUsdt - usedMarginUsdt);

    let btcCrash5PctLossUsdt = 0;
    for (const pos of positions) {
      const directionalBeta = pos.direction === 'LONG' ? pos.betaToBtc : -pos.betaToBtc;
      const deltaPnL = pos.notionalUsd * directionalBeta * -0.05;
      btcCrash5PctLossUsdt += deltaPnL;
    }

    const btcCrash5PctLossPct = equityUsdt > 0 ? (Math.abs(btcCrash5PctLossUsdt) / equityUsdt) * 100 : 0;

    return {
      equityUsdt: Number(equityUsdt.toFixed(2)),
      availableBalanceUsdt: Number(availableBalanceUsdt.toFixed(2)),
      usedMarginUsdt: Number(usedMarginUsdt.toFixed(2)),
      totalUnrealizedPnL: Number(totalUnrealizedPnL.toFixed(2)),
      portfolioBeta,
      btcCrash5PctLossUsdt: Number(btcCrash5PctLossUsdt.toFixed(2)),
      btcCrash5PctLossPct: Number(btcCrash5PctLossPct.toFixed(2)),
      total8hFundingBleedUsdt: Number(total8hFundingBleedUsdt.toFixed(2)),
      positions,
    };
  }

  // --- 4. 1-CLICK BRACKET ORDER SIMULATION ---

  public async executeBracketOrder(setup: BracketTradeSetup): Promise<{
    success: boolean;
    orderId: string;
    message: string;
    details: any;
  }> {
    const { symbol, direction, entryPrice, stopLoss, tp1, tp2, quantity, maxSafeLeverage } = setup;
    const orderId = `sim_bracket_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    console.log(
      `[BinanceAccountEngine] Routing simulated bracket order for ${symbol} (${direction}) at ${entryPrice}...`
    );

    return {
      success: true,
      orderId,
      message: `[Simulated Execution] Position registered in Paper Trading: Entry Limit @ ${entryPrice}, SL @ ${stopLoss}, TP1 @ ${tp1} (50%), TP2 @ ${tp2} (50%). Capital safe.`,
      details: {
        symbol,
        direction,
        quantity,
        entryPrice,
        stopLoss,
        tp1,
        tp2,
        leverage: maxSafeLeverage,
        executionMode: 'SIMULATED_STANDALONE',
      },
    };
  }

  // --- 5. POSITION CONTROLS ---

  public async moveStopToBreakeven(symbol: string): Promise<{ success: boolean; message: string }> {
    return await paperTrading.moveStopToBreakeven(symbol);
  }

  public async panicClosePosition(symbol: string): Promise<{ success: boolean; message: string }> {
    return await paperTrading.panicCloseTrade(symbol);
  }
}

// Singleton Export
export const binanceAccount = new BinanceAccountEngine();
