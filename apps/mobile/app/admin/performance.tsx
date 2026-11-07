import {
  BASIS_LABELS,
  type CalculationBasis,
  type InstrumentRow,
  money,
  percent,
  type PerformanceReport,
  type PerformanceStats,
  signedPoints,
} from '@signaldesk/domain';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { TradeRow } from '@/admin/parts';
import { api, queryString } from '@/lib/api';
import { space } from '@/theme/tokens';
import { Card, Chip, ChipRow, EmptyState, ErrorState, Loading, Notice, Screen, SectionTitle, Stat, T } from '@/ui';

const grid = { flexDirection: 'row', flexWrap: 'wrap', gap: space.lg } as const;

function BasisCard({
  basis,
  stats,
  comparable,
  currency,
}: {
  basis: CalculationBasis;
  stats: PerformanceStats;
  comparable: boolean;
  currency: string | null;
}) {
  return (
    <Card style={{ gap: space.md }} testID={`basis-${basis}`}>
      <T v="strong">{BASIS_LABELS[basis]}</T>
      <View style={grid}>
        <Stat
          label="Win rate"
          value={stats.winRate === null ? 'n/a' : percent(stats.winRate)}
          hint={`Of ${stats.winRateDenominator} measured`}
        />
        <Stat label="Wins / losses / flat" value={`${stats.wins} / ${stats.losses} / ${stats.breakevens}`} />
        {comparable && <Stat label="Net move" value={signedPoints(stats.netPoints)} />}
        {currency && stats.netPnl !== null && (
          <Stat
            label="Net result"
            value={money(stats.netPnl, currency)}
            hint={`${stats.monetaryTrades} with a position`}
          />
        )}
      </View>
    </Card>
  );
}

export default function Performance() {
  const [symbol, setSymbol] = useState('');
  const [basis, setBasis] = useState<CalculationBasis | ''>('');
  const instruments = useQuery({
    queryKey: ['admin', 'instruments'],
    queryFn: () => api.get<{ instruments: InstrumentRow[] }>('/admin/instruments'),
  });
  const report = useQuery({
    queryKey: ['admin', 'performance', symbol, basis],
    queryFn: () => api.get<PerformanceReport>(`/admin/performance${queryString({ symbol, basis })}`),
    placeholderData: keepPreviousData,
  });
  const refresh = useCallback(() => report.refetch(), [report]);
  const r = report.data;
  return (
    <Screen edges={['bottom']} refresh={refresh} testID="performance">
      <T c="muted">Internal analytics. Nothing here is visible to subscribers or the public.</T>
      <ChipRow>
        <Chip label="All instruments" on={!symbol} onPress={() => setSymbol('')} />
        {instruments.data?.instruments.map((i) => (
          <Chip key={i.id} label={i.symbol} on={symbol === i.symbol} onPress={() => setSymbol(i.symbol)} />
        ))}
      </ChipRow>
      <ChipRow>
        <Chip label="Both, kept separate" on={!basis} onPress={() => setBasis('')} />
        <Chip
          label="Hypothetical"
          on={basis === 'HYPOTHETICAL_OUTCOME'}
          onPress={() => setBasis('HYPOTHETICAL_OUTCOME')}
        />
        <Chip
          label="Declared"
          on={basis === 'ADMIN_DECLARED_EXECUTION'}
          onPress={() => setBasis('ADMIN_DECLARED_EXECUTION')}
        />
      </ChipRow>
      {report.isPending && <Loading rows={3} label="Calculating" />}
      {report.isError && !r && <ErrorState error={report.error} onRetry={() => void report.refetch()} />}
      {r && r.lifecycle.totalRecords === 0 && (
        <EmptyState icon="bar-chart-outline" title="No signals in this view yet">
          Publish and close some trades, or widen the filters.
        </EmptyState>
      )}
      {r && r.lifecycle.totalRecords > 0 && (
        <>
          <SectionTitle>Every record</SectionTitle>
          <Card style={grid}>
            <Stat label="Total" value={r.lifecycle.totalRecords} />
            <Stat label="Closed" value={r.lifecycle.finalized} hint={`${r.lifecycle.unresolved} not measurable`} />
            <Stat label="Open" value={r.lifecycle.open} />
            <Stat label="Awaiting entry" value={r.lifecycle.awaitingEntry} />
            <Stat label="Cancelled" value={r.lifecycle.cancelled} />
            <Stat label="Expired, no entry" value={r.lifecycle.expiredWithoutEntry} />
          </Card>
          <SectionTitle>By basis</SectionTitle>
          {!r.pointsComparable && (
            <Notice tone="neutral">
              Choose one instrument to see net moves. A point on one instrument is not worth the same as a point on
              another.
            </Notice>
          )}
          {r.byBasis.map((b) => (
            <BasisCard
              key={b.basis}
              basis={b.basis}
              stats={b.stats}
              comparable={r.pointsComparable}
              currency={r.quoteCurrency}
            />
          ))}
          {r.records.length > 0 && (
            <>
              <SectionTitle>Finished records</SectionTitle>
              <View style={{ gap: space.sm }}>
                {r.records.slice(0, 50).map((t) => (
                  <TradeRow key={t.id} trade={t} />
                ))}
              </View>
              {(r.truncated || r.records.length > 50) && (
                <T v="caption" c="subtle" center>
                  Showing the newest. Filter to see others.
                </T>
              )}
            </>
          )}
          <SectionTitle>{`How this is calculated (${r.methodology.version})`}</SectionTitle>
          <Card style={{ gap: space.sm }}>
            {r.methodology.statements.map((s) => (
              <T key={s} v="small" c="muted">
                {s}
              </T>
            ))}
          </Card>
        </>
      )}
    </Screen>
  );
}
