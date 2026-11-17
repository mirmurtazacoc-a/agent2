import React, { useState, useEffect } from 'react';
import {
  SafeAreaView,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  StatusBar,
  Alert,
} from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  CandidateCoin,
  CorrelationMode,
  MacroTelemetry,
  PaperTrade,
  TradePrediction,
  formatCryptoPrice,
} from './src/types';
import { api } from './src/services/api';
import { wsClient } from './src/services/websocket';
import { SqueezeRadar } from './src/components/SqueezeRadar';
import { LongPredictionCard } from './src/components/LongPredictionCard';
import { ShortPredictionCard } from './src/components/ShortPredictionCard';
import { PositionsList } from './src/components/PositionsList';
import { SettingsModal } from './src/components/SettingsModal';

type MainTab = 'RADAR' | 'PREDICTIONS' | 'POSITIONS';
type DirectionViewMode = 'LONG' | 'SHORT' | 'BOTH';

export default function App() {
  const [activeTab, setActiveTab] = useState<MainTab>('RADAR');
  const [activeSymbol, setActiveSymbol] = useState('');
  const [correlationMode, setCorrelationMode] = useState<CorrelationMode>('STANDALONE_ALPHA');
  const [directionViewMode, setDirectionViewMode] = useState<DirectionViewMode>('LONG');

  // Market & Prediction State
  const [candidates, setCandidates] = useState<CandidateCoin[]>([]);
  const [macro, setMacro] = useState<MacroTelemetry | null>(null);
  const [longPrediction, setLongPrediction] = useState<TradePrediction | null>(null);
  const [shortPrediction, setShortPrediction] = useState<TradePrediction | null>(null);
  const [trades, setTrades] = useState<PaperTrade[]>([]);
  const [equityUsdt, setEquityUsdt] = useState<number>(0);

  // Status & UI State
  const [wsConnected, setWsConnected] = useState(false);
  const [refreshingRadar, setRefreshingRadar] = useState(false);
  const [refreshingTrades, setRefreshingTrades] = useState(false);
  const [predictingLoading, setPredictingLoading] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);

  // Initialize Data & WebSocket
  useEffect(() => {
    // 1. Subscribe to WebSocket Status
    const unsubscribeStatus = wsClient.onStatus((connected) => {
      setWsConnected(connected);
    });

    // 2. Subscribe to WebSocket Messages
    const unsubscribeMsg = wsClient.onMessage((msg) => {
      if (!msg || !msg.type) return;

      if (msg.type === 'INIT_SNAPSHOT' || msg.type === 'SCANNER_UPDATE') {
        if (msg.candidates) setCandidates(msg.candidates);
        if (msg.macro) setMacro(msg.macro);
        if (msg.portfolio?.equityUsdt) setEquityUsdt(msg.portfolio.equityUsdt);
      } else if (msg.type === 'TICK_HEARTBEAT') {
        if (msg.openTrades) setTrades(msg.openTrades);
      } else if (msg.type === 'DUAL_PREDICTIONS_GENERATED') {
        if (msg.symbol === activeSymbol) {
          if (msg.longPrediction) setLongPrediction(msg.longPrediction);
          if (msg.shortPrediction) setShortPrediction(msg.shortPrediction);
        }
      }
    });

    // 3. Connect WebSocket
    wsClient.connect();

    // 4. Initial HTTP Poll
    fetchInitialData();

    return () => {
      unsubscribeStatus();
      unsubscribeMsg();
      wsClient.disconnect();
    };
  }, [activeSymbol]);

  const fetchInitialData = async () => {
    try {
      const data = await api.fetchCandidates();
      if (data.candidates) setCandidates(data.candidates);
      if (data.macro) setMacro(data.macro);
    } catch (e) {
      // Offline fallback
    }

    try {
      const p = await api.fetchPortfolio();
      if (p.equityUsdt) setEquityUsdt(p.equityUsdt);
    } catch (e) {}

    try {
      const t = await api.fetchTrades();
      if (t.trades) setTrades(t.trades);
    } catch (e) {}
  };

  const handleSelectSymbol = (symbol: string) => {
    setActiveSymbol(symbol);
    setActiveTab('PREDICTIONS');
    runPredictionsForSymbol(symbol, correlationMode);
  };

  const runPredictionsForSymbol = async (symbol: string, mode: CorrelationMode) => {
    setPredictingLoading(true);
    try {
      const res = await api.fetchDualPredictions(symbol, mode);
      if (res.success) {
        setLongPrediction(res.longPrediction);
        setShortPrediction(res.shortPrediction);
      }
    } catch (err: any) {
      Alert.alert('Prediction Error', err.message || 'Failed to fetch predictions.');
    } finally {
      setPredictingLoading(false);
    }
  };

  const handleSimulateTrade = async (direction: 'LONG' | 'SHORT') => {
    const targetPrediction = direction === 'LONG' ? longPrediction : shortPrediction;
    if (!targetPrediction) {
      Alert.alert('Notice', 'Please run live predictions first.');
      return;
    }

    try {
      const res = await api.executePaperTrade({
        symbol: targetPrediction.symbol,
        direction,
        entryPrice: targetPrediction.entryPrice,
        stopLoss: targetPrediction.stopLoss,
        tp1: targetPrediction.tp1,
        tp2: targetPrediction.tp2,
        notionalUsdt: targetPrediction.recommendedNotionalUsdt,
        maxSafeLeverage: targetPrediction.recommendedLeverage,
        riskRewardRatio: targetPrediction.riskRewardRatio,
        stopDistancePct: targetPrediction.stopDistancePct,
      });

      if (res.success) {
        Alert.alert(
          '100% Read-Only Simulation Active',
          `Simulated ${direction} position for ${targetPrediction.symbol} created!\nLive trailing order tracking active.`
        );
        const t = await api.fetchTrades();
        if (t.trades) setTrades(t.trades);
        setActiveTab('POSITIONS');
      } else {
        Alert.alert('Simulation Notice', res.message || 'Order could not be simulated.');
      }
    } catch (err: any) {
      Alert.alert('Simulation Error', err.message);
    }
  };

  const handleMoveBreakeven = async (symbol: string) => {
    try {
      await api.moveStopToBreakeven(symbol);
      Alert.alert('Trailing Stop', `Stop loss moved to Breakeven for ${symbol}`);
      const t = await api.fetchTrades();
      if (t.trades) setTrades(t.trades);
    } catch (err: any) {
      Alert.alert('Error', err.message);
    }
  };

  const handlePanicClose = async (symbol: string) => {
    try {
      await api.panicClosePosition(symbol);
      Alert.alert('Closed', `Simulated position closed for ${symbol}`);
      const t = await api.fetchTrades();
      if (t.trades) setTrades(t.trades);
    } catch (err: any) {
      Alert.alert('Error', err.message);
    }
  };

  const btcPrice = macro?.btcPrice || 0;
  const btcChange = macro?.btcChange15mPct || 0;

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="#080c14" />

        {/* 1. TOP INSTITUTIONAL HEADER BAR */}
        <View style={styles.topHeader}>
          <View style={styles.brandRow}>
            <Text style={styles.brandText}>
              QUANTUM<Text style={{ color: '#3b82f6' }}>EDGE</Text>
            </Text>
            <View style={styles.mobilePill}>
              <Text style={styles.mobilePillText}>MOBILE</Text>
            </View>
          </View>

          {/* Right Header Status Telemetry */}
          <View style={styles.headerRight}>
            {/* BTC Macro Pill */}
            {btcPrice > 0 && (
              <View style={styles.btcPill}>
                <Text style={styles.btcPriceText}>${formatCryptoPrice(btcPrice)}</Text>
                <Text style={[styles.btcChangeText, { color: btcChange >= 0 ? '#34d399' : '#fb7185' }]}>
                  {btcChange >= 0 ? '+' : ''}{btcChange.toFixed(1)}%
                </Text>
              </View>
            )}

            {/* WS Status Dot */}
            <View style={styles.wsPill}>
              <View style={[styles.wsDot, { backgroundColor: wsConnected ? '#10b981' : '#f43f5e' }]} />
              <Text style={styles.wsText}>{wsConnected ? 'LIVE' : 'OFFLINE'}</Text>
            </View>

            {/* Settings Button */}
            <TouchableOpacity onPress={() => setSettingsVisible(true)} style={styles.settingsBtn}>
              <Text style={styles.settingsIcon}>⚙️</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* 2. MAIN NAVIGATION TAB BAR */}
        <View style={styles.navBar}>
          <TouchableOpacity
            onPress={() => setActiveTab('RADAR')}
            style={[styles.navTab, activeTab === 'RADAR' && styles.navTabActive]}
          >
            <Text style={[styles.navTabText, activeTab === 'RADAR' && styles.navTabTextActive]}>
              📡 Squeeze Radar
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => setActiveTab('PREDICTIONS')}
            style={[styles.navTab, activeTab === 'PREDICTIONS' && styles.navTabActive]}
          >
            <Text style={[styles.navTabText, activeTab === 'PREDICTIONS' && styles.navTabTextActive]}>
              ⚡ Dual Predictions
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => setActiveTab('POSITIONS')}
            style={[styles.navTab, activeTab === 'POSITIONS' && styles.navTabActive]}
          >
            <Text style={[styles.navTabText, activeTab === 'POSITIONS' && styles.navTabTextActive]}>
              🛡️ Positions ({trades.filter((t) => t.status === 'ACTIVE').length})
            </Text>
          </TouchableOpacity>
        </View>

        {/* 3. TAB CONTENT */}
        <View style={styles.content}>
          {/* TAB 1: SQUEEZE RADAR */}
          {activeTab === 'RADAR' && (
            <SqueezeRadar
              candidates={candidates}
              activeSymbol={activeSymbol}
              onSelectSymbol={handleSelectSymbol}
              onRefresh={fetchInitialData}
              refreshing={refreshingRadar}
            />
          )}

          {/* TAB 2: DUAL PREDICTIONS */}
          {activeTab === 'PREDICTIONS' && (
            <ScrollView style={styles.predictionScroll} contentContainerStyle={styles.predictionContent}>
              {/* Active Symbol & Controls Strip */}
              <View style={styles.symbolControlStrip}>
                <View style={styles.symbolInfo}>
                  <Text style={styles.activeSymbolTitle}>{activeSymbol || 'Select a Coin'}</Text>
                  <Text style={styles.assetEquityText}>Asset: {equityUsdt > 0 ? `$${equityUsdt.toLocaleString()} USDT` : '-- USDT'}</Text>
                </View>

                {/* Strategy Mode Toggle Button */}
                <TouchableOpacity
                  onPress={() => {
                    const newMode = correlationMode === 'STANDALONE_ALPHA' ? 'BTC_COUPLED' : 'STANDALONE_ALPHA';
                    setCorrelationMode(newMode);
                    runPredictionsForSymbol(activeSymbol, newMode);
                  }}
                  style={styles.modeToggleBtn}
                >
                  <Text style={styles.modeToggleText}>
                    {correlationMode === 'STANDALONE_ALPHA' ? '⚡ Standalone' : '🔗 BTC-Coupled'}
                  </Text>
                </TouchableOpacity>

                {/* Run Predictions Action Button */}
                <TouchableOpacity
                  onPress={() => runPredictionsForSymbol(activeSymbol, correlationMode)}
                  disabled={predictingLoading}
                  style={styles.runPredictionsBtn}
                >
                  <Text style={styles.runPredictionsBtnText}>
                    {predictingLoading ? '⏳...' : '⚡ Predict'}
                  </Text>
                </TouchableOpacity>
              </View>

              {/* View Switcher: Long / Short / Both */}
              <View style={styles.viewSwitcher}>
                <TouchableOpacity
                  onPress={() => setDirectionViewMode('LONG')}
                  style={[styles.switcherTab, directionViewMode === 'LONG' && styles.switcherTabLong]}
                >
                  <Text style={[styles.switcherText, directionViewMode === 'LONG' && styles.switcherTextLong]}>
                    🟢 Long Signal
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => setDirectionViewMode('SHORT')}
                  style={[styles.switcherTab, directionViewMode === 'SHORT' && styles.switcherTabShort]}
                >
                  <Text style={[styles.switcherText, directionViewMode === 'SHORT' && styles.switcherTextShort]}>
                    🔴 Short Signal
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => setDirectionViewMode('BOTH')}
                  style={[styles.switcherTab, directionViewMode === 'BOTH' && styles.switcherTabBoth]}
                >
                  <Text style={[styles.switcherText, directionViewMode === 'BOTH' && styles.switcherTextBoth]}>
                    ⚡ Both Views
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Prediction Cards */}
              {(directionViewMode === 'LONG' || directionViewMode === 'BOTH') && (
                <LongPredictionCard
                  prediction={longPrediction}
                  onSimulate={() => handleSimulateTrade('LONG')}
                  loading={predictingLoading}
                />
              )}

              {(directionViewMode === 'SHORT' || directionViewMode === 'BOTH') && (
                <ShortPredictionCard
                  prediction={shortPrediction}
                  onSimulate={() => handleSimulateTrade('SHORT')}
                  loading={predictingLoading}
                />
              )}
            </ScrollView>
          )}

          {/* TAB 3: POSITIONS */}
          {activeTab === 'POSITIONS' && (
            <PositionsList
              trades={trades}
              onRefresh={async () => {
                setRefreshingTrades(true);
                const t = await api.fetchTrades();
                if (t.trades) setTrades(t.trades);
                setRefreshingTrades(false);
              }}
              refreshing={refreshingTrades}
              onMoveBreakeven={handleMoveBreakeven}
              onPanicClose={handlePanicClose}
            />
          )}
        </View>

        {/* Settings Modal */}
        <SettingsModal
          visible={settingsVisible}
          onClose={() => setSettingsVisible(false)}
        />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#080c14',
  },
  topHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
    backgroundColor: '#0f172a',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  brandText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#ffffff',
    fontFamily: 'monospace',
    letterSpacing: -0.5,
  },
  mobilePill: {
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.4)',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
  },
  mobilePillText: {
    color: '#60a5fa',
    fontSize: 9,
    fontFamily: 'monospace',
    fontWeight: 'bold',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  btcPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(6, 78, 59, 0.4)',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  btcPriceText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#e2e8f0',
    fontFamily: 'monospace',
  },
  btcChangeText: {
    fontSize: 10,
    fontFamily: 'monospace',
    fontWeight: 'bold',
  },
  wsPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#1e293b',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
  },
  wsDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  wsText: {
    fontSize: 9,
    fontFamily: 'monospace',
    color: '#94a3b8',
    fontWeight: 'bold',
  },
  settingsBtn: {
    padding: 3,
  },
  settingsIcon: {
    fontSize: 15,
  },
  navBar: {
    flexDirection: 'row',
    backgroundColor: '#0b1120',
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  navTab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  navTabActive: {
    borderBottomColor: '#3b82f6',
    backgroundColor: 'rgba(59, 130, 246, 0.08)',
  },
  navTabText: {
    fontSize: 11,
    fontFamily: 'monospace',
    fontWeight: 'bold',
    color: '#64748b',
  },
  navTabTextActive: {
    color: '#60a5fa',
  },
  content: {
    flex: 1,
  },
  predictionScroll: {
    flex: 1,
  },
  predictionContent: {
    padding: 12,
    gap: 12,
  },
  symbolControlStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#1e293b',
    borderRadius: 10,
    padding: 10,
  },
  symbolInfo: {
    flex: 1,
  },
  activeSymbolTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#ffffff',
    fontFamily: 'monospace',
  },
  assetEquityText: {
    fontSize: 10,
    color: '#64748b',
    fontFamily: 'monospace',
    marginTop: 1,
  },
  modeToggleBtn: {
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
    marginRight: 6,
  },
  modeToggleText: {
    fontSize: 10,
    color: '#38bdf8',
    fontFamily: 'monospace',
    fontWeight: 'bold',
  },
  runPredictionsBtn: {
    backgroundColor: '#2563eb',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  runPredictionsBtnText: {
    fontSize: 11,
    color: '#ffffff',
    fontFamily: 'monospace',
    fontWeight: 'bold',
  },
  viewSwitcher: {
    flexDirection: 'row',
    backgroundColor: '#0f172a',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1e293b',
    padding: 3,
  },
  switcherTab: {
    flex: 1,
    paddingVertical: 6,
    alignItems: 'center',
    borderRadius: 6,
  },
  switcherTabLong: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
  },
  switcherTabShort: {
    backgroundColor: 'rgba(244, 63, 94, 0.2)',
  },
  switcherTabBoth: {
    backgroundColor: 'rgba(139, 92, 246, 0.2)',
  },
  switcherText: {
    fontSize: 10,
    fontFamily: 'monospace',
    fontWeight: 'bold',
    color: '#64748b',
  },
  switcherTextLong: {
    color: '#34d399',
  },
  switcherTextShort: {
    color: '#fb7185',
  },
  switcherTextBoth: {
    color: '#c084fc',
  },
});

