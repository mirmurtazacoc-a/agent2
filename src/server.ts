import express, { Request, Response } from 'express';
import http from 'http';
import path from 'path';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import dotenv from 'dotenv';
import { marketData } from './marketData';
import { binanceAccount } from './binanceAccount';
import { paperTrading } from './paperTrading';
import { geminiStrategy } from './gemini';
import { BracketTradeSetup, CorrelationMode } from './types';
import { CONFIG } from './config';
import { futuresScanner } from './scanner';
import { buildIndicatorPayload } from './indicators';
import { dualHorizonAnalyst, DualHorizonAnalysis } from './aiAnalyst';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

/**
 * Dual Long & Short Trade Predictions Matrix (Primary Single-Page Application)
 */
app.get('/', (req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.get('/predictions', (req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '../public/predictions.html'));
});

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket Server
const wss = new WebSocketServer({ server, path: '/ws' });

// Track connected WebSocket clients
const connectedClients: Set<WebSocket> = new Set();

wss.on('connection', async (ws: WebSocket) => {
  connectedClients.add(ws);
  console.log(`[WebSocket] Client connected. Total active clients: ${connectedClients.size}`);

  try {
    const portfolio = await binanceAccount.getPortfolioRiskReport();
    const macro = marketData.getBtcMacroTelemetry();
    const candidates = marketData.getTopCandidates();
    const fundingTimestamp = marketData.getGlobalFundingTimestamp();

    // Send immediate initial state snapshot the millisecond client connects
    const initialSnapshot = {
      type: 'INIT_SNAPSHOT',
      timestamp: Date.now(),
      macro,
      candidates,
      fundingTimestamp,
      nextFundingTime: fundingTimestamp,
      portfolio,
      equityUsdt: portfolio.equityUsdt,
      dualSetups: latestDualSetups,
      lastDualScanAt,
    };

    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(initialSnapshot));
    }
  } catch (err: any) {
    console.warn('[WebSocket] Initial snapshot notice:', err.message);
  }

  ws.on('close', () => {
    connectedClients.delete(ws);
    console.log(`[WebSocket] Client disconnected. Total active clients: ${connectedClients.size}`);
  });

  ws.on('error', (err) => {
    console.error('[WebSocket] Client error:', err.message);
  });
});

