import Ionicons from '@expo/vector-icons/Ionicons';
import {
  type FinishedTrade,
  formatDateTime,
  formatPrice,
  type InstrumentRow,
  percent,
  type PerformanceReport,
  signedPoints,
} from '@signaldesk/domain';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { DirectionBadge, StatusBadge } from '@/trade';
import { api, queryString } from '@/lib/api';
import { useColors } from '@/theme';
import { radius, space } from '@/theme/tokens';
import { Card, Chip, ChipRow, EmptyState, ErrorState, Loading, Screen, SectionTitle, Stat, T } from '@/ui';

const grid = { flexDirection: 'row', flexWrap: 'wrap', gap: space.lg } as const;

function FinishedRow({ trade }: { trade: FinishedTrade }) {
  const c = useColors();
  const router = useRouter();
  const tone = trade.outcome === 'WIN' ? 'success' : trade.outcome === 'LOSS' ? 'stop' : 'muted';
  return (
    <Pressable
      testID={`finished-${trade.ref}`}
      accessibilityRole="button"
      accessibilityLabel={`${trade.direction} ${trade.symbol}, ${trade.points === null ? 'no result' : `result ${signedPoints(trade.points)}`}`}
      onPress={() => router.push(`/admin/trades/${trade.id}`)}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: c.surface, borderColor: c.line },
        pressed && { opacity: 0.75 },
      ]}
    >
      <View style={styles.line}>
        <DirectionBadge direction={trade.direction} />
        <T v="strong">{trade.symbol}</T>
        <StatusBadge status={trade.status} />
        <View style={{ flexGrow: 1 }} />
        <T v="strong" c={tone} num>
          {trade.points === null ? '–' : signedPoints(trade.points)}
        </T>
      </View>
      <View style={styles.line}>
        <T v="small" c="muted" num>
          {formatPrice(trade, trade.entryLow)}
          {trade.exit ? ` → ${formatPrice(trade, trade.exit)}` : ''}
        </T>
        <View style={{ flexGrow: 1 }} />
        <T v="caption" c="subtle" num>
          {trade.finishedAt ? formatDateTime(trade.finishedAt) : trade.ref}
        </T>
        <Ionicons name="chevron-forward" size={14} color={c.subtle} />
      </View>
    </Pressable>
  );
}

/** One report, as on the website: the signals, how they finished, and every finished trade. */
export default function Performance() {
  const [symbol, setSymbol] = useState('');
  const instruments = useQuery({
    queryKey: ['admin', 'instruments'],
    queryFn: () => api.get<{ instruments: InstrumentRow[] }>('/admin/instruments'),
  });
  const report = useQuery({
    queryKey: ['admin', 'performance', symbol],
    queryFn: () => api.get<PerformanceReport>(`/admin/performance${queryString({ symbol })}`),
    placeholderData: keepPreviousData,
  });
  const refresh = useCallback(() => report.refetch(), [report]);
  const r = report.data;
  const single = r && r.instruments.length === 1 ? r.instruments[0] : undefined;
  return (
    <Screen edges={['bottom']} refresh={refresh} testID="performance">
      <ChipRow>
        <Chip label="All instruments" on={!symbol} onPress={() => setSymbol('')} />
        {instruments.data?.instruments.map((i) => (
          <Chip key={i.id} label={i.symbol} on={symbol === i.symbol} onPress={() => setSymbol(i.symbol)} />
        ))}
      </ChipRow>
      {report.isPending && <Loading rows={3} label="Calculating" />}
      {report.isError && !r && <ErrorState error={report.error} onRetry={() => void report.refetch()} />}
      {r && r.counts.total === 0 && <EmptyState icon="bar-chart-outline" title="No signals yet" />}
      {r && r.counts.total > 0 && (
        <>
          <Card style={grid} testID="performance-counts">
            <Stat label="Total signals" value={r.counts.total} />
            <Stat label="Closed" value={r.counts.closed} />
            <Stat label="Active" value={r.counts.active} />
            <Stat label="Awaiting entry" value={r.counts.awaitingEntry} />
            <Stat label="Cancelled" value={r.counts.cancelled} />
          </Card>
          <Card style={grid} testID="performance-results">
            <Stat
              label="Win rate"
              value={r.results.winRate === null ? '–' : percent(r.results.winRate)}
              hint={`of ${r.results.measured} ${r.results.measured === 1 ? 'result' : 'results'}`}
            />
            <Stat label="Wins" value={r.results.wins} tone={r.results.wins > 0 ? 'success' : undefined} />
            <Stat label="Losses" value={r.results.losses} tone={r.results.losses > 0 ? 'stop' : undefined} />
            <Stat label="Breakeven" value={r.results.breakevens} />
            {single && (
              <>
                <Stat
                  label="Average result"
                  value={single.averagePoints === null ? '–' : signedPoints(single.averagePoints)}
                />
                <Stat label="Running total" value={signedPoints(single.netPoints)} hint={single.symbol} />
              </>
            )}
          </Card>
          {!single && r.instruments.length > 1 && (
            <>
              <SectionTitle>By instrument</SectionTitle>
              <Card style={{ gap: space.sm }}>
                {r.instruments.map((i) => (
                  <Pressable
                    key={i.symbol}
                    accessibilityRole="button"
                    onPress={() => setSymbol(i.symbol)}
                    style={styles.instrument}
                  >
                    <T v="strong" style={{ flex: 1 }}>
                      {i.symbol}
                    </T>
                    <T v="small" c="muted" num>
                      {i.winRate === null ? '–' : percent(i.winRate)}
                    </T>
                    <T v="small" num style={{ minWidth: 90, textAlign: 'right', fontWeight: '600' }}>
                      {signedPoints(i.netPoints)}
                    </T>
                  </Pressable>
                ))}
              </Card>
            </>
          )}
          {r.trades.length > 0 && (
            <>
              <SectionTitle>Finished trades</SectionTitle>
              <View style={{ gap: space.sm }}>
                {r.trades.slice(0, 50).map((t) => (
                  <FinishedRow key={t.id} trade={t} />
                ))}
              </View>
            </>
          )}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, padding: space.md, gap: space.xs },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  instrument: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 40 },
});
