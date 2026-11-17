import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  RefreshControl,
  StyleSheet,
} from 'react-native';
import { CandidateCoin, formatCryptoPrice } from '../types';

interface SqueezeRadarProps {
  candidates: CandidateCoin[];
  activeSymbol: string;
  onSelectSymbol: (symbol: string) => void;
  onRefresh: () => void;
  refreshing: boolean;
}

export const SqueezeRadar: React.FC<SqueezeRadarProps> = ({
  candidates,
  activeSymbol,
  onSelectSymbol,
  onRefresh,
  refreshing,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [aplusOnly, setAplusOnly] = useState(false);

  // Filter candidates based on search and A+ toggle
  const filteredCandidates = candidates.filter((c) => {
    const matchesSearch = c.symbol.toLowerCase().includes(searchQuery.toLowerCase().trim());
    if (!matchesSearch) return false;
    if (aplusOnly) {
      return c.isTradeableAplus || Math.abs(c.confluenceScore || 0) >= 45;
    }
    return true;
  });

  const renderCandidateCard = ({ item }: { item: CandidateCoin }) => {
    const isSelected = item.symbol === activeSymbol;
    const score = item.squeezeVelocityScore ?? 50;
    const scoreColor = score >= 75 ? '#c084fc' : score >= 50 ? '#34d399' : '#94a3b8';
    const scoreBg = score >= 75 ? 'rgba(88, 28, 135, 0.5)' : score >= 50 ? 'rgba(6, 78, 59, 0.5)' : '#1e293b';

    const p15 = Number(item.priceChange15mPct) || 0;
    const oi = Number(item.openInterest15mDeltaPct) || 0;
    const price = Number(item.price) || 0;

    const regime = (item.regime || 'NEUTRAL').replace(/_/g, ' ');

    return (
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => onSelectSymbol(item.symbol)}
        style={[
          styles.card,
          isSelected && styles.cardSelected,
        ]}
      >
        <View style={styles.cardHeader}>
          <View style={styles.symbolRow}>
            <Text style={styles.symbolText}>{item.symbol}</Text>
            {item.isTradeableAplus && (
              <View style={styles.aplusBadge}>
                <Text style={styles.aplusText}>🎯 A+</Text>
              </View>
            )}
            <View style={styles.regimeBadge}>
              <Text style={styles.regimeText} numberOfLines={1}>{regime}</Text>
            </View>
          </View>

          <View style={[styles.scoreBadge, { backgroundColor: scoreBg }]}>
            <Text style={[styles.scoreText, { color: scoreColor }]}>{score}</Text>
          </View>
        </View>

        <View style={styles.cardMetrics}>
          <Text style={styles.priceText}>${formatCryptoPrice(price)}</Text>
          <Text style={[styles.changeText, { color: p15 >= 0 ? '#34d399' : '#fb7185' }]}>
            {p15 >= 0 ? '+' : ''}{p15.toFixed(2)}%
          </Text>
          <Text style={[styles.oiText, { color: oi >= 0 ? '#34d399' : '#fb7185' }]}>
            ΔOI: {oi >= 0 ? '+' : ''}{oi.toFixed(1)}%
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      {/* Search & Filter Header */}
      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search coin (e.g. SOL, BTC, PEPE)..."
          placeholderTextColor="#64748b"
          value={searchQuery}
          onChangeText={setSearchQuery}
          autoCapitalize="characters"
          autoCorrect={false}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')} style={styles.clearBtn}>
            <Text style={styles.clearText}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Radar Controls Strip */}
      <View style={styles.controlsRow}>
        <View style={styles.titleRow}>
          <View style={styles.liveIndicator} />
          <Text style={styles.controlsTitle}>TOP SQUEEZE RADAR</Text>
          <Text style={styles.countText}>({filteredCandidates.length})</Text>
        </View>

        <TouchableOpacity
          onPress={() => setAplusOnly(!aplusOnly)}
          style={[styles.filterToggle, aplusOnly && styles.filterToggleActive]}
        >
          <Text style={[styles.filterToggleText, aplusOnly && styles.filterToggleTextActive]}>
            🎯 A+ Only: {aplusOnly ? 'ON' : 'OFF'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Candidates List */}
      <FlatList
        data={filteredCandidates}
        keyExtractor={(item) => item.symbol}
        renderItem={renderCandidateCard}
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
            <Text style={styles.emptyText}>
              {aplusOnly ? 'No A+ candidates meeting criteria.' : 'Scanning candidate universe...'}
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
  searchContainer: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 6,
    position: 'relative',
  },
  searchInput: {
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#1e293b',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
    color: '#f8fafc',
    fontFamily: 'monospace',
  },
  clearBtn: {
    position: 'absolute',
    right: 22,
    top: 18,
  },
  clearText: {
    color: '#94a3b8',
    fontSize: 14,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'between',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
    backgroundColor: '#0b1120',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  liveIndicator: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#3b82f6',
  },
  controlsTitle: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#cbd5e1',
    fontFamily: 'monospace',
  },
  countText: {
    fontSize: 10,
    color: '#64748b',
    fontFamily: 'monospace',
  },
  filterToggle: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#1e293b',
  },
  filterToggleActive: {
    backgroundColor: '#581c87',
    borderColor: '#a855f7',
  },
  filterToggleText: {
    fontSize: 10,
    color: '#94a3b8',
    fontFamily: 'monospace',
    fontWeight: 'bold',
  },
  filterToggleTextActive: {
    color: '#e9d5ff',
  },
  listContent: {
    padding: 10,
    gap: 8,
  },
  card: {
    backgroundColor: 'rgba(19, 30, 54, 0.6)',
    borderWidth: 1,
    borderColor: 'rgba(30, 41, 59, 0.8)',
    borderRadius: 10,
    padding: 10,
  },
  cardSelected: {
    borderColor: '#3b82f6',
    backgroundColor: 'rgba(30, 58, 138, 0.25)',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  symbolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  symbolText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#ffffff',
    fontFamily: 'monospace',
  },
  aplusBadge: {
    backgroundColor: 'rgba(88, 28, 135, 0.8)',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(168, 85, 247, 0.5)',
  },
  aplusText: {
    fontSize: 9,
    color: '#d8b4fe',
    fontWeight: 'bold',
    fontFamily: 'monospace',
  },
  regimeBadge: {
    backgroundColor: '#1e293b',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    maxWidth: 110,
  },
  regimeText: {
    fontSize: 9,
    color: '#94a3b8',
    fontWeight: 'bold',
    fontFamily: 'monospace',
  },
  scoreBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  scoreText: {
    fontSize: 11,
    fontWeight: 'bold',
    fontFamily: 'monospace',
  },
  cardMetrics: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  priceText: {
    fontSize: 12,
    color: '#e2e8f0',
    fontFamily: 'monospace',
    fontWeight: 'bold',
  },
  changeText: {
    fontSize: 11,
    fontFamily: 'monospace',
    fontWeight: 'bold',
  },
  oiText: {
    fontSize: 11,
    fontFamily: 'monospace',
  },
  emptyContainer: {
    padding: 30,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 12,
    color: '#64748b',
    fontFamily: 'monospace',
    textAlign: 'center',
  },
});

