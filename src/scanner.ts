import ccxt, { Exchange, OHLCV } from 'ccxt';
import { CONFIG } from './config';

export interface RawCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ScannedCoinData {
  symbol: string;
  ccxtSymbol: string;
  price: number;
  priceChange24hPct: number;
  quoteVolume24hUsdt: number;
  fundingRate: number;
  candles15m: RawCandle[];
  candles1h: RawCandle[];
  candles4h: RawCandle[];
  scannedAt: number;
}

export class FuturesScanner {
  private exchange: Exchange;
  private marketsLoaded = false;
  private rateLimitedUntil = 0;

  constructor() {
    this.exchange = new ccxt.binance({
      enableRateLimit: true,
      options: {
        defaultType: 'future',
      },
    });
  }

  public isRateLimited(): boolean {
    return Date.now() < this.rateLimitedUntil;
  }

  private handleCcxtError(context: string, err: any): void {
    const msg = String(err?.message || err || '');
    if (msg.includes('418') || msg.includes('429') || msg.toLowerCase().includes('rate limit')) {
      const waitSec = msg.includes('418') ? 180 : 60;
      this.rateLimitedUntil = Math.max(this.rateLimitedUntil, Date.now() + waitSec * 1000);
      console.warn(`[Scanner] ${context} -> Binance rate-limit/ban detected. Backing off ${waitSec}s.`);
    } else {
      console.warn(`[Scanner] ${context}:`, msg);
    }
  }

  private async ensureMarkets(): Promise<void> {
    if (this.marketsLoaded) return;
    await this.exchange.loadMarkets();
    this.marketsLoaded = true;
  }

  public normalizeToCcxtSymbol(input: string): string {
    const clean = input.toUpperCase().trim().replace(/[-_]/g, '');
    if (clean.includes('/')) {
      return clean.endsWith(':USDT') ? clean : `${clean}:USDT`;
    }
    const base = clean.endsWith('USDT') ? clean.slice(0, -4) : clean;
    return `${base}/USDT:USDT`;
  }

  public ccxtToPlainSymbol(ccxtSym: string): string {
    return ccxtSym.replace('/USDT:USDT', 'USDT').replace('/', '');
  }

  private mapOhlcv(rows: OHLCV[]): RawCandle[] {
    return rows.map((r) => ({
      timestamp: Number(r[0] || 0),
      open: Number(r[1] || 0),
      high: Number(r[2] || 0),
      low: Number(r[3] || 0),
      close: Number(r[4] || 0),
      volume: Number(r[5] || 0),
    }));
  }

  /**
   * Fetches multi-timeframe OHLCV (15m, 1h, 4h) and Funding Rate concurrently for a single symbol.
   */
  public async fetchCoinMultiTimeframe(
    symbolInput: string,
    tickerSnapshot?: { last?: number; percentage?: number; quoteVolume?: number }
  ): Promise<ScannedCoinData> {
    await this.ensureMarkets();
    const ccxtSymbol = this.normalizeToCcxtSymbol(symbolInput);
    const plainSymbol = this.ccxtToPlainSymbol(ccxtSymbol);

    const [ohlcv15m, ohlcv1h, ohlcv4h, fundingInfo, ticker] = await Promise.all([
      this.exchange.fetchOHLCV(ccxtSymbol, '15m', undefined, 100),
      this.exchange.fetchOHLCV(ccxtSymbol, '1h', undefined, 100),
      this.exchange.fetchOHLCV(ccxtSymbol, '4h', undefined, 100),
      this.exchange.fetchFundingRate(ccxtSymbol).catch(() => ({ fundingRate: 0 })),
      tickerSnapshot
        ? Promise.resolve(tickerSnapshot)
        : this.exchange.fetchTicker(ccxtSymbol).catch(() => ({ last: 0, percentage: 0, quoteVolume: 0 })),
    ]);

    const candles15m = this.mapOhlcv(ohlcv15m);
    const candles1h = this.mapOhlcv(ohlcv1h);
    const candles4h = this.mapOhlcv(ohlcv4h);

    const latestClose = candles15m[candles15m.length - 1]?.close || 0;
    const price = Number((ticker as any)?.last || latestClose);
    const priceChange24hPct = Number((ticker as any)?.percentage || 0);
    const quoteVolume24hUsdt = Number((ticker as any)?.quoteVolume || 0);
    const fundingRate = Number((fundingInfo as any)?.fundingRate || 0);

    return {
      symbol: plainSymbol,
      ccxtSymbol,
      price,
      priceChange24hPct,
      quoteVolume24hUsdt,
      fundingRate,
      candles15m,
      candles1h,
      candles4h,
      scannedAt: Date.now(),
    };
  }

  /**
   * Runs fetchTickers() across Binance Futures :USDT perpetuals, filters by
   * Quote Volume > $15M and |24h Change| >= 8%, sorts by volatility, and
   * fetches multi-timeframe OHLCV + funding rates for the top 12 coins.
   */
  public async scanTopVolatileCoins(): Promise<ScannedCoinData[]> {
    if (this.isRateLimited()) {
      console.warn('[Scanner] Skipping ccxt scan while rate-limit cooldown is active.');
      return [];
    }

    try {
      await this.ensureMarkets();
      const tickers = await this.exchange.fetchTickers();

      const filtered = Object.values(tickers)
        .filter((t) => {
          if (!t.symbol || !t.symbol.endsWith(':USDT')) return false;
          const qVol = Number(t.quoteVolume || 0);
          const pct = Math.abs(Number(t.percentage || 0));
          return qVol > CONFIG.MIN_24H_QUOTE_VOLUME_USDT && pct >= CONFIG.MIN_24H_PRICE_CHANGE_PERCENT;
        })
        .sort((a, b) => Math.abs(Number(b.percentage || 0)) - Math.abs(Number(a.percentage || 0)))
        .slice(0, CONFIG.MAX_VOLATILE_COINS);

      const results: ScannedCoinData[] = [];
      // Process in batches of 3 to respect Binance IP weights
      for (let i = 0; i < filtered.length; i += 3) {
        if (this.isRateLimited()) break;
        const batch = filtered.slice(i, i + 3);
        const batchData = await Promise.all(
          batch.map(async (t) => {
            try {
              return await this.fetchCoinMultiTimeframe(String(t.symbol), {
                last: t.last,
                percentage: t.percentage,
                quoteVolume: t.quoteVolume,
              });
            } catch (err: any) {
              this.handleCcxtError(`OHLCV fetch failed for ${t.symbol}`, err);
              return null;
            }
          })
        );
        for (const item of batchData) {
          if (item) results.push(item);
        }
        if (i + 3 < filtered.length && !this.isRateLimited()) {
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }

      return results;
    } catch (err: any) {
      this.handleCcxtError('scanTopVolatileCoins failed', err);
      return [];
    }
  }
}

export const futuresScanner = new FuturesScanner();
