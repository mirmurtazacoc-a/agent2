# Institutional Binance Futures Quantitative Trading Engine & AI Copilot

A complete, production-grade Institutional Binance Futures Quantitative Trading Engine and AI Copilot built with Node.js, TypeScript, Express, WebSockets, Mongoose (MongoDB), and Tailwind CSS / Vanilla JS.

---

## Architecture & Modules

### 1. Ingestion & Microstructure Engine (`src/marketData.ts`)
- **Binance Multiplexed WebSocket:** Continuous feed connecting to `wss://fstream.binance.com/stream?streams=!markPrice@arr@1s/!forceOrder@arr` with exponential backoff auto-reconnection.
- **Sliding 15m Liquidation Window:** Tracks forced buy-to-cover (`shortLiqUsd15m`) and forced sell-to-close (`longLiqUsd15m`) notional per symbol.
- **Microstructure REST Pipeline:** Parallel `Promise.allSettled` queries for Open Interest History, Taker Buy/Sell CVD Ratio, Top Trader & Retail Position Ratios, Spot-Perp Basis %, Order Book Depth (limit 500) for 2% Order Book Imbalance (OBI) and Liquidity Walls, and 15m Klines.
- **Mathematical Quant Calculators:**
  - Wilder's ATR14 smoothing: $ATR_t = \frac{ATR_{prev} \times 13 + TR_t}{14}$
  - Session VWAP: $\sum (TypicalPrice \times Volume) / \sum Volume$
  - Order Book Imbalance (OBI): $(BidNotional_{2\%} - AskNotional_{2\%}) / (BidNotional_{2\%} + AskNotional_{2\%})$
  - Squeeze Velocity Score (0–100): Composite weighting funding extremity, volume surges, OI delta, and liquidation velocity.
  - 4-Quadrant Market Regime Classifier: `PRIME_SHORT_SQUEEZE`, `SHORT_COVERING_EXHAUSTION`, `PRIME_LONG_SQUEEZE`, `SPOT_LED_MARKUP`, `NEUTRAL`.
  - BTC Macro Kill-Switch: Monitors BTC 15m price drop ($\le -1.5\%$) or long liquidations ($> \$5\text{M}$) to engage `MACRO_DUMP_WARNING` (blocking all new long entries).

### 2. Portfolio Risk & 1-Click Execution Engine (`src/binanceAccount.ts`)
- **1% Volatility-Adjusted Sizing:**
  $$\text{Notional}_{\text{USDT}} = \frac{\text{Account Equity} \times 0.01}{\frac{|\text{Entry} - \text{SL}|}{\text{Entry}}}$$
- **Safe Leverage Capper:** Enforces maximum safe leverage so liquidation distance $\ge 1.5 \times$ Stop-Loss distance.
- **Portfolio BTC-Beta Stress Test:** Computes beta-weighted altcoin exposure and simulates an instantaneous $-5\%$ BTC flash crash drawdown.
- **8-Hour Funding Bleed:** Projects cumulative funding fee settlements across all active positions.
- **1-Click CCXT Bracket Order Execution:** Sets symbol leverage, places Post-Only Limit Entry (`timeInForce: 'GTX'`, 0.02% maker fee), conditional `STOP_MARKET` order at Stop-Loss (`reduceOnly: true`), and two `TAKE_PROFIT_MARKET` orders (50% each, `reduceOnly: true`).
- **Emergency Controls:** `moveStopToBreakeven` and `panicClosePosition`.

### 3. Tick-Accurate Paper Trading State Machine & MongoDB (`src/paperTrading.ts`)
- **Mongoose Schema & High-Speed In-Memory Fallback:** Persists trade state, MAE/MFE excursions, fill status, realized PnL, and fee accounting.
- **3-Second Tick-Accurate Evaluation Loop:** Evaluates live WS mark prices and 1-minute candle High/Low wicks to prevent missed wicks.
- **Auto 50% Profit Lock & Breakeven SL:** Realizes 50% profit at TP1 and immediately shifts the effective Stop-Loss to Breakeven.
- **Time-Stop Invalidation (`CLOSED_SCRATCH`):** Scratches trades held past 90 minutes if momentum stalls or regime flips against the position.
- **Maker vs Taker Fee Modeling:** Deducts 0.02% Maker fee on limit entries/TPs and 0.05% Taker fee on stop-losses.

### 4. Deterministic AI Strategy & Copilot (`src/gemini.ts`)
- **Resilient Model Chain:** Configured for Google Gemini with deterministic institutional rule engine fallback.
- **Deterministic Math Sanitizer:** Enforces $1.5 \times ATR_{14}$ stop floor, minimum 1:2.5 Risk-to-Reward ratio, blocks longs during `SHORT_COVERING_EXHAUSTION`, and halts on `MACRO_DUMP_WARNING`.
- **MongoDB RAG History Calibration:** Injects empirical win rate and profit factors by regime into the Copilot context to ground conviction scores (0–100).
- **Structured Tagged Copilot Output:** Strict format syntax categorized with `[FACT]`, `[PREDICTION]`, `[ASSUMPTION]`, `[RISK]`, and `[INVALIDATION_TRIGGER]`.

### 5. Backend Server & Engine Loop (`src/server.ts`)
- Express & WebSocket server (Port 3000).
- 30-second candidate scanner loop & 3-second paper trading tick loop.
- Full REST API suite and real-time WebSocket broadcasting (`/ws`).

### 6. Professional Trading Terminal UI (`public/index.html`)
- Bloomberg / TradingView caliber dark mode UI with Tailwind CSS.
- Real-time Chart.js 15m candlesticks with Session VWAP, Top Bid Wall, and Top Ask Wall overlays.
- Interactive AI Copilot chat with syntax badges.
- 1-Click Bracket Order execution button.
- Portfolio beta stress tests, funding bleed impact, and emergency controls.

---

## Quick Start Guide

### 1. Configure Environment (Optional)
The project works out-of-the-box in simulated institutional mode with zero configuration. You can optionally add credentials in `.env`:
```ini
PORT=3000
BINANCE_API_KEY=your_binance_futures_api_key
BINANCE_API_SECRET=your_binance_futures_api_secret
BINANCE_TESTNET=false
GEMINI_API_KEY=your_google_gemini_api_key
MONGODB_URI=mongodb://127.0.0.1:27017/binance_quant_engine
```

### 2. Build the Project
```bash
npm run build
```

### 3. Start the Quantitative Engine
```bash
npm start
```
Or for development with live reload:
```bash
npm run dev
```

### 4. Open the Terminal
Navigate to [http://localhost:3000](http://localhost:3000) in your web browser.

