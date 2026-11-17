import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { TradePrediction, formatCryptoPrice } from '../types';

interface LongPredictionCardProps {
  prediction: TradePrediction | null;
  onSimulate: () => void;
  loading?: boolean;
}

export const LongPredictionCard: React.FC<LongPredictionCardProps> = ({
  prediction,
  onSimulate,
  loading,
}) => {
  if (loading) {
    return (
      <View style={[styles.card, styles.loadingCard]}>
        <Text style={styles.loadingText}>Computing Long Structural Breakout Traps...</Text>
      </View>
    );
  }

  if (!prediction) {
    return (
      <View style={[styles.card, styles.emptyCard]}>
        <Text style={styles.emptyText}>Tap "Run Predictions" to generate Long setup</Text>
      </View>
    );
  }

  const p = prediction;
  const liveMark = Number(p.liveMarkPrice) || 0;
  const entry = Number(p.entryPrice) || 0;
  const tp1 = Number(p.tp1) || 0;
  const tp2 = Number(p.tp2) || 0;
  const sl = Number(p.stopLoss) || 0;
  const cvd = p.microCvd5m || 0;
  const liq = p.shortLiqPool50x || 0;

  return (
    <View style={styles.card}>
      {/* Header Strip */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.longBadge}>
            <Text style={styles.longBadgeText}>🟢 LONG</Text>
          </View>
          <Text style={styles.symbolText}>{p.symbol}</Text>
          <View style={styles.regimeBadge}>
            <Text style={styles.regimeText} numberOfLines={1}>
              {(p.regime || 'MOMENTUM SCALP').replace(/_/g, ' ')}
            </Text>
          </View>
        </View>

        <View style={styles.headerRight}>
          <View style={styles.winProbBadge}>
            <Text style={styles.winProbText}>{p.winProbabilityPct}% WIN</Text>
          </View>
          <View style={styles.rrBadge}>
            <Text style={styles.rrText}>RR 1:{p.riskRewardRatio}</Text>
          </View>
        </View>
      </View>

      {/* Conviction Meter */}
      <View style={styles.convictionBox}>
        <View style={styles.convictionHeader}>
          <Text style={styles.convictionLabel}>AI LONG CONVICTION:</Text>
          <Text style={styles.convictionScore}>{p.confidenceScore}%</Text>
        </View>
        <View style={styles.progressBarTrack}>
          <View
            style={[
              styles.progressBarFill,
              { width: `${Math.min(100, Math.max(10, p.confidenceScore))}%` },
            ]}
          />
        </View>
      </View>

      {/* Price Grid */}
      <View style={styles.priceGrid}>
        <View style={styles.priceBox}>
          <Text style={styles.priceLabel}>LIVE MARK</Text>
          <Text style={styles.priceValue} numberOfLines={1}>
            ${formatCryptoPrice(liveMark, liveMark)}
          </Text>
        </View>

        <View style={[styles.priceBox, styles.priceBoxEntry]}>
          <Text style={[styles.priceLabel, { color: '#60a5fa' }]}>SWING ENTRY</Text>
          <Text style={[styles.priceValue, { color: '#93c5fd' }]} numberOfLines={1}>
            ${formatCryptoPrice(entry, entry)}
          </Text>
        </View>

        <View style={[styles.priceBox, styles.priceBoxTp]}>
          <View style={styles.tpHeader}>
            <Text style={[styles.priceLabel, { color: '#34d399' }]}>TP1 (50% LOCK)</Text>
            <Text style={styles.tpDistText}>+{p.tp1DistancePct}%</Text>
          </View>
          <Text style={[styles.priceValue, { color: '#34d399' }]} numberOfLines={1}>
            ${formatCryptoPrice(tp1, entry)}
          </Text>
        </View>

        <View style={[styles.priceBox, styles.priceBoxTp]}>
          <View style={styles.tpHeader}>
            <Text style={[styles.priceLabel, { color: '#34d399' }]}>TP2 (RUNNER)</Text>
            <Text style={styles.tpDistText}>+{p.tp2DistancePct}%</Text>
          </View>
          <Text style={[styles.priceValue, { color: '#34d399' }]} numberOfLines={1}>
            ${formatCryptoPrice(tp2, entry)}
          </Text>
        </View>

        <View style={[styles.priceBox, styles.slBox]}>
          <View>
            <Text style={[styles.priceLabel, { color: '#fb7185' }]}>STRUCTURAL STOP LOSS</Text>
            <Text style={[styles.priceValue, { color: '#fb7185' }]} numberOfLines={1}>
              ${formatCryptoPrice(sl, entry)}
            </Text>
          </View>
          <View style={styles.slRight}>
            <Text style={styles.priceLabel}>STOP DIST</Text>
            <Text style={styles.slDistText}>-{p.stopDistancePct}%</Text>
          </View>
        </View>
      </View>

      {/* MTF & Order Flow Confluence */}
      <View style={styles.mtfRow}>
        <View style={styles.mtfCol}>
          <Text style={styles.mtfLabel}>1H TREND: <Text style={styles.mtfValueBull}>{p.htfTrend || 'BULLISH'}</Text></Text>
          <Text style={styles.mtfLabel}>5m CVD: <Text style={styles.mtfValueBull}>{cvd >= 0 ? '+' : ''}${(cvd / 1000).toFixed(1)}k</Text></Text>
        </View>
        <View style={styles.mtfCol}>
          <Text style={styles.mtfLabel} numberOfLines={1}>ABSORPTION: <Text style={styles.mtfValuePurple}>{(p.priceCvdDivergence || 'NONE').replace(/_/g, ' ')}</Text></Text>
          <Text style={styles.mtfLabel} numberOfLines={1}>50x LIQ: <Text style={styles.mtfValueGold}>${formatCryptoPrice(liq, entry)}</Text></Text>
        </View>
      </View>

      {/* Sizing Advisory */}
      <View style={styles.sizingBox}>
        <View style={styles.sizingRow}>
          <Text style={styles.sizingLabel}>Volatility Sizing:</Text>
          <Text style={styles.sizingValue}>${Number(p.recommendedNotionalUsdt || 0).toLocaleString()} USDT</Text>
        </View>
        <View style={styles.sizingRow}>
          <Text style={styles.sizingLabel}>Safe Leverage:</Text>
          <Text style={[styles.sizingValue, { color: '#f59e0b' }]}>{p.recommendedLeverage}x (Capped)</Text>
        </View>
      </View>

      {/* Forecast & Thesis Box */}
      {p.predictionSummary && (
        <View style={styles.thesisBox}>
          <Text style={styles.thesisTitle}>🤖 AI LONG THESIS</Text>
          <Text style={styles.thesisBody}>{p.predictionSummary.priceActionForecast}</Text>
          {p.predictionSummary.invalidationTrigger && (
            <Text style={styles.invalidationText}>{p.predictionSummary.invalidationTrigger}</Text>
          )}
        </View>
      )}

      {/* Simulation Button */}
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={onSimulate}
        style={styles.simulateBtn}
      >
        <Text style={styles.simulateBtnText}>⚡ Simulate Paper Long Trade</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#0f172a',
    borderWidth: 1.5,
    borderColor: 'rgba(16, 185, 129, 0.4)',
    borderRadius: 14,
    padding: 12,
    gap: 10,
  },
  loadingCard: {
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: '#34d399',
    fontFamily: 'monospace',
    fontSize: 12,
  },
  emptyCard: {
    padding: 24,
    alignItems: 'center',
  },
  emptyText: {
    color: '#64748b',
    fontFamily: 'monospace',
    fontSize: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(16, 185, 129, 0.25)',
    paddingBottom: 8,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  longBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.5)',
  },
  longBadgeText: {
    color: '#34d399',
    fontSize: 11,
    fontWeight: 'bold',
    fontFamily: 'monospace',
  },
  symbolText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 'bold',
    fontFamily: 'monospace',
  },
  regimeBadge: {
    backgroundColor: '#1e1b4b',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
    maxWidth: 90,
  },
  regimeText: {
    color: '#c084fc',
    fontSize: 9,
    fontFamily: 'monospace',
    fontWeight: 'bold',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  winProbBadge: {
    backgroundColor: 'rgba(6, 78, 59, 0.8)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  winProbText: {
    color: '#6ee7b7',
    fontSize: 10,
    fontFamily: 'monospace',
    fontWeight: 'bold',
  },
  rrBadge: {
    backgroundColor: '#131e36',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  rrText: {
    color: '#6ee7b7',
    fontSize: 10,
    fontFamily: 'monospace',
    fontWeight: 'bold',
  },
  convictionBox: {
    backgroundColor: '#080c14',
    padding: 8,
    borderRadius: 8,
    gap: 4,
  },
  convictionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  convictionLabel: {
    fontSize: 10,
    color: '#94a3b8',
    fontFamily: 'monospace',
  },
  convictionScore: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#34d399',
    fontFamily: 'monospace',
  },
  progressBarTrack: {
    height: 6,
    backgroundColor: '#1e293b',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#10b981',
    borderRadius: 3,
  },
  priceGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  priceBox: {
    flex: 1,
    minWidth: '47%',
    backgroundColor: '#080c14',
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  priceBoxEntry: {
    borderColor: 'rgba(59, 130, 246, 0.3)',
  },
  priceBoxTp: {
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  tpHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  tpDistText: {
    fontSize: 9,
    color: '#34d399',
    fontWeight: 'bold',
    fontFamily: 'monospace',
  },
  slBox: {
    minWidth: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderColor: 'rgba(244, 63, 94, 0.3)',
  },
  slRight: {
    alignItems: 'flex-end',
  },
  slDistText: {
    fontSize: 11,
    color: '#fb7185',
    fontWeight: 'bold',
    fontFamily: 'monospace',
  },
  priceLabel: {
    fontSize: 9,
    color: '#64748b',
    fontFamily: 'monospace',
    fontWeight: 'bold',
  },
  priceValue: {
    fontSize: 13,
    color: '#ffffff',
    fontFamily: 'monospace',
    fontWeight: 'bold',
    marginTop: 2,
  },
  mtfRow: {
    flexDirection: 'row',
    backgroundColor: '#080c14',
    padding: 8,
    borderRadius: 8,
    justifyContent: 'space-between',
  },
  mtfCol: {
    gap: 3,
    flex: 1,
  },
  mtfLabel: {
    fontSize: 10,
    color: '#94a3b8',
    fontFamily: 'monospace',
  },
  mtfValueBull: {
    color: '#34d399',
    fontWeight: 'bold',
  },
  mtfValuePurple: {
    color: '#c084fc',
    fontWeight: 'bold',
  },
  mtfValueGold: {
    color: '#fbbf24',
    fontWeight: 'bold',
  },
  sizingBox: {
    backgroundColor: 'rgba(15, 23, 42, 0.9)',
    borderWidth: 1,
    borderColor: '#1e293b',
    borderRadius: 8,
    padding: 8,
    gap: 3,
  },
  sizingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sizingLabel: {
    fontSize: 10,
    color: '#94a3b8',
    fontFamily: 'monospace',
  },
  sizingValue: {
    fontSize: 11,
    color: '#ffffff',
    fontWeight: 'bold',
    fontFamily: 'monospace',
  },
  thesisBox: {
    backgroundColor: '#080c14',
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.25)',
    gap: 4,
  },
  thesisTitle: {
    fontSize: 10,
    color: '#34d399',
    fontWeight: 'bold',
    fontFamily: 'monospace',
  },
  thesisBody: {
    fontSize: 11,
    color: '#e2e8f0',
    fontFamily: 'monospace',
    lineHeight: 15,
  },
  invalidationText: {
    fontSize: 10,
    color: '#f87171',
    fontFamily: 'monospace',
    backgroundColor: 'rgba(127, 29, 29, 0.25)',
    padding: 4,
    borderRadius: 4,
  },
  simulateBtn: {
    backgroundColor: '#059669',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    shadowColor: '#059669',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  simulateBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 'bold',
    fontFamily: 'monospace',
  },
});

