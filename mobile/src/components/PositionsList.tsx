import React from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  StyleSheet,
  Alert,
} from 'react-native';
import { PaperTrade, formatCryptoPrice } from '../types';

interface PositionsListProps {
  trades: PaperTrade[];
  onRefresh: () => void;
  refreshing: boolean;
  onMoveBreakeven: (symbol: string) => void;
  onPanicClose: (symbol: string) => void;
}

export const PositionsList: React.FC<PositionsListProps> = ({
  trades,
  onRefresh,
  refreshing,
  onMoveBreakeven,
  onPanicClose,
}) => {
  const activeTrades = trades.filter((t) => t.status === 'ACTIVE' || t.status === 'PENDING_FILL');

  const confirmPanicClose = (symbol: string) => {
    Alert.alert(
      'Emergency Market Close',
      `Close simulated paper trade for ${symbol} immediately?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Close Position', style: 'destructive', onPress: () => onPanicClose(symbol) },
      ]
    );
  };

  const renderTradeItem = ({ item }: { item: PaperTrade }) => {
    const isLong = item.direction === 'LONG';
    const entryPrice = Number(item.entryPrice || 0);
    const currentMark = Number(item.currentMarkPrice ?? item.currentPrice ?? entryPrice);
    const stop = Number(item.trailingStopPrice ?? item.stopLoss ?? 0);
    const rawDiff = isLong ? currentMark - entryPrice : entryPrice - currentMark;
    const computedPct = entryPrice > 0 ? (rawDiff / entryPrice) * 100 : 0;
    const pnlPct = Number(item.unrealizedPnlPct ?? computedPct);
    const pnlUsdt = Number(item.unrealizedPnlUsdt ?? item.unrealizedPnL ?? 0);
    const isProfit = pnlPct >= 0;
    const pnlColor = isProfit ? '#34d399' : '#fb7185';
    const sign = isProfit ? '+' : '';

    return (
      <View style={styles.tradeCard}>
        {/* Top Row: Symbol, Direction, Status */}
        <View style={styles.cardHeader}>
          <View style={styles.headerLeft}>
            <Text style={styles.symbolText}>{item.symbol}</Text>
            <View style={[styles.dirBadge, isLong ? styles.dirLong : styles.dirShort]}>
              <Text style={[styles.dirText, isLong ? styles.dirTextLong : styles.dirTextShort]}>
                {item.direction}
              </Text>
            </View>
          </View>

          <View style={styles.pnlContainer}>
            <Text style={[styles.pnlPct, { color: pnlColor }]}>
              {sign}{pnlPct.toFixed(2)}%
            </Text>
            <Text style={[styles.pnlUsdt, { color: pnlColor }]}>
              ({sign}${pnlUsdt.toFixed(2)})
            </Text>
          </View>
        </View>

        {/* Middle Row: Entry, Mark, SL, Targets */}
        <View style={styles.metricsGrid}>
          <View style={styles.metricItem}>
            <Text style={styles.metricLabel}>ENTRY</Text>
            <Text style={styles.metricVal}>${formatCryptoPrice(item.entryPrice)}</Text>
          </View>
          <View style={styles.metricItem}>
            <Text style={styles.metricLabel}>CURRENT</Text>
            <Text style={[styles.metricVal, { color: '#ffffff' }]}>${formatCryptoPrice(currentMark)}</Text>
          </View>
          <View style={styles.metricItem}>
            <Text style={[styles.metricLabel, { color: '#fb7185' }]}>TRAILING SL</Text>
            <Text style={[styles.metricVal, { color: '#fb7185' }]}>${formatCryptoPrice(stop)}</Text>
          </View>
          <View style={styles.metricItem}>
            <Text style={[styles.metricLabel, { color: '#34d399' }]}>TARGETS</Text>
            <Text style={[styles.metricVal, { color: '#34d399' }]} numberOfLines={1}>
              ${formatCryptoPrice(item.tp1)}
            </Text>
          </View>
        </View>

        {/* Action Buttons */}
        <View style={styles.actionsRow}>
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => onMoveBreakeven(item.symbol)}
            style={styles.beBtn}
          >
            <Text style={styles.beBtnText}>SL ➔ Breakeven</Text>
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => confirmPanicClose(item.symbol)}
            style={styles.closeBtn}
          >
            <Text style={styles.closeBtnText}>Panic Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <FlatList
        data={activeTrades}
        keyExtractor={(item, index) => item.id || item.tradeId || `${item.symbol}_${index}`}
        renderItem={renderTradeItem}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#60a5fa"
            colors={['#60a5fa']}
          />
        }
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyTitle}>No Active Paper Trades</Text>
            <Text style={styles.emptySubtitle}>
              Select a coin from the Radar and tap "Simulate Paper Long / Short" to track real-time trailing stops.
            </Text>
          </View>
        }
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#080c14',
  },
  listContent: {
    padding: 12,
    gap: 10,
  },
  tradeCard: {
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#1e293b',
    borderRadius: 12,
    padding: 12,
    gap: 10,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
    paddingBottom: 8,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  symbolText: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#ffffff',
    fontFamily: 'monospace',
  },
  dirBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
  },
  dirLong: {
    backgroundColor: 'rgba(6, 78, 59, 0.5)',
    borderColor: '#10b981',
  },
  dirShort: {
    backgroundColor: 'rgba(159, 18, 57, 0.5)',
    borderColor: '#f43f5e',
  },
  dirText: {
    fontSize: 10,
    fontWeight: 'bold',
    fontFamily: 'monospace',
  },
  dirTextLong: {
    color: '#34d399',
  },
  dirTextShort: {
    color: '#fb7185',
  },
  pnlContainer: {
    alignItems: 'flex-end',
  },
  pnlPct: {
    fontSize: 14,
    fontWeight: 'bold',
    fontFamily: 'monospace',
  },
  pnlUsdt: {
    fontSize: 10,
    fontFamily: 'monospace',
  },
  metricsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#080c14',
    padding: 8,
    borderRadius: 8,
  },
  metricItem: {
    alignItems: 'center',
  },
  metricLabel: {
    fontSize: 9,
    color: '#64748b',
    fontFamily: 'monospace',
    fontWeight: 'bold',
  },
  metricVal: {
    fontSize: 11,
    color: '#cbd5e1',
    fontFamily: 'monospace',
    marginTop: 2,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  beBtn: {
    flex: 1,
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#d97706',
    borderRadius: 6,
    paddingVertical: 7,
    alignItems: 'center',
  },
  beBtnText: {
    color: '#fbbf24',
    fontSize: 11,
    fontWeight: 'bold',
    fontFamily: 'monospace',
  },
  closeBtn: {
    flex: 1,
    backgroundColor: '#881337',
    borderRadius: 6,
    paddingVertical: 7,
    alignItems: 'center',
  },
  closeBtnText: {
    color: '#fecdd3',
    fontSize: 11,
    fontWeight: 'bold',
    fontFamily: 'monospace',
  },
  emptyContainer: {
    padding: 36,
    alignItems: 'center',
    gap: 8,
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#cbd5e1',
    fontFamily: 'monospace',
  },
  emptySubtitle: {
    fontSize: 12,
    color: '#64748b',
    fontFamily: 'monospace',
    textAlign: 'center',
    lineHeight: 18,
  },
});