// Broadcast helper
function broadcastToClients(message: any): void {
  const payload = JSON.stringify(message);
  for (const client of connectedClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}
// --- REST API ENDPOINTS ---

/**
 * GET /api/status - Engine health & telemetry summary
 */
app.get('/api/status', async (req: Request, res: Response) => {
  try {
    const macro = marketData.getBtcMacroTelemetry();
    const portfolio = await binanceAccount.getPortfolioRiskReport();
    const fundingTimestamp = marketData.getGlobalFundingTimestamp();
    const wsConnected = marketData.isWsConnected();
    const lastWsTime = marketData.getLastWsMessageTime();
    const wsLatencyMs = lastWsTime > 0 ? Date.now() - lastWsTime : -1;

    res.json({
      status: 'ONLINE',
      systemMode: '100% READ-ONLY (NO LIVE ORDERS)',
      uptimeSeconds: process.uptime(),
      timestamp: Date.now(),
      binanceWsConnected: wsConnected,
      binanceWsLatencyMs: wsLatencyMs,
      binanceApiError: marketData.getLastApiError(),
      isPriceFeedFresh: wsConnected && wsLatencyMs >= 0 && wsLatencyMs < 12000,
      mongoDbConnected: paperTrading.isDbConnected(),
      macro,
      portfolioEquity: portfolio.equityUsdt,
      equityUsdt: portfolio.equityUsdt,
      nextFundingTime: fundingTimestamp,
      fundingTimestamp,
      candidates: marketData.getTopCandidates(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/scan - Top squeeze candidates
 */
app.get('/api/scan', async (req: Request, res: Response) => {
  try {
    let candidates = marketData.getTopCandidates();
    const macro = marketData.getBtcMacroTelemetry();
    const fundingTimestamp = marketData.getGlobalFundingTimestamp();
    res.json({
      timestamp: Date.now(),
      macro,
      candidates,
      fundingTimestamp,
      nextFundingTime: fundingTimestamp,
    });

    // Trigger async background refresh if candidate list is cold (uses Zero-Weight WS if REST is rate-limited)
    if (candidates.length === 0) {
      marketData.runCandidateScanner().catch(() => { });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/coin/:symbol - Instant chart loading (<10ms if pre-cached, <1500ms on-demand without LLM)
 */
app.get('/api/coin/:symbol', async (req: Request, res: Response) => {
  try {
    const symbol = (req.params.symbol || 'BTCUSDT').toUpperCase().trim();
    if (!marketData.isValidSymbol(symbol)) {
      return res.status(400).json({ error: `Invalid symbol format: ${symbol}. Must be a valid Binance USDT perpetual (e.g. BTCUSDT).` });
    }
    const data = await marketData.getFastCoinData(symbol);
    res.json({
      symbol,
      microstructure: data.microstructure,
      candles: data.candles,
      cached: data.cached,
      timestamp: Date.now(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/analyze?symbol=SOLUSDT - Deep microstructure & AI Copilot Quant Strategy
 */
app.get('/api/analyze', async (req: Request, res: Response) => {
  try {
    const symbol = ((req.query.symbol as string) || 'BTCUSDT').toUpperCase().trim();
    if (!marketData.isValidSymbol(symbol)) {
      return res.status(400).json({ error: `Invalid symbol format: ${symbol}. Must be a valid Binance USDT perpetual (e.g. BTCUSDT).` });
    }
    const correlationMode = ((req.query.correlationMode as string) || 'STANDALONE_ALPHA') as CorrelationMode;
    const portfolio = await binanceAccount.getPortfolioRiskReport();
    const liveEquity = portfolio.equityUsdt && portfolio.equityUsdt > 0 ? portfolio.equityUsdt : (CONFIG.ACCOUNT_CAPITAL_USD || 80);
    const analysis = await geminiStrategy.generateQuantStrategy(symbol, liveEquity, false, false, correlationMode);
    const microstructure = await marketData.fetchCoinData(symbol);
    const macro = marketData.getBtcMacroTelemetry();

    res.json({
      symbol: symbol.toUpperCase(),
      microstructure,
      macro,
      setup: analysis.setup,
      copilotRationale: analysis.copilotRationale,
      convictionScore: analysis.convictionScore,
      ragStats: analysis.ragStatsInjected,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/copilot/chat - Interactive AI Copilot conversation
 */
app.post('/api/copilot/chat', async (req: Request, res: Response) => {
  try {
    const { query, symbol = 'BTCUSDT' } = req.body;
    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'Query string is required in request body.' });
    }
    const sym = (symbol || 'BTCUSDT').toUpperCase().trim();
    if (!marketData.isValidSymbol(sym)) {
      return res.status(400).json({ error: `Invalid symbol format: ${sym}.` });
    }

    const reply = await geminiStrategy.chatWithCopilot(query, sym);
    res.json({
      query,
      symbol: sym,
      reply,
      timestamp: Date.now(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/symbols - Active Binance Futures USDT symbols list
 */
app.get('/api/symbols', (req: Request, res: Response) => {
  try {
    const symbols = marketData.getSymbols();
    res.json({ count: symbols.length, symbols });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/search?q=sol - Universal search autocomplete
 */
app.get('/api/search', (req: Request, res: Response) => {
  try {
    const q = ((req.query.q as string) || '').toUpperCase().trim();
    const symbols = marketData.getSymbols();
    const matches = q.length === 0
      ? symbols.slice(0, 10)
      : symbols.filter((s) => s.includes(q)).slice(0, 15);
    res.json({ query: q, matches });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/portfolio - Binance account & portfolio risk stress-test report
 */
app.get('/api/portfolio', async (req: Request, res: Response) => {
  try {
    const report = await binanceAccount.getPortfolioRiskReport();
    res.json(report);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/quant/dual-setup/:symbol - Institutional Dual-Trap Quant Setup (Dynamic Asset Equity)
 */
app.get('/api/quant/dual-setup/:symbol', async (req: Request, res: Response) => {
  try {
    const symbol = (req.params.symbol || 'BTCUSDT').toUpperCase().trim();
    if (!marketData.isValidSymbol(symbol)) {
      return res.status(400).json({ error: `Invalid symbol format: ${symbol}. Must be a valid Binance USDT perpetual (e.g. BTCUSDT).` });
    }
    const portfolio = await binanceAccount.getPortfolioRiskReport();
    const liveEquity = portfolio.equityUsdt && portfolio.equityUsdt > 0 ? portfolio.equityUsdt : (CONFIG.ACCOUNT_CAPITAL_USD || 80);
    const dualSetup = await geminiStrategy.generateDualModeQuantSetup(symbol, liveEquity);
    res.json({ success: true, symbol, dualSetup, accountEquityUsd: liveEquity, timestamp: Date.now() });
  } catch (err: any) {
    console.error('[API /quant/dual-setup] Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/predictions/dual/:symbol - Real-time dual Long & Short prediction vectors
 */
app.get('/api/predictions/dual/:symbol', async (req: Request, res: Response) => {
  try {
    const symbol = (req.params.symbol || 'BTCUSDT').toUpperCase().trim();
    if (!marketData.isValidSymbol(symbol)) {
      return res.status(400).json({ error: `Invalid symbol format: ${symbol}. Must be a valid Binance USDT perpetual (e.g. BTCUSDT).` });
    }
    const correlationMode = ((req.query.correlationMode as string) || 'STANDALONE_ALPHA') as CorrelationMode;
    const portfolio = await binanceAccount.getPortfolioRiskReport();
    const liveEquity = portfolio.equityUsdt && portfolio.equityUsdt > 0 ? portfolio.equityUsdt : (CONFIG.ACCOUNT_CAPITAL_USD || 80);

    const dual = await geminiStrategy.generateDualTradePredictions(symbol, liveEquity, correlationMode);
    res.json({
      success: true,
      symbol,
      correlationMode,
      accountEquityUsd: liveEquity,
      longPrediction: dual.longPrediction,
      shortPrediction: dual.shortPrediction,
      timestamp: Date.now(),
    });
  } catch (err: any) {
    console.error('[API /predictions/dual] Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/predict-trade/dual - Real-time dual Long & Short prediction generation with broadcast
 */
app.post('/api/predict-trade/dual', async (req: Request, res: Response) => {
  try {
    const { symbol = 'BTCUSDT', correlationMode = 'STANDALONE_ALPHA' } = req.body;
    const sym = symbol.toUpperCase().trim();
    if (!marketData.isValidSymbol(sym)) {
      return res.status(400).json({ error: `Invalid symbol format: ${sym}.` });
    }
    const portfolio = await binanceAccount.getPortfolioRiskReport();
    const liveEquity = portfolio.equityUsdt && portfolio.equityUsdt > 0 ? portfolio.equityUsdt : (CONFIG.ACCOUNT_CAPITAL_USD || 80);

    const dual = await geminiStrategy.generateDualTradePredictions(sym, liveEquity, correlationMode as CorrelationMode);

    broadcastToClients({
      type: 'DUAL_PREDICTIONS_GENERATED',
      symbol: sym,
      longPrediction: dual.longPrediction,
      shortPrediction: dual.shortPrediction,
      timestamp: Date.now(),
    });

    res.json({
      success: true,
      mode: '100%_READ_ONLY_SIMULATION',
      symbol: sym,
      correlationMode,
      accountEquityUsd: liveEquity,
      longPrediction: dual.longPrediction,
      shortPrediction: dual.shortPrediction,
      timestamp: Date.now(),
    });
  } catch (err: any) {
    console.error('[API /predict-trade/dual] Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/predict-trade - ⚡ On-Demand Real-Time Trade Prediction Simulator
 * Pulls latest live markPrice from 1s WebSocket stream, recalculates uncached quant prediction,
 * and registers into paperTrading as a live tracked simulation.
 */
app.post('/api/predict-trade', async (req: Request, res: Response) => {
  try {
    const { symbol, forceOverride, correlationMode = 'STANDALONE_ALPHA', direction } = req.body;
    if (!symbol || typeof symbol !== 'string') {
      return res.status(400).json({ error: 'Valid symbol string is required in request body.' });
    }

    const sym = symbol.toUpperCase().trim();
    if (!marketData.isValidSymbol(sym)) {
      return res.status(400).json({ error: `Invalid symbol format: ${sym}. Must be a valid Binance USDT perpetual (e.g. BTCUSDT).` });
    }

    const portfolio = await binanceAccount.getPortfolioRiskReport();
    const liveEquity = portfolio.equityUsdt && portfolio.equityUsdt > 0 ? portfolio.equityUsdt : (CONFIG.ACCOUNT_CAPITAL_USD || 80);

    // 1. Force fresh, uncached calculation anchored to latest live mark price & order flow + Dual Quant Setup
    const [{ prediction, copilotResponse }, dualSetup] = await Promise.all([
      geminiStrategy.generateTradePrediction(
        sym,
        liveEquity,
        true,
        Boolean(forceOverride),
        correlationMode as CorrelationMode,
        direction === 'LONG' || direction === 'SHORT' ? direction : undefined
      ),
      geminiStrategy.generateDualModeQuantSetup(sym, liveEquity).catch((err) => {
        console.warn('[API /predict-trade] Dual setup generation fallback:', err.message);
        return null;
      }),
    ]);

    // 2. Register into paperTrading as a live tracked simulation ONLY if trade was approved by gatekeeper (or forced)
    let trackedSimulation: any = null;
    if (prediction.direction !== 'NO_TRADE') {
      trackedSimulation = await paperTrading.createPaperTrade(copilotResponse.setup);
    }

    // 3. Broadcast prediction and simulated trade to all connected UI terminals
    broadcastToClients({
      type: 'PREDICTION_GENERATED',
      symbol: sym,
      prediction,
      dualSetup,
      trade: trackedSimulation,
      timestamp: Date.now(),
    });

    res.json({
      success: true,
      mode: '100%_READ_ONLY_SIMULATION',
      prediction,
      dualSetup,
      trackedSimulation,
      message:
        prediction.direction === 'NO_TRADE'
          ? `[GATEKEEPER ACTIVE] ${prediction.gatekeeperReason || 'No statistical edge. Wait for confluence.'}`
          : `Live structural swing prediction generated for ${sym} (${prediction.direction}) and registered for real-time tracking.`,
    });
  } catch (err: any) {
    console.error('[API /predict-trade] Prediction error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/execute-setup - 100% Read-Only Simulation Wrapper
 */
app.post('/api/execute-setup', async (req: Request, res: Response) => {
  try {
    const { setup } = req.body as { setup: BracketTradeSetup; mode?: string };

    if (!setup || !setup.symbol || !setup.entryPrice || !setup.stopLoss || !setup.tp1) {
      return res.status(400).json({ error: 'Incomplete BracketTradeSetup payload.' });
    }

    // Item #6: Explicitly block NO_TRADE execution
    if (setup.direction === 'NO_TRADE') {
      return res.status(400).json({ error: 'Cannot execute setup: Direction is NO_TRADE (Edge Gatekeeper blocked setup).' });
    }

    const sym = setup.symbol.toUpperCase().trim();
    if (!marketData.isValidSymbol(sym)) {
      return res.status(400).json({ error: `Invalid symbol format: ${sym}.` });
    }

    // Microstructure & Macro sanitization check
    const micro = await marketData.fetchCoinData(sym);
    const macro = marketData.getBtcMacroTelemetry();
    const portfolio = await binanceAccount.getPortfolioRiskReport();
    const liveEquity = portfolio.equityUsdt && portfolio.equityUsdt > 0 ? portfolio.equityUsdt : (CONFIG.ACCOUNT_CAPITAL_USD || 80);

    // Re-verify setup with math sanitizer
    const validatedSetup = geminiStrategy.validateAndSanitizeSetup(
      {
        symbol: sym,
        direction: setup.direction,
        entryPrice: setup.entryPrice,
        stopLoss: setup.stopLoss,
        tp1: setup.tp1,
        tp2: setup.tp2,
        equityUsdt: liveEquity,
      },
      micro,
      macro,
      (setup.correlationMode || 'STANDALONE_ALPHA') as CorrelationMode
    );

    // Save paper trade record in state machine (100% Read-Only mode - single source of truth)
    const paperTrade = await paperTrading.createPaperTrade(validatedSetup);
    const simResult = await binanceAccount.executeBracketOrder(validatedSetup);

    // Broadcast new trade event to connected terminals
    broadcastToClients({
      type: 'TRADE_CREATED',
      trade: paperTrade,
      mode: 'READ_ONLY_SIMULATION',
    });

    res.json({
      success: true,
      mode: '100%_READ_ONLY_SIMULATION',
      message: `[100% READ-ONLY] Simulated bracket position for ${sym} (${validatedSetup.direction}) registered for live tracking. No live exchange orders placed.`,
      validatedSetup,
      executionDetails: { paperTrade, simulatedExecution: simResult },
    });
  } catch (err: any) {
    console.error('[API /execute-setup] Execution error:', err.message);
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/trades - Active & Historical Paper Trades from MongoDB
 */
app.get('/api/trades', async (req: Request, res: Response) => {
  try {
    const trades = await paperTrading.getAllTrades();
    const stats = await paperTrading.getHistoricalRegimeMetrics();
    res.json({ trades, stats });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/position/breakeven - Emergency Move SL to Breakeven
 */
app.post('/api/position/breakeven', async (req: Request, res: Response) => {
  try {
    const { symbol } = req.body;
    if (!symbol) return res.status(400).json({ error: 'Symbol is required.' });
    const sym = symbol.toUpperCase().trim();
    if (!marketData.isValidSymbol(sym)) {
      return res.status(400).json({ error: `Invalid symbol format: ${sym}.` });
    }

    const result = await binanceAccount.moveStopToBreakeven(sym);
    broadcastToClients({ type: 'POSITION_UPDATED', action: 'BREAKEVEN', symbol: sym });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/position/panic-close - Emergency Panic Market Close
 */
app.post('/api/position/panic-close', async (req: Request, res: Response) => {
  try {
    const { symbol } = req.body;
    if (!symbol) return res.status(400).json({ error: 'Symbol is required.' });
    const sym = symbol.toUpperCase().trim();
    if (!marketData.isValidSymbol(sym)) {
      return res.status(400).json({ error: `Invalid symbol format: ${sym}.` });
    }

    const result = await binanceAccount.panicClosePosition(sym);
    broadcastToClients({ type: 'POSITION_CLOSED', action: 'PANIC_CLOSE', symbol: sym });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- DUAL-HORIZON CLI DASHBOARD & API ENDPOINTS ---

let latestDualSetups: DualHorizonAnalysis[] = [];
let lastDualScanAt = 0;

function printDualHorizonTable(setup: DualHorizonAnalysis): void {
  const C = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    cyan: '\x1b[36m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    magenta: '\x1b[35m',
    dim: '\x1b[2m',
  };
  const dirColor = (d: string) => (d === 'LONG' ? C.green : C.red);

  console.log(
    `\n${C.bold}${C.cyan}╔══════════════════════════════════════════════════════════════════════════════╗${C.reset}`
  );
  console.log(
    `${C.bold}${C.cyan}║${C.reset} ${C.bold}${setup.symbol}${C.reset}  Price: ${C.yellow}$${setup.price}${C.reset}  24h: ${setup.priceChange24hPct >= 0 ? C.green : C.red}${setup.priceChange24hPct}%${C.reset}  Funding: ${(setup.fundingRate * 100).toFixed(4)}%  [${C.magenta}${setup.source}${C.reset}]`
  );
  if (setup.preFilterReasons.length > 0) {
    console.log(`${C.dim}  Trigger: ${setup.preFilterReasons.join(' | ')}${C.reset}`);
  }
  console.table([
    {
      Horizon: 'SCALP (5-10m)',
      Direction: setup.scalpSetup.direction,
      OrderType: setup.scalpSetup.orderType,
      Trigger: setup.scalpSetup.triggerPrice,
      StopLoss: setup.scalpSetup.stopLoss,
      TakeProfit: setup.scalpSetup.takeProfit,
      Leverage: `${setup.scalpSetup.maxLeverage}x`,
      Rule: `${setup.scalpSetup.timeStopMinutes}m TimeStop`,
      Target: setup.scalpSetup.targetMagnet,
    },
    {
      Horizon: 'SWING (Multi-Hr)',
      Direction: setup.swingSetup.direction,
      OrderType: setup.swingSetup.orderType,
      Trigger: setup.swingSetup.triggerPrice,
      StopLoss: setup.swingSetup.stopLoss,
      TakeProfit: setup.swingSetup.takeProfit,
      Leverage: `${setup.swingSetup.maxLeverage}x`,
      Rule: `R:R 1:${setup.swingSetup.riskRewardRatio}`,
      Target: setup.swingSetup.macroTarget,
    },
  ]);
  console.log(
    `  ${dirColor(setup.scalpSetup.direction)}[SCALP]${C.reset} ${setup.scalpSetup.rationale}`
  );
  console.log(
    `  ${dirColor(setup.swingSetup.direction)}[SWING]${C.reset} ${setup.swingSetup.rationale}`
  );
  console.log(
    `${C.cyan}╚══════════════════════════════════════════════════════════════════════════════╝${C.reset}`
  );
}

async function runDualHorizonScanCycle(): Promise<DualHorizonAnalysis[]> {
  const scannedCoins = await futuresScanner.scanTopVolatileCoins();
  if (scannedCoins.length === 0) return latestDualSetups;

  const generated: DualHorizonAnalysis[] = [];
  for (const coin of scannedCoins) {
    const payload = buildIndicatorPayload(coin);
    if (!payload.preFilter.passed) continue;

    const analysis = await dualHorizonAnalyst.analyzeDualHorizon(payload);
    generated.push(analysis);
    printDualHorizonTable(analysis);
  }

  if (generated.length > 0) {
    latestDualSetups = generated;
  }
  lastDualScanAt = Date.now();
  broadcastToClients({
    type: 'DUAL_HORIZON_SETUPS',
    lastScanAt: lastDualScanAt,
    setups: latestDualSetups,
  });
  return latestDualSetups;
}

/**
 * GET /api/setups - Latest AI-analyzed Dual-Horizon (Scalp + Swing) setups
 */
app.get('/api/setups', (req: Request, res: Response) => {
  res.json({
    capitalUsd: CONFIG.ACCOUNT_CAPITAL_USD,
    noMarketOrders: CONFIG.NO_MARKET_ORDERS,
    lastScanAt: lastDualScanAt,
    count: latestDualSetups.length,
    setups: latestDualSetups,
  });
});

/**
 * GET /api/analyze/:symbol - Force instant real-time scan & Dual-Horizon analysis for a specific coin
 */
app.get('/api/analyze/:symbol', async (req: Request, res: Response) => {
  try {
    const rawSym = String(req.params.symbol || '').toUpperCase().trim();
    if (!rawSym) {
      return res.status(400).json({ error: 'Symbol parameter is required (e.g. BTCUSDT or JCTUSDT).' });
    }
    let coinData;
    try {
      if (marketData.isRateLimited() || futuresScanner.isRateLimited()) {
        throw new Error('Binance REST rate-limit cooldown active');
      }
      coinData = await futuresScanner.fetchCoinMultiTimeframe(rawSym);
    } catch (scanErr: any) {
      // Zero-REST WebSocket fallback when Binance REST is in a 418/429 cooldown
      const sym = rawSym.endsWith('USDT') ? rawSym : `${rawSym}USDT`;
      const mark = marketData.getLatestMarkPrice(sym);
      const candidate = marketData.getTopCandidates().find((c) => c.symbol === sym);
      const livePrice = mark?.markPrice || candidate?.price || 0;
      if (livePrice <= 0) {
        return res.status(503).json({ error: `Binance REST rate-limited (${scanErr?.message}) and no live WebSocket price cached yet for ${sym}.` });
      }
      const now = Date.now();
      const synthCandle = {
        timestamp: now,
        open: livePrice * 0.996,
        high: livePrice * 1.005,
        low: livePrice * 0.994,
        close: livePrice,
        volume: candidate?.volume15mUsd ? candidate.volume15mUsd / livePrice : 100000,
      };
      coinData = {
        symbol: sym,
        ccxtSymbol: futuresScanner.normalizeToCcxtSymbol(sym),
        price: livePrice,
        priceChange24hPct: candidate?.priceChange15mPct ? candidate.priceChange15mPct * 4 : 0,
        quoteVolume24hUsdt: (candidate?.volume15mUsd || 500000) * 96,
        fundingRate: mark?.lastFundingRate ?? candidate?.fundingRate ?? 0.0001,
        candles15m: [synthCandle],
        candles1h: [synthCandle],
        candles4h: [synthCandle],
        scannedAt: now,
      };
    }
    const indicatorPayload = buildIndicatorPayload(coinData);
    const setup = await dualHorizonAnalyst.analyzeDualHorizon(indicatorPayload);
    printDualHorizonTable(setup);

    // Upsert into latestDualSetups cache
    latestDualSetups = [setup, ...latestDualSetups.filter((s) => s.symbol !== setup.symbol)].slice(0, 12);
    lastDualScanAt = Date.now();
    broadcastToClients({
      type: 'DUAL_HORIZON_SETUPS',
      lastScanAt: lastDualScanAt,
      setups: latestDualSetups,
    });

    res.json({
      capitalUsd: CONFIG.ACCOUNT_CAPITAL_USD,
      noMarketOrders: CONFIG.NO_MARKET_ORDERS,
      indicatorPayload,
      setup,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to analyze symbol' });
  }
});

// --- ENGINE INITIALIZATION & BACKGROUND LOOPS ---

async function startEngine(): Promise<void> {
  console.log('[Server] Initializing Institutional Quantitative Trading Engine...');

  // Start HTTP & WebSocket server immediately on 0.0.0.0:PORT
  server.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`==================================================================`);
    console.log(`🚀 INSTITUTIONAL BINANCE FUTURES QUANT ENGINE ONLINE`);
    console.log(`📡 HTTP Server & REST API: http://localhost:${PORT}`);
    console.log(`⚡ WebSocket Stream: ws://localhost:${PORT}/ws`);
    console.log(`💻 Terminal UI: http://localhost:${PORT}`);
    console.log(`==================================================================`);
  });

  // Item #5: Explicitly await database initialization before starting trade loops
  await paperTrading.initialize();

  // 1. Connect Binance Multiplexed WebSocket
  marketData.startWebSocket();

  // 2. Start 3-Second Tick-Accurate Paper Trading Evaluation Loop
  paperTrading.startEvaluationLoop();

  // 3. Fetch Active Binance Futures Symbols & Run Initial Candidate Scan asynchronously
  (async () => {
    try {
      await marketData.refreshActiveSymbols();
      console.log('[Server] Performing initial 20-universe candidate scan & BTC macro check...');
      await marketData.runCandidateScanner();
    } catch (err: any) {
      console.warn('[Server] Initial scan notice:', err.message);
    }
  })();

  // 4. Start Background 60-Second Scanner Loop with In-Flight Guard (Item #14)
  let isPeriodicScanning = false;
  setInterval(async () => {
    if (isPeriodicScanning) return;
    isPeriodicScanning = true;
    try {
      const candidates = await marketData.runCandidateScanner();
      const macro = marketData.getBtcMacroTelemetry();
      broadcastToClients({
        type: 'SCANNER_UPDATE',
        timestamp: Date.now(),
        macro,
        candidates,
      });
    } catch (err: any) {
      console.warn('[ScannerLoop] Periodic scan warning:', err.message);
    } finally {
      isPeriodicScanning = false;
    }
  }, 60000);

  // 5. Broadcast 3-Second Ticker & Paper Trades Heartbeat to WebSockets (Item #14: getActiveTrades without 100 limit)
  setInterval(async () => {
    try {
      const openTrades = await paperTrading.getActiveTrades();
      broadcastToClients({
        type: 'TICK_HEARTBEAT',
        timestamp: Date.now(),
        openTrades,
      });
    } catch (err: any) {
      // Ignore heartbeat error
    }
  }, 3000);
}

startEngine().catch((err) => {
  console.error('[Server] Fatal engine boot failure:', err);
});
