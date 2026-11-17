import { config } from '../config';
import {
  CandidateCoin,
  CorrelationMode,
  MacroTelemetry,
  PaperTrade,
  PortfolioReport,
  TradePrediction,
} from '../types';

export const api = {
  // Fetch top squeeze candidates from market scanner
  async fetchCandidates(): Promise<{
    candidates: CandidateCoin[];
    macro?: MacroTelemetry;
    fundingTimestamp?: number;
  }> {
    const url = `${config.getApiUrl()}/api/scan`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to fetch candidates`);
    return await res.json();
  },

  // Fetch fast coin microstructure data
  async fetchCoinData(symbol: string): Promise<any> {
    const url = `${config.getApiUrl()}/api/coin/${encodeURIComponent(symbol)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to fetch coin data for ${symbol}`);
    return await res.json();
  },

  // Fetch dual real-time trade predictions (Long & Short)
  async fetchDualPredictions(
    symbol: string,
    correlationMode: CorrelationMode = 'STANDALONE_ALPHA'
  ): Promise<{
    success: boolean;
    symbol: string;
    correlationMode: CorrelationMode;
    accountEquityUsd: number;
    longPrediction: TradePrediction;
    shortPrediction: TradePrediction;
  }> {
    const url = `${config.getApiUrl()}/api/predictions/dual/${encodeURIComponent(symbol)}?correlationMode=${encodeURIComponent(correlationMode)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to calculate dual predictions`);
    return await res.json();
  },

  // Fetch active paper trades
  async fetchTrades(): Promise<{ trades: PaperTrade[] }> {
    const url = `${config.getApiUrl()}/api/trades`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to fetch paper trades`);
    return await res.json();
  },

  // Execute 100% Read-Only Paper Trade simulation
  async executePaperTrade(setup: any): Promise<{ success: boolean; message?: string }> {
    const url = `${config.getApiUrl()}/api/execute-setup`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ setup, mode: 'READ_ONLY_SIMULATION' }),
    });
    return await res.json();
  },

  // Move stop loss to breakeven
  async moveStopToBreakeven(symbol: string): Promise<any> {
    const url = `${config.getApiUrl()}/api/position/breakeven`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol }),
    });
    return await res.json();
  },

  // Panic close simulated position
  async panicClosePosition(symbol: string): Promise<any> {
    const url = `${config.getApiUrl()}/api/position/panic-close`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol }),
    });
    return await res.json();
  },

  // Autocomplete symbol search
  async searchSymbols(q: string): Promise<string[]> {
    if (!q || !q.trim()) return [];
    const url = `${config.getApiUrl()}/api/search?q=${encodeURIComponent(q.trim())}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return data.matches || [];
  },

  // Fetch account portfolio & equity
  async fetchPortfolio(): Promise<PortfolioReport> {
    const url = `${config.getApiUrl()}/api/portfolio`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to fetch portfolio`);
    return await res.json();
  },
};

