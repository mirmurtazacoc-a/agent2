# QuantumEdge Mobile (React Native + Expo)

Institutional Binance Futures Quantitative Trading & Dual Prediction Engine — Mobile Companion.

---

## 📱 Features

1. **📡 Top Squeeze Radar:**
   - Real-time candidate ranking by Squeeze Velocity Score (0–100).
   - Ticker search with instant filtering.
   - `🎯 A+ Only` filter toggle.
   - Live mark price, 15m price change %, 15m ΔOI %, and regime classification badges.
   - Tapping any candidate immediately loads its real-time microstructure and launches the Dual Prediction engine.

2. **⚡ Dual-Horizon Trade Predictions Matrix:**
   - **🟢 Strictly Long Signal View:** Institutional emerald card with win probability, 1:2.8+ R:R, AI Long conviction meter, swing long entry, TP1 (50% lock), TP2 (full runner), structural stop loss, 1H HTF trend, 5m micro-CVD, 50x short liq magnet, and risk-calibrated position sizing.
   - **🔴 Strictly Short Signal View:** Institutional rose card with win probability, 1:2.8+ R:R, AI Short conviction meter, swing short entry, TP1, TP2, structural stop loss, 1H HTF trend, 5m micro-CVD, 50x long liq magnet, and risk-calibrated position sizing.
   - Segmented view switcher: **🟢 Long**, **🔴 Short**, or **⚡ Both Views** (side-by-side / vertical stack).
   - Instant simulation button for both directions with 100% Read-Only safety.

3. **🛡️ Active Paper Positions:**
   - Live tracked positions with real-time unrealized PnL % and $.
   - Trailing stop order monitoring.
   - Emergency **`SL ➔ Breakeven`** and **`Panic Close`** controls.

4. **⚙️ In-App Backend Host Configurator:**
   - Change your backend server URL on the fly without recompiling.
   - Includes a "Test Ping" button to confirm connectivity with your Node.js engine.

---

## 🚀 Quick Start Guide

### 1. Install Dependencies
Open your terminal, navigate to the `mobile/` directory, and run:

```bash
cd mobile
npm install
```

### 2. Connect Your Phone to Your Computer
* Ensure your mobile phone and your computer are connected to the **same Wi-Fi network**.
* Find your computer's local IP address:
  * On Windows, run: `ipconfig` (look for **IPv4 Address**, e.g., `192.168.1.50`).

### 3. Start the Backend Server (if not already running)
From the root directory:
```bash
npm start
```
*(Server listens on `http://0.0.0.0:3000`)*

### 4. Start the Mobile App
From the `mobile/` folder:
```bash
npm start
```
A large **QR code** will appear in your terminal.

### 5. Open on Your Phone
* **iPhone:** Open the Camera app and scan the QR code. It will prompt you to open **Expo Go**.
* **Android:** Open the **Expo Go** app and tap **"Scan QR Code"**.
* Tap the **⚙️** icon in the top right of the mobile app to set your computer's IP address (e.g. `http://192.168.1.50:3000`), tap **"Test Ping"**, and then **"Save & Connect"**.

